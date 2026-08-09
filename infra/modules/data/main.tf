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

# Rate-limit counters for the AI-advisor Function (Milestone 4). Partitioned by
# /key (the caller identifier) so a limit check is a single-partition point
# read, the same cost reasoning the data model doc applies to /email elsewhere.
#
# TTL enabled with no blanket default (-1), exactly like loginTokens above:
# each counter sets its own short `ttl` and deletes itself once its window has
# passed, so there's no cleanup job and no unbounded growth from one document
# per caller per window.
resource "azurerm_cosmosdb_sql_container" "rate_limits" {
  name                = "rateLimits"
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.this.name
  database_name       = azurerm_cosmosdb_sql_database.this.name
  partition_key_paths = ["/key"]
  default_ttl         = -1
}

# --- Azure OpenAI (Milestone 4) ---------------------------------------------
#
# Lives in `data`, not `backend-compute`, for the same reason the Managed
# Identity lives in `secrets`: backend-compute is destroyed and recreated
# routinely for cost management (see architecture doc's Cost Management
# section), and a model deployment is exactly the kind of slow-to-reprovision,
# quota-scarce resource that must survive that teardown.
resource "azurerm_cognitive_account" "openai" {
  name                = "oai-${var.project_short_name}-${var.environment}"
  resource_group_name = var.resource_group_name
  location            = var.location

  kind     = "OpenAI"
  sku_name = "S0"

  # Required: the data-plane hostname is derived from this, and it must be
  # globally unique. Left implicit it defaults to the resource name, which is
  # already unique enough here (project + environment).
  custom_subdomain_name = "oai-${var.project_short_name}-${var.environment}"

  # No API key auth, ever — the app reaches this account via the user-assigned
  # Managed Identity's "Cognitive Services OpenAI User" role assignment (see
  # the secrets module). Same convention as Cosmos above
  # (local_authentication_enabled = false) and the Function's runtime storage
  # (shared_access_key_enabled = false): a credential that doesn't exist is a
  # credential that can't leak.
  #
  # Note this deliberately supersedes the build-order doc's Milestone 4 line
  # about seeding an API key into Key Vault — see the Milestone 4 engineering
  # log for the reasoning.
  local_auth_enabled = false

  tags = var.tags
}

# Model deployment. gpt-4.1-mini is the standardized choice (see the v1 scope
# doc's resolved-decisions log): it has real quota on both this subscription's
# current Free Tier and the Tier 1 it upgrades to, and stays on the plain
# chat-completions API — unlike the gpt-5 series, which Microsoft classifies as
# reasoning models with different parameters and hidden billed reasoning tokens.
#
# Model name/version and SKU availability confirmed live against this region
# before applying (`az cognitiveservices model list -l uksouth`,
# `az cognitiveservices usage list -l uksouth`), not assumed from docs — the
# same discipline the Node runtime version got in backend-compute.
resource "azurerm_cognitive_deployment" "chat" {
  name                 = var.openai_deployment_name
  cognitive_account_id = azurerm_cognitive_account.openai.id

  model {
    format  = "OpenAI"
    name    = "gpt-4.1-mini"
    version = "2025-04-14"
  }

  sku {
    name = "GlobalStandard"

    # Thousands of tokens per minute. The subscription's Free Tier quota for
    # GlobalStandard gpt-4.1-mini is 200 (i.e. 200k TPM); deliberately taking a
    # small slice of it rather than the lot, so the remainder stays available
    # for a second environment or a future model without a quota fight.
    capacity = var.openai_deployment_capacity
  }
}
