# ==============================================================================
# ZENTRA Staging — Amazon RDS PostgreSQL 16 Multi-AZ Architecture
# ==============================================================================

# ------------------------------------------------------------------------------
# DB Subnet Group
# ------------------------------------------------------------------------------
resource "aws_db_subnet_group" "db_subnet_group" {
  name        = "dbsng-zentra-staging"
  description = "DB Subnet Group spanning isolated subnets across AZ 1a and 1b"
  subnet_ids  = [aws_subnet.isolated_db_1a.id, aws_subnet.isolated_db_1b.id]

  tags = {
    Name = "dbsng-zentra-staging"
  }
}

# ------------------------------------------------------------------------------
# PostgreSQL 16 Parameter Group (SSL Enforcement)
# ------------------------------------------------------------------------------
resource "aws_db_parameter_group" "pg16_params" {
  name        = "pg16-zentra-staging-params"
  family      = "postgres16"
  description = "PostgreSQL 16 parameter group enforcing strict SSL for ZENTRA staging"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  tags = {
    Name = "pg16-zentra-staging-params"
  }
}

# ------------------------------------------------------------------------------
# Random Master Password (Stored in Secrets Manager, never printed or committed)
# ------------------------------------------------------------------------------
resource "random_password" "db_master_password" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# ------------------------------------------------------------------------------
# Amazon RDS PostgreSQL Multi-AZ Instance
# ------------------------------------------------------------------------------
resource "aws_db_instance" "staging_db" {
  identifier                  = "zentra-staging-db"
  engine                      = "postgres"
  engine_version              = "16.3"
  instance_class              = var.db_instance_class
  allocated_storage           = var.db_allocated_storage
  max_allocated_storage       = var.db_max_allocated_storage
  storage_type                = "gp3"
  storage_encrypted           = true

  db_name                     = "zentra_staging"
  username                    = "zentra_admin"
  password                    = random_password.db_master_password.result

  multi_az                    = true
  publicly_accessible         = false
  db_subnet_group_name        = aws_db_subnet_group.db_subnet_group.name
  vpc_security_group_ids      = [aws_security_group.db_sg.id]
  parameter_group_name        = aws_db_parameter_group.pg16_params.name

  # Automated Backups & PITR (AWS Managed)
  backup_retention_period     = var.db_backup_retention_days # 7 days
  backup_window               = "20:30-21:00"                # 02:00 AM IST
  maintenance_window          = "Sun:21:00-Sun:22:00"
  copy_tags_to_snapshot       = true
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "zentra-staging-db-final-snapshot"

  # Observability
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  auto_minor_version_upgrade      = true

  tags = {
    Name = "zentra-staging-db"
  }
}
