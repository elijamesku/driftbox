terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  required_version = ">= 1.5.0"
}

provider "aws" {
  region = "us-east-1"
}

# ---------------- S3: infra-demo-logs ----------------

resource "aws_s3_bucket" "infra_demo_logs" {
  bucket = "infra-demo-logs"

  tags = {
    env = "dev"
  }
}

resource "aws_s3_bucket_versioning" "infra_demo_logs_ver" {
  bucket = aws_s3_bucket.infra_demo_logs.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "infra_demo_logs_sse" {
  # Using .id is fine (it's the bucket name)
  bucket = aws_s3_bucket.infra_demo_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Optional but recommended: block all public access
resource "aws_s3_bucket_public_access_block" "infra_demo_logs_block" {
  bucket                  = aws_s3_bucket.infra_demo_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}


resource "aws_instance" "t3micro" {
  instance_type     = "t3.micro"
  ami               = "ami-0c55b159cbfafe1f0"
  availability_zone = "us-east-2a"
}

resource "aws_instance" "new_prod" {
  instance_type     = "t3.micro"
  ami               = "ami-0c55b159cbfafe1f0"
  availability_zone = "us-east-1a"
}

# ---------------- IAM user ----------------

resource "aws_iam_user" "app_deployer" {
  name          = "app-deployer"
  force_destroy = false

  tags = {
    env = "dev"
  }
}
resource "aws_vpc" "demo-vpc" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_internet_gateway" "demo_vpc_igw" {

  vpc_id = aws_vpc.demo-vpc.id
}
