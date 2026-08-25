from fastapi import APIRouter, HTTPException, Depends
from app.services.catalog import INFRASTRUCTURE_CATALOG
from app.services.infrastructure_query_service import infrastructure_query_service
from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.utils.errors import sanitize_error_detail
from typing import Dict, List, Any, Optional
from collections import defaultdict
import re

router = APIRouter()

AWS_RESOURCE_ICONS = {
    # Compute
    "aws_instance": "🖥️",
    "aws_launch_template": "🚀",
    "aws_autoscaling_group": "📊",
    "aws_lambda_function": "⚡",
    "aws_lambda_layer_version": "📦",
    "aws_ecs_cluster": "🐳",
    "aws_ecs_service": "🐳",
    "aws_ecs_task_definition": "📋",
    "aws_eks_cluster": "☸️",
    "aws_eks_node_group": "☸️",
    "aws_batch_job_definition": "⚙️",
    "aws_batch_compute_environment": "⚙️",
    
    # Storage
    "aws_s3_bucket": "💾",
    "aws_s3_bucket_policy": "📋",
    "aws_s3_bucket_versioning": "🔄",
    "aws_ebs_volume": "💿",
    "aws_ebs_snapshot": "📸",
    "aws_efs_file_system": "📁",
    "aws_fsx_windows_file_system": "📁",
    "aws_backup_vault": "🔐",
    "aws_glacier_vault": "🧊",
    
    # Database
    "aws_db_instance": "🗄️",
    "aws_rds_cluster": "🗄️",
    "aws_dynamodb_table": "⚡",
    "aws_elasticache_cluster": "⚡",
    "aws_elasticache_replication_group": "⚡",
    "aws_redshift_cluster": "📊",
    "aws_neptune_cluster": "🔗",
    "aws_docdb_cluster": "📄",
    "aws_timestream_database": "⏱️",
    
    # Networking
    "aws_vpc": "🌐",
    "aws_subnet": "🌐",
    "aws_internet_gateway": "🌍",
    "aws_nat_gateway": "🔄",
    "aws_route_table": "🗺️",
    "aws_route": "➡️",
    "aws_network_acl": "🔒",
    "aws_security_group": "🔒",
    "aws_security_group_rule": "🔐",
    "aws_vpc_peering_connection": "🔗",
    "aws_vpc_endpoint": "🔌",
    "aws_vpn_gateway": "🔒",
    "aws_customer_gateway": "🏢",
    "aws_vpn_connection": "🔐",
    "aws_transit_gateway": "🚦",
    "aws_elastic_ip": "🌐",
    "aws_network_interface": "🔌",
    
    # Load Balancing
    "aws_lb": "⚖️",
    "aws_alb": "⚖️",
    "aws_elb": "⚖️",
    "aws_lb_target_group": "🎯",
    "aws_lb_listener": "👂",
    
    # IAM & Security
    "aws_iam_role": "👤",
    "aws_iam_user": "👤",
    "aws_iam_group": "👥",
    "aws_iam_policy": "📋",
    "aws_iam_role_policy": "📋",
    "aws_iam_user_policy": "📋",
    "aws_iam_group_policy": "📋",
    "aws_iam_policy_attachment": "📎",
    "aws_iam_role_policy_attachment": "📎",
    "aws_iam_instance_profile": "🎫",
    "aws_kms_key": "🔑",
    "aws_kms_alias": "🏷️",
    "aws_secretsmanager_secret": "🔐",
    "aws_ssm_parameter": "⚙️",
    
    # API & Integration
    "aws_api_gateway_rest_api": "🔌",
    "aws_api_gateway_resource": "🔌",
    "aws_api_gateway_method": "🔌",
    "aws_api_gateway_deployment": "🚀",
    "aws_api_gateway_stage": "🎬",
    "aws_apigatewayv2_api": "🔌",
    "aws_appsync_graphql_api": "📊",
    "aws_sns_topic": "📢",
    "aws_sns_topic_subscription": "📨",
    "aws_sqs_queue": "📬",
    "aws_eventbridge_rule": "📅",
    "aws_cloudwatch_event_rule": "📅",
    "aws_step_functions_state_machine": "🔄",
    
    # Monitoring & Logging
    "aws_cloudwatch_log_group": "📝",
    "aws_cloudwatch_log_stream": "📝",
    "aws_cloudwatch_metric_alarm": "🚨",
    "aws_cloudwatch_dashboard": "📊",
    "aws_xray_sampling_rule": "🔍",
    
    # Content Delivery
    "aws_cloudfront_distribution": "🌍",
    "aws_cloudfront_origin_access_identity": "🎫",
    "aws_route53_zone": "🌐",
    "aws_route53_record": "📍",
    "aws_acm_certificate": "🔐",
    
    # Containers & Orchestration
    "aws_ecr_repository": "🐳",
    "aws_ecr_repository_policy": "📋",
    "aws_ecs_capacity_provider": "⚙️",
    "aws_app_runner_service": "🏃",
    
    # Analytics & Big Data
    "aws_kinesis_stream": "🌊",
    "aws_kinesis_firehose_delivery_stream": "🔥",
    "aws_athena_database": "🔍",
    "aws_glue_catalog_database": "📚",
    "aws_glue_crawler": "🕷️",
    "aws_emr_cluster": "📊",
    "aws_elasticsearch_domain": "🔍",
    "aws_opensearch_domain": "🔍",
    
    # Machine Learning
    "aws_sagemaker_notebook_instance": "📓",
    "aws_sagemaker_model": "🤖",
    "aws_sagemaker_endpoint": "🎯",
    
    # Application Services
    "aws_cognito_user_pool": "👥",
    "aws_cognito_identity_pool": "🎫",
    "aws_ses_domain_identity": "📧",
    "aws_ses_email_identity": "📧",
    
    # DevOps & CI/CD
    "aws_codebuild_project": "🔨",
    "aws_codepipeline": "🔄",
    "aws_codecommit_repository": "📦",
    "aws_codedeploy_app": "🚀",
    "aws_cloudformation_stack": "📚",
    
    # Management & Governance
    "aws_config_rule": "✅",
    "aws_cloudtrail": "👣",
    "aws_organizations_organization": "🏢",
    "aws_organizations_account": "👤",
    
    # Migration & Transfer
    "aws_dms_replication_instance": "🔄",
    "aws_transfer_server": "📤",
    
    # IoT
    "aws_iot_thing": "📡",
    "aws_iot_policy": "📋",
    
    # Media Services
    "aws_media_store_container": "🎬",
    
    # Other Services
    "aws_workspaces_directory": "💼",
    "aws_directory_service_directory": "📁",
}

