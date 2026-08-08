output "function_app_name" {
  description = "Name of the dev Function App — consumed by CI to target code deploys and the post-deploy Cosmos smoke-test check."
  value       = module.backend_compute.function_app_name
}

output "resource_group_name" {
  description = "Resource group the dev Function App lives in — consumed by CI's post-deploy smoke-test step."
  value       = local.resource_group_name
}
