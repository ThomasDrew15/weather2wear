output "key_vault_name" {
  value = azurerm_key_vault.this.name
}

output "key_vault_uri" {
  value = azurerm_key_vault.this.vault_uri
}

output "identity_id" {
  description = "Resource ID of the user-assigned Managed Identity. Attached to the Function App in Milestone 3."
  value       = azurerm_user_assigned_identity.app.id
}

output "identity_principal_id" {
  value = azurerm_user_assigned_identity.app.principal_id
}

output "identity_client_id" {
  description = "Client ID the Function App's identity block references (Milestone 3)."
  value       = azurerm_user_assigned_identity.app.client_id
}
