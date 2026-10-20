# ==============================================================================
# ZENTRA Staging — Virtual Private Cloud & Networking Architecture
# ==============================================================================

resource "aws_vpc" "staging_vpc" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "zentra-staging-vpc"
  }
}

# ------------------------------------------------------------------------------
# Public Subnets (ALB Tier)
# ------------------------------------------------------------------------------
resource "aws_subnet" "public_1a" {
  vpc_id                  = aws_vpc.staging_vpc.id
  cidr_block              = "10.100.1.0/24"
  availability_zone       = var.availability_zones[0]
  map_public_ip_on_launch = true

  tags = {
    Name = "subnet-staging-public-1a"
    Tier = "public"
  }
}

resource "aws_subnet" "public_1b" {
  vpc_id                  = aws_vpc.staging_vpc.id
  cidr_block              = "10.100.2.0/24"
  availability_zone       = var.availability_zones[1]
  map_public_ip_on_launch = true

  tags = {
    Name = "subnet-staging-public-1b"
    Tier = "public"
  }
}

# ------------------------------------------------------------------------------
# Private Application Subnets (Central API ECS Tier)
# ------------------------------------------------------------------------------
resource "aws_subnet" "private_app_1a" {
  vpc_id            = aws_vpc.staging_vpc.id
  cidr_block        = "10.100.10.0/24"
  availability_zone = var.availability_zones[0]

  tags = {
    Name = "subnet-staging-private-app-1a"
    Tier = "private-app"
  }
}

resource "aws_subnet" "private_app_1b" {
  vpc_id            = aws_vpc.staging_vpc.id
  cidr_block        = "10.100.11.0/24"
  availability_zone = var.availability_zones[1]

  tags = {
    Name = "subnet-staging-private-app-1b"
    Tier = "private-app"
  }
}

# ------------------------------------------------------------------------------
# Isolated Database Subnets (PostgreSQL Multi-AZ Tier)
# ------------------------------------------------------------------------------
resource "aws_subnet" "isolated_db_1a" {
  vpc_id            = aws_vpc.staging_vpc.id
  cidr_block        = "10.100.20.0/24"
  availability_zone = var.availability_zones[0]

  tags = {
    Name = "subnet-staging-isolated-db-1a"
    Tier = "isolated-db"
  }
}

resource "aws_subnet" "isolated_db_1b" {
  vpc_id            = aws_vpc.staging_vpc.id
  cidr_block        = "10.100.21.0/24"
  availability_zone = var.availability_zones[1]

  tags = {
    Name = "subnet-staging-isolated-db-1b"
    Tier = "isolated-db"
  }
}

# ------------------------------------------------------------------------------
# Internet Gateway (Public Egress)
# ------------------------------------------------------------------------------
resource "aws_internet_gateway" "staging_igw" {
  vpc_id = aws_vpc.staging_vpc.id

  tags = {
    Name = "igw-staging"
  }
}

# ------------------------------------------------------------------------------
# NAT Gateway (Private App Egress)
# ------------------------------------------------------------------------------
resource "aws_eip" "nat_eip_1a" {
  domain = "vpc"

  tags = {
    Name = "eip-staging-nat-1a"
  }
}

resource "aws_nat_gateway" "nat_1a" {
  allocation_id = aws_eip_nat_eip_1a.id
  subnet_id     = aws_subnet.public_1a.id

  tags = {
    Name = "nat-staging-1a"
  }

  depends_on = [aws_internet_gateway.staging_igw]
}

# ------------------------------------------------------------------------------
# Route Tables
# ------------------------------------------------------------------------------

# Public Route Table
resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.staging_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.staging_igw.id
  }

  tags = {
    Name = "rt-staging-public"
  }
}

resource "aws_route_table_association" "public_1a" {
  subnet_id      = aws_subnet.public_1a.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table_association" "public_1b" {
  subnet_id      = aws_subnet.public_1b.id
  route_table_id = aws_route_table.public_rt.id
}

# Private Application Route Table
resource "aws_route_table" "private_app_rt" {
  vpc_id = aws_vpc.staging_vpc.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat_1a.id
  }

  tags = {
    Name = "rt-staging-private-app"
  }
}

resource "aws_route_table_association" "private_app_1a" {
  subnet_id      = aws_subnet.private_app_1a.id
  route_table_id = aws_route_table.private_app_rt.id
}

resource "aws_route_table_association" "private_app_1b" {
  subnet_id      = aws_subnet.private_app_1b.id
  route_table_id = aws_route_table.private_app_rt.id
}

# Isolated Database Route Table (Strictly VPC Local — ZERO Internet/NAT Route)
resource "aws_route_table" "isolated_db_rt" {
  vpc_id = aws_vpc.staging_vpc.id

  tags = {
    Name = "rt-staging-isolated-db"
  }
}

resource "aws_route_table_association" "isolated_db_1a" {
  subnet_id      = aws_subnet.isolated_db_1a.id
  route_table_id = aws_route_table.isolated_db_rt.id
}

resource "aws_route_table_association" "isolated_db_1b" {
  subnet_id      = aws_subnet.isolated_db_1b.id
  route_table_id = aws_route_table.isolated_db_rt.id
}

# ------------------------------------------------------------------------------
# S3 Gateway VPC Endpoint (Direct, Zero-Cost S3 Routing from App Subnets)
# ------------------------------------------------------------------------------
resource "aws_vpc_endpoint" "s3_gateway" {
  vpc_id            = aws_vpc.staging_vpc.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private_app_rt.id]

  tags = {
    Name = "vpce-staging-s3"
  }
}
