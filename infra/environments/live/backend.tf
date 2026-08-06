# Values come from `terraform output` in infra/bootstrap, applied once first.
# This environment can't `terraform init` until bootstrap has run and these
# are filled in.
#
# TODO: add `use_azuread_auth = true` here once this backend is wired up and
# working, so Terraform authenticates via az login/Azure AD rather than the
# storage account's access key. Once every backend uses that, set
# shared_access_key_enabled = false on the storage account in
# infra/bootstrap/main.tf to close off key-based auth entirely — same
# reasoning as the threat model doc's "prefer Azure AD/RBAC over master keys"
# call for Cosmos DB.
terraform {
  backend "azurerm" {
    resource_group_name  = "rg-woa-bootstrap"
    storage_account_name = "stwoatfstatec9gjz3" # tfstate_storage_account_name output from bootstrap
    container_name       = "tfstate"
    key                  = "live.terraform.tfstate"
  }
}