# ===== DIGITALOCEAN RESOURCE ICONS =====
DIGITALOCEAN_RESOURCE_ICONS = {
    # Compute
    "digitalocean_droplet": "💧",
    "digitalocean_kubernetes_cluster": "☸️",
    "digitalocean_kubernetes_node_pool": "☸️",
    "digitalocean_app": "🚀",
    
    # Storage
    "digitalocean_spaces_bucket": "💾",
    "digitalocean_spaces_bucket_object": "📄",
    "digitalocean_volume": "💿",
    "digitalocean_volume_attachment": "🔗",
    "digitalocean_volume_snapshot": "📸",
    
    # Database
    "digitalocean_database_cluster": "🗄️",
    "digitalocean_database_db": "🗃️",
    "digitalocean_database_user": "👤",
    "digitalocean_database_replica": "🔄",
    "digitalocean_database_connection_pool": "🔌",
    "digitalocean_database_firewall": "🔒",
    
    # Networking
    "digitalocean_vpc": "🌐",
    "digitalocean_firewall": "🔒",
    "digitalocean_loadbalancer": "⚖️",
    "digitalocean_floating_ip": "🌐",
    "digitalocean_floating_ip_assignment": "📍",
    "digitalocean_reserved_ip": "🌐",
    "digitalocean_reserved_ip_assignment": "📍",
    
    # DNS
    "digitalocean_domain": "🌐",
    "digitalocean_record": "📍",
    "digitalocean_certificate": "🔐",
    
    # Container Registry
    "digitalocean_container_registry": "🐳",
    "digitalocean_container_registry_docker_credentials": "🔑",
    
    # Monitoring
    "digitalocean_monitor_alert": "🚨",
    "digitalocean_uptime_check": "✅",
    "digitalocean_uptime_alert": "📢",
    
    # Project Management
    "digitalocean_project": "📁",
    "digitalocean_project_resources": "📦",
    "digitalocean_tag": "🏷️",
    
    # SSH & Access
    "digitalocean_ssh_key": "🔑",
    
    # CDN
    "digitalocean_cdn": "📡",
    
    # Functions
    "digitalocean_function": "⚡",
}

