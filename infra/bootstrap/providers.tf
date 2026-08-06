provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }
}

provider "azuread" {}

# Local auth only — az login, per the architecture doc's local dev workflow.
# No stored Azure credentials for this module. (az login needs the
# `--scope https://graph.microsoft.com/.default` addition for azuread
# resources to authenticate — see the graph-token fix earlier in Milestone 1.)
