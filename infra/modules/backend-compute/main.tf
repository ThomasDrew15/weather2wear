# Storage account backing the Function App's own runtime state (deployment
# package, trigger bookkeeping) — distinct from the app's Cosmos DB, which is
# where actual application data lives. Storage account names must be
# globally unique and lowercase alphanumeric only, hence the random suffix,
# same constraint bootstrap's tfstate storage account hit.
resource "random_string" "func_storage_suffix" {
  length  = 6
  special = false
  upper   = false
  numeric = true
}

resource "azurerm_storage_account" "function" {
  name                = "st${var.project_short_name}${var.environment}func${random_string.func_storage_suffix.result}"
  resource_group_name = var.resource_group_name
  location            = var.location

  account_tier             = "Standard"
  account_replication_type = "LRS"

  # No master-key auth here either — same convention as tfstate storage and
  # Cosmos. The Function App authenticates via its Managed Identity instead
  # (storage_uses_managed_identity below), so the key is never needed.
  shared_access_key_enabled = false

  tags = var.tags
}

# Required for a Function App to use its Managed Identity against its own
# runtime storage instead of a connection string with an embedded key.
resource "azurerm_role_assignment" "app_storage_blob_data_owner" {
  scope                = azurerm_storage_account.function.id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = var.identity_principal_id

  lifecycle {
    create_before_destroy = true
  }
}

# Separate from the app identity's grant above — this is for whoever runs
# `terraform apply` itself (CI, or a local operator), not the deployed app.
# With storage_use_azuread = true on the provider (required because this
# storage account also has shared_access_key_enabled = false), Terraform's
# own apply-time calls against the storage account — e.g. reading queue
# properties as part of managing the resource — authenticate as AAD too,
# and generic Contributor doesn't include Storage data-plane actions.
# Function App storage uses blob, queue, and table internally, so all
# three data roles are granted rather than only the one specific service
# whichever error happened to surface first.
locals {
  storage_data_plane_principals = [var.ci_principal_id, var.operator_group_object_id]
  storage_data_plane_roles      = ["Storage Blob Data Contributor", "Storage Queue Data Contributor", "Storage Table Data Contributor"]

  storage_data_plane_grants = {
    for pair in setproduct(local.storage_data_plane_principals, local.storage_data_plane_roles) :
    "${pair[0]}-${replace(pair[1], " ", "")}" => { principal_id = pair[0], role = pair[1] }
  }
}

resource "azurerm_role_assignment" "function_storage_data_plane" {
  for_each = local.storage_data_plane_grants

  scope                = azurerm_storage_account.function.id
  role_definition_name = each.value.role
  principal_id         = each.value.principal_id

  lifecycle {
    create_before_destroy = true
  }
}

# Consumption plan (Y1) — scales to zero, matching the "near-zero cost when
# idle" reasoning for Functions over AKS in v1 (see architecture doc). Plan
# type and Node runtime version below were confirmed live via
# `az functionapp list-runtimes --os linux` on 2026-08-08 (node 18/20/22/24
# all currently supported) — re-check the same way before applying if this
# sits unapplied for a while, since Azure periodically changes what's
# recommended/supported here.
resource "azurerm_service_plan" "this" {
  name                = "plan-${var.project_short_name}-${var.environment}"
  resource_group_name = var.resource_group_name
  location            = var.location
  os_type             = "Linux"
  sku_name            = "Y1"

  tags = var.tags
}

resource "azurerm_linux_function_app" "this" {
  name                = "func-${var.project_short_name}-${var.environment}"
  resource_group_name = var.resource_group_name
  location            = var.location

  service_plan_id = azurerm_service_plan.this.id

  storage_account_name          = azurerm_storage_account.function.name
  storage_uses_managed_identity = true

  https_only = true

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  site_config {
    minimum_tls_version = "1.2"

    # Hard ceiling on how far this app can ever scale out. Not a per-caller
    # rate limit (that's the AI-advisor's own Cosmos-backed limiter) but a
    # global blast-radius cap: it bounds worst-case spend and worst-case
    # upstream call volume — against both Azure OpenAI's TPM quota and the Met
    # Office free tier's 360 calls/day — no matter what traffic arrives.
    # Consumption scales to zero regardless, so this costs nothing when idle.
    app_scale_limit = var.function_app_scale_limit

    # Node 20 hit end-of-life 2026-04 (per the official Node.js release
    # schedule) — not just a stale default, a real reason to avoid it.
    # Node 22 is the current minimum LTS both Azure Functions and the
    # @azure/* SDK packages (their engines field now requires >=22) support.
    application_stack {
      node_version = "22"
    }
  }

  app_settings = {
    FUNCTIONS_WORKER_RUNTIME = "node"

    # Points DefaultAzureCredential at this specific user-assigned identity
    # rather than letting it search — matters once more than one identity
    # could plausibly be attached to a host.
    AZURE_CLIENT_ID = var.identity_client_id

    # storage_uses_managed_identity alone isn't enough with a *user*-assigned
    # identity: the Functions host defaults to looking for a system-assigned
    # one and fails to authenticate to its own runtime storage. These name the
    # identity explicitly. Without them the deploy itself succeeds but the
    # sync-trigger step fails ("Function app may have malformed content"),
    # because the host can't read its own package back out of storage.
    AzureWebJobsStorage__clientId   = var.identity_client_id
    AzureWebJobsStorage__credential = "managedidentity"

    # Same problem for the deployment package specifically — the Linux
    # Consumption RBAC deploy path (WEBSITE_RUN_FROM_PACKAGE) needs the
    # identity named by resource ID, not just client ID.
    WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID = var.identity_id

    KEY_VAULT_URI           = var.key_vault_uri
    COSMOS_ACCOUNT_ENDPOINT = var.cosmos_account_endpoint

    # Azure OpenAI (Milestone 4). Endpoint and deployment name only — there is
    # no key setting here because the account has local_auth_enabled = false;
    # the app authenticates with AZURE_CLIENT_ID's identity above. The
    # deployment name is config rather than a code constant so the model can be
    # swapped without a code change.
    AZURE_OPENAI_ENDPOINT   = var.openai_endpoint
    AZURE_OPENAI_DEPLOYMENT = var.openai_deployment_name
  }

  # Defaults to "SystemAssigned", which doesn't exist on this app — any future
  # Key Vault reference would silently fail to resolve. Not currently used
  # (secrets are read via the SDK at runtime, not Key Vault references), but
  # wrong-by-default is worth correcting while the identity wiring is fresh.
  key_vault_reference_identity_id = var.identity_id

  tags = var.tags

  # Carried forward from Milestone 3: the deploy action (Azure/functions-action)
  # sets these two app settings itself, and they're absent from the config
  # above, so every `terraform apply` stripped them and every deploy re-added
  # them. Harmless given the workflow's ordering (apply runs before deploy) but
  # it made every plan noisier than it should be, and plan noise is how real
  # changes get skimmed past. Scoped to these two keys specifically rather than
  # ignoring app_settings wholesale — a blanket ignore would also silently drop
  # genuine changes to the settings above.
  lifecycle {
    ignore_changes = [
      app_settings["WEBSITE_RUN_FROM_PACKAGE"],
      app_settings["WEBSITE_ENABLE_SYNC_UPDATE_SITE"],
    ]
  }

  # Managed-identity storage access must exist before the Function App tries
  # to use it.
  depends_on = [azurerm_role_assignment.app_storage_blob_data_owner]
}