AWS_RESOURCE_DISPLAY_NAMES = {
    # Compute
    "aws_instance": "EC2 Instances",
    "aws_launch_template": "Launch Templates",
    "aws_autoscaling_group": "Auto Scaling Groups",
    "aws_lambda_function": "Lambda Functions",
    "aws_lambda_layer_version": "Lambda Layers",
    "aws_ecs_cluster": "ECS Clusters",
    "aws_ecs_service": "ECS Services",
    "aws_ecs_task_definition": "ECS Task Definitions",
    "aws_eks_cluster": "EKS Clusters",
    "aws_eks_node_group": "EKS Node Groups",
    "aws_batch_job_definition": "Batch Job Definitions",
    "aws_batch_compute_environment": "Batch Compute Environments",
    
    # Storage
    "aws_s3_bucket": "S3 Buckets",
    "aws_s3_bucket_policy": "S3 Bucket Policies",
    "aws_s3_bucket_versioning": "S3 Bucket Versioning",
    "aws_ebs_volume": "EBS Volumes",
    "aws_ebs_snapshot": "EBS Snapshots",
    "aws_efs_file_system": "EFS File Systems",
    "aws_fsx_windows_file_system": "FSx File Systems",
    "aws_backup_vault": "Backup Vaults",
    "aws_glacier_vault": "Glacier Vaults",
    
    # Database
    "aws_db_instance": "RDS Instances",
    "aws_rds_cluster": "RDS Clusters",
    "aws_dynamodb_table": "DynamoDB Tables",
    "aws_elasticache_cluster": "ElastiCache Clusters",
    "aws_elasticache_replication_group": "ElastiCache Replication Groups",
    "aws_redshift_cluster": "Redshift Clusters",
    "aws_neptune_cluster": "Neptune Clusters",
    "aws_docdb_cluster": "DocumentDB Clusters",
    "aws_timestream_database": "Timestream Databases",
    
    # Networking
    "aws_vpc": "VPCs",
    "aws_subnet": "Subnets",
    "aws_internet_gateway": "Internet Gateways",
    "aws_nat_gateway": "NAT Gateways",
    "aws_route_table": "Route Tables",
    "aws_route": "Routes",
    "aws_network_acl": "Network ACLs",
    "aws_security_group": "Security Groups",
    "aws_security_group_rule": "Security Group Rules",
    "aws_vpc_peering_connection": "VPC Peering Connections",
    "aws_vpc_endpoint": "VPC Endpoints",
    "aws_vpn_gateway": "VPN Gateways",
    "aws_customer_gateway": "Customer Gateways",
    "aws_vpn_connection": "VPN Connections",
    "aws_transit_gateway": "Transit Gateways",
    "aws_elastic_ip": "Elastic IPs",
    "aws_network_interface": "Network Interfaces",
    
    # Load Balancing
    "aws_lb": "Load Balancers",
    "aws_alb": "Application Load Balancers",
    "aws_elb": "Classic Load Balancers",
    "aws_lb_target_group": "Target Groups",
    "aws_lb_listener": "Load Balancer Listeners",
    
    # IAM & Security
    "aws_iam_role": "IAM Roles",
    "aws_iam_user": "IAM Users",
    "aws_iam_group": "IAM Groups",
    "aws_iam_policy": "IAM Policies",
    "aws_iam_role_policy": "IAM Role Inline Policies",
    "aws_iam_user_policy": "IAM User Inline Policies",
    "aws_iam_group_policy": "IAM Group Inline Policies",
    "aws_iam_policy_attachment": "IAM Policy Attachments",
    "aws_iam_role_policy_attachment": "IAM Role Policy Attachments",
    "aws_iam_instance_profile": "IAM Instance Profiles",
    "aws_kms_key": "KMS Keys",
    "aws_kms_alias": "KMS Aliases",
    "aws_secretsmanager_secret": "Secrets Manager Secrets",
    "aws_ssm_parameter": "SSM Parameters",
    
    # API & Integration
    "aws_api_gateway_rest_api": "API Gateway REST APIs",
    "aws_api_gateway_resource": "API Gateway Resources",
    "aws_api_gateway_method": "API Gateway Methods",
    "aws_api_gateway_deployment": "API Gateway Deployments",
    "aws_api_gateway_stage": "API Gateway Stages",
    "aws_apigatewayv2_api": "API Gateway V2 APIs",
    "aws_appsync_graphql_api": "AppSync GraphQL APIs",
    "aws_sns_topic": "SNS Topics",
    "aws_sns_topic_subscription": "SNS Subscriptions",
    "aws_sqs_queue": "SQS Queues",
    "aws_eventbridge_rule": "EventBridge Rules",
    "aws_cloudwatch_event_rule": "CloudWatch Event Rules",
    "aws_step_functions_state_machine": "Step Functions State Machines",
    
    # Monitoring & Logging
    "aws_cloudwatch_log_group": "CloudWatch Log Groups",
    "aws_cloudwatch_log_stream": "CloudWatch Log Streams",
    "aws_cloudwatch_metric_alarm": "CloudWatch Alarms",
    "aws_cloudwatch_dashboard": "CloudWatch Dashboards",
    "aws_xray_sampling_rule": "X-Ray Sampling Rules",
    
    # Content Delivery
    "aws_cloudfront_distribution": "CloudFront Distributions",
    "aws_cloudfront_origin_access_identity": "CloudFront OAI",
    "aws_route53_zone": "Route53 Hosted Zones",
    "aws_route53_record": "Route53 Records",
    "aws_acm_certificate": "ACM Certificates",
    
    # Containers & Orchestration
    "aws_ecr_repository": "ECR Repositories",
    "aws_ecr_repository_policy": "ECR Repository Policies",
    "aws_ecs_capacity_provider": "ECS Capacity Providers",
    "aws_app_runner_service": "App Runner Services",
    
    # Analytics & Big Data
    "aws_kinesis_stream": "Kinesis Streams",
    "aws_kinesis_firehose_delivery_stream": "Kinesis Firehose Streams",
    "aws_athena_database": "Athena Databases",
    "aws_glue_catalog_database": "Glue Databases",
    "aws_glue_crawler": "Glue Crawlers",
    "aws_emr_cluster": "EMR Clusters",
    "aws_elasticsearch_domain": "Elasticsearch Domains",
    "aws_opensearch_domain": "OpenSearch Domains",
    
    # Machine Learning
    "aws_sagemaker_notebook_instance": "SageMaker Notebooks",
    "aws_sagemaker_model": "SageMaker Models",
    "aws_sagemaker_endpoint": "SageMaker Endpoints",
    
    # Application Services
    "aws_cognito_user_pool": "Cognito User Pools",
    "aws_cognito_identity_pool": "Cognito Identity Pools",
    "aws_ses_domain_identity": "SES Domain Identities",
    "aws_ses_email_identity": "SES Email Identities",
    
    # DevOps & CI/CD
    "aws_codebuild_project": "CodeBuild Projects",
    "aws_codepipeline": "CodePipeline Pipelines",
    "aws_codecommit_repository": "CodeCommit Repositories",
    "aws_codedeploy_app": "CodeDeploy Applications",
    "aws_cloudformation_stack": "CloudFormation Stacks",
    
    # Management & Governance
    "aws_config_rule": "Config Rules",
    "aws_cloudtrail": "CloudTrail Trails",
    "aws_organizations_organization": "Organizations",
    "aws_organizations_account": "Organization Accounts",
    
    # Migration & Transfer
    "aws_dms_replication_instance": "DMS Replication Instances",
    "aws_transfer_server": "Transfer Family Servers",
    
    # IoT
    "aws_iot_thing": "IoT Things",
    "aws_iot_policy": "IoT Policies",
    
    # Media Services
    "aws_media_store_container": "MediaStore Containers",
    
    # Other Services
    "aws_workspaces_directory": "WorkSpaces Directories",
    "aws_directory_service_directory": "Directory Service Directories",
}

