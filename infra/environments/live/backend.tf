# Values come from `terraform output` in infra/bootstrap, applied once first.
# This environment can't `terraform init` until bootstrap has run and these
# are filled in.
#
# use_azuread_auth: Terraform authenticates via Azure AD (az login locally,
# OIDC in CI) rather than the storage account's access key. Both the local
# operator and the GitHub Actions identity have Reader + Storage Blob Data
# Contributor scoped to just the tfstate storage account in
# infra/bootstrap/main.tf. Next: set shared_access_key_enabled = false on
# that storage account once nothing needs key-based auth any more.
terraform {
  backend "azurerm" {
    resource_group_name  = "rg-woa-bootstrap"
    storage_account_name = "stwoatfstatec9gjz3" # tfstate_storage_account_name output from bootstrap
    container_name       = "tfstate"
    key                  = "live.terraform.tfstate"
    use_azuread_auth     = true
  }
}
