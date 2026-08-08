# Root module for the live environment. Composes the data, secrets,
# backend-compute, frontend, and observability modules as they're built
# (Milestones 2, 3, 6, 7).

locals {
  common_tags = {
    project     = "weather-outfit-advisor"
    managedBy   = "terraform"
    environment = "live"
  }

  resource_group_name = "rg-woa-live"
  location            = "uksouth"

  # From bootstrap's operator_group_object_id output. Bootstrap uses local
  # state, so this can't be read via remote state — copied by hand after
  # `terraform apply` in infra/bootstrap, same pattern as backend.tf's
  # storage account name.
  operator_group_object_id = "d4f3df6b-70b2-4710-9617-38fa66e74080"

  # Same CI service principal as dev — one GitHub Actions OIDC identity,
  # granted Contributor separately on both rg-woa-dev and rg-woa-live.
  ci_principal_id = "9f50e509-8487-47c8-bd13-96fa2f5e8687"
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

  operator_group_object_id = local.operator_group_object_id
}

module "backend_compute" {
  source = "../../modules/backend-compute"

  project_short_name  = "woa"
  environment         = "live"
  resource_group_name = local.resource_group_name
  location            = local.location
  tags                = local.common_tags

  identity_id             = module.secrets.identity_id
  identity_client_id      = module.secrets.identity_client_id
  identity_principal_id   = module.secrets.identity_principal_id
  key_vault_uri           = module.secrets.key_vault_uri
  cosmos_account_endpoint = module.data.cosmos_account_endpoint

  ci_principal_id          = local.ci_principal_id
  operator_group_object_id = local.operator_group_object_id
}