# ===== DIGITALOCEAN RESOURCE DISPLAY NAMES =====
DIGITALOCEAN_RESOURCE_DISPLAY_NAMES = {
    # Compute
    "digitalocean_droplet": "Droplets",
    "digitalocean_kubernetes_cluster": "Kubernetes Clusters",
    "digitalocean_kubernetes_node_pool": "Kubernetes Node Pools",
    "digitalocean_app": "App Platform Apps",
    
    # Storage
    "digitalocean_spaces_bucket": "Spaces Buckets",
    "digitalocean_spaces_bucket_object": "Spaces Objects",
    "digitalocean_volume": "Block Storage Volumes",
    "digitalocean_volume_attachment": "Volume Attachments",
    "digitalocean_volume_snapshot": "Volume Snapshots",
    
    # Database
    "digitalocean_database_cluster": "Managed Databases",
    "digitalocean_database_db": "Database Names",
    "digitalocean_database_user": "Database Users",
    "digitalocean_database_replica": "Database Replicas",
    "digitalocean_database_connection_pool": "Connection Pools",
    "digitalocean_database_firewall": "Database Firewalls",
    
    # Networking
    "digitalocean_vpc": "VPCs",
    "digitalocean_firewall": "Firewalls",
    "digitalocean_loadbalancer": "Load Balancers",
    "digitalocean_floating_ip": "Floating IPs",
    "digitalocean_floating_ip_assignment": "Floating IP Assignments",
    "digitalocean_reserved_ip": "Reserved IPs",
    "digitalocean_reserved_ip_assignment": "Reserved IP Assignments",
    
    # DNS
    "digitalocean_domain": "Domains",
    "digitalocean_record": "DNS Records",
    "digitalocean_certificate": "Certificates",
    
    # Container Registry
    "digitalocean_container_registry": "Container Registries",
    "digitalocean_container_registry_docker_credentials": "Registry Credentials",
    
    # Monitoring
    "digitalocean_monitor_alert": "Monitor Alerts",
    "digitalocean_uptime_check": "Uptime Checks",
    "digitalocean_uptime_alert": "Uptime Alerts",
    
    # Project Management
    "digitalocean_project": "Projects",
    "digitalocean_project_resources": "Project Resources",
    "digitalocean_tag": "Tags",
    
    # SSH & Access
    "digitalocean_ssh_key": "SSH Keys",
    
    # CDN
    "digitalocean_cdn": "CDN Endpoints",
    
    # Functions
    "digitalocean_function": "Functions",
}

