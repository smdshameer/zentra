terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # ----------------------------------------------------------------------------
  # Remote State Backend (S3 + DynamoDB State Locking)
  # ----------------------------------------------------------------------------
  # Operational Status: PREPARED — NOT PROVISIONED
  #
  # Backend parameters cannot use ordinary Terraform variables (evaluated at init).
  # A partial backend configuration is declared below. The operator will provide
  # backend coordinates during 'terraform init' using a backend configuration file:
  #   terraform init -backend-config=backend.hcl
  #
  # Mandatory Remote Backend Requirements:
  #   1. S3 bucket: Private, versioning enabled, all 4 BlockPublicAccess enabled
  #   2. Encryption: Server-Side Encryption with AWS KMS (SSE-KMS) or AES256
  #   3. Locking: AWS DynamoDB table with 'LockID' primary key (string)
  #   4. Access: Scoped IAM permissions with zero public access
  #
  # Refer to backend.hcl.example for the operator configuration template.
  backend "s3" {
    # Partial configuration: coordinates supplied via -backend-config during init
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project               = "ZENTRA"
      Environment           = "staging"
      ManagedBy             = "ZENTRA"
      Owner                 = "ZENTRA-Operations"
      CostCenter            = "ZENTRA-STAGING"
      DoNotUseForProduction = "true"
    }
  }
}
