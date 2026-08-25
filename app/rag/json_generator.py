"""
Terraform JSON Generator
Generates .tf.json files from intermediate representation.
Fast, accurate, and production-ready using official Terraform JSON format.
"""
import json
from typing import Dict, Any, List


def generate_terraform_json(intermediate_representation: Dict[str, Any], region: str = "us-east-1") -> Dict[str, str]:
    """
    Generate Terraform JSON files from intermediate representation.
    
    Args:
        intermediate_representation: Dict with "ops" key containing operations
        region: AWS region for provider
    
    Returns:
        Dictionary mapping filenames to JSON content
    """
    # Group resources by file hint
    files_resources = {}
    
    ir_operations = intermediate_representation.get("ops", [])
    
    for operation in ir_operations:
        if operation.get("action") == "delete":
            continue
        
        selector = operation.get("selector", {})
        resource_type = selector.get("type", "")
        resource_name = selector.get("name", "")
        file_hint = operation.get("file_hint", "main.tf.json")
        
        if not resource_type or not resource_name:
            continue
        
        # Build resource attributes from changes
        attributes = {}
        for change in operation.get("changes", []):
            if change.get("op") == "set":
                path = change.get("path", "")
                value = change.get("value")
                
                # Convert flat path to nested dict
                _set_nested_value(attributes, path, value)
        
        # CRITICAL: Convert block-type attributes from objects to arrays
        # In Terraform JSON, blocks MUST be arrays, even if single item
        attributes = _wrap_blocks_in_arrays(attributes, resource_type)
        
        # Add to file group
        if file_hint not in files_resources:
            files_resources[file_hint] = {}
        
        if resource_type not in files_resources[file_hint]:
            files_resources[file_hint][resource_type] = {}
        
        files_resources[file_hint][resource_type][resource_name] = attributes
    
    # Generate JSON files
    result = {}
    is_first_file = True
    
    for filename, resources_by_type in files_resources.items():
        # Ensure .tf.json extension
        if not filename.endswith(".tf.json"):
            filename = filename.replace(".tf", ".tf.json")
        
        # Only the FIRST file gets terraform/provider blocks
        # Other files just have resources
        if is_first_file:
            tf_json = {
                "terraform": {
                    "required_providers": {
                        "aws": {
                            "source": "hashicorp/aws",
                            "version": "~> 5.0"
                        }
                    }
                },
                "provider": {
                    "aws": {
                        "region": region
                    }
                },
                "resource": resources_by_type
            }
            is_first_file = False
        else:
            # Subsequent files: only resources
            tf_json = {
                "resource": resources_by_type
            }
        
        # Convert to pretty JSON
        result[filename] = json.dumps(tf_json, indent=2)
    
    # If no files generated, return empty
    if not result:
        result["main.tf.json"] = json.dumps({
            "terraform": {
                "required_providers": {
                    "aws": {
                        "source": "hashicorp/aws",
                        "version": "~> 5.0"
                    }
                }
            }
        }, indent=2)
    
    return result


def _wrap_blocks_in_arrays(attributes: Dict[str, Any], resource_type: str) -> Dict[str, Any]:
    """
    Wrap block-type attributes in arrays as required by Terraform JSON format.
    
    In Terraform JSON, blocks must be arrays even if single item:
    "versioning_configuration": [{"status": "Enabled"}]  ✓
    "versioning_configuration": {"status": "Enabled"}     ✗
    """
    # Map of resource types to their block-type attributes
    BLOCK_ATTRIBUTES = {
        "aws_s3_bucket_versioning": ["versioning_configuration"],
        "aws_s3_bucket": ["versioning", "server_side_encryption_configuration", "lifecycle_rule", "cors_rule", "website"],
        "aws_security_group": ["ingress", "egress"],
        "aws_lb_listener": ["default_action"],
        "aws_lb_target_group": ["health_check", "stickiness"],
        "aws_autoscaling_group": ["tag", "launch_template"],
        "aws_ecs_task_definition": ["volume", "placement_constraints"],
        "aws_ecs_service": ["load_balancer", "network_configuration", "placement_constraints", "service_registries"],
        "aws_rds_cluster": ["scaling_configuration"],
        "aws_db_instance": ["restore_to_point_in_time"],
    }
    
    block_attrs = BLOCK_ATTRIBUTES.get(resource_type, [])
    
    for attr_name in block_attrs:
        if attr_name in attributes:
            value = attributes[attr_name]
            # If it's a dict (not already an array), wrap it
            if isinstance(value, dict):
                attributes[attr_name] = [value]
    
    return attributes


def _set_nested_value(obj: Dict[str, Any], path: str, value: Any) -> None:
    """
    Set a value in a nested dictionary using dot notation path.
    Example: _set_nested_value(obj, "tags.Name", "value") → obj["tags"]["Name"] = "value"
    """
    parts = path.split(".")
    current = obj
    
    for part in parts[:-1]:
        if part not in current:
            current[part] = {}
        elif not isinstance(current[part], dict):
            # Can't nest further, skip
            return
        current = current[part]
    
    # Handle special cases for Terraform references
    # NOTE: Nested interpolations are now prevented by upstream normalization
    if isinstance(value, str):
        # Check if it's already a ${} expression
        if value.startswith("${") and value.endswith("}"):
            pass  # Keep as-is, already wrapped (validated upstream)
        # Check if it's a Terraform reference (e.g., aws_vpc.main.id)
        elif _is_terraform_reference(value):
            # In JSON format, references use ${} syntax
            value = f"${{{value}}}"
        # Check if it's a function call like jsonencode(...)
        elif "(" in value and value.strip().endswith(")"):
            # Keep function calls as-is
            pass
    
    current[parts[-1]] = value


def _is_terraform_reference(value: str) -> bool:
    """
    Check if a string looks like a Terraform reference.
    Example: aws_vpc.main.id, aws_subnet.private[0].id
    """
    if not isinstance(value, str):
        return False
    
    # Pattern: resource_type.name.attribute or resource_type.name[index].attribute
    parts = value.replace("[", ".").replace("]", "").split(".")
    
    # Should have at least 3 parts: type, name, attribute
    if len(parts) < 3:
        return False
    
    # First part should be a resource type (e.g., aws_vpc, random_id)
    if "_" not in parts[0]:
        return False
    
    return True

