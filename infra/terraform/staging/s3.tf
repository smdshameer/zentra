# ==============================================================================
# ZENTRA Staging — S3 Object Storage Architecture
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. Primary Evidence Storage Bucket (Field Evidence Binaries)
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "evidence_bucket" {
  bucket        = "zentra-staging-evidence"
  force_destroy = false

  tags = {
    Name        = "zentra-staging-evidence"
    Purpose     = "Field inspection evidence, photos, and OCR attachments"
    Sensitivity = "Confidential"
  }
}

# Block all public access unconditionally
resource "aws_s3_bucket_public_access_block" "evidence_public_block" {
  bucket = aws_s3_bucket.evidence_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning (Audit trail & anti-tamper)
resource "aws_s3_bucket_versioning" "evidence_versioning" {
  bucket = aws_s3_bucket.evidence_bucket.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Server-Side Encryption (AES256)
resource "aws_s3_bucket_server_side_encryption_configuration" "evidence_encryption" {
  bucket = aws_s3_bucket.evidence_bucket.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Lifecycle Management (Multipart cleanup & version transition)
resource "aws_s3_bucket_lifecycle_configuration" "evidence_lifecycle" {
  bucket = aws_s3_bucket.evidence_bucket.id

  rule {
    id     = "evidence-retention-lifecycle"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "GLACIER"
    }
  }
}

# S3 CORS Policy:
# IMPORTANT: Staging domain is NOT yet delegated (BLK-STG-02).
# In accordance with prompt rules, wildcards (*) are strictly prohibited.
# Dynamic block applies CORS ONLY when an authoritative staging domain is provided.
# When var.staging_domain is empty, CORS remains: PENDING STAGING DOMAIN DELEGATION.
resource "aws_s3_bucket_cors_configuration" "evidence_cors" {
  count  = var.staging_domain != "" ? 1 : 0
  bucket = aws_s3_bucket.evidence_bucket.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = [
      "https://staging-portal.${var.staging_domain}"
    ]
    expose_headers  = ["ETag", "x-amz-server-side-encryption"]
    max_age_seconds = 3600
  }
}

# ------------------------------------------------------------------------------
# 2. Web Portal Static Hosting Bucket (Private S3 origin for CloudFront OAC)
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "web_static_bucket" {
  bucket        = "zentra-staging-web-static"
  force_destroy = false

  tags = {
    Name        = "zentra-staging-web-static"
    Purpose     = "Static build artifacts for Management Web Portal"
  }
}

resource "aws_s3_bucket_public_access_block" "web_static_public_block" {
  bucket = aws_s3_bucket.web_static_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web_static_encryption" {
  bucket = aws_s3_bucket.web_static_bucket.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
