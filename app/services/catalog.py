from typing import Dict, Any
from pathlib import Path
from fastapi import HTTPException
from typing import List, Optional
import hcl2 
from app.utils.hcl_parser import parse_hcl_safely, extract_blocks, extract_resources, get_resource_line_numbers
from app.services.git_ops import compute_git_commit_hash
# ------------------------------------------------------------------------------
# In-memory infrastructure catalog (populated via /index-repo endpoint)
# ------------------------------------------------------------------------------
INFRASTRUCTURE_CATALOG: Dict[str, Any] = {"sha": None, "dir": ".", "resources": [], "modules": [], "variables": [], "outputs": []}
# Alias for backward compatibility
CATALOG = INFRASTRUCTURE_CATALOG

# ------------------------------------------------------------------------------
# Index terraform directory and build catalog
# ------------------------------------------------------------------------------
def build_directory_index(repository_root: Path, relative_directory: str) -> Dict[str, Any]:
    if hcl2 is None:
        raise HTTPException(status_code=500, detail={"error": "missing_dependency", "message": "python-hcl2 not installed. Run: pip install python-hcl2"})
    target_directory = (repository_root / relative_directory).resolve()
    if not target_directory.exists():
        raise HTTPException(status_code=400, detail={"error": "dir_not_found", "message": f"{relative_directory} does not exist in repo"})

    discovered_resources: List[Dict[str, Any]] = []
    discovered_modules: List[Dict[str, Any]] = []
    discovered_variables: List[Dict[str, Any]] = []
    discovered_outputs: List[Dict[str, Any]] = []

    for terraform_file in sorted(target_directory.rglob("*.tf")):
        parsed_content = parse_hcl_safely(terraform_file)
        # Get line numbers for all resources in this file
        line_numbers = get_resource_line_numbers(terraform_file)
        
        for resource_data in extract_resources(parsed_content):
            resource_data["file"] = str(terraform_file.relative_to(repository_root))
            # Add line number if we found it
            resource_address = resource_data.get("address", "")
            resource_data["line"] = line_numbers.get(resource_address, 1)
            discovered_resources.append(resource_data)
        for module_name, module_attributes in extract_blocks(parsed_content, "module").items():
            discovered_modules.append({"name": module_name, "file": str(terraform_file.relative_to(repository_root)), "attrs": module_attributes})
        for variable_name, variable_attributes in extract_blocks(parsed_content, "variable").items():
            discovered_variables.append({"name": variable_name, "file": str(terraform_file.relative_to(repository_root)), "attrs": variable_attributes})
        for output_name, output_attributes in extract_blocks(parsed_content, "output").items():
            discovered_outputs.append({"name": output_name, "file": str(terraform_file.relative_to(repository_root)), "attrs": output_attributes})

    commit_hash = compute_git_commit_hash(repository_root)
    return {
        "sha": commit_hash,
        "dir": relative_directory,
        "resources": discovered_resources,
        "modules": discovered_modules,
        "variables": discovered_variables,
        "outputs": discovered_outputs,
        "counts": {
            "resources": len(discovered_resources),
            "modules": len(discovered_modules),
            "variables": len(discovered_variables),
            "outputs": len(discovered_outputs),
        },
    }

# ------------------------------------------------------------------------------
# Search for resource candidates matching hint
# ------------------------------------------------------------------------------
def find_matching_resources(infrastructure_catalog: Dict[str, Any], search_hint: str, result_limit: int = 5) -> List[Dict[str, Any]]:
    normalized_hint = search_hint.lower()
    scored_results = []
    for resource in infrastructure_catalog.get("resources", []):
        searchable_text = f"{resource.get('address','')} {resource.get('name','')}".lower()
        resource_tags = resource.get("attrs", {}).get("tags", {})
        if isinstance(resource_tags, dict):
            searchable_text += " " + " ".join([f"{tag_key}:{tag_value}" for tag_key, tag_value in resource_tags.items()])
        relevance_score = 0
        if normalized_hint in searchable_text:
            relevance_score += 10
        for search_token in normalized_hint.split():
            if search_token in searchable_text:
                relevance_score += 2
        if relevance_score > 0:
            scored_results.append((relevance_score, resource))
    scored_results.sort(key=lambda x: x[0], reverse=True)
    return [resource for _, resource in scored_results[:result_limit]]

# ------------------------------------------------------------------------------
# Resolve target resource from catalog based on selector criteria
# ------------------------------------------------------------------------------
def identify_target_resource(infrastructure_catalog: dict, resource_selector: dict, file_location_hint: Optional[str]):
    """Identify best matching resource from catalog based on selector criteria and hints."""
    resource_type = resource_selector.get("type")
    resource_name = resource_selector.get("name")
    attribute_matchers = resource_selector.get("match", {})
    potential_matches = []
    for resource in infrastructure_catalog.get("resources", []):
        if resource_type and resource["type"] != resource_type:
            continue
        match_score = 0
        if resource_name and resource["name"] == resource_name:
            match_score += 10
        for attr_key, attr_value in (attribute_matchers or {}).items():
            if isinstance(resource.get("attrs", {}).get(attr_key), str) and resource["attrs"][attr_key] == attr_value:
                match_score += 6
        if file_location_hint and resource.get("file") == file_location_hint:
            match_score += 2
        if match_score > 0 or (not resource_name and not attribute_matchers and resource_type):
            potential_matches.append((match_score, resource))
    if not potential_matches:
        return None
    potential_matches.sort(key=lambda x: x[0], reverse=True)
    return potential_matches[0][1]

    
def extract_existing_resource_identifiers(infrastructure_catalog: dict) -> set[str]:
    resource_identifiers = set()
    for resource in (infrastructure_catalog.get("resources") or []):
        resource_type = resource.get("type")
        resource_name = resource.get("name")
        if resource_type and resource_name:
            resource_identifiers.add(f"{resource_type}:{resource_name}")
    return resource_identifiers