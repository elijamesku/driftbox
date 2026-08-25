"""
Cloud Provider Detection and Configuration
Supports AWS and DigitalOcean (more providers can be added)
"""

from typing import Literal, Optional
import re

CloudProvider = Literal['aws', 'digitalocean']

# Provider-specific resource mappings
PROVIDER_RESOURCES = {
    'aws': {
        'compute': 'aws_instance',
        'database': 'aws_db_instance',
        'storage': 'aws_s3_bucket',
        'loadbalancer': 'aws_lb',
        'vpc': 'aws_vpc',
        'kubernetes': 'aws_eks_cluster',
        'serverless': 'aws_lambda_function',
        'cdn': 'aws_cloudfront_distribution',
    },
    'digitalocean': {
        'compute': 'digitalocean_droplet',
        'database': 'digitalocean_database_cluster',
        'storage': 'digitalocean_spaces_bucket',
        'loadbalancer': 'digitalocean_loadbalancer',
        'vpc': 'digitalocean_vpc',
        'kubernetes': 'digitalocean_kubernetes_cluster',
        'serverless': 'digitalocean_app',  # DO App Platform
        'cdn': 'digitalocean_cdn',
    }
}

# Provider terraform blocks
PROVIDER_TERRAFORM_BLOCKS = {
    'aws': '''terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "us-east-1"
}''',
    'digitalocean': '''terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

variable "do_token" {
  description = "DigitalOcean API token"
  sensitive   = true
}'''
}

# IR System prompts for each provider
IR_SYSTEM_PROMPTS = {
    'aws': """You are a Terraform infrastructure expert for AWS. Convert natural language to JSON IR.
Output ONLY valid JSON in this format:
{
  "ops": [{
    "action": "create",
    "selector": {"type": "aws_resource_type", "name": "resource_name"},
    "changes": [{"op": "set", "path": "field", "value": "value"}]
  }],
  "summary": "Brief description"
}

Rules:
- Use correct AWS Terraform resource types (aws_instance, aws_s3_bucket, aws_vpc, aws_subnet, aws_security_group, aws_lb, aws_db_instance, aws_lambda_function, etc.)
- Include ALL required fields for each resource
- Use proper references between resources using "${resource_type.resource_name.attribute}"
- Create supporting resources when needed (e.g., VPC for subnet, security group for instance)
- NEVER reference resources that aren't being created
- Generate COMPLETE, SELF-CONTAINED infrastructure

Example: "Create S3 bucket" ->
{"ops": [{"action": "create", "selector": {"type": "aws_s3_bucket", "name": "main"}, "changes": [{"op": "set", "path": "bucket", "value": "my-bucket"}]}], "summary": "Create S3 bucket"}""",

    'digitalocean': """You are a Terraform infrastructure expert for DigitalOcean. Convert natural language to JSON IR.
Output ONLY valid JSON in this format:
{
  "ops": [{
    "action": "create",
    "selector": {"type": "digitalocean_resource_type", "name": "resource_name"},
    "changes": [{"op": "set", "path": "field", "value": "value"}]
  }],
  "summary": "Brief description"
}

Rules:
- Use correct DigitalOcean Terraform resource types:
  - digitalocean_droplet (compute instances)
  - digitalocean_database_cluster (managed databases: pg, mysql, redis, mongodb)
  - digitalocean_spaces_bucket (S3-compatible object storage)
  - digitalocean_loadbalancer (load balancers)
  - digitalocean_vpc (virtual private cloud)
  - digitalocean_kubernetes_cluster (DOKS)
  - digitalocean_firewall (firewall rules)
  - digitalocean_domain (DNS)
  - digitalocean_app (App Platform)
  - digitalocean_volume (block storage)
- Include ALL required fields for each resource
- Use proper references between resources using "${resource_type.resource_name.attribute}"
- Create supporting resources when needed (e.g., VPC for droplet)
- NEVER reference resources that aren't being created
- Generate COMPLETE, SELF-CONTAINED infrastructure

Common DigitalOcean values:
- Regions: nyc1, nyc3, sfo3, ams3, sgp1, lon1, fra1, blr1
- Droplet sizes: s-1vcpu-1gb, s-1vcpu-2gb, s-2vcpu-4gb, s-4vcpu-8gb
- Database sizes: db-s-1vcpu-1gb, db-s-1vcpu-2gb, db-s-2vcpu-4gb
- Kubernetes versions: Use "latest" or specific like "1.28.2-do.0"

Example: "Create a droplet" ->
{"ops": [{"action": "create", "selector": {"type": "digitalocean_droplet", "name": "main"}, "changes": [{"op": "set", "path": "name", "value": "my-droplet"}, {"op": "set", "path": "region", "value": "nyc1"}, {"op": "set", "path": "size", "value": "s-1vcpu-1gb"}, {"op": "set", "path": "image", "value": "ubuntu-22-04-x64"}]}], "summary": "Create DigitalOcean droplet"}

Example: "Create a managed PostgreSQL database" ->
{"ops": [{"action": "create", "selector": {"type": "digitalocean_database_cluster", "name": "main"}, "changes": [{"op": "set", "path": "name", "value": "my-database"}, {"op": "set", "path": "engine", "value": "pg"}, {"op": "set", "path": "version", "value": "15"}, {"op": "set", "path": "size", "value": "db-s-1vcpu-1gb"}, {"op": "set", "path": "region", "value": "nyc1"}, {"op": "set", "path": "node_count", "value": 1}]}], "summary": "Create managed PostgreSQL database"}"""
}


