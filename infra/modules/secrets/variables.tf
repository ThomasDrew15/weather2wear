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

variable "cosmos_account_id" {
  description = "Resource ID of the Cosmos DB account (from the data module), for scoping the SQL role assignment."
  type        = string
}

variable "cosmos_account_name" {
  description = "Name of the Cosmos DB account (from the data module)."
  type        = string
}

variable "cosmos_database_name" {
  description = "Name of the Cosmos SQL database (from the data module)."
  type        = string
}

variable "operator_group_object_id" {
  description = "Object ID of the operators AAD group (bootstrap's operator_group_object_id output). Role assignments target this group, not the currently authenticated caller, so a different identity running terraform apply doesn't silently replace them."
  type        = string
}
