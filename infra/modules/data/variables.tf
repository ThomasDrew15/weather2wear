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

variable "openai_deployment_name" {
  description = "Name of the Azure OpenAI model deployment. Passed to the app as a config value rather than hardcoded in code, so the model can be swapped without a code change (see the v1 scope doc's resolved-decisions log)."
  type        = string
  default     = "chat"
}

variable "openai_deployment_capacity" {
  description = "Deployment capacity in thousands of tokens per minute. Kept well below the subscription's available quota so a second environment or model doesn't need a quota increase."
  type        = number
  default     = 20
}
