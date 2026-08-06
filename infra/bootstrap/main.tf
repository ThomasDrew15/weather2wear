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

# Grants the operator running `terraform apply` (via az login) management
# access so secrets can be seeded before the Managed Identity exists.
resource "azurerm_role_assignment" "bootstrap_operator" {
  scope                = azurerm_key_vault.bootstrap.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = data.azurerm_client_config.current.object_id
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
}

resource "azurerm_role_assignment" "github_actions_live" {
  scope                = azurerm_resource_group.live.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.github_actions.object_id
}
