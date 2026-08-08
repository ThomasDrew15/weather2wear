output "function_app_name" {
  description = "Name of the Function App — used by CI to target code deploys and the post-deploy Cosmos smoke-test check."
  value       = azurerm_linux_function_app.this.name
}

output "function_app_default_hostname" {
  description = "Default hostname of the Function App."
  value       = azurerm_linux_function_app.this.default_hostname
}

output "function_app_id" {
  description = "Resource ID of the Function App."
  value       = azurerm_linux_function_app.this.id
}
