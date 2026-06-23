variable "aws_region" {
  description = "AWS region for the BSA V2 deployment."
  type        = string
  default     = "us-west-2"
}

variable "project_name" {
  description = "Short name used for AWS resource naming."
  type        = string
  default     = "bsa-v2"
}

variable "environment" {
  description = "Deployment environment label."
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "CIDR block for the dedicated app VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "allowed_ingress_cidrs" {
  description = "Public source CIDRs allowed to reach the ALB. Use Backblaze VPN/full-tunnel egress CIDRs here."
  type        = list(string)
  default = [
    "104.153.232.0/21",
    "149.137.128.0/20",
    "206.190.208.0/21",
    "45.11.36.0/22",
  ]
}

variable "enable_https" {
  description = "Create an HTTPS listener. Keep true for any login-capable deployment because production auth cookies require HTTPS."
  type        = bool
  default     = true
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener. Required when enable_https is true."
  type        = string
  default     = ""
}

variable "app_base_url" {
  description = "External URL used in magic links and PDF rendering, for example https://bsa.example.internal."
  type        = string
}

variable "container_image_tag" {
  description = "Container image tag deployed from the generated ECR repository."
  type        = string
  default     = "latest"
}

variable "cpu_architecture" {
  description = "Fargate CPU architecture. ARM64 matches Apple Silicon local builds unless you publish multi-arch images."
  type        = string
  default     = "ARM64"

  validation {
    condition     = contains(["ARM64", "X86_64"], var.cpu_architecture)
    error_message = "cpu_architecture must be ARM64 or X86_64."
  }
}

variable "app_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 1024
}

variable "app_memory" {
  description = "Fargate task memory in MiB."
  type        = number
  default     = 2048
}

variable "desired_count" {
  description = "Number of ECS tasks to run. Use 0 for initial infrastructure creation before secrets/image are ready."
  type        = number
  default     = 0
}

variable "database_name" {
  description = "RDS database name."
  type        = string
  default     = "b2savingsanalyzer"
}

variable "database_username" {
  description = "RDS master username."
  type        = string
  default     = "bsaapp"
}

variable "database_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "database_allocated_storage_gb" {
  description = "Initial RDS allocated storage in GiB."
  type        = number
  default     = 20
}

variable "database_backup_retention_days" {
  description = "RDS automated backup retention in days."
  type        = number
  default     = 7
}

variable "database_deletion_protection" {
  description = "Enable RDS deletion protection."
  type        = bool
  default     = false
}

variable "database_skip_final_snapshot" {
  description = "Skip RDS final snapshot on destroy. Prefer false for production."
  type        = bool
  default     = true
}

variable "allowed_email_domain" {
  description = "Comma-separated allowed login email domains."
  type        = string
  default     = "backblaze.com"
}

variable "email_from" {
  description = "From header for Resend magic-link emails."
  type        = string
  default     = "B2 Savings Analyzer <onboarding@resend.dev>"
}
