variable "project_short_name" {
  description = "Short project prefix used in Azure resource names."
  type        = string
}

variable "environment" {
  description = "Environment name (dev/live), used in resource naming and tags."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group to deploy into (pre-created by bootstrap)."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "tags" {
  description = "Tags applied to all resources in this module."
  type        = map(string)
}

variable "identity_id" {
  description = "Resource ID of the user-assigned Managed Identity (from the secrets module), attached to the Function App."
  type        = string
}

variable "identity_client_id" {
  description = "Client ID of the Managed Identity (from the secrets module) — set as an app setting so DefaultAzureCredential resolves to this identity rather than guessing among several available to the host."
  type        = string
}

variable "identity_principal_id" {
  description = "Principal (object) ID of the Managed Identity (from the secrets module) — used here to grant it access to this module's own Function-runtime storage account."
  type        = string
}

variable "key_vault_uri" {
  description = "URI of the app's Key Vault (from the secrets module). Passed as an app setting and read at runtime via the SDK — not a Key Vault reference, consistent with secret values never being Terraform-managed."
  type        = string
}

variable "cosmos_account_endpoint" {
  description = "Data-plane endpoint of the Cosmos DB account (from the data module) — app setting for the Cosmos SDK client."
  type        = string
}