def extract_resource_attributes(resource: Dict[str, Any]) -> Dict[str, Any]:
    """Extract useful attributes from a resource"""
    attrs = resource.get("attrs", {})
    resource_type = resource.get("type", "")
    tf_name = resource.get("name", "")  # Terraform resource name
    
    # Try to get the actual AWS resource name from attributes
    # Different resource types store their "name" in different attributes
    aws_name = None
    
    # Map of resource types to their name attribute
    name_attributes = {
        # AWS resources
        "aws_s3_bucket": "bucket",
        "aws_iam_role": "name",
        "aws_iam_user": "name",
        "aws_iam_group": "name",
        "aws_iam_policy": "name",
        "aws_lambda_function": "function_name",
        "aws_dynamodb_table": "name",
        "aws_instance": "tags.Name",  # EC2 uses tags
        "aws_vpc": "tags.Name",
        "aws_subnet": "tags.Name",
        "aws_security_group": "name",
        "aws_db_instance": "identifier",
        "aws_rds_cluster": "cluster_identifier",
        "aws_ecs_cluster": "name",
        "aws_ecs_service": "name",
        "aws_eks_cluster": "name",
        "aws_route53_zone": "name",
        "aws_cloudwatch_log_group": "name",
        "aws_sns_topic": "name",
        "aws_sqs_queue": "name",
        "aws_kms_key": "tags.Name",
        "aws_ecr_repository": "name",
        "aws_api_gateway_rest_api": "name",
        "aws_lb": "name",
        "aws_alb": "name",
        "aws_elb": "name",
        "aws_elasticache_cluster": "cluster_id",
        "aws_cloudfront_distribution": "comment",
        "aws_acm_certificate": "domain_name",
        # DigitalOcean resources
        "digitalocean_droplet": "name",
        "digitalocean_database_cluster": "name",
        "digitalocean_kubernetes_cluster": "name",
        "digitalocean_spaces_bucket": "name",
        "digitalocean_loadbalancer": "name",
        "digitalocean_firewall": "name",
        "digitalocean_vpc": "name",
        "digitalocean_volume": "name",
        "digitalocean_container_registry": "name",
        "digitalocean_app": "spec.name",
        "digitalocean_domain": "name",
        "digitalocean_project": "name",
        "digitalocean_ssh_key": "name",
    }
    
    # Try to get AWS resource name
    name_attr = name_attributes.get(resource_type)
    if name_attr:
        if "." in name_attr:  # Handle nested attributes like "tags.Name"
            parts = name_attr.split(".")
            value = attrs
            for part in parts:
                if isinstance(value, dict):
                    value = value.get(part)
                else:
                    value = None
                    break
            aws_name = value
        else:
            aws_name = attrs.get(name_attr)
    
    # Fallback to terraform name if no AWS name found
    display_name = aws_name if aws_name else tf_name
    
    # Common attributes
    extracted = {
        "name": display_name,  # Display name (AWS name or Terraform name)
        "tf_name": tf_name,  # Original Terraform resource name
        "type": resource_type,
        "file": resource.get("file", ""),
        "line": resource.get("line", 1),  # Line number in file
    }
    
    # S3 Bucket specific
    if resource_type == "aws_s3_bucket":
        extracted["bucket_name"] = attrs.get("bucket", extracted["name"])
        extracted["versioning"] = "enabled" if attrs.get("versioning", {}).get("enabled") else "disabled"
        extracted["encryption"] = "enabled" if attrs.get("server_side_encryption_configuration") else "disabled"
        extracted["public"] = "yes" if attrs.get("acl") == "public-read" else "no"
    
    # EC2 Instance specific
    elif resource_type == "aws_instance":
        extracted["instance_type"] = attrs.get("instance_type", "unknown")
        extracted["ami"] = attrs.get("ami", "")
        extracted["availability_zone"] = attrs.get("availability_zone", "")
    
    # Lambda specific
    elif resource_type == "aws_lambda_function":
        extracted["runtime"] = attrs.get("runtime", "")
        extracted["handler"] = attrs.get("handler", "")
        extracted["memory"] = attrs.get("memory_size", 128)
        extracted["timeout"] = attrs.get("timeout", 3)
    
    # DynamoDB specific
    elif resource_type == "aws_dynamodb_table":
        extracted["hash_key"] = attrs.get("hash_key", "")
        extracted["range_key"] = attrs.get("range_key", "")
        extracted["billing_mode"] = attrs.get("billing_mode", "PROVISIONED")
    
    # VPC specific
    elif resource_type == "aws_vpc":
        extracted["cidr_block"] = attrs.get("cidr_block", "")
        extracted["enable_dns"] = attrs.get("enable_dns_hostnames", False)
    
    # Security Group specific
    elif resource_type == "aws_security_group":
        extracted["vpc_id"] = attrs.get("vpc_id", "")
        ingress_rules = attrs.get("ingress", [])
        extracted["ingress_rules_count"] = len(ingress_rules) if isinstance(ingress_rules, list) else 0
        egress_rules = attrs.get("egress", [])
        extracted["egress_rules_count"] = len(egress_rules) if isinstance(egress_rules, list) else 0
    
    # IAM Role specific
    elif resource_type == "aws_iam_role":
        extracted["assume_role_policy"] = bool(attrs.get("assume_role_policy"))
        extracted["managed_policies"] = attrs.get("managed_policy_arns", [])
        extracted["max_session_duration"] = attrs.get("max_session_duration", 3600)
    
    # IAM Policy specific
    elif resource_type == "aws_iam_policy":
        extracted["policy_document"] = bool(attrs.get("policy"))
        extracted["path"] = attrs.get("path", "/")
    
    # IAM User specific
    elif resource_type == "aws_iam_user":
        extracted["path"] = attrs.get("path", "/")
        extracted["force_destroy"] = attrs.get("force_destroy", False)
    
    # RDS specific
    elif resource_type == "aws_db_instance":
        extracted["engine"] = attrs.get("engine", "")
        extracted["engine_version"] = attrs.get("engine_version", "")
        extracted["instance_class"] = attrs.get("instance_class", "")
        extracted["storage_gb"] = attrs.get("allocated_storage", 0)
        extracted["multi_az"] = attrs.get("multi_az", False)
        extracted["encrypted"] = attrs.get("storage_encrypted", False)
    
    # Route53 specific
    elif resource_type == "aws_route53_zone":
        extracted["zone_type"] = "private" if attrs.get("vpc") else "public"
    
    # CloudWatch Log Group
    elif resource_type == "aws_cloudwatch_log_group":
        extracted["retention_days"] = attrs.get("retention_in_days", "never")
        extracted["encrypted"] = bool(attrs.get("kms_key_id"))
    
    # ECS Service
    elif resource_type == "aws_ecs_service":
        extracted["desired_count"] = attrs.get("desired_count", 1)
        extracted["launch_type"] = attrs.get("launch_type", "EC2")
    
    # API Gateway
    elif resource_type == "aws_api_gateway_rest_api":
        extracted["endpoint_type"] = attrs.get("endpoint_configuration", {}).get("types", ["EDGE"])[0]
    
    # KMS Key
    elif resource_type == "aws_kms_key":
        extracted["enabled"] = attrs.get("is_enabled", True)
        extracted["rotation_enabled"] = attrs.get("enable_key_rotation", False)
    
    # Secrets Manager
    elif resource_type == "aws_secretsmanager_secret":
        extracted["rotation_enabled"] = bool(attrs.get("rotation_lambda_arn"))
    
    # SNS Topic
    elif resource_type == "aws_sns_topic":
        extracted["encrypted"] = bool(attrs.get("kms_master_key_id"))
    
    # SQS Queue
    elif resource_type == "aws_sqs_queue":
        extracted["fifo"] = attrs.get("fifo_queue", False)
        extracted["visibility_timeout"] = attrs.get("visibility_timeout_seconds", 30)
        extracted["encrypted"] = bool(attrs.get("kms_master_key_id"))
    
    # ECR Repository
    elif resource_type == "aws_ecr_repository":
        extracted["scan_on_push"] = attrs.get("image_scanning_configuration", {}).get("scan_on_push", False)
        extracted["immutable"] = attrs.get("image_tag_mutability") == "IMMUTABLE"
    
    # EKS Cluster
    elif resource_type == "aws_eks_cluster":
        extracted["k8s_version"] = attrs.get("version", "")
        extracted["endpoint_private"] = attrs.get("vpc_config", {}).get("endpoint_private_access", False)
    
    # CloudFront Distribution
    elif resource_type == "aws_cloudfront_distribution":
        extracted["enabled"] = attrs.get("enabled", True)
        extracted["price_class"] = attrs.get("price_class", "PriceClass_All")
    
    # ACM Certificate
    elif resource_type == "aws_acm_certificate":
        extracted["domain"] = attrs.get("domain_name", "")
        extracted["validation_method"] = attrs.get("validation_method", "DNS")
    
    # Add tags if available
    if "tags" in attrs:
        extracted["tags"] = attrs["tags"]
    
    # ===== DIGITALOCEAN RESOURCE EXTRACTION =====
    
    # DigitalOcean Droplet
    if resource_type == "digitalocean_droplet":
        extracted["size"] = attrs.get("size", "")
        extracted["image"] = attrs.get("image", "")
        extracted["region"] = attrs.get("region", "")
        extracted["vpc"] = "yes" if attrs.get("vpc_uuid") else "no"
        extracted["backups"] = "enabled" if attrs.get("backups") else "disabled"
        extracted["monitoring"] = "enabled" if attrs.get("monitoring") else "disabled"
    
    # DigitalOcean Database Cluster
    elif resource_type == "digitalocean_database_cluster":
        extracted["engine"] = attrs.get("engine", "")
        extracted["version"] = attrs.get("version", "")
        extracted["size"] = attrs.get("size", "")
        extracted["region"] = attrs.get("region", "")
        extracted["node_count"] = attrs.get("node_count", 1)
        extracted["private_network"] = "yes" if attrs.get("private_network_uuid") else "no"
    
    # DigitalOcean Kubernetes Cluster
    elif resource_type == "digitalocean_kubernetes_cluster":
        extracted["version"] = attrs.get("version", "")
        extracted["region"] = attrs.get("region", "")
        extracted["auto_upgrade"] = "enabled" if attrs.get("auto_upgrade") else "disabled"
        extracted["surge_upgrade"] = "enabled" if attrs.get("surge_upgrade") else "disabled"
        node_pools = attrs.get("node_pool", [])
        if isinstance(node_pools, list):
            extracted["node_pool_count"] = len(node_pools)
        elif isinstance(node_pools, dict):
            extracted["node_pool_count"] = 1
    
    # DigitalOcean Spaces Bucket
    elif resource_type == "digitalocean_spaces_bucket":
        extracted["region"] = attrs.get("region", "")
        extracted["acl"] = attrs.get("acl", "private")
        extracted["public"] = "yes" if attrs.get("acl") in ["public-read", "public-read-write"] else "no"
        extracted["versioning"] = "enabled" if attrs.get("versioning", {}).get("enabled") else "disabled"
    
    # DigitalOcean Load Balancer
    elif resource_type == "digitalocean_loadbalancer":
        extracted["region"] = attrs.get("region", "")
        extracted["size"] = attrs.get("size", "small")
        forwarding_rules = attrs.get("forwarding_rule", [])
        extracted["forwarding_rules_count"] = len(forwarding_rules) if isinstance(forwarding_rules, list) else 1
        extracted["https"] = "enabled" if attrs.get("redirect_http_to_https") else "disabled"
    
    # DigitalOcean Firewall
    elif resource_type == "digitalocean_firewall":
        inbound = attrs.get("inbound_rule", [])
        outbound = attrs.get("outbound_rule", [])
        extracted["inbound_rules_count"] = len(inbound) if isinstance(inbound, list) else 1
        extracted["outbound_rules_count"] = len(outbound) if isinstance(outbound, list) else 1
    
    # DigitalOcean VPC
    elif resource_type == "digitalocean_vpc":
        extracted["ip_range"] = attrs.get("ip_range", "")
        extracted["region"] = attrs.get("region", "")
    
    # DigitalOcean Volume
    elif resource_type == "digitalocean_volume":
        extracted["region"] = attrs.get("region", "")
        extracted["size_gb"] = attrs.get("size", 0)
        extracted["filesystem_type"] = attrs.get("initial_filesystem_type", "ext4")
    
    # DigitalOcean Container Registry
    elif resource_type == "digitalocean_container_registry":
        extracted["subscription_tier"] = attrs.get("subscription_tier_slug", "starter")
        extracted["region"] = attrs.get("region", "")
    
    # DigitalOcean App
    elif resource_type == "digitalocean_app":
        spec = attrs.get("spec", {})
        extracted["region"] = spec.get("region", "")
        services = spec.get("service", [])
        extracted["service_count"] = len(services) if isinstance(services, list) else 1
    
    # DigitalOcean Domain
    elif resource_type == "digitalocean_domain":
        extracted["domain_name"] = attrs.get("name", "")
    
    # DigitalOcean DNS Record
    elif resource_type == "digitalocean_record":
        extracted["record_type"] = attrs.get("type", "")
        extracted["domain"] = attrs.get("domain", "")
        extracted["ttl"] = attrs.get("ttl", 1800)
    
    return extracted

