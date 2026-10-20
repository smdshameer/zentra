# ==============================================================================
# ZENTRA Staging — ECS Fargate & Application Load Balancer Foundation
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. ECS Cluster
# ------------------------------------------------------------------------------
resource "aws_ecs_cluster" "staging_cluster" {
  name = "zentra-staging-ecs-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "zentra-staging-ecs-cluster"
  }
}

# ------------------------------------------------------------------------------
# 2. Application Load Balancer (Public Ingress Tier)
# ------------------------------------------------------------------------------
resource "aws_lb" "staging_alb" {
  name               = "zentra-staging-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = [aws_subnet.public_1a.id, aws_subnet.public_1b.id]

  enable_deletion_protection = false

  tags = {
    Name = "zentra-staging-alb"
  }
}

# Target Group pointing to Central API ECS Tasks (Port 4000)
resource "aws_lb_target_group" "api_tg" {
  name        = "tg-zentra-staging-api"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.staging_vpc.id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/api/v1/health/liveness"
    port                = "4000"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = "tg-zentra-staging-api"
  }
}

# HTTP Listener (Port 80)
resource "aws_lb_listener" "http_listener" {
  load_balancer_arn = aws_lb.staging_alb.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api_tg.arn
  }
}

# ------------------------------------------------------------------------------
# 3. ECS Task Definition (Fargate)
# ------------------------------------------------------------------------------
resource "aws_ecs_task_definition" "api_task" {
  family                   = "zentra-staging-api-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution_role.arn
  task_role_arn            = aws_iam_role.api_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "zentra-api"
      image     = "zentra-staging-api:latest" # Placeholder image tag prior to Step 3 build promotion
      essential = true

      portMappings = [
        {
          containerPort = 4000
          hostPort      = 4000
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "APP_ENV", value = "staging" },
        { name = "API_PORT", value = "4000" },
        { name = "API_HOST", value = "0.0.0.0" },
        { name = "API_PREFIX", value = "/api/v1" },
        { name = "S3_BUCKET_NAME", value = aws_s3_bucket.evidence_bucket.id },
        { name = "S3_REGION", value = var.aws_region },
        { name = "LOG_LEVEL", value = "info" },
        { name = "PRETTY_LOGGING", value = "false" },
        { name = "RATE_LIMIT_GLOBAL_MAX", value = "1000" },
        { name = "RATE_LIMIT_AUTH_MAX", value = "15" },
        { name = "RATE_LIMIT_TIME_WINDOW_MS", value = "60000" }
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:url::"
        },
        {
          name      = "JWT_ACCESS_SECRET"
          valueFrom = aws_secretsmanager_secret.jwt_access.arn
        },
        {
          name      = "JWT_REFRESH_SECRET"
          valueFrom = aws_secretsmanager_secret.jwt_refresh.arn
        },
        {
          name      = "OFFLINE_PERMIT_SIGNING_KEY"
          valueFrom = aws_secretsmanager_secret.offline_permit.arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api_log_group.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])

  tags = {
    Name = "zentra-staging-api-task"
  }
}

# ------------------------------------------------------------------------------
# 4. ECS Service (Private Subnets)
# ------------------------------------------------------------------------------
resource "aws_ecs_service" "api_service" {
  name            = "zentra-staging-api-service"
  cluster         = aws_ecs_cluster.staging_cluster.id
  task_definition = aws_ecs_task_definition.api_task.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.private_app_1a.id, aws_subnet.private_app_1b.id]
    security_groups  = [aws_security_group.api_sg.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api_tg.arn
    container_name   = "zentra-api"
    container_port   = 4000
  }

  depends_on = [
    aws_lb_listener.http_listener,
    aws_db_instance.staging_db
  ]

  tags = {
    Name = "zentra-staging-api-service"
  }
}
