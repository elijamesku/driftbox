"""
AWS Import Service - Convert existing AWS infrastructure to Terraform
without requiring AWS credentials on our side.

Supports multiple input formats:
1. AWS Config snapshots (JSON)
2. CloudFormation exports (JSON/YAML)
3. AWS CLI describe outputs (JSON)
4. Manual resource descriptions (natural language)
5. Terraform state files (JSON)
6. AWS Resource Groups inventory (JSON)
"""

import json
import csv
from typing import Dict, Any, List, Optional
from pathlib import Path
import re
import io

try:
    import yaml
    YAML_AVAILABLE = True
except ImportError:
    YAML_AVAILABLE = False


class AWSImportService:
    """Service to convert AWS infrastructure exports to Terraform code."""
    
    def __init__(self):
        self.resource_mappings = {
            # AWS Config resource types to Terraform resource types
            'AWS::S3::Bucket': 'aws_s3_bucket',
            'AWS::EC2::Instance': 'aws_instance',
            'AWS::EC2::VPC': 'aws_vpc',
            'AWS::EC2::Subnet': 'aws_subnet',
            'AWS::EC2::SecurityGroup': 'aws_security_group',
            'AWS::EC2::InternetGateway': 'aws_internet_gateway',
            'AWS::RDS::DBInstance': 'aws_db_instance',
            'AWS::Lambda::Function': 'aws_lambda_function',
            'AWS::IAM::Role': 'aws_iam_role',
            'AWS::IAM::Policy': 'aws_iam_policy',
            'AWS::DynamoDB::Table': 'aws_dynamodb_table',
            'AWS::ElasticLoadBalancingV2::LoadBalancer': 'aws_lb',
            'AWS::ECS::Cluster': 'aws_ecs_cluster',
            'AWS::EKS::Cluster': 'aws_eks_cluster',
        }
    
    def import_from_aws_config(self, config_snapshot: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert AWS Config snapshot to Terraform IR format.
        
        AWS Config snapshot format:
        {
            "configurationItems": [
                {
                    "resourceType": "AWS::S3::Bucket",
                    "resourceId": "my-bucket",
                    "configuration": {...},
                    "tags": {...}
                }
            ]
        }
        """
        resources = []
        config_items = config_snapshot.get('configurationItems', [])
        
        for item in config_items:
            resource_type = item.get('resourceType', '')
            terraform_type = self.resource_mappings.get(resource_type)
            
            if not terraform_type:
                continue  # Skip unsupported resource types
            
            resource_id = item.get('resourceId', '')
            configuration = item.get('configuration', {})
            tags = item.get('tags', {})
            
            # Convert AWS Config format to Terraform attributes
            terraform_attrs = self._convert_config_to_terraform_attrs(
                terraform_type, configuration, tags
            )
            
            resources.append({
                'resource_type': terraform_type,
                'name': self._sanitize_name(resource_id),
                'attrs': terraform_attrs,
                'file': 'imported.tf',
                'line': len(resources) + 1
            })
        
        return {
            'resources': resources,
            'summary': f'Imported {len(resources)} resources from AWS Config snapshot'
        }
    
    def import_from_cloudformation(self, cf_template: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert CloudFormation template to Terraform IR format.
        
        CloudFormation template format:
        {
            "Resources": {
                "MyBucket": {
                    "Type": "AWS::S3::Bucket",
                    "Properties": {...}
                }
            }
        }
        """
        resources = []
        cf_resources = cf_template.get('Resources', {})
        
        for logical_id, resource_def in cf_resources.items():
            cf_type = resource_def.get('Type', '')
            terraform_type = self.resource_mappings.get(cf_type)
            
            if not terraform_type:
                continue
            
            properties = resource_def.get('Properties', {})
            
            # Convert CloudFormation properties to Terraform attributes
            terraform_attrs = self._convert_cf_to_terraform_attrs(
                terraform_type, properties
            )
            
            resources.append({
                'resource_type': terraform_type,
                'name': self._sanitize_name(logical_id),
                'attrs': terraform_attrs,
                'file': 'imported.tf',
                'line': len(resources) + 1
            })
        
        return {
            'resources': resources,
            'summary': f'Imported {len(resources)} resources from CloudFormation template'
        }
    
    def import_from_aws_cli_output(self, cli_output: List[Dict[str, Any]], 
                                   resource_type: str) -> Dict[str, Any]:
        """
        Convert AWS CLI describe output to Terraform IR format.
        
        Example:
        - aws ec2 describe-instances
        - aws s3api list-buckets
        - aws rds describe-db-instances
        """
        resources = []
        
        # Map AWS CLI resource types to Terraform types
        cli_to_terraform = {
            'ec2-instances': 'aws_instance',
            's3-buckets': 'aws_s3_bucket',
            'rds-instances': 'aws_db_instance',
            'lambda-functions': 'aws_lambda_function',
            'vpc': 'aws_vpc',
            'subnets': 'aws_subnet',
            'security-groups': 'aws_security_group',
        }
        
        terraform_type = cli_to_terraform.get(resource_type)
        if not terraform_type:
            terraform_type = f'aws_{resource_type.replace("-", "_")}'
        
        for item in cli_output:
            terraform_attrs = self._convert_cli_to_terraform_attrs(
                terraform_type, item
            )
            
            # Extract resource name/ID
            resource_name = self._extract_resource_name(terraform_type, item)
            
            resources.append({
                'resource_type': terraform_type,
                'name': self._sanitize_name(resource_name),
                'attrs': terraform_attrs,
                'file': 'imported.tf',
                'line': len(resources) + 1
            })
        
        return {
            'resources': resources,
            'summary': f'Imported {len(resources)} {resource_type} from AWS CLI output'
        }
    
    def import_from_natural_language(self, description: str) -> Dict[str, Any]:
        """
        Use AI to convert natural language description of AWS resources to Terraform.
        
        Example input:
        "I have an S3 bucket named 'my-app-logs' with versioning enabled,
         a VPC with CIDR 10.0.0.0/16, and an EC2 instance t3.micro in us-east-1a"
        
        This will be processed by the existing NLP processor.
        """
        # This will be handled by the existing enhanced_nlp_processor
        # Just return a marker that this needs AI processing
        return {
            'resources': [],
            'summary': 'Natural language description - requires AI processing',
            'needs_ai_processing': True,
            'description': description
        }
    
    def import_from_terraform_state(self, state_file: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract resources from Terraform state file.
        
        Terraform state format:
        {
            "resources": [
                {
                    "type": "aws_s3_bucket",
                    "name": "my_bucket",
                    "instances": [{"attributes": {...}}]
                }
            ]
        }
        """
        resources = []
        state_resources = state_file.get('resources', [])
        
        for resource in state_resources:
            resource_type = resource.get('type', '')
            resource_name = resource.get('name', '')
            instances = resource.get('instances', [])
            
            for instance in instances:
                attrs = instance.get('attributes', {})
                
                # Clean up state attributes (remove computed/internal fields)
                terraform_attrs = self._clean_state_attributes(attrs)
                
                resources.append({
                    'resource_type': resource_type,
                    'name': self._sanitize_name(resource_name),
                    'attrs': terraform_attrs,
                    'file': 'imported.tf',
                    'line': len(resources) + 1
                })
        
        return {
            'resources': resources,
            'summary': f'Imported {len(resources)} resources from Terraform state'
        }
    
    def _convert_config_to_terraform_attrs(self, terraform_type: str, 
                                          config: Dict[str, Any], 
                                          tags: Dict[str, str]) -> Dict[str, Any]:
        """Convert AWS Config configuration to Terraform attributes."""
        attrs = {}
        
        if terraform_type == 'aws_s3_bucket':
            attrs['bucket'] = config.get('name', config.get('bucketName', ''))
            if tags:
                attrs['tags'] = tags
        
        elif terraform_type == 'aws_vpc':
            attrs['cidr_block'] = config.get('cidrBlock', '')
            if tags:
                attrs['tags'] = tags
        
        elif terraform_type == 'aws_instance':
            attrs['instance_type'] = config.get('instanceType', '')
            attrs['ami'] = config.get('imageId', '')
            if config.get('subnetId'):
                attrs['subnet_id'] = config.get('subnetId')
            if tags:
                attrs['tags'] = tags
        
        # Add more mappings as needed
        
        return attrs
    
    def _convert_cf_to_terraform_attrs(self, terraform_type: str, 
                                       properties: Dict[str, Any]) -> Dict[str, Any]:
        """Convert CloudFormation properties to Terraform attributes."""
        attrs = {}
        
        # CloudFormation to Terraform attribute mappings
        cf_to_tf_mappings = {
            'aws_s3_bucket': {
                'BucketName': 'bucket',
                'Tags': 'tags',
            },
            'aws_vpc': {
                'CidrBlock': 'cidr_block',
                'Tags': 'tags',
            },
            'aws_instance': {
                'InstanceType': 'instance_type',
                'ImageId': 'ami',
                'SubnetId': 'subnet_id',
                'Tags': 'tags',
            },
        }
        
        mapping = cf_to_tf_mappings.get(terraform_type, {})
        
        for cf_key, tf_key in mapping.items():
            if cf_key in properties:
                attrs[tf_key] = properties[cf_key]
        
        return attrs
    
    def _convert_cli_to_terraform_attrs(self, terraform_type: str, 
                                        cli_item: Dict[str, Any]) -> Dict[str, Any]:
        """Convert AWS CLI output to Terraform attributes."""
        attrs = {}
        
        # Common mappings
        if 'Tags' in cli_item:
            attrs['tags'] = {tag['Key']: tag['Value'] for tag in cli_item['Tags']}
        
        # Type-specific conversions
        if terraform_type == 'aws_instance':
            attrs['instance_type'] = cli_item.get('InstanceType', '')
            attrs['ami'] = cli_item.get('ImageId', '')
            if 'SubnetId' in cli_item:
                attrs['subnet_id'] = cli_item['SubnetId']
        
        elif terraform_type == 'aws_s3_bucket':
            attrs['bucket'] = cli_item.get('Name', '')
        
        elif terraform_type == 'aws_vpc':
            attrs['cidr_block'] = cli_item.get('CidrBlock', '')
        
        return attrs
    
    def _clean_state_attributes(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """Remove computed/internal Terraform state attributes."""
        # Remove computed fields that shouldn't be in Terraform code
        computed_fields = {
            'arn', 'id', 'owner_id', 'region', 'request_id',
            'tags_all', 'timeouts', '%', '*'
        }
        
        cleaned = {}
        for key, value in attrs.items():
            # Skip computed fields and internal fields
            if key in computed_fields or key.startswith('%') or key.startswith('*'):
                continue
            cleaned[key] = value
        
        return cleaned
    
    def _extract_resource_name(self, terraform_type: str, item: Dict[str, Any]) -> str:
        """Extract a resource name/ID from AWS CLI output."""
        # Try common name fields
        for field in ['Name', 'BucketName', 'DBInstanceIdentifier', 
                     'FunctionName', 'ClusterName', 'VpcId', 'InstanceId']:
            if field in item:
                return str(item[field])
        
        # Fallback to ID fields
        for field in ['Id', 'ResourceId', 'Arn']:
            if field in item:
                return str(item[field]).split('/')[-1]  # Get last part of ARN
        
        return 'imported_resource'
    
    def _sanitize_name(self, name: str) -> str:
        """Convert resource name to valid Terraform resource name."""
        # Replace invalid characters with underscores
        sanitized = re.sub(r'[^a-zA-Z0-9_]', '_', name)
        # Ensure it starts with a letter
        if sanitized and sanitized[0].isdigit():
            sanitized = f'resource_{sanitized}'
        return sanitized or 'imported_resource'
    
    def import_from_csv(self, csv_content: str, csv_type: Optional[str] = None) -> Dict[str, Any]:
        """
        Convert AWS export CSV to Terraform IR format.
        
        Supports two CSV formats:
        
        1. AWS Migration Hub CSV formats:
          - Server.csv - EC2 instances (columns: InstanceId, HostName, InstanceType, etc.)
          - Application.csv - Applications
          - NetworkInterface.csv - Network interfaces
        
        2. Generic AWS resource CSV format:
          - Columns: accountId, accountName, region, resourceType, resourceId, resourceName, 
            service, environment, owner, tags, createdDate, status, details
          - Supports: S3Bucket, EC2Instance, RDSInstance, LambdaFunction, IAMRole, VPC, 
            LoadBalancer, EKSCluster, DynamoDBTable, CloudWatchLogGroup
        """
        resources = []
        
        # Parse CSV
        reader = csv.DictReader(io.StringIO(csv_content))
        rows = list(reader)
        
        if not rows:
            return {'resources': [], 'summary': 'Empty CSV file'}
        
        # Auto-detect CSV type from filename or headers
        if not csv_type:
            headers = reader.fieldnames or []
            # Check for generic AWS resource CSV format
            if 'resourceType' in headers and 'resourceId' in headers:
                csv_type = 'generic_aws'
            elif 'InstanceId' in headers or 'HostName' in headers:
                csv_type = 'server'
            elif 'ApplicationId' in headers:
                csv_type = 'application'
            elif 'NetworkInterfaceId' in headers or 'IPAddress' in headers:
                csv_type = 'network_interface'
            else:
                csv_type = 'server'  # Default
        
        # Map AWS resource types to Terraform resource types
        RESOURCE_TYPE_MAP = {
            'S3Bucket': 'aws_s3_bucket',
            'EC2Instance': 'aws_instance',
            'RDSInstance': 'aws_db_instance',
            'LambdaFunction': 'aws_lambda_function',
            'IAMRole': 'aws_iam_role',
            'VPC': 'aws_vpc',
            'LoadBalancer': 'aws_lb',
            'ELBv2': 'aws_lb',  # ALB/NLB
            'EKSCluster': 'aws_eks_cluster',
            'DynamoDBTable': 'aws_dynamodb_table',
            'CloudWatchLogGroup': 'aws_cloudwatch_log_group',
        }
        
        if csv_type == 'generic_aws':
            # Handle generic AWS resource CSV format
            for row in rows:
                resource_type_aws = row.get('resourceType', '').strip()
                resource_id = row.get('resourceId', '').strip()
                resource_name = row.get('resourceName', '').strip() or resource_id
                details = row.get('details', '').strip()
                tags_str = row.get('tags', '').strip()
                region = row.get('region', '').strip()
                
                # Map to Terraform resource type
                terraform_type = RESOURCE_TYPE_MAP.get(resource_type_aws)
                if not terraform_type:
                    # Skip unsupported resource types
                    continue
                
                # Parse tags (format: "Key1=Value1;Key2=Value2")
                tags = {}
                if tags_str:
                    for tag_pair in tags_str.split(';'):
                        if '=' in tag_pair:
                            key, value = tag_pair.split('=', 1)
                            tags[key.strip()] = value.strip()
                
                # Parse details (format: "Value1;Key2=Value2" or "Key1=Value1;Key2=Value2")
                terraform_attrs = {}
                if details:
                    for detail_pair in details.split(';'):
                        detail_pair = detail_pair.strip()
                        if not detail_pair:
                            continue
                        
                        if '=' in detail_pair:
                            key, value = detail_pair.split('=', 1)
                            key = key.strip()
                            value = value.strip()
                            
                            # Map detail keys to Terraform attributes
                            if terraform_type == 'aws_s3_bucket':
                                if key == 'Versioning':
                                    terraform_attrs['versioning'] = {'enabled': value.lower() == 'enabled'}
                                elif key == 'Encryption':
                                    if value.startswith('SSE-KMS'):
                                        terraform_attrs['server_side_encryption_configuration'] = {
                                            'rule': {
                                                'apply_server_side_encryption_by_default': {
                                                    'sse_algorithm': 'aws:kms'
                                                }
                                            }
                                        }
                                    elif value.startswith('SSE-S3'):
                                        terraform_attrs['server_side_encryption_configuration'] = {
                                            'rule': {
                                                'apply_server_side_encryption_by_default': {
                                                    'sse_algorithm': 'AES256'
                                                }
                                            }
                                        }
                            
                            elif terraform_type == 'aws_instance':
                                if key == 'InstanceType':
                                    terraform_attrs['instance_type'] = value
                                elif key == 'AMI':
                                    terraform_attrs['ami'] = value
                                elif key == 'AZ':
                                    # Availability zone - will be handled by subnet
                                    pass
                        else:
                            # Standalone value (no '=') - interpret based on resource type
                            if terraform_type == 'aws_instance':
                                # Could be instance type (e.g., "t3.large", "m5.large")
                                if detail_pair.startswith('t3.') or detail_pair.startswith('m5.') or detail_pair.startswith('t2.') or detail_pair.startswith('t3') or detail_pair.startswith('m5') or detail_pair.startswith('t2'):
                                    terraform_attrs['instance_type'] = detail_pair
                            elif terraform_type == 'aws_db_instance':
                                # Could be instance class (e.g., "db.m5.large")
                                if detail_pair.startswith('db.'):
                                    terraform_attrs['instance_class'] = detail_pair
                            
                            elif terraform_type == 'aws_db_instance':
                                if key == 'InstanceClass':
                                    terraform_attrs['instance_class'] = value
                                elif key == 'Engine':
                                    terraform_attrs['engine'] = value.lower()
                                elif key == 'MultiAZ':
                                    terraform_attrs['multi_az'] = value.lower() == 'true'
                                elif key == 'Storage':
                                    # Extract size (e.g., "500GB" -> 500)
                                    import re
                                    match = re.search(r'(\d+)', value)
                                    if match:
                                        terraform_attrs['allocated_storage'] = int(match.group(1))
                            
                            elif terraform_type == 'aws_lambda_function':
                                if key == 'Runtime':
                                    terraform_attrs['runtime'] = value
                                elif key == 'Timeout':
                                    # Extract seconds (e.g., "30s" -> 30)
                                    import re
                                    match = re.search(r'(\d+)', value)
                                    if match:
                                        terraform_attrs['timeout'] = int(match.group(1))
                                elif key == 'Memory':
                                    # Extract MB (e.g., "512MB" -> 512)
                                    import re
                                    match = re.search(r'(\d+)', value)
                                    if match:
                                        terraform_attrs['memory_size'] = int(match.group(1))
                            
                            elif terraform_type == 'aws_vpc':
                                if key == 'CIDR':
                                    terraform_attrs['cidr_block'] = value
                            
                            elif terraform_type == 'aws_lb':
                                if key == 'Type':
                                    terraform_attrs['load_balancer_type'] = value.lower()
                
                # Set required attributes based on resource type
                if terraform_type == 'aws_s3_bucket':
                    terraform_attrs['bucket'] = resource_name
                elif terraform_type == 'aws_instance':
                    if 'instance_type' not in terraform_attrs:
                        terraform_attrs['instance_type'] = 't3.micro'  # Default
                elif terraform_type == 'aws_db_instance':
                    terraform_attrs['identifier'] = resource_name
                    if 'engine' not in terraform_attrs:
                        terraform_attrs['engine'] = 'postgres'  # Default
                elif terraform_type == 'aws_lambda_function':
                    terraform_attrs['function_name'] = resource_name
                    if 'runtime' not in terraform_attrs:
                        terraform_attrs['runtime'] = 'python3.11'
                elif terraform_type == 'aws_iam_role':
                    terraform_attrs['name'] = resource_name
                elif terraform_type == 'aws_vpc':
                    if 'cidr_block' not in terraform_attrs:
                        terraform_attrs['cidr_block'] = '10.0.0.0/16'  # Default
                elif terraform_type == 'aws_lb':
                    terraform_attrs['name'] = resource_name
                elif terraform_type == 'aws_eks_cluster':
                    terraform_attrs['name'] = resource_name
                elif terraform_type == 'aws_dynamodb_table':
                    terraform_attrs['name'] = resource_name
                elif terraform_type == 'aws_cloudwatch_log_group':
                    terraform_attrs['name'] = resource_name
                
                # Add tags
                if tags:
                    terraform_attrs['tags'] = tags
                elif resource_name:
                    terraform_attrs['tags'] = {'Name': resource_name}
                
                # Sanitize resource name for Terraform
                terraform_name = self._sanitize_name(resource_name or resource_id or f'{resource_type_aws.lower()}_{len(resources)}')
                
                resources.append({
                    'resource_type': terraform_type,
                    'name': terraform_name,
                    'attrs': terraform_attrs,
                    'file': 'imported.tf',
                    'line': len(resources) + 1
                })
        
        elif csv_type == 'server':
            # Convert Server.csv to aws_instance resources
            for row in rows:
                instance_id = row.get('InstanceId') or row.get('ServerId', '')
                hostname = row.get('HostName') or row.get('Name', '')
                
                # Extract instance type from SystemPerformance or default
                instance_type = row.get('InstanceType') or row.get('InstanceSize', 't3.micro')
                
                # Extract AMI if available
                ami = row.get('ImageId') or row.get('AMI', '')
                
                # Extract VPC/Subnet if available
                vpc_id = row.get('VpcId') or row.get('VPC', '')
                subnet_id = row.get('SubnetId') or row.get('Subnet', '')
                
                terraform_attrs = {
                    'instance_type': instance_type,
                }
                
                if ami:
                    terraform_attrs['ami'] = ami
                if subnet_id:
                    terraform_attrs['subnet_id'] = subnet_id
                
                # Add tags if available
                tags = {}
                if hostname:
                    tags['Name'] = hostname
                if row.get('Environment'):
                    tags['Environment'] = row['Environment']
                if tags:
                    terraform_attrs['tags'] = tags
                
                resource_name = self._sanitize_name(hostname or instance_id or f'server_{len(resources)}')
                
                resources.append({
                    'resource_type': 'aws_instance',
                    'name': resource_name,
                    'attrs': terraform_attrs,
                    'file': 'imported.tf',
                    'line': len(resources) + 1
                })
        
        elif csv_type == 'network_interface':
            # Network interfaces are usually part of EC2 instances
            # We'll create data sources or note them
            for row in rows:
                interface_id = row.get('NetworkInterfaceId') or row.get('InterfaceId', '')
                ip_address = row.get('IPAddress') or row.get('PrivateIpAddress', '')
                
                # Network interfaces are typically managed by EC2 instances
                # We'll create a data source reference
                if interface_id:
                    resources.append({
                        'resource_type': 'data',
                        'data_type': 'aws_network_interface',
                        'name': self._sanitize_name(interface_id),
                        'attrs': {'id': interface_id},
                        'file': 'imported.tf',
                        'line': len(resources) + 1
                    })
        
        # Handle Tags.csv - merge tags into existing resources
        elif csv_type == 'tags':
            # Tags are typically merged with server resources
            # This would be handled in a post-processing step
            pass
        
        return {
            'resources': resources,
            'summary': f'Imported {len(resources)} resources from CSV ({csv_type})'
        }
    
    def parse_import_file(self, file_path: Path, file_type: Optional[str] = None) -> Dict[str, Any]:
        """
        Auto-detect and parse an import file.
        
        Supports:
        - AWS Config snapshots (.json)
        - CloudFormation templates (.json, .yaml, .yml)
        - Terraform state files (.json)
        - AWS CLI output (.json)
        - CSV files (.csv) - AWS Migration Hub exports OR generic AWS resource CSV format
        """
        content = file_path.read_text()
        
        # Auto-detect file type
        if not file_type:
            if file_path.suffix == '.csv':
                file_type = 'csv'
            elif file_path.suffix in ['.yaml', '.yml']:
                file_type = 'cloudformation'
            elif 'configurationItems' in content:
                file_type = 'aws_config'
            elif 'Resources' in content and 'AWSTemplateFormatVersion' in content:
                file_type = 'cloudformation'
            elif '"resources"' in content and '"type"' in content:
                file_type = 'terraform_state'
            else:
                file_type = 'aws_cli'  # Default assumption
        
        # Handle CSV files
        if file_type == 'csv':
            # Try to detect CSV type from filename
            csv_type = None
            filename_lower = file_path.name.lower()
            if 'server' in filename_lower:
                csv_type = 'server'
            elif 'application' in filename_lower:
                csv_type = 'application'
            elif 'network' in filename_lower or 'interface' in filename_lower:
                csv_type = 'network_interface'
            
            return self.import_from_csv(content, csv_type)
        
        # Parse based on type
        if file_type == 'cloudformation':
            if file_path.suffix in ['.yaml', '.yml']:
                if not YAML_AVAILABLE:
                    raise ImportError("PyYAML is required for YAML files. Install with: pip install pyyaml")
                data = yaml.safe_load(content)
            else:
                data = json.loads(content)
            return self.import_from_cloudformation(data)
        
        elif file_type == 'aws_config':
            data = json.loads(content)
            return self.import_from_aws_config(data)
        
        elif file_type == 'terraform_state':
            data = json.loads(content)
            return self.import_from_terraform_state(data)
        
        else:  # aws_cli or unknown
            data = json.loads(content)
            # Try to detect resource type from structure
            if isinstance(data, list):
                return self.import_from_aws_cli_output(data, 'unknown')
            elif 'Reservations' in data:  # EC2 describe-instances
                instances = []
                for reservation in data.get('Reservations', []):
                    instances.extend(reservation.get('Instances', []))
                return self.import_from_aws_cli_output(instances, 'ec2-instances')
            elif 'Buckets' in data:  # S3 list-buckets
                return self.import_from_aws_cli_output(data.get('Buckets', []), 's3-buckets')
            else:
                return {'resources': [], 'summary': 'Unknown file format'}


# Global instance
aws_import_service = AWSImportService()

