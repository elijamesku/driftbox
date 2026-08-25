"""
CDKTF-based Terraform HCL Generator
Uses HashiCorp's official Terraform CDK for Python to generate perfect, validated HCL.
"""
import os
import tempfile
import shutil
from typing import Dict, Any, List
from pathlib import Path

from cdktf import App, TerraformStack, TerraformOutput
from cdktf_cdktf_provider_aws.provider import AwsProvider
from cdktf_cdktf_provider_random.provider import RandomProvider


class InfrastructureStack(TerraformStack):
    """Dynamic Terraform stack that builds resources from IR operations."""
    
    def __init__(self, scope, id: str, resources: List[Dict[str, Any]], region: str = "us-east-1"):
        super().__init__(scope, id)
        
        # Add AWS provider
        AwsProvider(self, "aws", region=region)
        
        # Add Random provider (for random_id, random_string, etc.)
        RandomProvider(self, "random")
        
        # Map to store created resources for cross-references
        self.resource_map = {}
        
        # Create all resources
        for resource_spec in resources:
            self._create_resource(resource_spec)
    
    def _create_resource(self, spec: Dict[str, Any]):
        """
        Create a CDKTF resource from a spec.
        
        spec format:
        {
            "type": "aws_s3_bucket",
            "name": "my_bucket",
            "args": {"bucket": "my-bucket-name", "tags": {"Name": "..."}}
        }
        """
        resource_type = spec.get("type", "")
        resource_name = spec.get("name", "")
        args = spec.get("args", {})
        
        if not resource_type or not resource_name:
            return
        
        # Import the resource class dynamically
        try:
            resource_class = self._get_resource_class(resource_type)
            print(f"DEBUG: Got resource_class for {resource_type}: {resource_class}")
            
            if not resource_class:
                print(f"WARNING: No resource class found for {resource_type} - skipping")
                return
            
            if resource_class:
                # Process args to handle references
                processed_args = self._process_args(args)
                print(f"DEBUG: Processed args for {resource_type}.{resource_name}: {list(processed_args.keys())}")
                
                # Create the resource
                resource = resource_class(
                    self,
                    resource_name,
                    **processed_args
                )
                
                print(f"DEBUG: Successfully created {resource_type}.{resource_name}")
                
                # Store in map for cross-references
                self.resource_map[f"{resource_type}.{resource_name}"] = resource
            else:
                print(f"WARNING: No resource class found for {resource_type}")
        except Exception as e:
            print(f"Warning: Could not create {resource_type}.{resource_name}: {e}")
            import traceback
            traceback.print_exc()
    
    def _get_resource_class(self, resource_type: str):
        """Map Terraform resource type to CDKTF class."""
        # Import mapping for AWS resources
        from cdktf_cdktf_provider_aws import (
            s3_bucket, vpc, subnet, internet_gateway, security_group,
            lb, lb_target_group, lb_listener,
            ecs_cluster, ecs_task_definition, ecs_service,
            rds_cluster, rds_cluster_instance, db_subnet_group,
            elasticache_subnet_group, elasticache_replication_group,
            iam_role, iam_role_policy, iam_role_policy_attachment,
            cloudwatch_metric_alarm, launch_template, autoscaling_group,
            route_table, route_table_association, nat_gateway, eip,
        )
        
        # Import mapping for Random provider resources
        from cdktf_cdktf_provider_random.id import Id as RandomId
        from cdktf_cdktf_provider_random.string import String as RandomString
        from cdktf_cdktf_provider_random.password import Password as RandomPassword
        from cdktf_cdktf_provider_random.integer import Integer as RandomInteger
        from cdktf_cdktf_provider_random.uuid import Uuid as RandomUuid
        from cdktf_cdktf_provider_random.shuffle import Shuffle as RandomShuffle
        from cdktf_cdktf_provider_random.pet import Pet as RandomPet
        
        # Mapping dictionary
        TYPE_MAP = {
            "aws_s3_bucket": s3_bucket.S3Bucket,
            "aws_s3_bucket_versioning": s3_bucket.S3BucketVersioning,
            "aws_vpc": vpc.Vpc,
            "aws_subnet": subnet.Subnet,
            "aws_internet_gateway": internet_gateway.InternetGateway,
            "aws_security_group": security_group.SecurityGroup,
            "aws_lb": lb.Lb,
            "aws_lb_target_group": lb_target_group.LbTargetGroup,
            "aws_lb_listener": lb_listener.LbListener,
            "aws_ecs_cluster": ecs_cluster.EcsCluster,
            "aws_ecs_task_definition": ecs_task_definition.EcsTaskDefinition,
            "aws_ecs_service": ecs_service.EcsService,
            "aws_rds_cluster": rds_cluster.RdsCluster,
            "aws_rds_cluster_instance": rds_cluster_instance.RdsClusterInstance,
            "aws_db_subnet_group": db_subnet_group.DbSubnetGroup,
            "aws_elasticache_subnet_group": elasticache_subnet_group.ElasticacheSubnetGroup,
            "aws_elasticache_replication_group": elasticache_replication_group.ElasticacheReplicationGroup,
            "aws_iam_role": iam_role.IamRole,
            "aws_iam_role_policy": iam_role_policy.IamRolePolicy,
            "aws_iam_role_policy_attachment": iam_role_policy_attachment.IamRolePolicyAttachment,
            "aws_cloudwatch_metric_alarm": cloudwatch_metric_alarm.CloudwatchMetricAlarm,
            "aws_launch_template": launch_template.LaunchTemplate,
            "aws_autoscaling_group": autoscaling_group.AutoscalingGroup,
            "aws_route_table": route_table.RouteTable,
            "aws_route_table_association": route_table_association.RouteTableAssociation,
            "aws_nat_gateway": nat_gateway.NatGateway,
            "aws_eip": eip.Eip,
            # Random provider resources
            "random_id": RandomId,
            "random_string": RandomString,
            "random_password": RandomPassword,
            "random_integer": RandomInteger,
            "random_uuid": RandomUuid,
            "random_shuffle": RandomShuffle,
            "random_pet": RandomPet,
        }
        
        return TYPE_MAP.get(resource_type)
    
    def _process_args(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process arguments to handle Terraform references.
        Convert string references like "aws_vpc.main.id" to actual CDKTF references.
        """
        import json
        
        processed = {}
        
        for key, value in args.items():
            if isinstance(value, str):
                # Check if it's a jsonencode() string from our normalizer
                # Pattern: jsonencode({...}) or jsonencode([...])
                if value.strip().startswith("jsonencode(") and value.strip().endswith(")"):
                    # Extract the JSON inside jsonencode(...)
                    json_str = value.strip()[11:-1]  # Remove "jsonencode(" and ")"
                    try:
                        # Parse back to Python object - CDKTF will handle encoding
                        processed[key] = json.loads(json_str)
                        continue
                    except:
                        pass  # If parse fails, treat as regular string
                
                # Check if it's a Terraform reference
                if self._is_terraform_reference(value):
                    # Convert to CDKTF reference
                    processed[key] = self._resolve_reference(value)
                else:
                    processed[key] = value
            elif isinstance(value, list):
                # Process list items
                processed[key] = [
                    self._resolve_reference(item) if isinstance(item, str) and self._is_terraform_reference(item)
                    else item
                    for item in value
                ]
            elif isinstance(value, dict):
                # Handle special jsonencode marker
                if value.get("__terraform_jsonencode__"):
                    # CDKTF handles JSON automatically, just pass the data
                    processed[key] = value.get("data")
                else:
                    # Recursively process nested dicts
                    processed[key] = self._process_args(value)
            else:
                processed[key] = value
        
        return processed
    
    def _is_terraform_reference(self, value: str) -> bool:
        """Check if a string is a Terraform resource reference."""
        # Pattern: aws_<resource_type>.<name>.<attribute>
        parts = value.split(".")
        return len(parts) >= 3 and parts[0].startswith("aws_")
    
    def _resolve_reference(self, ref: str):
        """
        Resolve a Terraform reference to a CDKTF object reference.
        Example: "aws_vpc.main.id" → self.resource_map["aws_vpc.main"].id
        """
        parts = ref.split(".")
        if len(parts) < 2:
            return ref
        
        # Extract resource type and name
        resource_key = f"{parts[0]}.{parts[1]}"
        attribute = ".".join(parts[2:]) if len(parts) > 2 else "id"
        
        # Look up in resource map
        resource = self.resource_map.get(resource_key)
        if resource:
            # Return the attribute reference
            return getattr(resource, attribute, ref)
        
        return ref


def _flatten_path_to_nested_dict(flat_args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert flat paths like {'tags.Name': 'value'} to nested dicts like {'tags': {'Name': 'value'}}.
    """
    nested = {}
    
    for path, value in flat_args.items():
        parts = path.split(".")
        current = nested
        
        # Navigate/create nested structure
        for i, part in enumerate(parts[:-1]):
            if part not in current:
                current[part] = {}
            current = current[part]
        
        # Set the final value
        current[parts[-1]] = value
    
    return nested


def generate_terraform_hcl_with_cdktf(intermediate_representation: Dict[str, Any], region: str = "us-east-1") -> Dict[str, str]:
    """
    Generate Terraform HCL files using CDKTF from an intermediate representation.
    
    Args:
        intermediate_representation: Dict with "ops" key containing operations
        region: AWS region for provider
    
    Returns:
        Dictionary mapping file names to HCL content
    """
    # Extract resources from IR operations
    ir_operations = intermediate_representation.get("ops", [])
    resources = []
    
    for operation in ir_operations:
        if operation["action"] == "delete":
            continue
        
        resource_type = operation["selector"]["type"]
        resource_name = operation["selector"]["name"]
        
        # Skip resource types that don't work well with CDKTF
        # (These should be handled differently or merged into parent resources)
        SKIP_RESOURCES = ["aws_s3_bucket_versioning"]
        if resource_type in SKIP_RESOURCES:
            print(f"INFO: Skipping {resource_type} - enable versioning directly on bucket instead")
            continue
        
        # Build args from changes (flat paths like "tags.Name")
        flat_args = {}
        for change in operation.get("changes", []):
            if change["op"] == "set":
                flat_args[change["path"]] = change.get("value")
        
        # Convert flat paths to nested dict structure for CDKTF
        args = _flatten_path_to_nested_dict(flat_args)
        
        resources.append({
            "type": resource_type,
            "name": resource_name,
            "args": args,
            "file_hint": operation.get("file_hint", "main.tf")
        })
    
    # Create temporary directory for CDKTF output
    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            print(f"CDKTF: Creating app with {len(resources)} resources")
            
            # Initialize CDKTF app
            app = App(outdir=tmpdir)
            
            # Create stack with resources
            InfrastructureStack(app, "infrara", resources=resources, region=region)
            
            print(f"CDKTF: Synthesizing to {tmpdir}")
            
            # Synthesize to generate HCL
            app.synth()
            
            print(f"CDKTF: Synth complete, reading files from {tmpdir}")
            
            # Read generated HCL files
            hcl_files = {}
            stack_dir = Path(tmpdir) / "stacks" / "infrara"
            
            print(f"CDKTF: Looking for .tf files in {stack_dir}")
            print(f"CDKTF: Stack dir exists: {stack_dir.exists()}")
            
            if stack_dir.exists():
                tf_files = list(stack_dir.glob("*.tf"))
                print(f"CDKTF: Found {len(tf_files)} .tf files: {[f.name for f in tf_files]}")
                
                for tf_file in tf_files:
                    # Skip provider config if we want to use our own
                    if tf_file.name == "cdk.tf":
                        continue
                    
                    content = tf_file.read_text()
                    
                    # Map to logical file names based on resource types
                    filename = _determine_filename(tf_file.name, content)
                    hcl_files[filename] = content
                    print(f"CDKTF: Mapped {tf_file.name} -> {filename} ({len(content)} bytes)")
            else:
                # List what's actually in tmpdir
                print(f"CDKTF: Stack dir doesn't exist! Listing tmpdir contents:")
                for item in Path(tmpdir).rglob("*"):
                    print(f"  - {item}")
            
            # If no files generated, return empty
            if not hcl_files:
                print("CDKTF: No HCL files generated!")
                hcl_files["main.tf"] = "# No resources generated"
            
            return hcl_files
            
        except Exception as e:
            print(f"CDKTF generation error: {e}")
            import traceback
            traceback.print_exc()
            return {"main.tf": f"# CDKTF Error: {str(e)}"}


def _determine_filename(original_name: str, content: str) -> str:
    """Determine logical filename based on content."""
    # Simple heuristic: look at resource types in content
    if "aws_vpc" in content or "aws_subnet" in content:
        return "vpc.tf"
    elif "aws_s3_bucket" in content:
        return "storage.tf"
    elif "aws_rds" in content or "aws_db" in content:
        return "database.tf"
    elif "aws_ecs" in content:
        return "ecs.tf"
    elif "aws_lb" in content or "aws_alb" in content:
        return "load_balancer.tf"
    elif "aws_elasticache" in content:
        return "cache.tf"
    elif "aws_iam" in content:
        return "iam.tf"
    elif "aws_cloudwatch" in content:
        return "monitoring.tf"
    elif "aws_autoscaling" in content or "aws_launch_template" in content:
        return "compute.tf"
    elif "aws_security_group" in content:
        return "security.tf"
    else:
        return original_name or "main.tf"

