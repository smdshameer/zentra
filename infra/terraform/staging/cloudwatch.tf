# ==============================================================================
# ZENTRA Staging — CloudWatch Observability & Audit Log Groups
# ==============================================================================

resource "aws_cloudwatch_log_group" "api_log_group" {
  name              = "/zentra/staging/api"
  retention_in_days = 30

  tags = {
    Name    = "/zentra/staging/api"
    Service = "Central-API"
  }
}

resource "aws_cloudwatch_log_group" "alb_log_group" {
  name              = "/zentra/staging/alb"
  retention_in_days = 30

  tags = {
    Name    = "/zentra/staging/alb"
    Service = "ALB-Ingress"
  }
}