def detect_provider_from_terraform(tf_content: str) -> CloudProvider:
    """
    Detect cloud provider from existing Terraform content.
    
    Args:
        tf_content: Terraform file content
        
    Returns:
        'aws' or 'digitalocean'
    """
    tf_lower = tf_content.lower()
    
    # Check for provider blocks
    if 'provider "digitalocean"' in tf_lower or 'digitalocean/digitalocean' in tf_lower:
        return 'digitalocean'
    
    # Check for resource prefixes
    if 'digitalocean_' in tf_lower:
        return 'digitalocean'
    
    # Default to AWS
    return 'aws'


def detect_provider_from_files(file_contents: dict) -> CloudProvider:
    """
    Detect provider from multiple Terraform files.
    
    Args:
        file_contents: Dict of {filename: content}
        
    Returns:
        'aws' or 'digitalocean'
    """
    all_content = '\n'.join(file_contents.values())
    return detect_provider_from_terraform(all_content)


def detect_provider_from_query(query: str) -> Optional[CloudProvider]:
    """
    Detect provider intent from user query.
    
    Args:
        query: User's natural language query
        
    Returns:
        'aws', 'digitalocean', or None if not specified
    """
    query_lower = query.lower()
    
    # DigitalOcean keywords
    do_keywords = [
        'digitalocean', 'digital ocean', 'do ', ' do ', 'droplet', 'doks',
        'spaces bucket', 'digitalocean_'
    ]
    
    for keyword in do_keywords:
        if keyword in query_lower:
            return 'digitalocean'
    
    # AWS keywords (explicit)
    aws_keywords = [
        ' aws ', 'amazon', 'ec2', 'lambda', 's3 bucket', 'rds', 'eks',
        'cloudfront', 'dynamodb', 'aws_'
    ]
    
    for keyword in aws_keywords:
        if keyword in query_lower:
            return 'aws'
    
    # No explicit provider mentioned
    return None


def get_ir_system_prompt(provider: CloudProvider, existing_resources_context: str = "") -> str:
    """
    Get the IR system prompt for a specific provider.
    
    Args:
        provider: 'aws' or 'digitalocean'
        existing_resources_context: Additional context about existing resources
        
    Returns:
        System prompt string
    """
    base_prompt = IR_SYSTEM_PROMPTS.get(provider, IR_SYSTEM_PROMPTS['aws'])
    return base_prompt + existing_resources_context


def get_provider_terraform_block(provider: CloudProvider) -> str:
    """
    Get the terraform/provider block for a provider.
    
    Args:
        provider: 'aws' or 'digitalocean'
        
    Returns:
        Terraform block string
    """
    return PROVIDER_TERRAFORM_BLOCKS.get(provider, PROVIDER_TERRAFORM_BLOCKS['aws'])


def map_generic_to_provider_resource(generic_type: str, provider: CloudProvider) -> str:
    """
    Map a generic resource type to provider-specific resource.
    
    Args:
        generic_type: Generic type like 'compute', 'database', 'storage'
        provider: 'aws' or 'digitalocean'
        
    Returns:
        Provider-specific resource type
    """
    provider_resources = PROVIDER_RESOURCES.get(provider, PROVIDER_RESOURCES['aws'])
    return provider_resources.get(generic_type, generic_type)

