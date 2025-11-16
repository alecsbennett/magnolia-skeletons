terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

# Common tags for all resources
locals {
  common_tags = merge(var.tags, {
    Environment   = var.environment
    Project       = var.project_name
    ManagedBy     = "Terraform"
    CreatedDate   = formatdate("YYYY-MM-DD", timestamp())
    CreatedTime   = formatdate("HH:mm:ss", timestamp())
    TerraformRepo = "MagnoliaSkeletons"
  })
  
  # Handle "auto" values - convert to null so Terraform uses defaults
  # The create script will replace "auto" with actual IP before Terraform runs
  # This is a safety net in case Terraform validates before the script runs
  allowed_ssh_cidr = var.allowed_ssh_cidr == "auto" || var.allowed_ssh_cidr == "auto-detect" ? "0.0.0.0/0" : var.allowed_ssh_cidr
  allowed_http_cidr = var.allowed_http_cidr == "auto" || var.allowed_http_cidr == "auto-detect" ? null : var.allowed_http_cidr
}

# Data source for latest Amazon Linux 2023 AMI
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Security Group for Magnolia
resource "aws_security_group" "magnolia_sg" {
  name        = "${var.project_name}-sg"
  description = "Security group for Magnolia CMS author instance"

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [local.allowed_ssh_cidr]
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = local.allowed_http_cidr != null && local.allowed_http_cidr != "" ? [local.allowed_http_cidr] : ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = local.allowed_http_cidr != null && local.allowed_http_cidr != "" ? [local.allowed_http_cidr] : ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-sg"
  })
}

# Security Group for PostgreSQL
resource "aws_security_group" "postgres_sg" {
  name        = "${var.project_name}-postgres-sg"
  description = "Security group for PostgreSQL database instance"

  ingress {
    description     = "PostgreSQL from Magnolia instance"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.magnolia_sg.id]
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [local.allowed_ssh_cidr]
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-postgres-sg"
  })
}

# EBS Volume for PostgreSQL data (persistent, scalable)
# Note: Volume will be created in same AZ as instance via volume attachment
resource "aws_ebs_volume" "postgres_data" {
  availability_zone = data.aws_availability_zones.available.names[0]
  size              = var.postgres_storage_size
  type              = var.postgres_storage_type
  encrypted         = true

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-postgres-data"
  })
}

# Get available availability zones
data "aws_availability_zones" "available" {
  state = "available"
}

# User data script to install Java, Tomcat, and configure Magnolia
locals {
  magnolia_user_data = <<-EOF
#!/bin/bash
set -e

# Minimal setup - Ansible will handle the rest
# Just ensure Python 3 is available for Ansible
yum update -y
yum install -y python3 python3-pip

# Create marker for Ansible to detect
mkdir -p /opt/tomcat
touch /opt/tomcat/.ansible-ready

echo "User-data complete. Ready for Ansible provisioning."
EOF

  postgres_user_data = <<-EOF
#!/bin/bash
set -e

# Minimal setup - Ansible will handle PostgreSQL installation
yum update -y
yum install -y python3 python3-pip

# Create marker for Ansible
mkdir -p /var/lib/pgsql
touch /var/lib/pgsql/.ansible-ready

echo "User-data complete. Ready for Ansible provisioning."
EOF
}

# EC2 Instance
resource "aws_instance" "magnolia_author" {
  ami           = data.aws_ami.amazon_linux.id
  instance_type = var.instance_type
  key_name      = var.key_pair_name

  vpc_security_group_ids = [aws_security_group.magnolia_sg.id]

  user_data = local.magnolia_user_data

  root_block_device {
    volume_type = "gp3"
    volume_size = 30  # Minimum required by AMI snapshot
    encrypted   = true
  }

  tags = merge(local.common_tags, {
    Name = var.project_name
  })

  volume_tags = merge(local.common_tags, {
    Name = "${var.project_name}-root-volume"
  })
}

# PostgreSQL EC2 Instance
resource "aws_instance" "postgres" {
  ami           = data.aws_ami.amazon_linux.id
  instance_type = "t3.micro"
  key_name      = var.key_pair_name

  availability_zone = data.aws_availability_zones.available.names[0]
  vpc_security_group_ids = [aws_security_group.postgres_sg.id]

  user_data = local.postgres_user_data

  root_block_device {
    volume_type = "gp3"
    volume_size = 30  # Minimum required by AMI snapshot
    encrypted   = true
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-postgres"
  })

  volume_tags = merge(local.common_tags, {
    Name = "${var.project_name}-postgres-root-volume"
  })
}

# Attach EBS volume to PostgreSQL instance
resource "aws_volume_attachment" "postgres_data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.postgres_data.id
  instance_id = aws_instance.postgres.id

  # Note: In EC2, /dev/sdf maps to /dev/nvme1n1 on newer instance types
  # The user data script handles this mapping
  # Force detach before destroy to prevent issues
  force_detach = true
}

