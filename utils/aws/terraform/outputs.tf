output "instance_id" {
  description = "ID of the EC2 instance"
  value       = aws_instance.magnolia_author.id
}

output "instance_public_ip" {
  description = "Public IP address of the EC2 instance"
  value       = aws_instance.magnolia_author.public_ip
}

output "instance_private_ip" {
  description = "Private IP address of the EC2 instance"
  value       = aws_instance.magnolia_author.private_ip
}

output "instance_public_dns" {
  description = "Public DNS name of the EC2 instance"
  value       = aws_instance.magnolia_author.public_dns
}

output "ssh_command" {
  description = "SSH command to connect to the instance"
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ec2-user@${aws_instance.magnolia_author.public_ip}"
}

output "magnolia_url" {
  description = "URL to access Magnolia author instance"
  value       = "http://${aws_instance.magnolia_author.public_ip}/author"
}

output "security_group_id" {
  description = "ID of the security group"
  value       = aws_security_group.magnolia_sg.id
}

output "postgres_instance_id" {
  description = "ID of the PostgreSQL EC2 instance"
  value       = aws_instance.postgres.id
}

output "postgres_private_ip" {
  description = "Private IP address of the PostgreSQL instance"
  value       = aws_instance.postgres.private_ip
}

output "postgres_public_ip" {
  description = "Public IP address of the PostgreSQL instance"
  value       = aws_instance.postgres.public_ip
}

output "postgres_ssh_command" {
  description = "SSH command to connect to PostgreSQL instance"
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ec2-user@${aws_instance.postgres.public_ip}"
}

output "postgres_connection_string" {
  description = "PostgreSQL connection string for Magnolia"
  value       = "jdbc:postgresql://${aws_instance.postgres.private_ip}:5432/${var.postgres_db_name}"
  sensitive   = false
}

output "postgres_volume_id" {
  description = "ID of the PostgreSQL EBS volume (for resizing)"
  value       = aws_ebs_volume.postgres_data.id
}

output "postgres_volume_size" {
  description = "Current size of PostgreSQL EBS volume in GB"
  value       = aws_ebs_volume.postgres_data.size
}

output "environment" {
  description = "Deployment environment"
  value       = var.environment
}

output "magnolia_profile" {
  description = "Magnolia configuration profile in use"
  value       = var.magnolia_profile
}

