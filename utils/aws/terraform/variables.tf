variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.medium"
}

variable "key_pair_name" {
  description = "Name of the AWS key pair for SSH access"
  type        = string
}

variable "allowed_ssh_cidr" {
  description = "CIDR block allowed for SSH access. Set to 'auto' or 'auto-detect' to auto-detect your public IP, specify an IP/CIDR (e.g., '203.0.113.45/32'), or use default '0.0.0.0/0' to allow access from anywhere (not recommended for production)"
  type        = string
  default     = "0.0.0.0/0"
  
  validation {
    condition     = var.allowed_ssh_cidr != "auto" && var.allowed_ssh_cidr != "auto-detect"
    error_message = "ERROR: 'auto' value detected in allowed_ssh_cidr! The create script should have replaced this with your IP. Please run: npm run aws:create"
  }
}

variable "allowed_http_cidr" {
  description = "CIDR block allowed for HTTP/HTTPS access to Tomcat. Set to 'auto' or 'auto-detect' to auto-detect your public IP, specify an IP/CIDR (e.g., '203.0.113.45/32'), or leave unset/null to allow access from anywhere (0.0.0.0/0)"
  type        = string
  default     = null
  
  validation {
    condition     = var.allowed_http_cidr == null || (var.allowed_http_cidr != "auto" && var.allowed_http_cidr != "auto-detect")
    error_message = "ERROR: 'auto' value detected in allowed_http_cidr! The create script should have replaced this with your IP. Please run: npm run aws:create"
  }
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "magnolia-author"
}

variable "tags" {
  description = "Common tags to apply to all resources. These tags are merged with automatic tags (Environment, Project, ManagedBy, CreatedDate, CreatedTime, TerraformRepo) for comprehensive resource tracking, cost allocation, and deployment management."
  type        = map(string)
  default = {
    Project     = "Magnolia-CMS"
    Environment = "Development"
    # Add additional tags here for cost tracking:
    # CostCenter  = "Engineering"
    # Team        = "Platform"
    # Application = "Magnolia-CMS"
    # Owner       = "platform-team@example.com"
  }
}

variable "postgres_db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "jackrabbit-author"
}

variable "postgres_db_user" {
  description = "PostgreSQL database user"
  type        = string
  default     = "magnolia"
}

variable "postgres_db_password" {
  description = "PostgreSQL database password"
  type        = string
  sensitive   = true
}

variable "postgres_storage_size" {
  description = "Size of PostgreSQL EBS volume in GB (can be resized later)"
  type        = number
  default     = 20
}

variable "postgres_storage_type" {
  description = "EBS volume type for PostgreSQL storage"
  type        = string
  default     = "gp3"
}

variable "environment" {
  description = "Environment name (development, production, etc.)"
  type        = string
  default     = "development"
  
  validation {
    condition     = contains(["development", "production", "staging"], var.environment)
    error_message = "Environment must be one of: development, production, staging"
  }
}

variable "magnolia_profile" {
  description = "Magnolia configuration profile to use (maps to WEB-INF/config/{profile}/magnolia.properties)"
  type        = string
  default     = "development"
}

