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

# Consumption plan (Y1) — scales to zero, matching the "near-zero cost when
# idle" reasoning for Functions over AKS in v1 (see architecture doc). Plan
# type and Node runtime version below were current as of this module's
# authoring (2026-08) — Azure periodically changes what's recommended here,
# so verify against `az functionapp list-runtimes` or current docs before
# applying if this sits unapplied for a while.
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

    application_stack {
      node_version = "20"
    }
  }

  app_settings = {
    FUNCTIONS_WORKER_RUNTIME = "node"

    # Points DefaultAzureCredential at this specific user-assigned identity
    # rather than letting it search — matters once more than one identity
    # could plausibly be attached to a host.
    AZURE_CLIENT_ID = var.identity_client_id

    KEY_VAULT_URI           = var.key_vault_uri
    COSMOS_ACCOUNT_ENDPOINT = var.cosmos_account_endpoint
  }

  tags = var.tags

  # Managed-identity storage access must exist before the Function App tries
  # to use it.
  depends_on = [azurerm_role_assignment.app_storage_blob_data_owner]
}
