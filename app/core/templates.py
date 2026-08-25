from jinja2 import Template 
from fastapi import HTTPException
from pathlib import Path  
from app.config import EXECUTION_ENVIRONMENT
import textwrap 

# Terraform HCL templates for infrastructure resource generation
# Provider configuration adjusts for offline development mode
S3_BUCKET_TEMPLATE = Template(textwrap.dedent("""
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "{{ properties.region }}"
  {% if execution_mode == "offline" %}
  skip_credentials_validation   = true
  skip_requesting_account_id    = true
  skip_region_validation        = true
  skip_metadata_api_check       = true
  {% endif %}
}

resource "aws_s3_bucket" "{{ name | replace('-', '_') }}" {
  bucket = "{{ name }}"
  {% if properties.tags %}
  tags = {
  {% for k, v in properties.tags.items() %}
    {{k}} = "{{v}}"
  {% endfor %}
  }
  {% endif %}
}

resource "aws_s3_bucket_versioning" "{{ name | replace('-', '_') }}_ver" {
  bucket = aws_s3_bucket.{{ name | replace('-', '_') }}.id
  versioning_configuration { status = "{{ 'Enabled' if properties.versioning else 'Suspended' }}" }
}

resource "aws_s3_bucket_public_access_block" "{{ name | replace('-', '_') }}_block" {
  bucket                  = aws_s3_bucket.{{ name | replace('-', '_') }}.id
  block_public_acls       = {{ 'true' if properties.block_public_access else 'false' }}
  block_public_policy     = {{ 'true' if properties.block_public_access else 'false' }}
  ignore_public_acls      = {{ 'true' if properties.block_public_access else 'false' }}
  restrict_public_buckets = {{ 'true' if properties.block_public_access else 'false' }}
}
"""))

IAM_USER_TEMPLATE = Template(textwrap.dedent("""
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "{{ properties.region }}"
  {% if execution_mode == "offline" %}
  skip_credentials_validation   = true
  skip_requesting_account_id    = true
  skip_region_validation        = true
  skip_metadata_api_check       = true
  {% endif %}
}

resource "aws_iam_user" "{{ name | replace('-', '_') }}" {
  name          = "{{ name }}"
  force_destroy = false
  tags = {
    managed_by = "tfgen-mvp"
    {% if properties.tags %}
    {% for k, v in properties.tags.items() %}
    {{k}} = "{{v}}"
    {% endfor %}
    {% endif %}
  }
}
"""))

DYNAMODB_TABLE_TEMPLATE = Template(textwrap.dedent("""
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "{{ properties.region }}"
  {% if execution_mode == "offline" %}
  skip_credentials_validation   = true
  skip_requesting_account_id    = true
  skip_region_validation        = true
  skip_metadata_api_check       = true
  {% endif %}
}

resource "aws_dynamodb_table" "{{ name | replace('-', '_') }}" {
  name         = "{{ name }}"
  billing_mode = "PAY_PER_REQUEST"

  hash_key = "{{ properties.hash_key }}"
  attribute {
    name = "{{ properties.hash_key }}"
    type = "{{ properties.hash_key_type }}"
  }

  {% if properties.tags %}
  tags = {
  {% for k, v in properties.tags.items() %}
    {{k}} = "{{v}}"
  {% endfor %}
  }
  {% endif %}
}
"""))

def generate_terraform_config(infrastructure_config: dict, output_directory: Path):
    """Generate Terraform HCL configuration file from infrastructure specification"""
    template_context = {**infrastructure_config, "execution_mode": EXECUTION_ENVIRONMENT}
    resource_type = infrastructure_config["resource"]
    
    if resource_type == "aws_s3_bucket":
        terraform_code = S3_BUCKET_TEMPLATE.render(**template_context)
    elif resource_type == "aws_iam_user":
        terraform_code = IAM_USER_TEMPLATE.render(**template_context)
    elif resource_type == "aws_dynamodb_table":
        terraform_code = DYNAMODB_TABLE_TEMPLATE.render(**template_context)
    else:
        raise HTTPException(status_code=400, detail={"error": "unsupported_resource", "message": resource_type})
    
    (output_directory / "main.tf").write_text(terraform_code)
