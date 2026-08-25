"""
IR Validation Layer - Production-ready validation for Terraform IR
Validates resource types, dependencies, and catches errors before HCL generation.
"""
from typing import Dict, Any, List, Tuple, Set
import re


# REMOVED: Hardcoded whitelist - now we accept ALL aws_* resources dynamically
# This allows Driftbox to support the entire AWS Terraform provider (700+ resources)
# without manual maintenance


class ValidationError(Exception):
    """Raised when IR validation fails."""
    def __init__(self, message: str, errors: List[str]):
        super().__init__(message)
        self.errors = errors


def validate_ir(ir: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validate intermediate representation before HCL generation.
    
    Returns:
        (is_valid, error_messages)
    """
    errors = []
    
    # 1. Validate resource types
    resource_type_errors = _validate_resource_types(ir)
    errors.extend(resource_type_errors)
    
    # 2. Validate dependencies
    dependency_errors = _validate_dependencies(ir)
    errors.extend(dependency_errors)
    
    # 3. Validate required fields
    required_field_errors = _validate_required_fields(ir)
    errors.extend(required_field_errors)
    
    # 4. Validate references
    reference_errors = _validate_references(ir)
    errors.extend(reference_errors)
    
    return (len(errors) == 0, errors)


def _validate_resource_types(ir: Dict[str, Any]) -> List[str]:
    """Validate all resource types follow valid provider patterns."""
    errors = []
    
    # Valid provider prefixes (allow ALL AWS and DigitalOcean resources)
    VALID_PREFIXES = [
        "aws_",           # All AWS resources
        "digitalocean_",  # All DigitalOcean resources
        "random_",        # Random provider
        "null_",          # Null provider
        "time_",          # Time provider
        "local_",         # Local provider
        "external_",      # External provider
        "archive_",       # Archive provider
        "http_",          # HTTP provider
        "tls_",           # TLS provider
    ]
    
    for op in ir.get("ops", []):
        selector = op.get("selector", {})
        resource_type = selector.get("type", "")
        
        if not resource_type:
            continue
        
        # Check if it starts with a valid provider prefix
        is_valid = any(resource_type.startswith(prefix) for prefix in VALID_PREFIXES)
        
        if not is_valid:
            errors.append(
                f"Unknown provider for resource type: '{resource_type}'. "
                f"Supported providers: AWS (aws_*), DigitalOcean (digitalocean_*), Random (random_*), Null (null_*), etc."
            )
    
    return errors




def _validate_dependencies(ir: Dict[str, Any]) -> List[str]:
    """Validate resource dependencies form a valid DAG (no cycles)."""
    errors = []
    
    # Build dependency graph
    resources = {}  # name -> resource_type
    dependencies = {}  # name -> list of referenced names
    
    for op in ir.get("ops", []):
        if op.get("action") == "delete":
            continue
        
        selector = op.get("selector", {})
        resource_type = selector.get("type", "")
        resource_name = selector.get("name", "")
        
        if not resource_type or not resource_name:
            continue
        
        full_name = f"{resource_type}.{resource_name}"
        resources[full_name] = resource_type
        dependencies[full_name] = []
        
        # Extract references from changes
        for change in op.get("changes", []):
            value = change.get("value")
            if isinstance(value, str):
                # Find all ${resource_type.name.attr} patterns
                refs = re.findall(r'\$\{([a-z0-9_]+\.[a-z0-9_]+)', value)
                for ref in refs:
                    if "." in ref:
                        dependencies[full_name].append(ref)
    
    # Check for cycles (simple DFS)
    visited = set()
    rec_stack = set()
    
    def has_cycle(node):
        visited.add(node)
        rec_stack.add(node)
        
        for neighbor in dependencies.get(node, []):
            if neighbor not in visited:
                if has_cycle(neighbor):
                    return True
            elif neighbor in rec_stack:
                return True
        
        rec_stack.remove(node)
        return False
    
    for resource in resources:
        if resource not in visited:
            if has_cycle(resource):
                errors.append(f"Circular dependency detected involving: {resource}")
    
    return errors


def _validate_required_fields(ir: Dict[str, Any]) -> List[str]:
    """Validate required fields are present for each resource type."""
    errors = []
    
    # Map of resource_type -> required fields
    REQUIRED_FIELDS = {
        "aws_s3_bucket": ["bucket"],
        "aws_vpc": ["cidr_block"],
        "aws_subnet": ["vpc_id", "cidr_block"],
        "aws_instance": ["ami", "instance_type"],
        "aws_security_group": ["name"],
        "aws_iam_role": ["assume_role_policy"],
        "aws_db_instance": ["allocated_storage", "engine", "instance_class"],
        "aws_rds_cluster": ["engine"],
    }
    
    for op in ir.get("ops", []):
        if op.get("action") != "create":
            continue
        
        selector = op.get("selector", {})
        resource_type = selector.get("type", "")
        resource_name = selector.get("name", "")
        
        required_fields = REQUIRED_FIELDS.get(resource_type, [])
        if not required_fields:
            continue
        
        # Extract all paths from changes
        provided_paths = set()
        for change in op.get("changes", []):
            if change.get("op") == "set":
                path = change.get("path", "")
                # Get top-level field
                top_field = path.split(".")[0]
                provided_paths.add(top_field)
        
        # Check for missing required fields
        missing = set(required_fields) - provided_paths
        if missing:
            errors.append(
                f"{resource_type}.{resource_name}: Missing required fields: {', '.join(missing)}"
            )
    
    return errors


def _validate_references(ir: Dict[str, Any]) -> List[str]:
    """Validate all resource references point to defined resources."""
    errors = []
    
    # Build set of defined resources
    defined_resources = set()
    for op in ir.get("ops", []):
        if op.get("action") == "delete":
            continue
        
        selector = op.get("selector", {})
        resource_type = selector.get("type", "")
        resource_name = selector.get("name", "")
        
        if resource_type and resource_name:
            defined_resources.add(f"{resource_type}.{resource_name}")
    
    # Check all references
    for op in ir.get("ops", []):
        selector = op.get("selector", {})
        current_resource = f"{selector.get('type', '')}.{selector.get('name', '')}"
        
        for change in op.get("changes", []):
            value = change.get("value")
            if isinstance(value, str):
                # Find all ${resource_type.name.attr} patterns
                refs = re.findall(r'\$\{([a-z0-9_]+\.[a-z0-9_]+)', value)
                for ref in refs:
                    # Ignore Terraform built-ins (var.*, data.*, local.*)
                    if not any(ref.startswith(prefix) for prefix in ["var.", "data.", "local."]):
                        # It's a resource reference
                        if ref not in defined_resources:
                            errors.append(
                                f"{current_resource}: References undefined resource '{ref}'"
                            )
    
    return errors


def get_validation_suggestions(errors: List[str]) -> str:
    """Convert validation errors into actionable suggestions for Claude."""
    if not errors:
        return ""
    
    suggestions = ["❌ Validation failed. Please fix:", ""]
    for i, error in enumerate(errors, 1):
        suggestions.append(f"{i}. {error}")
    
    suggestions.extend([
        "",
        "💡 Suggestions:",
        "- Check resource type spelling (use aws_s3_bucket not aws_bucket)",
        "- Ensure all referenced resources are defined first",
        "- Include required fields for each resource type",
        "- Avoid circular dependencies between resources"
    ])
    
    return "\n".join(suggestions)

