# Inputs. Fill via terraform.tfvars (see terraform.tfvars.example) or -var.
# No secrets have defaults; the API token comes from CLOUDFLARE_API_TOKEN env.

variable "zone_id" {
  type        = string
  description = "Cloudflare Zone ID for the Verity apex/domain."
}

variable "account_id" {
  type        = string
  description = "Cloudflare Account ID (for the Pages project)."
}

variable "api_hostname" {
  type        = string
  description = "Public gateway hostname the WAF/rate rules apply to (e.g. api.verity.example)."
}

variable "app_hostname" {
  type        = string
  description = "Public frontend hostname served by Pages (e.g. app.verity.example)."
}

variable "pages_project_name" {
  type        = string
  default     = "verity-web"
  description = "Cloudflare Pages project name for the apps/web static export."
}

variable "github_owner" {
  type        = string
  default     = ""
  description = "GitHub owner for the Pages source repo (optional; blank = direct upload / CI deploy)."
}

variable "github_repo" {
  type        = string
  default     = ""
  description = "GitHub repo name for the Pages source (optional)."
}

variable "production_branch" {
  type        = string
  default     = "main"
  description = "Branch Pages treats as production."
}
