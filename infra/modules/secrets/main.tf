data "azurerm_client_config" "current" {}

# Key Vault names must be globally unique across Azure, same constraint the
# bootstrap module hit for its storage account and vault names.
resource "random_string" "kv_suffix" {
  length  = 6
  special = false
  upper   = false
  numeric = true
}

# Per-environment vault, distinct from bootstrap's — that one only exists to
# hold Terraform's own bootstrap-phase secrets before this identity existed.
resource "azurerm_key_vault" "this" {
  name                = "kv-${var.project_short_name}-${var.environment}-${random_string.kv_suffix.result}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  rbac_authorization_enabled = true

  # Explicit per the threat model doc, not left to provider defaults.
  purge_protection_enabled   = true
  soft_delete_retention_days = 90

  tags = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

# Lets the operator running `terraform apply` (via az login) write the
# secret value below. Narrower than bootstrap's "Key Vault Administrator" —
# this vault only ever needs secret read/write, no access-policy/purge
# management, so Secrets Officer is the correct least-privilege fit.
resource "azurerm_role_assignment" "operator_kv_secrets_officer" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Created once, referenced by backend-compute in Milestone 3 — persists
# independently of whether backend-compute currently exists. See
# architecture doc's Secrets Management section for the full "why
# user-assigned, not system-assigned" reasoning.
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${var.project_short_name}-${var.environment}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

# Read-only — the app only ever reads secrets. Writes happen via the
# operator's Secrets Officer role above, not the app identity.
resource "azurerm_role_assignment" "app_kv_secrets_user" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# Cosmos DB SQL role assignment (data-plane RBAC), not azurerm_role_assignment
# — Cosmos's data plane has its own RBAC system, separate from Azure RBAC.
# Built-in Data Contributor (00000000-0000-0000-0000-000000000002) scoped to
# the database, covering both containers without granting anything at the
# subscription/account-management level.
resource "azurerm_cosmosdb_sql_role_assignment" "app_data_contributor" {
  resource_group_name = var.resource_group_name
  account_name        = var.cosmos_account_name
  role_definition_id  = "${var.cosmos_account_id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_user_assigned_identity.app.principal_id
  scope               = "${var.cosmos_account_id}/dbs/${var.cosmos_database_name}"
}

# Secret values are deliberately NOT managed here. If Terraform wrote the
# value into an azurerm_key_vault_secret resource, it would also record that
# value in Terraform state to track drift — duplicating the secret into a
# file that isn't designed to hold one. Instead, secrets are seeded directly
# via `az keyvault secret set --vault-name <name> --name <secret> --value
# <value>` after this vault exists, so Terraform only ever manages the vault
# container and access, never the value itself. See engineering log for
# Milestone 2.
