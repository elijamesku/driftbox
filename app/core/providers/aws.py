from typing import Dict, List, Optional, Any
from app.core.providers.base import InfrastructureProvider


class AmazonWebServicesProvider(InfrastructureProvider):
    """Amazon Web Services cloud provider integration implementation"""
    
    # Monthly cost estimation data (USD) - simplified pricing model
    MONTHLY_PRICING_DATA = {
        "aws_s3_bucket": {
            "base": 0.023,  # Standard storage per GB/month
            "versioning": 0.023,  # Version storage per GB/month
            "encryption": 0.0,  # SSE-S3 encryption at no cost
        },
        "aws_dynamodb_table": {
            "base": 0.0,  # On-demand billing has no fixed cost
            "on_demand_write": 1.25,  # Cost per million write requests
            "on_demand_read": 0.25,   # Cost per million read requests
        },
        "aws_iam_user": {
            "base": 0.0,  # IAM service is free
        },
        "aws_ec2_instance": {
            "t2.micro": 8.50,     # Monthly cost for t2.micro
            "t2.small": 16.79,
            "t2.medium": 33.58,
            "t3.micro": 7.59,
            "t3.small": 15.18,
            "t3.medium": 30.37,
            "m5.large": 70.08,
            "m5.xlarge": 140.16,
        },
        "aws_rds_instance": {
            "db.t3.micro": 15.33,
            "db.t3.small": 30.66,
            "db.t3.medium": 61.32,
            "db.m5.large": 140.16,
        },
        "aws_vpc": {
            "base": 0.0,  # VPC creation is free
        },
        "aws_subnet": {
            "base": 0.0,  # Subnet creation is free
        },
        "aws_security_group": {
            "base": 0.0,  # Security group creation is free
        },
        "aws_lambda_function": {
            "base": 0.0,  # Free tier includes 1M requests
            "per_million_requests": 0.20,
            "per_gb_second": 0.0000166667,
        },
        "aws_cloudwatch_log_group": {
            "ingestion_per_gb": 0.50,
            "storage_per_gb": 0.03,
        },
    }
    
    AVAILABLE_RESOURCE_TYPES = [
        "aws_s3_bucket",
        "aws_iam_user",
        "aws_dynamodb_table",
        "aws_ec2_instance",
        "aws_rds_instance",
        "aws_vpc",
        "aws_subnet",
        "aws_security_group",
        "aws_lambda_function",
        "aws_cloudwatch_log_group",
        "aws_ebs_volume",
        "aws_elb",
        "aws_alb",
        "aws_route53_zone",
        "aws_route53_record",
    ]
    
    def retrieve_provider_identifier(self) -> str:
        return "aws"
    
    def verify_resource_configuration(self, resource_type: str, configuration: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """Verify AWS resource configuration meets requirements"""
        if resource_type not in self.AVAILABLE_RESOURCE_TYPES:
            return False, f"Unsupported resource type: {resource_type}"
        
        # Resource-specific configuration validation
        if resource_type == "aws_s3_bucket":
            if "bucket" not in configuration:
                return False, "S3 bucket must have 'bucket' attribute"
        
        elif resource_type == "aws_iam_user":
            if "name" not in configuration:
                return False, "IAM user must have 'name' attribute"
        
        elif resource_type == "aws_dynamodb_table":
            if "name" not in configuration and "table_name" not in configuration:
                return False, "DynamoDB table must have 'name' or 'table_name' attribute"
            if "hash_key" not in configuration:
                return False, "DynamoDB table must have 'hash_key' attribute"
        
        return True, None
    
    def list_supported_resource_types(self) -> List[str]:
        return self.AVAILABLE_RESOURCE_TYPES
    
    def calculate_monthly_cost(self, resource_type: str, configuration: Dict[str, Any]) -> Optional[float]:
        """
        Calculate estimated monthly cost for AWS resources.
        Returns cost in USD or None when estimation unavailable.
        """
        if resource_type not in self.MONTHLY_PRICING_DATA:
            return None
        
        pricing_info = self.MONTHLY_PRICING_DATA[resource_type]
        
        # S3 bucket cost estimation based on typical usage patterns
        if resource_type == "aws_s3_bucket":
            estimated_cost = pricing_info["base"] * 10  # Default 10GB storage assumption
            if configuration.get("versioning", {}).get("enabled"):
                estimated_cost += pricing_info["versioning"] * 5  # Additional 5GB for versions
            return estimated_cost
        
        # DynamoDB table cost estimation (usage-dependent)
        elif resource_type == "aws_dynamodb_table":
            # Base cost varies by billing mode
            billing_mode = configuration.get("billing_mode", "PAY_PER_REQUEST")
            if billing_mode == "PAY_PER_REQUEST":
                # Conservative estimate: 100k writes + 500k reads monthly
                return (pricing_info["on_demand_write"] * 0.1) + (pricing_info["on_demand_read"] * 0.5)
            return 5.0  # Provisioned capacity baseline estimate
        
        # IAM user (free service)
        elif resource_type == "aws_iam_user":
            return pricing_info["base"]
        
        # EC2 compute instance
        elif resource_type == "aws_ec2_instance":
            instance_type = configuration.get("instance_type", "t3.micro")
            return pricing_info.get(instance_type, 30.0)  # Fallback to $30 for unknown types
        
        # RDS database instance
        elif resource_type == "aws_rds_instance":
            instance_class = configuration.get("instance_class", "db.t3.micro")
            return pricing_info.get(instance_class, 50.0)  # Fallback to $50 for unknown classes
        
        # Zero-cost networking resources
        elif resource_type in ["aws_vpc", "aws_subnet", "aws_security_group", "aws_iam_user"]:
            return 0.0
        
        # Lambda function cost estimation
        elif resource_type == "aws_lambda_function":
            # Conservative estimate: 1M invocations/month, 128MB memory, 200ms average duration
            invocation_cost = pricing_info["per_million_requests"]
            # Compute GB-seconds: (128MB/1024GB) * 0.2s * 1M invocations = 25,000 GB-seconds
            compute_cost = pricing_info["per_gb_second"] * 25000
            return invocation_cost + compute_cost
        
        # CloudWatch logs cost estimation
        elif resource_type == "aws_cloudwatch_log_group":
            # Conservative estimate: 10GB ingestion + 10GB storage monthly
            return (pricing_info["ingestion_per_gb"] * 10) + (pricing_info["storage_per_gb"] * 10)
        
        return None
    
    def get_documentation_url(self, resource_type: str) -> Optional[str]:
        """Retrieve Terraform AWS provider documentation URL for resource type"""
        if not resource_type.startswith("aws_"):
            return None
        
        resource_identifier = resource_type.replace("aws_", "")
        return f"https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/{resource_identifier}"


# Singleton provider instance
aws_provider_instance = AmazonWebServicesProvider()

