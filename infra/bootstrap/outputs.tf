output "resource_group_name" {
  description = "Resource group holding the bootstrap resources."
  value       = azurerm_resource_group.bootstrap.name
}

output "tfstate_storage_account_name" {
  description = "Storage account for Terraform remote state. Used in each environment's azurerm backend block."
  value       = azurerm_storage_account.tfstate.name
}

output "tfstate_container_name" {
  description = "Blob container for Terraform remote state. Used in each environment's azurerm backend block."
  value       = azurerm_storage_container.tfstate.name
}

output "key_vault_name" {
  description = "Name of the bootstrap Key Vault."
  value       = azurerm_key_vault.bootstrap.name
}

output "key_vault_uri" {
  description = "URI of the bootstrap Key Vault."
  value       = azurerm_key_vault.bootstrap.vault_uri
}

output "tenant_id" {
  description = "Azure AD tenant ID, for reuse in downstream modules."
  value       = data.azurerm_client_config.current.tenant_id
}

output "subscription_id" {
  description = "Azure subscription ID, for reuse in downstream modules and CI."
  value       = data.azurerm_client_config.current.subscription_id
}

output "dev_resource_group_name" {
  description = "Empty resource group for the dev environment's app resources."
  value       = azurerm_resource_group.dev.name
}

output "live_resource_group_name" {
  description = "Empty resource group for the live environment's app resources."
  value       = azurerm_resource_group.live.name
}

output "github_actions_client_id" {
  description = "Client ID of the GitHub Actions OIDC app registration. Set as the AZURE_CLIENT_ID repo variable in GitHub."
  value       = azuread_application_registration.github_actions.client_id
}

output "operator_group_object_id" {
  description = "Object ID of the operators AAD group. Bootstrap uses local state, so this can't be read via remote state — copy it into environments/*/main.tf's secrets module wiring by hand after apply."
  value       = azuread_group.operators.object_id
}
