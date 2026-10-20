variable "aws_region" {
  description = "The target AWS region for the ZENTRA staging deployment."
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "staging"
}

variable "project_name" {
  description = "Project name prefix."
  type        = string
  default     = "zentra"
}

variable "vpc_cidr" {
  description = "CIDR block for staging VPC."
  type        = string
  default     = "10.100.0.0/16"
}

variable "availability_zones" {
  description = "Target Availability Zones in ap-south-1."
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b"]
}

variable "db_instance_class" {
  description = "RDS DB instance class for PostgreSQL Multi-AZ."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "Initial storage allocated for PostgreSQL instance (GB)."
  type        = number
  default     = 50
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling upper limit (GB)."
  type        = number
  default     = 200
}

variable "db_backup_retention_days" {
  description = "Automated backup retention days (Step 2A baseline: 7 days)."
  type        = number
  default     = 7
}

variable "single_nat_gateway" {
  description = "Whether to use a single NAT Gateway in staging to optimize cost."
  type        = bool
  default     = true
}

variable "staging_domain" {
  description = "Authoritative staging domain name (currently blocked by BLK-STG-02)."
  type        = string
  default     = ""
}
