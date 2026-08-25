# HCL (HashiCorp Configuration Language) generation from structured infrastructure plans
from typing import Dict, Any, List
from jinja2 import Template
import textwrap

# Note: We use pure Python for resource blocks, Jinja2 only for provider config

# Known block-type arguments that should NOT use "=" syntax
# These are rendered as blocks: key { ... } instead of key = { ... }
BLOCK_TYPE_ARGUMENTS = {
    # Security Groups (AWS)
    "ingress", "egress",
    
    # Load Balancers (AWS)
    "health_check", "launch_template", "default_action", "action", "condition",
    
    # S3 Bucket configurations
    "versioning_configuration", "server_side_encryption_configuration", 
    "logging", "cors_rule", "lifecycle_rule", "replication_configuration",
    "notification", "object_lock_configuration", "website",
    "apply_server_side_encryption_by_default",  # S3 encryption rule
    "transition", "expiration", "noncurrent_version_transition", "noncurrent_version_expiration",  # S3 lifecycle sub-blocks
    
    # RDS/Database
    "restore_to_point_in_time", "scaling_configuration",
    
    # ECS
    "capacity_provider_strategy", "network_configuration", "load_balancer",
    "placement_constraints", "placement_strategy", "service_registries",
    
    # Autoscaling
    "mixed_instances_policy", "launch_template", "instance_refresh",
    
    # IAM
    "statement", "inline_policy",
    
    # Networking (VPC, Route Tables, etc.)
    "route", "rule", "destination", "origin",
    
    # Terraform meta-arguments
    "tag", "dynamic", "lifecycle", "provisioner", "connection", "depends_on",
    
    # DigitalOcean Load Balancer
    "forwarding_rule", "healthcheck", "sticky_sessions",
    
    # DigitalOcean Firewall
    "inbound_rule", "outbound_rule",
    
    # DigitalOcean Kubernetes
    "node_pool", "taint", "maintenance_policy",
    
    # DigitalOcean Database
    "maintenance_window",
    
    # DigitalOcean CDN/Spaces
    "cors_rule", "lifecycle_rule"
}

TERRAFORM_AWS_PROVIDER_TEMPLATE = Template(textwrap.dedent("""\
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = "{{ aws_region }}"
}
"""))

TERRAFORM_DIGITALOCEAN_PROVIDER_TEMPLATE = Template(textwrap.dedent("""\
terraform {
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean", version = "~> 2.0" }
  }
}

provider "digitalocean" {
  # Token is read from DIGITALOCEAN_TOKEN environment variable
  # Or set: token = var.do_token
}

variable "do_token" {
  description = "DigitalOcean API token"
  type        = string
  default     = ""
  sensitive   = true
}
"""))

# Default template (for backwards compatibility)
TERRAFORM_PROVIDER_CONFIGURATION_TEMPLATE = TERRAFORM_AWS_PROVIDER_TEMPLATE

def _render_hcl_scalar_value(scalar_value, in_list=False):
    """
    Render a scalar value for HCL.
    
    Args:
        scalar_value: The value to render
        in_list: If True, use appropriate quoting for list context
    """
    if isinstance(scalar_value, bool):
        return "true" if scalar_value else "false"
    if isinstance(scalar_value, (int, float)):
        return str(scalar_value)
    if scalar_value is None:
        return "null"
    # Handle Terraform interpolations and functions
    if isinstance(scalar_value, str):
        # Convert old-style ${simple.reference} to modern style simple.reference
        # But keep ${complex(expressions)} as-is (with quotes)
        if scalar_value.startswith("${") and scalar_value.endswith("}"):
            inner = scalar_value[2:-1]  # Strip ${ and }
            # Check if it's a simple reference (no functions, no string operations)
            # Simple: aws_subnet.foo.id, var.something, data.aws_ami.latest.id
            # Complex: jsonencode(...), "${var.x}-suffix", etc.
            if "(" not in inner and '"' not in inner and "'" not in inner:
                # Simple reference - use modern syntax (no ${})
                if in_list:
                    return inner  # In lists: [aws_subnet.a.id, aws_subnet.b.id]
                return inner  # Standalone: subnet_id = aws_subnet.foo.id
            else:
                # Complex expression - keep ${} and quote if needed
                if in_list:
                    return f"\"{scalar_value}\""  # In lists: ["${jsonencode(...)}"]
                return scalar_value  # Standalone: container_definitions = ${jsonencode(...)}
        # Don't quote Terraform function calls: jsonencode(...), file(...), etc
        if "(" in scalar_value and scalar_value.strip().endswith(")"):
            # Check if it looks like a function call
            func_name = scalar_value.split("(")[0].strip()
            if func_name and func_name.replace("_", "").isalnum():
                return scalar_value
    return f"\"{scalar_value}\""

