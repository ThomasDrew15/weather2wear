# Root module for the live environment. Composes the data, secrets,
# backend-compute, frontend, and observability modules as they're built
# (Milestones 2-6).

locals {
  common_tags = {
    project     = "weather-outfit-advisor"
    managedBy   = "terraform"
    environment = "live"
  }

  resource_group_name = "rg-woa-live"
  location            = "uksouth"
}

module "data" {
  source = "../../modules/data"

  project_short_name  = "woa"
  environment         = "live"
  resource_group_name = local.resource_group_name
  location            = local.location
  tags                = local.common_tags
}

module "secrets" {
  source = "../../modules/secrets"

  project_short_name  = "woa"
  environment         = "live"
  resource_group_name = local.resource_group_name
  location            = local.location
  tags                = local.common_tags

  cosmos_account_id    = module.data.cosmos_account_id
  cosmos_account_name  = module.data.cosmos_account_name
  cosmos_database_name = module.data.cosmos_database_name
}
