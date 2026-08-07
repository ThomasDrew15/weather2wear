# Serverless capacity mode — pay-per-request, no always-on cost, matching
# the reasoning for Functions over AKS in v1 (see architecture doc's Data
# Layer section).
resource "azurerm_cosmosdb_account" "this" {
  name                = "cosmos-${var.project_short_name}-${var.environment}"
  resource_group_name = var.resource_group_name
  location            = var.location
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  capabilities {
    name = "EnableServerless"
  }

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = var.location
    failover_priority = 0
  }

  # No master-key auth, ever — data-plane access is via the Cosmos SQL role
  # assignment in the secrets module, tied to the app's Managed Identity.
  # Threat model: "Prefer Cosmos DB's Azure AD/RBAC data-plane access...
  # over master keys — avoids another long-lived secret entirely."
  local_authentication_enabled = false

  tags = var.tags
}

resource "azurerm_cosmosdb_sql_database" "this" {
  name                = "woa"
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.this.name
}

# Partitioned by /email — see data model doc: makes "load this user's data"
# a single-partition point read, the cheapest operation at serverless tier.
resource "azurerm_cosmosdb_sql_container" "users" {
  name                = "users"
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.this.name
  database_name       = azurerm_cosmosdb_sql_database.this.name
  partition_key_paths = ["/email"]
}

# TTL enabled at the container level with no default (-1) — only items that
# set their own `ttl` field expire, per the loginTokens shape in the data
# model doc. Persistent user docs above get no TTL at all.
resource "azurerm_cosmosdb_sql_container" "login_tokens" {
  name                = "loginTokens"
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.this.name
  database_name       = azurerm_cosmosdb_sql_database.this.name
  partition_key_paths = ["/email"]
  default_ttl         = -1
}
