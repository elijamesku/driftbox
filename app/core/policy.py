import re
import os
import json 
import tempfile
from fastapi import HTTPException
from app.utils.validators import INFRASTRUCTURE_SCHEMA_VALIDATOR

def validate_infrastructure_request(infrastructure_config: dict):
    """Validate infrastructure configuration against schema and business rules"""
    validation_errors = sorted(INFRASTRUCTURE_SCHEMA_VALIDATOR.iter_errors(infrastructure_config), key=lambda e: e.path)
    if validation_errors:
        error_messages = [f"{'/'.join(map(str, err.path))}: {err.message}" for err in validation_errors]
        raise HTTPException(status_code=400, detail={"error": "ir_validation_failed", "messages": error_messages})

    resource_type = infrastructure_config["resource"]
    resource_name = infrastructure_config["name"]
    resource_properties = infrastructure_config["properties"]

    # Enforce naming conventions
    if not re.match(r"^[a-z0-9\-_.]+$", resource_name):
        raise HTTPException(status_code=400, detail={"error": "invalid_name", "message": "Name must be lowercase alphanum plus - _ ."})
    if resource_name.startswith(("admin", "root", "prod-unsafe", "public-")):
        raise HTTPException(status_code=400, detail={"error": "unsafe_name_prefix", "message": "Disallowed resource name prefix."})

    # Apply resource-specific validation and defaults
    if resource_type == "aws_s3_bucket":
        if not resource_properties.get("block_public_access", True):
            raise HTTPException(status_code=400, detail={"error": "unsafe_request", "message": "Public buckets are blocked in MVP."})
        resource_properties.setdefault("versioning", True)
        resource_properties.setdefault("region", "us-east-1")
        resource_properties.setdefault("tags", {"env": "dev"})

    if resource_type == "aws_iam_user":
        resource_properties.setdefault("region", "us-east-1")
        resource_properties.setdefault("tags", {"env": "dev"})

    if resource_type == "aws_dynamodb_table":
        resource_properties.setdefault("region", "us-east-1")
        key_type = resource_properties.get("hash_key_type", "S")
        if key_type not in ("S", "N", "B"):
            raise HTTPException(status_code=400, detail={"error": "invalid_hash_key_type", "message": "hash_key_type must be S, N, or B"})
        resource_properties.setdefault("hash_key", "pk")
        resource_properties["hash_key_type"] = key_type
        resource_properties.setdefault("tags", {"env": "dev"})


def enforce_security_policy(infrastructure_config: dict):
    """Execute Open Policy Agent policy checks against infrastructure configuration"""
    import subprocess as sp
    file_descriptor, temp_file_path = tempfile.mkstemp(suffix=".json")
    os.close(file_descriptor)
    try:
        # Write configuration to temporary file for policy evaluation
        with open(temp_file_path, "w") as config_file:
            json.dump(infrastructure_config, config_file)

        # Try different conftest invocation patterns for compatibility
        base_command = ["conftest", "test", "--policy", "app/policies", temp_file_path]
        command_variations = [base_command + ["--input", "json"], base_command]
        execution_result = None
        
        for command_variant in command_variations:
            process = sp.run(command_variant, capture_output=True, text=True)
            combined_output = (process.stdout or "") + (process.stderr or "")
            if "unknown flag" in combined_output:
                continue
            execution_result = process
            break
            
        if execution_result is None:
            raise HTTPException(500, {"error": "policy_error", "message": "Conftest invocation failed for all flag styles"})

        if execution_result.returncode != 0:
            policy_violation_message = (execution_result.stdout or execution_result.stderr or "").strip()
            raise HTTPException(status_code=400, detail={"error": "policy_denied", "message": policy_violation_message})
    finally:
        try: os.remove(temp_file_path)
        except Exception: pass
