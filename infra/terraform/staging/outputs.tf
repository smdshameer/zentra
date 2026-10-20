# ==============================================================================
# ZENTRA Staging — Terraform Infrastructure Outputs
# ==============================================================================

output "vpc_id" {
  description = "Identifier of the staging VPC."
  value       = aws_vpc.staging_vpc.id
}

output "public_subnet_ids" {
  description = "Identifiers of public subnets."
  value       = [aws_subnet.public_1a.id, aws_subnet.public_1b.id]
}

output "private_app_subnet_ids" {
  description = "Identifiers of private application subnets."
  value       = [aws_subnet.private_app_1a.id, aws_subnet.private_app_1b.id]
}

output "isolated_db_subnet_ids" {
  description = "Identifiers of isolated database subnets."
  value       = [aws_subnet.isolated_db_1a.id, aws_subnet.isolated_db_1b.id]
}

output "alb_dns_name" {
  description = "DNS name of the staging Application Load Balancer."
  value       = aws_lb.staging_alb.dns_name
}

output "rds_endpoint" {
  description = "Database instance CNAME endpoint."
  value       = aws_db_instance.staging_db.address
}

output "rds_port" {
  description = "Database port."
  value       = aws_db_instance.staging_db.port
}

output "evidence_bucket_name" {
  description = "S3 evidence bucket name."
  value       = aws_s3_bucket.evidence_bucket.id
}

output "evidence_bucket_arn" {
  description = "S3 evidence bucket ARN."
  value       = aws_s3_bucket.evidence_bucket.arn
}

output "api_task_role_arn" {
  description = "IAM role ARN assumed by Central API ECS tasks."
  value       = aws_iam_role.api_task_role.arn
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.staging_cluster.name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.api_service.name
}

output "db_admin_credentials_secret_arn" {
  description = "Secrets Manager ARN for RDS master admin credentials (migration/admin operations only)."
  value       = aws_secretsmanager_secret.db_admin_credentials.arn
}

