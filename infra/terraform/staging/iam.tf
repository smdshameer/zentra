# ==============================================================================
# ZENTRA Staging — IAM Roles & Least-Privilege Policies
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. API Task IAM Role (Application Runtime Identity)
# ------------------------------------------------------------------------------
resource "aws_iam_role" "api_task_role" {
  name        = "zentra-staging-api-role"
  description = "Least-privilege IAM role assumed by ZENTRA Central API ECS tasks"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "zentra-staging-api-role"
  }
}

# S3 Policy: Strictly scoped to staging evidence bucket (NO production bucket access, NO wildcard s3:*)
resource "aws_iam_policy" "api_s3_policy" {
  name        = "zentra-staging-api-s3-policy"
  description = "Scoped access to zentra-staging-evidence bucket for SigV4 presigning and evidence access"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "StagingEvidenceBucketOperations"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:HeadObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.evidence_bucket.arn}/*"
      },
      {
        Sid    = "StagingEvidenceBucketMetadata"
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.evidence_bucket.arn
      }
    ]
  })
}

# Secrets Policy: Scoped strictly to zentra/staging/* secrets
resource "aws_iam_policy" "api_secrets_policy" {
  name        = "zentra-staging-api-secrets-policy"
  description = "Read-only access to ZENTRA staging application secrets"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "StagingSecretsRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.jwt_access.arn,
          aws_secretsmanager_secret.jwt_refresh.arn,
          aws_secretsmanager_secret.offline_permit.arn,
          aws_secretsmanager_secret.db_credentials.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "attach_s3" {
  role       = aws_iam_role.api_task_role.name
  policy_arn = aws_iam_policy.api_s3_policy.arn
}

resource "aws_iam_role_policy_attachment" "attach_secrets" {
  role       = aws_iam_role.api_task_role.name
  policy_arn = aws_iam_policy.api_secrets_policy.arn
}

# ------------------------------------------------------------------------------
# 2. ECS Task Execution Role (Container Agent Infrastructure Identity)
# ------------------------------------------------------------------------------
resource "aws_iam_role" "ecs_execution_role" {
  name        = "zentra-staging-ecs-execution-role"
  description = "Allows ECS container agent to make AWS API calls (pull image, write logs, get secrets)"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "zentra-staging-ecs-execution-role"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_execution_base" {
  role       = aws_iam_role.ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "ecs_execution_secrets" {
  role       = aws_iam_role.ecs_execution_role.name
  policy_arn = aws_iam_policy.api_secrets_policy.arn
}
