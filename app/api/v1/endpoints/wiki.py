"""
Team Wiki API - AI-powered documentation generation for repositories
Generates human-readable explanations of infrastructure code
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import os
import re
import json
from app.services.auth import authentication_service
from app.database.models import UserAccount

router = APIRouter()


class FileContent(BaseModel):
    path: str
    content: str

class WikiGenerateRequest(BaseModel):
    team_id: Optional[str] = None
    simple_mode: bool = True
    files: Optional[List[FileContent]] = None  # Files from frontend


class WikiResource(BaseModel):
    type: str
    name: str
    explanation: Dict[str, str]  # {"technical": "...", "simple": "..."}
    attributes: Optional[Dict[str, str]] = None
    dependencies: Optional[List[str]] = None


class WikiVariable(BaseModel):
    name: str
    type: str
    default: Optional[str] = None
    description: Optional[str] = None


class WikiOutput(BaseModel):
    name: str
    value: Optional[str] = None
    description: Optional[str] = None


class WikiSection(BaseModel):
    title: str
    content: str
    items: Optional[List[str]] = None


class WikiFile(BaseModel):
    path: str
    name: str
    type: str  # "file" or "folder"
    extension: Optional[str] = None
    children: Optional[List["WikiFile"]] = None
    explanation: Optional[Dict[str, str]] = None
    resources: Optional[List[WikiResource]] = None
    variables: Optional[List[WikiVariable]] = None
    outputs: Optional[List[WikiOutput]] = None
    sections: Optional[List[WikiSection]] = None  # Rich documentation sections
    providers: Optional[List[str]] = None
    modules: Optional[List[Dict[str, str]]] = None
    security: Optional[Dict[str, Any]] = None
    cost: Optional[Dict[str, str]] = None
    line_count: Optional[int] = None


class WikiResponse(BaseModel):
    files: List[WikiFile]
    summary: Dict[str, str]
    stats: Dict[str, Any]


# Resource type explanations (simple mode)
RESOURCE_EXPLANATIONS = {
    # AWS Core Compute
    "aws_instance": {
        "simple": "A virtual computer running in the cloud. Think of it like renting a computer that's always on, always connected to the internet, and you can access it from anywhere. You choose how powerful it is (CPU, memory) and what software runs on it.",
        "technical": "Creates an EC2 instance - a virtual server with configurable compute, memory, and storage resources."
    },
    "aws_launch_template": {
        "simple": "A reusable template that describes how to create new servers. Instead of setting up each server manually, you define the settings once and reuse them.",
        "technical": "Creates a launch template defining instance configuration for use with ASGs and fleet requests."
    },
    "aws_autoscaling_group": {
        "simple": "Automatically adds more servers when your app gets busy (like during a sale), and removes them when traffic is low - this saves you money because you only pay for what you use.",
        "technical": "Creates an ASG that dynamically adjusts instance count based on scaling policies and health checks."
    },
    "aws_spot_instance_request": {
        "simple": "Rents unused cloud computers at a big discount (up to 90% off). The catch is AWS can take them back with 2 minutes notice, so best for tasks that can be interrupted.",
        "technical": "Requests Spot Instances at reduced pricing with configurable interruption behavior."
    },
    
    # AWS Networking
    "aws_vpc": {
        "simple": "Creates your own private section of the cloud - like having your own private neighborhood where only your servers can talk to each other. It's isolated from everyone else's stuff for security.",
        "technical": "Creates a Virtual Private Cloud (VPC) providing network isolation and IP address management."
    },
    "aws_subnet": {
        "simple": "A smaller section within your cloud neighborhood. Some sections (public subnets) can be accessed from the internet, others (private subnets) are hidden away for security - like having a front yard vs a locked backyard.",
        "technical": "Creates a subnet within a VPC for organizing resources by availability zone and access level."
    },
    "aws_internet_gateway": {
        "simple": "The door that connects your private cloud to the internet. Without this, nothing in your cloud can reach the outside world or be reached from it.",
        "technical": "Creates an Internet Gateway enabling internet connectivity for VPC resources."
    },
    "aws_nat_gateway": {
        "simple": "Lets your private servers access the internet (to download updates, etc.) while staying hidden from incoming traffic. Like a one-way mirror.",
        "technical": "Creates a NAT Gateway for outbound internet access from private subnets."
    },
    "aws_route_table": {
        "simple": "A set of directions that tell network traffic where to go - like a GPS for your cloud. It knows which path leads to the internet vs internal services.",
        "technical": "Creates a route table with routing rules for directing traffic within and outside the VPC."
    },
    "aws_security_group": {
        "simple": "A firewall that controls what traffic can reach your servers. Like a bouncer at a club - you define rules for who gets in (ports, IP addresses) and who doesn't.",
        "technical": "Creates a security group defining inbound/outbound traffic rules for associated resources."
    },
    "aws_network_acl": {
        "simple": "A second layer of firewall protection at the subnet level. While security groups protect individual servers, this protects entire sections of your network.",
        "technical": "Creates a Network ACL with stateless inbound/outbound rules for subnet-level security."
    },
    "aws_eip": {
        "simple": "A permanent public IP address you own. Normally, if you restart a server it gets a new address - but this keeps the same one, so your domain name always works.",
        "technical": "Allocates an Elastic IP providing a static public IPv4 address for dynamic cloud resources."
    },
    "aws_vpc_peering_connection": {
        "simple": "Creates a private highway between two separate cloud networks. Traffic stays within AWS's network instead of going over the public internet - faster and more secure.",
        "technical": "Creates a VPC peering connection enabling private routing between VPCs."
    },
    
    # AWS Load Balancing
    "aws_lb": {
        "simple": "A traffic director that spreads incoming visitors across multiple servers. If one server is busy or crashes, traffic automatically goes to healthy ones. This keeps your site fast and reliable.",
        "technical": "Creates an Application/Network Load Balancer for traffic distribution and health checking."
    },
    "aws_alb": {
        "simple": "Spreads web traffic (HTTP/HTTPS) across your servers intelligently. It can route users to different servers based on the URL they're visiting.",
        "technical": "Creates an Application Load Balancer for HTTP/HTTPS traffic with content-based routing."
    },
    "aws_lb_target_group": {
        "simple": "A group of servers that the load balancer sends traffic to. The load balancer regularly checks if servers in the group are healthy.",
        "technical": "Creates a target group defining instances/IPs to receive traffic from load balancers."
    },
    "aws_lb_listener": {
        "simple": "Tells the load balancer which port to listen on (like 80 for HTTP, 443 for HTTPS) and what to do with incoming traffic.",
        "technical": "Creates a listener on a load balancer to handle incoming connections on specified ports."
    },
    
    # AWS Storage
    "aws_s3_bucket": {
        "simple": "A place to store any files in the cloud - images, videos, backups, anything. It can hold unlimited files, is super reliable (99.999999999% durability), and accessible from anywhere in the world.",
        "technical": "Creates an S3 bucket for object storage with configurable access policies and versioning."
    },
    "aws_s3_bucket_versioning": {
        "simple": "Keeps a history of every change to your files. If you accidentally delete or overwrite something, you can restore older versions - like a time machine for your files.",
        "technical": "Enables versioning on an S3 bucket for object history and recovery."
    },
    "aws_s3_bucket_public_access_block": {
        "simple": "A safety lock that prevents your files from accidentally becoming public. Even if someone makes a mistake in permissions, this blocks public access.",
        "technical": "Configures public access block settings to prevent public bucket/object exposure."
    },
    "aws_s3_bucket_server_side_encryption_configuration": {
        "simple": "Automatically encrypts all files stored in this bucket. Even if someone somehow accessed the raw data, they couldn't read it without the encryption key.",
        "technical": "Configures server-side encryption for S3 bucket objects at rest."
    },
    "aws_ebs_volume": {
        "simple": "A virtual hard drive you can attach to your servers. The data persists even if the server is turned off or replaced.",
        "technical": "Creates an EBS volume providing persistent block storage attachable to EC2 instances."
    },
    "aws_efs_file_system": {
        "simple": "A shared folder that multiple servers can access at the same time. Unlike regular drives, many servers can read/write to it simultaneously.",
        "technical": "Creates an EFS file system providing scalable, shared NFS storage across AZs."
    },
    
    # AWS Database
    "aws_db_instance": {
        "simple": "A managed database that stores your app's data (users, orders, content). AWS handles backups, updates, and recovery automatically - you just use it.",
        "technical": "Creates an RDS database instance with automated backups, HA options, and managed maintenance."
    },
    "aws_rds_instance": {
        "simple": "A managed database (MySQL, PostgreSQL, etc.) that stores your app's data. AWS handles all the hard stuff - backups, security patches, and failover.",
        "technical": "Creates an RDS database instance with automated backups, high availability, and managed maintenance."
    },
    "aws_rds_cluster": {
        "simple": "A cluster of databases that work together for high performance and reliability. If one database server fails, others take over automatically.",
        "technical": "Creates an Aurora cluster with automatic failover and read replica support."
    },
    "aws_dynamodb_table": {
        "simple": "A super-fast database that can handle millions of requests per second. Great for apps that need quick responses and can scale automatically.",
        "technical": "Creates a DynamoDB table - a fully managed NoSQL database with auto-scaling."
    },
    "aws_elasticache_cluster": {
        "simple": "A super-fast in-memory database for caching. Instead of fetching data from your main database every time, frequently used data is stored here for instant access.",
        "technical": "Creates an ElastiCache cluster for Redis/Memcached in-memory caching."
    },
    
    # AWS Serverless
    "aws_lambda_function": {
        "simple": "Code that runs only when something triggers it - like receiving a file upload or an API call. You only pay for the milliseconds it actually runs, not for idle time.",
        "technical": "Creates a serverless function that executes in response to events with automatic scaling."
    },
    "aws_api_gateway_rest_api": {
        "simple": "Creates an API that your mobile apps or websites can call. It handles authentication, rate limiting, and connects to your backend services.",
        "technical": "Creates an API Gateway REST API for building, deploying, and managing APIs."
    },
    "aws_sqs_queue": {
        "simple": "A message queue that stores tasks to be processed later. Like a to-do list that different parts of your app can add to and work through.",
        "technical": "Creates an SQS queue for decoupled, asynchronous message processing."
    },
    "aws_sns_topic": {
        "simple": "A notification system that can send messages to many subscribers at once - emails, texts, or triggering other AWS services.",
        "technical": "Creates an SNS topic for pub/sub messaging and push notifications."
    },
    
    # AWS Security & Identity
    "aws_iam_role": {
        "simple": "Permissions that let your cloud services talk to each other securely. Instead of storing passwords, services 'assume' a role that grants them specific abilities.",
        "technical": "Creates an IAM role with attached policies for cross-service authorization."
    },
    "aws_iam_user": {
        "simple": "An account for a person or application to access AWS. You can control exactly what they're allowed to do.",
        "technical": "Creates an IAM user with configurable permissions and access credentials."
    },
    "aws_iam_policy": {
        "simple": "A set of rules defining what actions are allowed or denied. Like a permission slip that lists exactly what someone can do.",
        "technical": "Creates an IAM policy document defining allowed/denied actions on AWS resources."
    },
    "aws_kms_key": {
        "simple": "An encryption key managed by AWS. Used to encrypt sensitive data - only things with permission can decrypt and read the data.",
        "technical": "Creates a KMS key for encrypting data with customer-managed key rotation."
    },
    "aws_secretsmanager_secret": {
        "simple": "A secure vault for storing passwords, API keys, and other secrets. Applications can retrieve them securely without hardcoding sensitive values.",
        "technical": "Creates a Secrets Manager secret for secure credential storage with rotation support."
    },
    
    # AWS Monitoring
    "aws_cloudwatch_log_group": {
        "simple": "A place where your applications send their logs (records of what happened). You can search through them to debug issues or track activity.",
        "technical": "Creates a CloudWatch Log Group for aggregating and retaining application logs."
    },
    "aws_cloudwatch_metric_alarm": {
        "simple": "An automatic alert that triggers when something goes wrong - like if CPU usage is too high or errors spike. Can notify you or automatically take action.",
        "technical": "Creates a CloudWatch Alarm monitoring metrics with configurable thresholds and actions."
    },
    
    # AWS Containers
    "aws_ecs_cluster": {
        "simple": "A place to run Docker containers managed by AWS. You deploy your containerized apps here and AWS handles running them reliably.",
        "technical": "Creates an ECS cluster for orchestrating containerized applications."
    },
    "aws_ecs_service": {
        "simple": "Keeps your containerized app running. If a container crashes, it automatically starts a new one. Can scale up/down based on demand.",
        "technical": "Creates an ECS service ensuring desired task count with rolling updates."
    },
    "aws_ecs_task_definition": {
        "simple": "A recipe describing how to run your container - which image to use, how much CPU/memory, what ports to open, etc.",
        "technical": "Creates an ECS task definition specifying container configurations and requirements."
    },
    "aws_ecr_repository": {
        "simple": "A private storage for your Docker images. Like Docker Hub, but private to your AWS account.",
        "technical": "Creates an ECR repository for storing and managing Docker container images."
    },
    "aws_eks_cluster": {
        "simple": "Kubernetes managed by AWS. Kubernetes is a system for running lots of containers across many servers - AWS handles the complex setup and maintenance.",
        "technical": "Creates an EKS cluster for managed Kubernetes workloads."
    },
    
    # AWS DNS & CDN
    "aws_route53_zone": {
        "simple": "Manages your domain name (like example.com). This is where you set up which servers your domain points to.",
        "technical": "Creates a Route53 hosted zone for DNS management and record configuration."
    },
    "aws_route53_record": {
        "simple": "A DNS record that tells browsers where to find your website. Like a phone book entry connecting a name to an address.",
        "technical": "Creates a Route53 DNS record for routing traffic to AWS or external resources."
    },
    "aws_cloudfront_distribution": {
        "simple": "Copies your website content to servers around the world so it loads fast for users everywhere. A user in Japan gets content from a nearby server instead of your US-based origin.",
        "technical": "Creates a CloudFront CDN distribution for global content delivery with edge caching."
    },
    "aws_acm_certificate": {
        "simple": "A free SSL certificate from AWS that makes your site show as 'secure' (HTTPS with the padlock). Renews automatically.",
        "technical": "Creates an ACM certificate for SSL/TLS encryption with automatic renewal."
    },
    
    # DigitalOcean Resources
    "digitalocean_droplet": {
        "simple": "A virtual server on DigitalOcean. Simpler pricing and interface than AWS - great for startups and smaller projects. You pick a size (CPU/RAM) and a region.",
        "technical": "Creates a DigitalOcean Droplet - a virtual machine with configurable size and region."
    },
    "digitalocean_kubernetes_cluster": {
        "simple": "Kubernetes managed by DigitalOcean. They handle the complex control plane, you just deploy your containers. Simpler and cheaper than AWS EKS.",
        "technical": "Creates a DOKS cluster for orchestrating containerized workloads."
    },
    "digitalocean_database_cluster": {
        "simple": "A managed database (PostgreSQL, MySQL, Redis) on DigitalOcean. They handle backups, updates, and high availability - you just connect and use it.",
        "technical": "Creates a managed database cluster with automated backups and HA options."
    },
    "digitalocean_spaces_bucket": {
        "simple": "DigitalOcean's version of S3 - cloud storage for files. Compatible with S3 tools so you can use existing code/libraries.",
        "technical": "Creates a Spaces bucket for S3-compatible object storage."
    },
    "digitalocean_loadbalancer": {
        "simple": "Spreads traffic across your Droplets so no single server gets overwhelmed. Also provides a single IP address for your app.",
        "technical": "Creates a DigitalOcean Load Balancer for traffic distribution."
    },
    "digitalocean_domain": {
        "simple": "Manages DNS for your domain name. Set up where your domain points to - your Droplets, load balancers, etc.",
        "technical": "Creates a domain for DNS management within DigitalOcean."
    },
    "digitalocean_record": {
        "simple": "A DNS record for your domain - like pointing www.example.com to your server's IP address.",
        "technical": "Creates a DNS record for routing traffic to DigitalOcean resources."
    },
    "digitalocean_firewall": {
        "simple": "Controls what traffic can reach your Droplets - which ports are open, which IP addresses are allowed.",
        "technical": "Creates firewall rules for inbound/outbound traffic control."
    },
    "digitalocean_vpc": {
        "simple": "A private network for your DigitalOcean resources. Droplets in the same VPC can talk to each other privately.",
        "technical": "Creates a VPC for network isolation and private communication."
    },
    "digitalocean_app": {
        "simple": "DigitalOcean's platform for deploying apps from Git. Push your code and it automatically builds and deploys. Great for simple web apps.",
        "technical": "Creates a DigitalOcean App Platform application with automatic deployment."
    },
    "digitalocean_cdn": {
        "simple": "Caches your Spaces files at edge locations worldwide so they load faster for users everywhere.",
        "technical": "Enables CDN caching for Spaces bucket content distribution."
    },
    "digitalocean_project": {
        "simple": "A folder to organize your DigitalOcean resources. Group related Droplets, databases, and domains together.",
        "technical": "Creates a project for organizing and managing related resources."
    },
    "digitalocean_certificate": {
        "simple": "An SSL certificate for HTTPS. Makes your site secure with the padlock icon. Can be auto-renewed.",
        "technical": "Creates or imports an SSL certificate for load balancer HTTPS termination."
    },
    
    # Google Cloud Resources
    "google_compute_instance": {
        "simple": "A virtual server on Google Cloud. Good if you already use Google services or need their specific AI/ML tools.",
        "technical": "Creates a GCE instance with configurable machine type and boot disk."
    },
    "google_storage_bucket": {
        "simple": "Google's version of cloud storage - store any files with high durability and global accessibility.",
        "technical": "Creates a GCS bucket for object storage with lifecycle policies."
    },
    
    # Azure Resources
    "azurerm_virtual_machine": {
        "simple": "A virtual server on Microsoft Azure. Integrates well with Windows, Active Directory, and Office 365.",
        "technical": "Creates an Azure VM with configurable size, OS, and networking."
    },
    "azurerm_resource_group": {
        "simple": "A container to organize your Azure resources. Everything in the group shares the same lifecycle and permissions.",
        "technical": "Creates a resource group for organizing and managing Azure resources."
    }
}

# File type explanations
FILE_EXPLANATIONS = {
    # Terraform files
    "main.tf": {
        "simple": "The main setup file - this is where the most important infrastructure is defined.",
        "technical": "Root Terraform configuration file defining primary resources and module calls."
    },
    "variables.tf": {
        "simple": "A list of settings you can change - like a configuration menu for your infrastructure.",
        "technical": "Input variable declarations with types, defaults, and validation rules."
    },
    "outputs.tf": {
        "simple": "Shows important information after your infrastructure is created - like addresses and IDs.",
        "technical": "Output value definitions exposing resource attributes for consumption."
    },
    "providers.tf": {
        "simple": "Tells Terraform which cloud providers to connect to (AWS, Google, DigitalOcean, etc).",
        "technical": "Provider configuration blocks with authentication and region settings."
    },
    "terraform.tfvars": {
        "simple": "Your actual settings values - like filling in the blanks in a form.",
        "technical": "Variable value definitions for the current deployment context."
    },
    "backend.tf": {
        "simple": "Configures where Terraform saves its memory of what it created.",
        "technical": "Remote state backend configuration for state locking and collaboration."
    },
    "versions.tf": {
        "simple": "Specifies which versions of tools to use - ensures consistency.",
        "technical": "Terraform and provider version constraints for reproducibility."
    },
    # Common infrastructure files
    "vpc.tf": {
        "simple": "Creates your private cloud network - like setting up your own secure neighborhood in the cloud.",
        "technical": "VPC configuration including CIDR blocks, DNS settings, and network topology."
    },
    "subnet.tf": {
        "simple": "Divides your network into smaller sections - some public, some private for security.",
        "technical": "Subnet definitions across availability zones with routing configurations."
    },
    "security.tf": {
        "simple": "Controls who can access what - like setting up security guards for your cloud.",
        "technical": "Security group rules defining inbound/outbound traffic permissions."
    },
    "security_group.tf": {
        "simple": "Firewall rules that control what traffic can reach your servers.",
        "technical": "Security group configurations with ingress/egress rules."
    },
    "iam.tf": {
        "simple": "Controls permissions - who can do what in your cloud account.",
        "technical": "IAM roles, policies, and user configurations for access control."
    },
    "iam_role.tf": {
        "simple": "Defines what permissions your services have to talk to each other.",
        "technical": "IAM role definitions with trust policies and attached permissions."
    },
    "ecs.tf": {
        "simple": "Runs your applications in containers - like Docker but managed by AWS.",
        "technical": "ECS cluster, service, and task definitions for containerized workloads."
    },
    "ecs_task_definition.tf": {
        "simple": "Describes how your container should run - what image, how much memory, etc.",
        "technical": "ECS task definition with container specs, resource limits, and networking."
    },
    "s3.tf": {
        "simple": "Creates storage buckets for files - like a super reliable cloud hard drive.",
        "technical": "S3 bucket configuration with versioning, encryption, and lifecycle policies."
    },
    "rds.tf": {
        "simple": "Sets up your database - where all your app's data is stored securely.",
        "technical": "RDS instance configuration with engine settings, backups, and high availability."
    },
    "load_balancer.tf": {
        "simple": "Distributes traffic across your servers so no single one gets overwhelmed.",
        "technical": "ALB/NLB configuration with listeners, target groups, and health checks."
    },
    "autoscaling.tf": {
        "simple": "Automatically adds or removes servers based on demand - saves money!",
        "technical": "Auto Scaling Group with scaling policies and launch configurations."
    },
    "lambda.tf": {
        "simple": "Runs code only when needed - you don't pay when it's not running.",
        "technical": "Lambda function definitions with triggers, runtime, and IAM permissions."
    },
    "cloudwatch.tf": {
        "simple": "Monitors your infrastructure and alerts you when something goes wrong.",
        "technical": "CloudWatch alarms, dashboards, and log group configurations."
    },
    "route53.tf": {
        "simple": "Manages your domain names - how people find your website.",
        "technical": "Route53 hosted zones, DNS records, and health checks."
    },
    "imported.tf": {
        "simple": "Resources that were imported from existing cloud infrastructure.",
        "technical": "Terraform-imported resources brought under IaC management."
    },
    # Documentation files
    "driftbox.md": {
        "simple": "AI-generated documentation explaining what's in this repository.",
        "technical": "Driftbox-generated markdown documentation with architecture overview."
    },
    "README.md": {
        "simple": "The main documentation explaining what this project does and how to use it.",
        "technical": "Repository README with setup instructions and usage documentation."
    },
    # Config files
    "package.json": {
        "simple": "Lists all the JavaScript packages this project needs to run.",
        "technical": "Node.js package manifest with dependencies and scripts."
    },
    "docker-compose.yml": {
        "simple": "Defines how to run multiple containers together as one application.",
        "technical": "Docker Compose service definitions for local development."
    },
    "Dockerfile": {
        "simple": "Instructions for building a container image of your application.",
        "technical": "Docker build instructions with base image, dependencies, and entrypoint."
    }
}


def get_resource_explanation(resource_type: str, resource_name: str) -> Dict[str, str]:
    """Get explanation for a resource type"""
    base = RESOURCE_EXPLANATIONS.get(resource_type, {
        "simple": f"A cloud resource called {resource_name}.",
        "technical": f"Resource of type {resource_type} named {resource_name}."
    })
    return {
        "technical": f"{base['technical']} Instance: {resource_name}.",
        "simple": base["simple"]
    }


def analyze_file_content(filename: str, content: str) -> Dict[str, Any]:
    """Deep analysis of file content to generate dynamic documentation"""
    analysis = {
        "overview": "",
        "sections": [],
        "resources_found": [],
        "variables_found": [],
        "outputs_found": [],
        "dependencies": [],
        "providers": [],
        "modules": [],
        "line_count": len(content.split('\n')) if content else 0
    }
    
    if not content:
        return analysis
    
    # Detect cloud provider
    providers = []
    if "aws_" in content or 'provider "aws"' in content:
        providers.append("AWS")
    if "digitalocean_" in content or 'provider "digitalocean"' in content:
        providers.append("DigitalOcean")
    if "google_" in content or 'provider "google"' in content:
        providers.append("Google Cloud")
    if "azurerm_" in content or 'provider "azurerm"' in content:
        providers.append("Azure")
    analysis["providers"] = providers
    
    # Extract resources with their configs
    resource_pattern = r'resource\s+"([^"]+)"\s+"([^"]+)"\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}'
    for match in re.finditer(resource_pattern, content, re.DOTALL):
        resource_type = match.group(1)
        resource_name = match.group(2)
        resource_body = match.group(3)
        
        # Extract key attributes
        attributes = {}
        attr_pattern = r'(\w+)\s*=\s*(?:"([^"]+)"|([^\s\n]+))'
        for attr_match in re.finditer(attr_pattern, resource_body):
            attr_name = attr_match.group(1)
            attr_value = attr_match.group(2) or attr_match.group(3)
            if attr_name not in ['tags', 'depends_on']:
                attributes[attr_name] = attr_value
        
        # Detect dependencies
        deps = re.findall(r'(\w+)\.(\w+)\.(\w+)', resource_body)
        
        analysis["resources_found"].append({
            "type": resource_type,
            "name": resource_name,
            "attributes": attributes,
            "dependencies": deps
        })
    
    # Extract variables
    var_pattern = r'variable\s+"([^"]+)"\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}'
    for match in re.finditer(var_pattern, content, re.DOTALL):
        var_name = match.group(1)
        var_body = match.group(2)
        
        # Get type and default
        type_match = re.search(r'type\s*=\s*(\w+)', var_body)
        default_match = re.search(r'default\s*=\s*(?:"([^"]+)"|([^\s\n]+))', var_body)
        desc_match = re.search(r'description\s*=\s*"([^"]+)"', var_body)
        
        analysis["variables_found"].append({
            "name": var_name,
            "type": type_match.group(1) if type_match else "any",
            "default": default_match.group(1) or default_match.group(2) if default_match else None,
            "description": desc_match.group(1) if desc_match else None
        })
    
    # Extract outputs
    output_pattern = r'output\s+"([^"]+)"\s*\{([^}]*)\}'
    for match in re.finditer(output_pattern, content, re.DOTALL):
        output_name = match.group(1)
        output_body = match.group(2)
        
        value_match = re.search(r'value\s*=\s*(.+)', output_body)
        desc_match = re.search(r'description\s*=\s*"([^"]+)"', output_body)
        
        analysis["outputs_found"].append({
            "name": output_name,
            "value": value_match.group(1).strip() if value_match else None,
            "description": desc_match.group(1) if desc_match else None
        })
    
    # Extract modules
    module_pattern = r'module\s+"([^"]+)"\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}'
    for match in re.finditer(module_pattern, content, re.DOTALL):
        module_name = match.group(1)
        module_body = match.group(2)
        
        source_match = re.search(r'source\s*=\s*"([^"]+)"', module_body)
        
        analysis["modules"].append({
            "name": module_name,
            "source": source_match.group(1) if source_match else None
        })
    
    return analysis


def generate_dynamic_explanation(filename: str, content: str, analysis: Dict[str, Any]) -> Dict[str, str]:
    """Generate dynamic, content-aware explanations for a file"""
    
    # Build dynamic overview based on what's actually in the file
    providers_str = ", ".join(analysis["providers"]) if analysis["providers"] else "cloud"
    resource_count = len(analysis["resources_found"])
    var_count = len(analysis["variables_found"])
    output_count = len(analysis["outputs_found"])
    module_count = len(analysis["modules"])
    
    # Generate technical summary line
    tech_parts = []
    if resource_count > 0:
        resource_types = list(set([r["type"] for r in analysis["resources_found"]]))
        tech_parts.append(f"Defines {resource_count} resource(s): {', '.join(resource_types[:5])}")
    if var_count > 0:
        tech_parts.append(f"{var_count} input variable(s)")
    if output_count > 0:
        tech_parts.append(f"{output_count} output value(s)")
    if module_count > 0:
        tech_parts.append(f"{module_count} module reference(s)")
    
    tech_summary = f"Terraform configuration file ({analysis['line_count']} lines). "
    if tech_parts:
        tech_summary += ". ".join(tech_parts) + "."
    else:
        tech_summary += "Configuration or documentation file."
    
    # Generate rich paragraph overview based on resource types
    overview_parts = []
    
    # Categorize resources for better descriptions
    has_ecs = any("ecs" in r["type"] for r in analysis["resources_found"])
    has_vpc = any("vpc" in r["type"] for r in analysis["resources_found"])
    has_subnet = any("subnet" in r["type"] for r in analysis["resources_found"])
    has_security = any("security" in r["type"] for r in analysis["resources_found"])
    has_iam = any("iam" in r["type"] or "role" in r["type"] for r in analysis["resources_found"])
    has_s3 = any("s3" in r["type"] for r in analysis["resources_found"])
    has_rds = any("rds" in r["type"] or "db_" in r["type"] for r in analysis["resources_found"])
    has_lb = any("lb" in r["type"] or "load_balancer" in r["type"] for r in analysis["resources_found"])
    has_lambda = any("lambda" in r["type"] for r in analysis["resources_found"])
    has_cloudwatch = any("cloudwatch" in r["type"] for r in analysis["resources_found"])
    has_autoscaling = any("autoscaling" in r["type"] for r in analysis["resources_found"])
    
    # Build paragraph based on what's in the file
    if has_ecs:
        overview_parts.append(f"This file configures Amazon ECS (Elastic Container Service) to run your containerized applications. It sets up the container definitions, task configurations, and service settings that tell AWS how to run and manage your Docker containers in the cloud.")
        if has_cloudwatch:
            overview_parts.append("It also configures CloudWatch logging so you can monitor your container logs and track application behavior.")
    elif has_vpc:
        overview_parts.append(f"This file creates your Virtual Private Cloud (VPC) - essentially your own private, isolated section of the AWS cloud. Think of it as setting up your own private network in the cloud where your resources can communicate securely.")
        if has_subnet:
            overview_parts.append("It divides this network into subnets, some public (accessible from the internet) and some private (isolated for security).")
    elif has_security:
        overview_parts.append(f"This file defines your security rules - the firewall configurations that control what traffic can reach your servers. It specifies which ports are open, which IP addresses can connect, and what kind of traffic is allowed in and out.")
    elif has_iam:
        overview_parts.append(f"This file manages permissions and access control. It defines who (or what services) can do what in your AWS account. These IAM roles and policies are crucial for security - they ensure services only have the permissions they need.")
    elif has_s3:
        overview_parts.append(f"This file sets up S3 (Simple Storage Service) buckets for storing files in the cloud. S3 is like a highly reliable, infinitely scalable hard drive that's accessible from anywhere. It's commonly used for backups, static websites, and application data.")
    elif has_rds:
        overview_parts.append(f"This file configures your database using Amazon RDS (Relational Database Service). RDS manages your database for you - handling backups, updates, and failover automatically so you don't have to worry about database administration.")
    elif has_lb:
        overview_parts.append(f"This file sets up a load balancer to distribute incoming traffic across multiple servers. This ensures no single server gets overwhelmed and provides high availability - if one server fails, traffic automatically goes to healthy ones.")
    elif has_lambda:
        overview_parts.append(f"This file configures AWS Lambda functions - serverless code that runs only when triggered. You don't pay for idle time, making it cost-effective for event-driven tasks, APIs, and automation.")
    elif has_autoscaling:
        overview_parts.append(f"This file configures auto-scaling rules that automatically add or remove servers based on demand. When traffic increases, more servers spin up; when it decreases, servers shut down to save costs.")
    elif var_count > 0 and resource_count == 0:
        var_names = [v["name"] for v in analysis["variables_found"][:5]]
        overview_parts.append(f"This file defines the configurable parameters for your infrastructure. Variables like {', '.join(var_names)} allow you to customize the deployment without changing the main code. This makes it easy to use the same infrastructure for different environments (dev, staging, production).")
    elif output_count > 0 and resource_count == 0:
        output_names = [o["name"] for o in analysis["outputs_found"][:5]]
        overview_parts.append(f"This file defines what information to display after your infrastructure is created. Outputs like {', '.join(output_names)} give you the addresses, IDs, and connection details you'll need to use your newly created resources.")
    else:
        # Generic fallback
        base = FILE_EXPLANATIONS.get(filename, {})
        if base:
            overview_parts.append(base.get("simple", f"This file is part of your {providers_str} infrastructure configuration."))
        else:
            overview_parts.append(f"This file is part of your {providers_str} infrastructure configuration and helps define how your cloud resources are set up and connected.")
    
    # Add provider context
    if analysis["providers"] and len(overview_parts) > 0:
        if "AWS" in analysis["providers"]:
            overview_parts.append("It uses Amazon Web Services (AWS) as the cloud provider.")
        elif "DigitalOcean" in analysis["providers"]:
            overview_parts.append("It uses DigitalOcean as the cloud provider - a developer-friendly alternative to AWS.")
        elif "Google Cloud" in analysis["providers"]:
            overview_parts.append("It uses Google Cloud Platform (GCP) as the cloud provider.")
    
    # Add variable/output info for resource files
    if resource_count > 0:
        if var_count > 0:
            overview_parts.append(f"You can customize this file using {var_count} input variable(s).")
        if output_count > 0:
            overview_parts.append(f"After deployment, it will provide {output_count} output value(s) with important information about the created resources.")
    
    simple = " ".join(overview_parts)
    
    # Technical is the summary + the paragraph
    technical = tech_summary + "\n\n" + simple
    
    return {"simple": simple, "technical": technical}


def get_file_explanation(filename: str, content: str = "") -> Dict[str, str]:
    """Get explanation for a file based on its name and content"""
    if content:
        analysis = analyze_file_content(filename, content)
        return generate_dynamic_explanation(filename, content, analysis)
    
    # Fallback to static explanations if no content
    base = FILE_EXPLANATIONS.get(filename, {
        "simple": f"A configuration file that helps set up your infrastructure.",
        "technical": f"Terraform configuration file: {filename}"
    })
    return base


def generate_file_sections(filename: str, content: str, analysis: Dict[str, Any], simple_mode: bool = True) -> List[Dict[str, Any]]:
    """Generate rich documentation sections like Confluence/Notion for a file"""
    sections = []
    
    # Overview section
    providers_str = ", ".join(analysis["providers"]) if analysis["providers"] else "Infrastructure"
    overview_content = f"This file is part of your {providers_str} infrastructure configuration."
    
    if analysis["line_count"]:
        overview_content += f" It contains {analysis['line_count']} lines of configuration."
    
    sections.append({
        "title": "Overview",
        "content": overview_content,
        "items": []
    })
    
    # Resources section - if any resources found
    if analysis["resources_found"]:
        resource_items = []
        for r in analysis["resources_found"]:
            rtype = r["type"]
            rname = r["name"]
            
            # Get simple description based on resource type
            if simple_mode:
                desc = RESOURCE_EXPLANATIONS.get(rtype, {}).get("simple", f"A {rtype.replace('_', ' ')} resource")
            else:
                desc = RESOURCE_EXPLANATIONS.get(rtype, {}).get("technical", f"Resource type: {rtype}")
            
            # Add key attributes
            attrs = r.get("attributes", {})
            attr_str = ""
            if attrs:
                key_attrs = list(attrs.items())[:3]
                attr_str = " | " + ", ".join([f"{k}: {v}" for k, v in key_attrs])
            
            resource_items.append(f"**{rname}** ({rtype}): {desc}{attr_str}")
        
        sections.append({
            "title": "Resources Defined",
            "content": f"This file defines {len(analysis['resources_found'])} cloud resource(s):",
            "items": resource_items
        })
    
    # Variables section
    if analysis["variables_found"]:
        var_items = []
        for v in analysis["variables_found"]:
            desc = v.get("description") or f"Input variable of type {v['type']}"
            default = f" (default: {v['default']})" if v.get("default") else " (required)"
            var_items.append(f"**{v['name']}**: {desc}{default}")
        
        sections.append({
            "title": "Configuration Options",
            "content": f"You can customize this file with {len(analysis['variables_found'])} variable(s):",
            "items": var_items
        })
    
    # Outputs section
    if analysis["outputs_found"]:
        output_items = []
        for o in analysis["outputs_found"]:
            desc = o.get("description") or "Output value"
            output_items.append(f"**{o['name']}**: {desc}")
        
        sections.append({
            "title": "Outputs",
            "content": f"After deployment, this file exposes {len(analysis['outputs_found'])} value(s):",
            "items": output_items
        })
    
    # Modules section
    if analysis["modules"]:
        module_items = []
        for m in analysis["modules"]:
            source = m.get("source", "unknown")
            module_items.append(f"**{m['name']}**: Source: {source}")
        
        sections.append({
            "title": "Module References",
            "content": f"This file uses {len(analysis['modules'])} external module(s):",
            "items": module_items
        })
    
    # Dependencies section
    all_deps = []
    for r in analysis["resources_found"]:
        if r.get("dependencies"):
            for dep in r["dependencies"]:
                dep_str = ".".join(dep) if isinstance(dep, (list, tuple)) else str(dep)
                if dep_str not in all_deps:
                    all_deps.append(dep_str)
    
    if all_deps:
        sections.append({
            "title": "Dependencies",
            "content": "This file depends on or references these other resources:",
            "items": all_deps[:10]  # Limit to 10
        })
    
    # Provider section
    if analysis["providers"]:
        provider_items = []
        for p in analysis["providers"]:
            if p == "AWS":
                provider_items.append("**Amazon Web Services (AWS)**: Cloud computing platform with extensive services")
            elif p == "DigitalOcean":
                provider_items.append("**DigitalOcean**: Developer-friendly cloud platform")
            elif p == "Google Cloud":
                provider_items.append("**Google Cloud Platform (GCP)**: Google's cloud infrastructure")
            elif p == "Azure":
                provider_items.append("**Microsoft Azure**: Enterprise cloud platform")
        
        if provider_items:
            sections.append({
                "title": "Cloud Providers",
                "content": "This file interacts with the following cloud provider(s):",
                "items": provider_items
            })
    
    return sections


def parse_terraform_file(content: str) -> List[WikiResource]:
    """Parse Terraform file and extract resources"""
    resources = []
    
    # Match resource blocks
    resource_pattern = r'resource\s+"([^"]+)"\s+"([^"]+)"'
    for match in re.finditer(resource_pattern, content):
        resource_type = match.group(1)
        resource_name = match.group(2)
        resources.append(WikiResource(
            type=resource_type,
            name=resource_name,
            explanation=get_resource_explanation(resource_type, resource_name)
        ))
    
    # Match module blocks
    module_pattern = r'module\s+"([^"]+)"'
    for match in re.finditer(module_pattern, content):
        module_name = match.group(1)
        resources.append(WikiResource(
            type="module",
            name=module_name,
            explanation={
                "technical": f"Terraform module '{module_name}' encapsulating reusable infrastructure components.",
                "simple": f"A reusable piece of infrastructure called '{module_name}' - like a template that can be used multiple times."
            }
        ))
    
    return resources


def estimate_cost(resources: List[WikiResource]) -> Dict[str, str]:
    """Estimate cost based on resources"""
    # Simple cost estimation
    costs = {
        "aws_instance": 30,
        "aws_rds_instance": 50,
        "aws_lb": 20,
        "aws_s3_bucket": 5,
        "digitalocean_droplet": 10,
        "digitalocean_kubernetes_cluster": 100,
    }
    
    total = 0
    breakdown = []
    for r in resources:
        if r.type in costs:
            total += costs[r.type]
            breakdown.append(f"{r.type}: ~${costs[r.type]}/mo")
    
    return {
        "estimate": f"~${total}/month" if total > 0 else "Minimal cost",
        "breakdown": ", ".join(breakdown) if breakdown else "No billable resources detected"
    }


def calculate_security_score(content: str) -> Dict[str, Any]:
    """Calculate security score based on content analysis"""
    issues = []
    score = 100
    
    # Check for common security issues
    if "0.0.0.0/0" in content and "ingress" in content.lower():
        issues.append("Open ingress from 0.0.0.0/0 detected - consider restricting")
        score -= 15
    
    if "hardcoded" in content.lower() or re.search(r'password\s*=\s*"[^"]+"', content):
        issues.append("Possible hardcoded credentials - use variables or secrets manager")
        score -= 20
    
    if "encrypt" not in content.lower() and ("s3" in content or "rds" in content or "ebs" in content):
        issues.append("Consider enabling encryption for data at rest")
        score -= 10
    
    if "logging" not in content.lower() and "cloudtrail" not in content.lower():
        issues.append("Consider adding logging/audit configuration")
        score -= 5
    
    return {
        "score": max(0, score),
        "issues": issues
    }


@router.post("/generate/{owner}/{repo}", response_model=WikiResponse)
async def generate_wiki(
    owner: str,
    repo: str,
    request: WikiGenerateRequest,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Generate AI-powered wiki documentation for a repository
    """
    try:
        files = []
        all_resources = []
        total_files = 0
        
        # PRIORITY 1: Use files sent from frontend (desktop/electron mode)
        if request.files and len(request.files) > 0:
            code_extensions = ['.tf', '.tfvars', '.hcl', '.json', '.yaml', '.yml', '.md']
            
            for file_data in request.files:
                # Check if file has a supported extension
                ext = None
                for e in code_extensions:
                    if file_data.path.endswith(e):
                        ext = e[1:]  # Remove the dot
                        break
                
                if ext:
                    total_files += 1
                    filename = os.path.basename(file_data.path)
                    content = file_data.content
                    
                    # Deep analyze the file content
                    analysis = analyze_file_content(filename, content)
                    
                    # Parse resources only from .tf files
                    resources = []
                    if ext == 'tf' or ext == 'tfvars' or ext == 'hcl':
                        resources = parse_terraform_file(content)
                        all_resources.extend(resources)
                    
                    # Generate rich sections for documentation
                    sections = generate_file_sections(filename, content, analysis, request.simple_mode)
                    
                    # Convert variables and outputs to proper format
                    variables = [WikiVariable(**v) for v in analysis["variables_found"]]
                    outputs = [WikiOutput(**o) for o in analysis["outputs_found"]]
                    
                    files.append(WikiFile(
                        path=file_data.path,
                        name=filename,
                        type="file",
                        extension=ext,
                        explanation=get_file_explanation(filename, content),
                        resources=resources,
                        variables=variables if variables else None,
                        outputs=outputs if outputs else None,
                        sections=sections if sections else None,
                        providers=analysis["providers"] if analysis["providers"] else None,
                        modules=analysis["modules"] if analysis["modules"] else None,
                        line_count=analysis["line_count"],
                        security=calculate_security_score(content) if ext in ['tf', 'tfvars', 'hcl'] else {"score": 100, "issues": []},
                        cost=estimate_cost(resources) if resources else {"estimate": "$0", "breakdown": "No billable resources"}
                    ))
        else:
            # PRIORITY 2: Try to read from local repo if available
            repo_paths = [
                os.path.expanduser(f"~/.driftbox/repos/{owner}/{repo}"),
                os.path.join(os.environ.get('WORKSPACE_ROOT', ''), owner, repo) if os.environ.get('WORKSPACE_ROOT') else None,
            ]
            
            repo_path = None
            for path in repo_paths:
                if path and os.path.exists(path):
                    repo_path = path
                    break
            
            if repo_path:
                # Scan actual repo
                for root, dirs, filenames in os.walk(repo_path):
                    # Skip hidden and common non-tf directories
                    dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['node_modules', '.terraform']]
                    
                    for filename in filenames:
                        if filename.endswith('.tf'):
                            total_files += 1
                            filepath = os.path.join(root, filename)
                            rel_path = os.path.relpath(filepath, repo_path)
                            
                            try:
                                with open(filepath, 'r') as f:
                                    content = f.read()
                            except:
                                content = ""
                            
                            resources = parse_terraform_file(content)
                            all_resources.extend(resources)
                            
                            files.append(WikiFile(
                                path=rel_path,
                                name=filename,
                                type="file",
                                extension="tf",
                                explanation=get_file_explanation(filename, content),
                                resources=resources,
                                security=calculate_security_score(content),
                                cost=estimate_cost(resources)
                            ))
        
        # PRIORITY 3: Return demo data if nothing found
        if len(files) == 0:
            files = [
                WikiFile(
                    path="main.tf",
                    name="main.tf",
                    type="file",
                    extension="tf",
                    explanation=FILE_EXPLANATIONS.get("main.tf", {}),
                    resources=[
                        WikiResource(
                            type="aws_vpc",
                            name="main",
                            explanation=get_resource_explanation("aws_vpc", "main")
                        )
                    ],
                    security={"score": 85, "issues": []},
                    cost={"estimate": "$0/month", "breakdown": "VPC is free"}
                ),
                WikiFile(
                    path="variables.tf",
                    name="variables.tf",
                    type="file",
                    extension="tf",
                    explanation=FILE_EXPLANATIONS.get("variables.tf", {}),
                    resources=[],
                    security={"score": 100, "issues": []},
                    cost={"estimate": "$0", "breakdown": "No resources"}
                )
            ]
            total_files = 2
            all_resources = files[0].resources or []
        
        # Calculate overall stats
        avg_security = sum(f.security.get("score", 100) for f in files if f.security) / max(len(files), 1)
        total_cost = sum(int(re.search(r'\d+', f.cost.get("estimate", "0")).group() if f.cost and re.search(r'\d+', f.cost.get("estimate", "0")) else 0) for f in files if f.cost)
        
        return WikiResponse(
            files=files,
            summary={
                "technical": f"Terraform repository with {total_files} configuration files defining {len(all_resources)} resources. "
                           f"Average security score: {avg_security:.0f}/100. Estimated monthly cost: ${total_cost}.",
                "simple": f"This repository contains your cloud infrastructure setup. It has {total_files} configuration files "
                         f"that create {len(all_resources)} cloud resources. Your security score is {avg_security:.0f}/100, "
                         f"and it costs about ${total_cost} per month to run."
            },
            stats={
                "totalFiles": total_files,
                "resources": len(all_resources),
                "estimatedCost": f"${total_cost}/month",
                "securityScore": int(avg_security)
            }
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/explain/{owner}/{repo}/{path:path}")
async def explain_file(
    owner: str,
    repo: str,
    path: str,
    simple: bool = True,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get detailed explanation for a specific file
    """
    try:
        # Try to find and read the file
        repo_paths = [
            os.path.expanduser(f"~/.driftbox/repos/{owner}/{repo}"),
        ]
        
        for repo_path in repo_paths:
            if os.path.exists(repo_path):
                filepath = os.path.join(repo_path, path)
                if os.path.exists(filepath):
                    with open(filepath, 'r') as f:
                        content = f.read()
                    
                    resources = parse_terraform_file(content)
                    explanation = get_file_explanation(os.path.basename(path), content)
                    
                    return {
                        "path": path,
                        "explanation": explanation["simple"] if simple else explanation["technical"],
                        "resources": [
                            {
                                "type": r.type,
                                "name": r.name,
                                "explanation": r.explanation["simple"] if simple else r.explanation["technical"]
                            }
                            for r in resources
                        ],
                        "security": calculate_security_score(content),
                        "cost": estimate_cost(resources)
                    }
        
        raise HTTPException(status_code=404, detail="File not found")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

