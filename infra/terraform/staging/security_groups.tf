# ==============================================================================
# ZENTRA Staging — Security Group Architecture & Tiered Isolation
# ==============================================================================

# ------------------------------------------------------------------------------
# Application Load Balancer Security Group (Public Ingress Tier)
# ------------------------------------------------------------------------------
resource "aws_security_group" "alb_sg" {
  name        = "sg-zentra-staging-alb"
  description = "Controls public inbound traffic to Staging Application Load Balancer"
  vpc_id      = aws_vpc.staging_vpc.id

  # Inbound HTTPS (Port 443) from Internet
  ingress {
    description = "Public HTTPS ingress"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Inbound HTTP (Port 80) for HTTPS redirect only
  ingress {
    description = "Public HTTP redirect ingress"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "sg-zentra-staging-alb"
  }
}

# ------------------------------------------------------------------------------
# Central API Security Group (Private App Tier)
# ------------------------------------------------------------------------------
resource "aws_security_group" "api_sg" {
  name        = "sg-zentra-staging-api"
  description = "Controls traffic to Central API ECS Fargate tasks"
  vpc_id      = aws_vpc.staging_vpc.id

  # Inbound Port 4000 strictly from ALB Security Group
  ingress {
    description     = "Inbound API traffic strictly from ALB SG"
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }

  # Outbound HTTPS for AWS APIs (Secrets Manager, S3, CloudWatch)
  egress {
    description = "Outbound HTTPS to VPC Endpoints and AWS APIs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "sg-zentra-staging-api"
  }
}

# ------------------------------------------------------------------------------
# PostgreSQL Database Security Group (Isolated Database Tier)
# ------------------------------------------------------------------------------
resource "aws_security_group" "db_sg" {
  name        = "sg-zentra-staging-db"
  description = "Controls traffic to Amazon RDS PostgreSQL Multi-AZ"
  vpc_id      = aws_vpc.staging_vpc.id

  # Inbound Port 5432 strictly from Central API Security Group
  ingress {
    description     = "PostgreSQL inbound strictly from Central API SG"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api_sg.id]
  }

  # Zero outbound Internet egress (RDS operates in isolated subnets)

  tags = {
    Name = "sg-zentra-staging-db"
  }
}

# ------------------------------------------------------------------------------
# Inter-Tier Egress Rules
# ------------------------------------------------------------------------------
resource "aws_security_group_rule" "alb_to_api_egress" {
  type                     = "egress"
  description              = "Forward traffic from ALB to API container port 4000"
  from_port                = 4000
  to_port                  = 4000
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.api_sg.id
  security_group_id        = aws_security_group.alb_sg.id
}

resource "aws_security_group_rule" "api_to_db_egress" {
  type                     = "egress"
  description              = "Connect from API to PostgreSQL database port 5432"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.db_sg.id
  security_group_id        = aws_security_group.api_sg.id
}
