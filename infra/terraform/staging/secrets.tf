# ==============================================================================
# ZENTRA Staging — AWS Secrets Manager Architecture
# ==============================================================================

# High-entropy random cryptographic tokens (min 32 characters)
resource "random_password" "jwt_access_secret" {
  length  = 64
  special = false
}

resource "random_password" "jwt_refresh_secret" {
  length  = 64
  special = false
}

resource "random_password" "offline_permit_key" {
  length  = 64
  special = false
}

resource "random_password" "app_db_password" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# ------------------------------------------------------------------------------
# 1. JWT Access Secret
# ------------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "jwt_access" {
  name                    = "zentra/staging/jwt-access-secret"
  description             = "Cryptographic secret for signing Central API JWT access tokens"
  recovery_window_in_days = 7

  tags = {
    Name = "zentra/staging/jwt-access-secret"
  }
}

resource "aws_secretsmanager_secret_version" "jwt_access_val" {
  secret_id     = aws_secretsmanager_secret.jwt_access.id
  secret_string = random_password.jwt_access_secret.result
}

# ------------------------------------------------------------------------------
# 2. JWT Refresh Secret
# ------------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "jwt_refresh" {
  name                    = "zentra/staging/jwt-refresh-secret"
  description             = "Cryptographic secret for signing Central API refresh tokens"
  recovery_window_in_days = 7

  tags = {
    Name = "zentra/staging/jwt-refresh-secret"
  }
}

resource "aws_secretsmanager_secret_version" "jwt_refresh_val" {
  secret_id     = aws_secretsmanager_secret.jwt_refresh.id
  secret_string = random_password.jwt_refresh_secret.result
}

# ------------------------------------------------------------------------------
# 3. Offline Permit Key
# ------------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "offline_permit" {
  name                    = "zentra/staging/offline-permit-key"
  description             = "Cryptographic key for signing mobile offline service permits"
  recovery_window_in_days = 7

  tags = {
    Name = "zentra/staging/offline-permit-key"
  }
}

resource "aws_secretsmanager_secret_version" "offline_permit_val" {
  secret_id     = aws_secretsmanager_secret.offline_permit.id
  secret_string = random_password.offline_permit_key.result
}

# ------------------------------------------------------------------------------
# 4. Database Credentials
# ------------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "db_credentials" {
  name                    = "zentra/staging/db-credentials"
  description             = "PostgreSQL credentials for ZENTRA staging application role"
  recovery_window_in_days = 7

  tags = {
    Name = "zentra/staging/db-credentials"
  }
}

resource "aws_secretsmanager_secret_version" "db_credentials_val" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    engine   = "postgres"
    host     = aws_db_instance.staging_db.address
    port     = aws_db_instance.staging_db.port
    dbname   = "zentra_staging"
    username = "zentra_staging_app"
    password = random_password.app_db_password.result
    sslmode  = "require"
    url      = "postgresql://zentra_staging_app:${random_password.app_db_password.result}@${aws_db_instance.staging_db.address}:${aws_db_instance.staging_db.port}/zentra_staging?sslmode=require"
  })
}

# ------------------------------------------------------------------------------
# 5. Database Administrator Credentials (CORR-03: Migration / Admin Operations)
# ------------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "db_admin_credentials" {
  name                    = "zentra/staging/db-admin-credentials"
  description             = "PostgreSQL master administrator credentials for ZENTRA staging (migration/admin operations only)"
  recovery_window_in_days = 7

  tags = {
    Name = "zentra/staging/db-admin-credentials"
    Role = "Database-Admin"
  }
}

resource "aws_secretsmanager_secret_version" "db_admin_credentials_val" {
  secret_id = aws_secretsmanager_secret.db_admin_credentials.id
  secret_string = jsonencode({
    engine   = "postgres"
    host     = aws_db_instance.staging_db.address
    port     = aws_db_instance.staging_db.port
    dbname   = "zentra_staging"
    username = "zentra_admin"
    password = random_password.db_master_password.result
    sslmode  = "require"
    url      = "postgresql://zentra_admin:${random_password.db_master_password.result}@${aws_db_instance.staging_db.address}:${aws_db_instance.staging_db.port}/zentra_staging?sslmode=require"
  })
}

