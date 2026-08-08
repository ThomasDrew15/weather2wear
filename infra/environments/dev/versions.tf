terraform {
  required_version = ">= 1.9"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }

  # Required alongside shared_access_key_enabled = false on
  # backend-compute's storage account — without this, the provider's own
  # apply-time reads (e.g. queue properties) default to key-based auth
  # regardless of that setting and fail with 403
  # KeyBasedAuthenticationNotPermitted. Affects Terraform's own calls, not
  # the Function App's runtime access (that's storage_uses_managed_identity
  # on the Function App resource, a separate setting).
  storage_use_azuread = true
}
