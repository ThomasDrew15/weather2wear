data "azurerm_client_config" "current" {}

locals {
  common_tags = {
    project   = var.project_name
    managedBy = "terraform"
  }

  bootstrap_tags = merge(local.common_tags, { environment = "bootstrap", layer = "bootstrap" })
}

# Storage account names must be globally unique across Azure, so a random
# suffix is appended rather than relying on the project name alone.
resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
  numeric = true
}

resource "azurerm_resource_group" "bootstrap" {
  name     = "rg-${var.project_short_name}-bootstrap"
  location = var.location

  tags = local.bootstrap_tags
}

# Holds Terraform state for every other module/environment. Destroying this
# by accident takes out the state for the whole project, hence prevent_destroy.
resource "azurerm_storage_account" "tfstate" {
  name                     = "st${var.project_short_name}tfstate${random_string.suffix.result}"
  resource_group_name      = azurerm_resource_group.bootstrap.name
  location                 = azurerm_resource_group.bootstrap.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"

  blob_properties {
    versioning_enabled = true
  }

  tags = local.bootstrap_tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"
}

# Initial Key Vault for the bootstrap phase. The `secrets` module (Milestone 2)
# creates the user-assigned Managed Identity and its role assignments against
# this vault; this module only provisions the vault itself.
resource "azurerm_key_vault" "bootstrap" {
  name                = "kv-${var.project_short_name}-boot-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.bootstrap.name
  location            = azurerm_resource_group.bootstrap.location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  rbac_authorization_enabled = true

  # Explicit per the threat model doc, not left to provider defaults.
  purge_protection_enabled   = true
  soft_delete_retention_days = 90

  tags = local.bootstrap_tags

  lifecycle {
    prevent_destroy = true
  }
}

# Operator role assignments target this group's object ID, not
# data.azurerm_client_config.current.object_id directly. principal_id is
# ForceNew on azurerm_role_assignment, so binding straight to "whoever is
# currently authenticated" means a different machine/identity running
# `terraform apply` would silently replace these assignments — revoking the
# previous operator's access as a side effect of an unrelated apply, rather
# than a deliberate decision. The group is a stable target; membership is
# managed separately from the resources that depend on it.
resource "azuread_group" "operators" {
  display_name     = "${var.project_short_name}-operators"
  security_enabled = true
  description      = "Operators permitted to manage secrets/state for ${var.project_name}. Role assignments target this group instead of individual principals."
}

resource "azuread_group_member" "current_operator" {
  group_object_id  = azuread_group.operators.object_id
  member_object_id = data.azurerm_client_config.current.object_id
}

# create_before_destroy on every role assignment below: principal_id is
# ForceNew, so a replacement would otherwise revoke access, then grant it —
# a real gap in between, hit for real in Milestone 2 (see engineering log
# §7). create_before_destroy flips the order to grant, then revoke, so
# there's never a moment with neither in place.

# Grants the operator group management access so secrets can be seeded
# before the Managed Identity exists.
resource "azurerm_role_assignment" "bootstrap_operator" {
  scope                = azurerm_key_vault.bootstrap.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = azuread_group.operators.object_id

  lifecycle {
    create_before_destroy = true
  }
}

# Same reasoning as the github_actions_tfstate_* assignments below: local
# `terraform init`/`plan`/`apply` in dev/live now uses use_azuread_auth too,
# so the operator group needs the same two roles on the storage account.
resource "azurerm_role_assignment" "bootstrap_operator_tfstate_reader" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Reader"
  principal_id         = azuread_group.operators.object_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "azurerm_role_assignment" "bootstrap_operator_tfstate_blob_contributor" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azuread_group.operators.object_id

  lifecycle {
    create_before_destroy = true
  }
}

# --- dev/live resource group containers -----------------------------------
# Pre-created here (rather than by the dev/live environments themselves) so
# the GitHub Actions OIDC identity below can be scoped to specific resource
# groups from day one, instead of needing subscription-wide Contributor as a
# stopgap. Milestone 2+ modules deploy into these.

resource "azurerm_resource_group" "dev" {
  name     = "rg-${var.project_short_name}-dev"
  location = var.location

  tags = merge(local.common_tags, { environment = "dev", layer = "app" })
}

resource "azurerm_resource_group" "live" {
  name     = "rg-${var.project_short_name}-live"
  location = var.location

  tags = merge(local.common_tags, { environment = "live", layer = "app" })
}

# --- GitHub Actions OIDC identity ------------------------------------------
# Lets GitHub Actions authenticate to Azure via short-lived federated tokens
# instead of a stored service principal secret (see architecture doc's
# CI/CD → Azure authentication section).

resource "azuread_application_registration" "github_actions" {
  display_name = "${var.project_short_name}-github-actions"
}

resource "azuread_service_principal" "github_actions" {
  client_id = azuread_application_registration.github_actions.client_id
}

# Subject is scoped to one specific repo and branch — not a wildcard — per
# the threat model doc's OIDC federation mitigation.
resource "azuread_application_federated_identity_credential" "github_actions_main" {
  application_id = azuread_application_registration.github_actions.id
  display_name   = "github-actions-${var.github_branch}"
  description    = "GitHub Actions on push to ${var.github_branch} in ${var.github_org}/${var.github_repo}."
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_org}@${var.github_org_id}/${var.github_repo}@${var.github_repo_id}:ref:refs/heads/${var.github_branch}"
}

# Contributor scoped to the two app resource groups only — never
# subscription-wide, per the threat model doc.
resource "azurerm_role_assignment" "github_actions_dev" {
  scope                = azurerm_resource_group.dev.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.github_actions.object_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "azurerm_role_assignment" "github_actions_live" {
  scope                = azurerm_resource_group.live.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.github_actions.object_id

  lifecycle {
    create_before_destroy = true
  }
}

# The azurerm backend also needs to read/write the tfstate storage account
# itself for `terraform init`/`plan` to work at all. Scoped to just the
# storage account, not the whole rg-woa-bootstrap RG, so this identity still
# never gets Key Vault access — discovered as a genuine 403 on the first
# real CI run, not assumed up front.
resource "azurerm_role_assignment" "github_actions_tfstate_reader" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Reader"
  principal_id         = azuread_service_principal.github_actions.object_id

  lifecycle {
    create_before_destroy = true
  }
}

resource "azurerm_role_assignment" "github_actions_tfstate_blob_contributor" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azuread_service_principal.github_actions.object_id

  lifecycle {
    create_before_destroy = true
  }
}
