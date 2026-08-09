# Root module for the dev environment. Composes the data, secrets,
# backend-compute, frontend, and observability modules as they're built
# (Milestones 2, 3, 6, 7).

locals {
  common_tags = {
    project     = "weather-outfit-advisor"
    managedBy   = "terraform"
    environment = "dev"
  }

  resource_group_name = "rg-woa-dev"
  location            = "uksouth"

  # From bootstrap's operator_group_object_id output. Bootstrap uses local
  # state, so this can't be read via remote state — copied by hand after
  # `terraform apply` in infra/bootstrap, same pattern as backend.tf's
  # storage account name.
  operator_group_object_id = "d4f3df6b-70b2-4710-9617-38fa66e74080"

  # Object ID of the GitHub Actions CI service principal (bootstrap's
  # github_actions_client_id output, resolved to its service principal
  # object ID via `az ad sp show` — same "copied by hand, bootstrap uses
  # local state" pattern as operator_group_object_id above).
  ci_principal_id = "9f50e509-8487-47c8-bd13-96fa2f5e8687"
}

module "data" {
  source = "../../modules/data"

  project_short_name  = "woa"
  environment         = "dev"
  resource_group_name = local.resource_group_name
  location            = local.location
  tags                = local.common_tags
}

module "secrets" {
  source = "../../modules/secrets"

  project_short_name  = "woa"
  environment         = "dev"
  resource_group_name = local.resource_group_name
  location            = local.location
  tags                = local.common_tags

  cosmos_account_id    = module.data.cosmos_account_id
  cosmos_account_name  = module.data.cosmos_account_name
  cosmos_database_name = module.data.cosmos_database_name
  openai_account_id    = module.data.openai_account_id

  operator_group_object_id = local.operator_group_object_id
}

module "backend_compute" {
  source = "../../modules/backend-compute"

  project_short_name  = "woa"
  environment         = "dev"
  resource_group_name = local.resource_group_name
  location            = local.location
  tags                = local.common_tags

  identity_id             = module.secrets.identity_id
  identity_client_id      = module.secrets.identity_client_id
  identity_principal_id   = module.secrets.identity_principal_id
  key_vault_uri           = module.secrets.key_vault_uri
  cosmos_account_endpoint = module.data.cosmos_account_endpoint
  openai_endpoint         = module.data.openai_endpoint
  openai_deployment_name  = module.data.openai_deployment_name

  ci_principal_id          = local.ci_principal_id
  operator_group_object_id = local.operator_group_object_id
}