def _render_hcl_nested_value(nested_value, indentation_level=0):
    indentation_padding = "  " * indentation_level
    if isinstance(nested_value, dict):
        # Check for special jsonencode marker
        if "__terraform_jsonencode__" in nested_value:
            # Render as jsonencode(data)
            data = nested_value.get("data", [])
            inner_json = _render_hcl_nested_value(data, 0)
            return f"jsonencode({inner_json})"
        
        # Render HCL nested block structure (e.g., versioning = { enabled = true })
        hcl_lines = ["{"]
        for nested_key, nested_val in nested_value.items():
            if isinstance(nested_val, dict):
                # Recursively render nested objects
                hcl_lines.append(f"{indentation_padding}  {nested_key} = {_render_hcl_nested_value(nested_val, indentation_level+1)}")
            else:
                hcl_lines.append(f"{indentation_padding}  {nested_key} = {_render_hcl_scalar_value(nested_val, in_list=False)}")
        hcl_lines.append(indentation_padding + "}")
        return "\n".join(hcl_lines)
    if isinstance(nested_value, list):
        # When rendering list items, pass in_list=True to properly quote interpolations
        rendered_list_items = ", ".join(_render_hcl_scalar_value(item, in_list=True) if not isinstance(item, (dict,list)) else _render_hcl_nested_value(item, indentation_level+1) for item in nested_value)
        return f"[{rendered_list_items}]"
    return _render_hcl_scalar_value(nested_value, in_list=False)

def _format_hcl_block(key, value, indentation_level=1):
    """Format a Terraform block (no = sign)."""
    indent = "  " * indentation_level
    lines = [f"{indent}{key} {{"]
    
    if isinstance(value, dict):
        for nested_key, nested_val in value.items():
            if isinstance(nested_val, dict) and nested_key in BLOCK_TYPE_ARGUMENTS:
                # Recursively render nested blocks
                lines.append(_format_hcl_block(nested_key, nested_val, indentation_level + 1))
            else:
                lines.append(f"{indent}  {nested_key} = {_render_hcl_scalar_value(nested_val, in_list=False) if not isinstance(nested_val, (dict, list)) else _render_hcl_nested_value(nested_val, indentation_level + 1)}")
    
    lines.append(f"{indent}}}")
    return "\n".join(lines)

def _format_resource_block(resource_data, render_hcl_value_func):
    """Format a Terraform resource block with proper indentation."""
    lines = [f'resource "{resource_data["type"]}" "{resource_data["name"]}" {{']
    
    for key, value in resource_data["args"].items():
        # Check if this is a block-type argument
        if isinstance(value, dict) and key in BLOCK_TYPE_ARGUMENTS:
            # Render as block (no = sign)
            lines.append(_format_hcl_block(key, value, 1))
        elif isinstance(value, list) and key in BLOCK_TYPE_ARGUMENTS:
            # Multiple blocks (e.g., multiple ingress rules)
            for item in value:
                if isinstance(item, dict):
                    lines.append(_format_hcl_block(key, item, 1))
                else:
                    lines.append(f"  {key} = {render_hcl_value_func(value, 1)}")
                    break  # Only add once if not dict
        else:
            # Regular attribute assignment
            lines.append(f"  {key} = {render_hcl_value_func(value, 1)}")
    
    lines.append("}")
    return "\n".join(lines)

def convert_resource_plan_to_hcl(infrastructure_plan: Dict[str, Any], default_region: str = "us-east-1", cloud_provider: str = None) -> Dict[str, str]:
    """
    Transform infrastructure plan into HCL file mapping.
    Returns dictionary mapping file_path → HCL content.
    Consolidates resources by file_hint; injects provider configuration if absent.
    
    Args:
        infrastructure_plan: The plan with "resources" list
        default_region: AWS region (used for AWS provider)
        cloud_provider: 'aws' or 'digitalocean' - if None, auto-detects from resources
    """
    hcl_files_content: Dict[str, List[str]] = {}
    
    # Auto-detect provider from resources if not specified
    detected_provider = cloud_provider
    if not detected_provider:
        for resource_definition in infrastructure_plan.get("resources", []):
            resource_type = resource_definition.get("resource_type", "")
            if resource_type.startswith("digitalocean_"):
                detected_provider = "digitalocean"
                break
            elif resource_type.startswith("aws_"):
                detected_provider = "aws"
                break
        if not detected_provider:
            detected_provider = "aws"  # Default
    
    for resource_definition in infrastructure_plan["resources"]:
        target_file_hint = resource_definition.get("file_hint") or "main.tf"
        rendered_resource_hcl = _format_resource_block(resource_definition, _render_hcl_nested_value)
        
        # Prepend explanation comment if it exists (for driftbox/docs/ auto-generated dependencies)
        explanation_comment = resource_definition.get("explanation_comment", "").strip()
        if explanation_comment:
            rendered_resource_hcl = f"{explanation_comment}\n\n{rendered_resource_hcl}"
        
        hcl_files_content.setdefault(target_file_hint, []).append(rendered_resource_hcl)

    # Add provider configuration to providers.tf ONLY if it doesn't exist yet
    # Simple check: if providers.tf already has content, don't add more
    if "providers.tf" not in hcl_files_content or len(hcl_files_content.get("providers.tf", [])) == 0:
        if detected_provider == "digitalocean":
            provider_configuration_hcl = TERRAFORM_DIGITALOCEAN_PROVIDER_TEMPLATE.render()
        else:
            provider_configuration_hcl = TERRAFORM_AWS_PROVIDER_TEMPLATE.render(aws_region=default_region)
        
        hcl_files_content["providers.tf"] = [provider_configuration_hcl]

    return {filename: "\n\n".join(hcl_statements) + "\n" for filename, hcl_statements in hcl_files_content.items()}
