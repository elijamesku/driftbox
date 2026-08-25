 
from typing import List
from fastapi import HTTPException
from .validators import INFRASTRUCTURE_SCHEMA_VALIDATOR
from .schemas import TERRAFORM_PLAN_PATTERN, TERRAFORM_RESOURCE_PATTERN
 
def generate_plan_summary(terraform_output: str) -> dict:
    """Parse Terraform plan output and extract change statistics"""
    resources_to_add = resources_to_modify = resources_to_delete = 0
    pattern_match = TERRAFORM_PLAN_PATTERN.search(terraform_output or "")
    if pattern_match:
        resources_to_add, resources_to_modify, resources_to_delete = map(int, pattern_match.groups())
    
    # Determine plan verdict based on output analysis
    has_changes = (resources_to_add + resources_to_modify + resources_to_delete) > 0
    status_verdict = "ok" if has_changes else "no_changes_or_failed"
    
    if "No valid credential sources found" in (terraform_output or ""):
        status_verdict = "credentials_missing"
    if "Failed to query available provider packages" in (terraform_output or ""):
        status_verdict = "cannot_reach_terraform_registry"
    if "Error:" in (terraform_output or "") and "Plan:" not in (terraform_output or ""):
        status_verdict = "error"
    
    return {"to_add": resources_to_add, "to_change": resources_to_modify, "to_destroy": resources_to_delete, "verdict": status_verdict}

def extract_plan_details(terraform_output: str) -> List[dict]:
    """Extract detailed resource-level changes from Terraform plan output"""
    resource_changes = []
    for pattern_match in TERRAFORM_RESOURCE_PATTERN.finditer(terraform_output or ""):
        resource_changes.append({"address": pattern_match.group("addr"), "action": pattern_match.group("action")})
    return resource_changes