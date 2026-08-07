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
