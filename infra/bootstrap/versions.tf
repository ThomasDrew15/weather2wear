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
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
  }

  # Bootstrap creates the remote state backend for everything else — it has
  # nothing to point to yet. State stays local and this module is applied
  # once, manually, separately from the dev/live environments.
  backend "local" {}
}