@router.get("/aws-resources/{owner}/{repo}")
async def get_aws_resources_dashboard_by_repo(
    owner: str,
    repo: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Returns AWS resources grouped by type for dashboard display (indexed version)
    Queries the infrastructure index instead of global catalog
    """
    try:
        # Try index first, fallback to parsing (backward compatibility)
        from app.services.codebase_indexing_service import codebase_indexing_service
        
        index_status = codebase_indexing_service.get_index_status(user.id, owner, repo)
        resources = []
        
        if index_status.get("exists"):
            resources = infrastructure_query_service.get_all_resources(
                user_id=user.id,
                owner=owner,
                repo=repo,
                fallback_to_parse=False
            )
        
        # If no resources from index, parse (backward compatibility)
        if not resources:
            from app.api.v1.endpoints.github_parser import parse_github_repo, GitHubRepoRequest
            parse_req = GitHubRepoRequest(owner=owner, repo=repo, branch="main")
            parsed_data = await parse_github_repo(parse_req, user)
            
            resources = parsed_data.get("resources", [])
            
            # Store in index for future use (non-blocking)
            if resources:
                try:
                    from app.services.infrastructure_indexing_service import infrastructure_indexing_service
                    infrastructure_indexing_service.store_resources(
                        user_id=user.id,
                        owner=owner,
                        repo=repo,
                        resources=resources,
                        commit_sha=parsed_data.get("sha")
                    )
                except Exception as e:
                    print(f"⚠️ [Dashboard] Failed to store resources in index (non-fatal): {e}")
        
        if not resources:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "not_indexed",
                    "message": "No resources found. Repository may not contain Terraform files."
                }
            )
        
        # Group resources by type
        resources_by_type: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        
        for resource in resources:
            if not isinstance(resource, dict):
                continue
                
            resource_type = resource.get("type", "")
            
            # Include AWS and DigitalOcean resources
            if resource_type.startswith("aws_") or resource_type.startswith("digitalocean_"):
                extracted = extract_resource_attributes(resource)
                resources_by_type[resource_type].append(extracted)
        
        # Format for dashboard
        dashboard_data = []
        for resource_type, resources_list in resources_by_type.items():
            # Get display name and icon based on provider
            if resource_type.startswith("digitalocean_"):
                display_name = DIGITALOCEAN_RESOURCE_DISPLAY_NAMES.get(resource_type, resource_type.replace("_", " ").title())
                icon = DIGITALOCEAN_RESOURCE_ICONS.get(resource_type, "💧")
            else:
                display_name = AWS_RESOURCE_DISPLAY_NAMES.get(resource_type, resource_type.replace("_", " ").title())
                icon = AWS_RESOURCE_ICONS.get(resource_type, "📦")
            
            dashboard_data.append({
                "type": resource_type,
                "display_name": display_name,
                "icon": icon,
                "count": len(resources_list),
                "resources": sorted(resources_list, key=lambda x: x.get("name", "")),
            })
        
        # Sort by count (descending)
        dashboard_data.sort(key=lambda x: x["count"], reverse=True)
        
        return {
            "ok": True,
            "repo": f"{owner}/{repo}",
            "sha": None,  # TODO: Get from index metadata
            "total_resources": sum(item["count"] for item in dashboard_data),
            "resource_types": len(dashboard_data),
            "resources": dashboard_data,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to get dashboard data"))


@router.get("/aws-resources")
def get_aws_resources_dashboard():
    """
    Returns AWS resources grouped by type for dashboard display
    """
    # Check if catalog exists and has resources
    if not isinstance(INFRASTRUCTURE_CATALOG, dict):
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_indexed",
                "message": "Catalog not initialized. Select a repository first."
            }
        )
    
    resources = INFRASTRUCTURE_CATALOG.get("resources", [])
    if not resources or not isinstance(resources, list):
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_indexed",
                "message": "No resources found. Run /index-repo first or select a repository."
            }
        )
    
    # Group resources by type
    resources_by_type: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    
    for resource in resources:
        if not isinstance(resource, dict):
            continue
            
        resource_type = resource.get("type", "")
        
        # Include AWS and DigitalOcean resources
        if resource_type.startswith("aws_") or resource_type.startswith("digitalocean_"):
            extracted = extract_resource_attributes(resource)
            resources_by_type[resource_type].append(extracted)
    
    # Format for dashboard
    dashboard_data = []
    for resource_type, resources in resources_by_type.items():
        # Get display name and icon based on provider
        if resource_type.startswith("digitalocean_"):
            display_name = DIGITALOCEAN_RESOURCE_DISPLAY_NAMES.get(resource_type, resource_type.replace("_", " ").title())
            icon = DIGITALOCEAN_RESOURCE_ICONS.get(resource_type, "💧")
        else:
            display_name = AWS_RESOURCE_DISPLAY_NAMES.get(resource_type, resource_type.replace("_", " ").title())
            icon = AWS_RESOURCE_ICONS.get(resource_type, "📦")
        
        dashboard_data.append({
            "type": resource_type,
            "display_name": display_name,
            "icon": icon,
            "count": len(resources),
            "resources": sorted(resources, key=lambda x: x.get("name", "")),
        })
    
    # Sort by count (descending)
    dashboard_data.sort(key=lambda x: x["count"], reverse=True)
    
    return {
        "ok": True,
        "repo": INFRASTRUCTURE_CATALOG.get("dir", "."),
        "sha": INFRASTRUCTURE_CATALOG.get("sha"),
        "total_resources": sum(item["count"] for item in dashboard_data),
        "resource_types": len(dashboard_data),
        "resources": dashboard_data,
    }

@router.get("/aws-resources/{resource_type}")
def get_aws_resource_type_details(resource_type: str):
    """
    Get detailed information about a specific AWS resource type
    """
    if not isinstance(INFRASTRUCTURE_CATALOG, dict):
        raise HTTPException(status_code=404, detail={"error": "not_indexed", "message": "Catalog not initialized"})
    
    resources_list = INFRASTRUCTURE_CATALOG.get("resources", [])
    if not isinstance(resources_list, list):
        raise HTTPException(status_code=404, detail={"error": "not_indexed", "message": "Invalid catalog format"})
    
    resources = []
    for resource in resources_list:
        if not isinstance(resource, dict):
            continue
        if resource.get("type") == resource_type:
            extracted = extract_resource_attributes(resource)
            resources.append(extracted)
    
    if not resources:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": f"No resources of type {resource_type} found"}
        )
    
    return {
        "ok": True,
        "type": resource_type,
        "display_name": AWS_RESOURCE_DISPLAY_NAMES.get(resource_type, resource_type),
        "icon": AWS_RESOURCE_ICONS.get(resource_type, "📦"),
        "count": len(resources),
        "resources": resources,
    }

