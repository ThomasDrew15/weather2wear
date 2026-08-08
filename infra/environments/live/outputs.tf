output "function_app_name" {
  description = "Name of the live Function App. Not currently consumed by any automated pipeline — live deploys stay manual, see the backend-deploy workflow's dev-only scope."
  value       = module.backend_compute.function_app_name
}
