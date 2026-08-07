output "cosmos_account_id" {
  description = "Resource ID of the Cosmos DB account. Used by the secrets module to scope the SQL role assignment."
  value       = azurerm_cosmosdb_account.this.id
}

output "cosmos_account_name" {
  description = "Name of the Cosmos DB account."
  value       = azurerm_cosmosdb_account.this.name
}

output "cosmos_account_endpoint" {
  description = "Data-plane endpoint for the Cosmos DB account. Used by backend-compute (Milestone 3) to connect via the Managed Identity."
  value       = azurerm_cosmosdb_account.this.endpoint
}

output "cosmos_database_name" {
  description = "Name of the Cosmos SQL database."
  value       = azurerm_cosmosdb_sql_database.this.name
}

output "users_container_name" {
  value = azurerm_cosmosdb_sql_container.users.name
}

output "login_tokens_container_name" {
  value = azurerm_cosmosdb_sql_container.login_tokens.name
}
