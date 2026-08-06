variable "project_name" {
  description = "Full project name, used in resource tags."
  type        = string
  default     = "weather-outfit-advisor"
}

variable "project_short_name" {
  description = "Short project prefix used in Azure resource names. Kept short to fit storage account (24 char) and Key Vault (24 char) name limits."
  type        = string
  default     = "woa"
}

variable "location" {
  description = "Azure region for bootstrap resources."
  type        = string
  default     = "uksouth"
}

variable "github_org" {
  description = "GitHub org/user that owns the repo, for scoping the OIDC federated credential."
  type        = string
  default     = "ThomasDrew15"
}

variable "github_repo" {
  description = "GitHub repository name, for scoping the OIDC federated credential."
  type        = string
  default     = "weather2wear"
}

variable "github_branch" {
  description = "Branch the OIDC federated credential trusts. Deploy-capable CI only runs from this branch, never PRs from forks."
  type        = string
  default     = "main"
}
