"""
Post-processing for Infrastructure IR to fix common issues.
Specifically handles JSON string fields that need jsonencode() in Terraform.
"""
import json
import re
from typing import Any, Dict, List


# AWS resources with JSON fields that MUST use jsonencode()
JSON_FIELDS_BY_RESOURCE = {
    "aws_iam_role": ["assume_role_policy"],
    "aws_iam_policy": ["policy"],
    "aws_iam_role_policy": ["policy"],
    "aws_iam_user_policy": ["policy"],
    "aws_iam_group_policy": ["policy"],
    "aws_s3_bucket_policy": ["policy"],
    "aws_sns_topic_policy": ["policy"],
    "aws_sqs_queue_policy": ["policy"],
    "aws_lambda_permission": ["policy"],
    "aws_api_gateway_rest_api_policy": ["policy"],
    "aws_vpc_endpoint_policy": ["policy"],
    "aws_ecs_task_definition": ["container_definitions"],
    "aws_cloudwatch_event_rule": ["event_pattern"],
    "aws_cloudformation_stack": ["template_body"],
    "aws_lambda_function": ["environment"],  # sometimes contains JSON
    "aws_elasticache_parameter_group": ["parameter"],  # can be JSON
}


def postprocess_ir_for_terraform(ir: Dict[str, Any]) -> Dict[str, Any]:
    """
    Post-process IR to ensure all JSON fields use jsonencode() marker.
    This prevents "Invalid multi-line string" errors in Terraform.
    
    Args:
        ir: Infrastructure IR with ops
        
    Returns:
        Modified IR with jsonencode markers added
    """
    if not ir or "ops" not in ir:
        return ir
    
    for op in ir["ops"]:
        resource_type = op.get("selector", {}).get("type", "")
        
        # Check if this resource type has known JSON fields
        json_fields = JSON_FIELDS_BY_RESOURCE.get(resource_type, [])
        
        if not json_fields:
            continue
        
        # Process each change in this operation
        for change in op.get("changes", []):
            path = change.get("path", "")
            value = change.get("value")
            
            # Check if this path is a known JSON field
            if path in json_fields:
                # Wrap with jsonencode marker if not already wrapped
                if isinstance(value, dict) and "__terraform_jsonencode__" not in value:
                    # If it's already a dict, wrap it
                    change["value"] = {
                        "__terraform_jsonencode__": True,
                        "data": value
                    }
                    print(f"✅ [IR-Postprocess] Wrapped {resource_type}.{path} with jsonencode()")
                    
                elif isinstance(value, list):
                    # Lists should also be jsonencoded (e.g., container_definitions)
                    change["value"] = {
                        "__terraform_jsonencode__": True,
                        "data": value
                    }
                    print(f"✅ [IR-Postprocess] Wrapped {resource_type}.{path} list with jsonencode()")
                    
                elif isinstance(value, str):
                    # String value - check if it's JSON-like
                    # IMPORTANT: Remove any leading/trailing quotes that might have been accidentally added
                    cleaned_value = value.strip().strip('"').strip("'")
                    parsed_json = _try_parse_json_string(cleaned_value)
                    if parsed_json is not None:
                        # It's a JSON string - wrap it
                        change["value"] = {
                            "__terraform_jsonencode__": True,
                            "data": parsed_json
                        }
                        print(f"✅ [IR-Postprocess] Parsed and wrapped {resource_type}.{path} JSON string with jsonencode()")
                    else:
                        # Not JSON, but it's a JSON field - might be a heredoc or interpolation
                        # Leave it as-is, but warn
                        print(f"⚠️  [IR-Postprocess] {resource_type}.{path} is a string but not valid JSON - leaving as-is")
    
    return ir


def _try_parse_json_string(value: str) -> Any:
    """
    Try to parse a string as JSON.
    Returns the parsed object or None if not valid JSON.
    """
    if not isinstance(value, str):
        return None
    
    # Skip if it's obviously an interpolation
    if "${" in value or "jsonencode(" in value:
        return None
    
    try:
        return json.loads(value)
    except (json.JSONDecodeError, ValueError):
        return None


def auto_detect_and_wrap_json_fields(ir: Dict[str, Any]) -> Dict[str, Any]:
    """
    AGGRESSIVE: Auto-detect any field that looks like JSON and wrap it.
    Use this as a fallback if the resource type is unknown.
    """
    if not ir or "ops" not in ir:
        return ir
    
    for op in ir["ops"]:
        for change in op.get("changes", []):
            value = change.get("value")
            path = change.get("path", "")
            
            # Skip if already wrapped
            if isinstance(value, dict) and "__terraform_jsonencode__" in value:
                continue
            
            # Check if value is a multi-line string that looks like JSON
            if isinstance(value, str) and ("\n" in value or value.strip().startswith("{") or value.strip().startswith("[")):
                # Clean up any extra quotes first
                cleaned = value.strip().strip('"').strip("'")
                parsed = _try_parse_json_string(cleaned)
                if parsed is not None:
                    resource_type = op.get("selector", {}).get("type", "unknown")
                    change["value"] = {
                        "__terraform_jsonencode__": True,
                        "data": parsed
                    }
                    print(f"✅ [IR-AutoDetect] Found and wrapped multi-line JSON in {resource_type}.{path}")
    
    return ir

