from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import base64
import requests
import re
from app.utils.hcl_parser import parse_hcl_safely, extract_blocks, extract_resources
from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.utils.errors import sanitize_error_detail

router = APIRouter()

def get_resource_line_numbers_from_string(content: str, file_path: str) -> Dict[str, int]:
    """
    Parse Terraform content string to find the line number where each resource is declared.
    Returns a dict mapping "resource_type.resource_name" to line number.
    """
    line_map = {}
    try:
        lines = content.split('\n')
        for line_num, line in enumerate(lines, start=1):
            # Match: resource "aws_s3_bucket" "my_bucket" {
            match = re.match(r'^\s*resource\s+"([^"]+)"\s+"([^"]+)"\s*\{', line)
            if match:
                resource_type = match.group(1)
                resource_name = match.group(2)
                key = f"{resource_type}.{resource_name}"
                line_map[key] = line_num
    except Exception as e:
        print(f"Error parsing line numbers from {file_path}: {e}")
    return line_map

class GitHubRepoRequest(BaseModel):
    owner: str
    repo: str
    branch: Optional[str] = "main"

def fetch_github_tree(owner: str, repo: str, token: str, branch: str = "main") -> List[Dict]:
    """Fetch repository file tree from GitHub API with automatic branch detection
    Always fetches fresh data - no caching to ensure we get the latest commit
    """
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "Cache-Control": "no-cache",  # Ensure we always get latest data
        "If-None-Match": ""  # Force fresh fetch
    }
    
    # Try the specified branch first
    # Add timestamp to ensure we get latest (GitHub API may cache)
    url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
    response = requests.get(url, headers=headers, timeout=30)
    
    # If 404, try common branch names (main/master) before API call
    if response.status_code == 404:
        # Try 'master' if 'main' was specified, or vice versa
        alternate_branch = "master" if branch == "main" else "main"
        alt_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{alternate_branch}?recursive=1"
        alt_response = requests.get(alt_url, headers=headers, timeout=30)
        
        if alt_response.ok:
            print(f"Using alternate branch '{alternate_branch}' instead of '{branch}'")
            data = alt_response.json()
            return data.get("tree", [])
        
        # If both fail, try to get the default branch from API
        repo_url = f"https://api.github.com/repos/{owner}/{repo}"
        repo_response = requests.get(repo_url, headers=headers, timeout=30)
        
        if repo_response.ok:
            repo_data = repo_response.json()
            default_branch = repo_data.get("default_branch", "master")
            
            # Try with default branch
            url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{default_branch}?recursive=1"
            response = requests.get(url, headers=headers, timeout=30)
            
            if response.ok:
                print(f"Using default branch '{default_branch}' instead of '{branch}'")
    
    if not response.ok:
        raise HTTPException(
            status_code=response.status_code,
            detail={"error": "github_api_failed", "message": f"Failed to fetch repo tree: {response.text}"}
        )
    
    data = response.json()
    return data.get("tree", [])

def fetch_github_file(owner: str, repo: str, path: str, token: str) -> str:
    """Fetch file content from GitHub API
    Always fetches fresh data - no caching to ensure we get the latest version
    """
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "Cache-Control": "no-cache",  # Ensure we always get latest data
        "If-None-Match": ""  # Force fresh fetch
    }
    
    response = requests.get(url, headers=headers, timeout=30)
    if not response.ok:
        raise HTTPException(
            status_code=response.status_code,
            detail={"error": "github_api_failed", "message": f"Failed to fetch file {path}"}
        )
    
    data = response.json()
    if data.get("encoding") == "base64":
        content = base64.b64decode(data["content"]).decode("utf-8")
        return content
    
    return data.get("content", "")

@router.post("/parse-github-repo")
async def parse_github_repo(
    req: GitHubRepoRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Parse Terraform files directly from GitHub (serverless-friendly)
    No filesystem required - fetches and parses in-memory
    """
    # Get user's GitHub OAuth token
    if not user.github_access_token:
        raise HTTPException(
            status_code=401, 
            detail={
                "error": "github_token_required", 
                "message": "GitHub authentication required. Please sign in with GitHub."
            }
        )
    
    token = user.github_access_token
    
    try:
        # Fetch repository tree (always fresh - no backend caching)
        # This ensures we get the latest commit on the branch
        tree = fetch_github_tree(req.owner, req.repo, token, req.branch)
        
        # Log the commit SHA we're parsing (for debugging)
        commit_sha = tree[0].get("sha") if tree else None
        if commit_sha:
            print(f"📄 [Parse] Parsing repo {req.owner}/{req.repo} at commit {commit_sha[:7]} on branch {req.branch}")
        
        # Find all .tf files
        tf_files = [item for item in tree if item["path"].endswith(".tf") and item["type"] == "blob"]
        
        if not tf_files:
            return {
                "ok": True,
                "repo": f"{req.owner}/{req.repo}",
                "branch": req.branch,
                "sha": tree[0].get("sha") if tree else None,
                "total_resources": 0,
                "resource_types": 0,
                "resources": [],
                "message": "No Terraform files found in repository"
            }
        
        # Parse each .tf file
        all_resources: List[Dict[str, Any]] = []
        all_modules: List[Dict[str, Any]] = []
        all_variables: List[Dict[str, Any]] = []
        all_outputs: List[Dict[str, Any]] = []
        
        parsed_count = 0
        skipped_count = 0
        
        for tf_file in tf_files:
            try:
                # Fetch file content
                content = fetch_github_file(req.owner, req.repo, tf_file["path"], token)
                
                # Skip empty files
                if not content or len(content.strip()) == 0:
                    skipped_count += 1
                    continue
                
                # Parse HCL
                parsed = parse_hcl_safely_from_string(content)
                
                # Skip if parsing failed
                if not parsed:
                    skipped_count += 1
                    print(f"Skipping {tf_file['path']}: HCL parsing returned empty")
                    continue
                
                # Extract resources with line numbers
                try:
                    # Get line numbers by parsing the raw content
                    line_numbers = get_resource_line_numbers_from_string(content, tf_file["path"])
                    
                    for resource_data in extract_resources(parsed):
                        resource_data["file"] = tf_file["path"]
                        # Add line number if found
                        resource_address = resource_data.get("address", "")
                        resource_data["line"] = line_numbers.get(resource_address, 1)
                        all_resources.append(resource_data)
                except Exception as e:
                    print(f"Failed to extract resources from {tf_file['path']}: {e}")
                
                # Extract modules
                try:
                    for module_name, module_attrs in extract_blocks(parsed, "module").items():
                        all_modules.append({
                            "name": module_name,
                            "file": tf_file["path"],
                            "attrs": module_attrs
                        })
                except Exception as e:
                    print(f"Failed to extract modules from {tf_file['path']}: {e}")
                
                # Extract variables
                try:
                    for var_name, var_attrs in extract_blocks(parsed, "variable").items():
                        all_variables.append({
                            "name": var_name,
                            "file": tf_file["path"],
                            "attrs": var_attrs
                        })
                except Exception as e:
                    print(f"Failed to extract variables from {tf_file['path']}: {e}")
                
                # Extract outputs
                try:
                    for output_name, output_attrs in extract_blocks(parsed, "output").items():
                        all_outputs.append({
                            "name": output_name,
                            "file": tf_file["path"],
                            "attrs": output_attrs
                        })
                except Exception as e:
                    print(f"Failed to extract outputs from {tf_file['path']}: {e}")
                
                parsed_count += 1
                    
            except Exception as e:
                # Log but continue with other files
                skipped_count += 1
                print(f"Failed to process {tf_file['path']}: {str(e)[:100]}")
                continue
        
        print(f"Parsed {parsed_count} files, skipped {skipped_count} files")
        
        # Update the global INFRASTRUCTURE_CATALOG so dashboard can access it
        from app.services.catalog import INFRASTRUCTURE_CATALOG
        catalog_data = {
            "ok": True,
            "repo": f"{req.owner}/{req.repo}",
            "branch": req.branch,
            "sha": tree[0].get("sha") if tree else None,
            "dir": ".",
            "resources": all_resources,
            "modules": all_modules,
            "variables": all_variables,
            "outputs": all_outputs,
            "counts": {
                "resources": len(all_resources),
                "modules": len(all_modules),
                "variables": len(all_variables),
                "outputs": len(all_outputs),
            }
        }
        
        # Update global catalog
        INFRASTRUCTURE_CATALOG.clear()
        INFRASTRUCTURE_CATALOG.update(catalog_data)
        
        # Also store resources in infrastructure index for dashboard access
        # This ensures refresh actually updates the data that dashboard queries
        if all_resources:
            try:
                from app.services.infrastructure_indexing_service import infrastructure_indexing_service
                infrastructure_indexing_service.store_resources(
                    user_id=user.id,
                    owner=req.owner,
                    repo=req.repo,
                    resources=all_resources,
                    commit_sha=tree[0].get("sha") if tree else None
                )
                print(f"✅ [Parse] Stored {len(all_resources)} resources in infrastructure index")
            except Exception as e:
                print(f"⚠️ [Parse] Failed to store resources in index (non-fatal): {e}")
        
        return catalog_data
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "parse_failed", "message": sanitize_error_detail(e, "Failed to parse repository")}
        )

def parse_hcl_safely_from_string(content: str) -> Dict[str, Any]:
    """Parse HCL content from string with better error handling"""
    try:
        import hcl2
        import io
        # Try to parse HCL
        parsed = hcl2.load(io.StringIO(content))
        return parsed if parsed else {}
    except ImportError:
        print("hcl2 library not installed. Run: pip install python-hcl2")
        return {}
    except Exception as e:
        # Log the error but don't crash - skip problematic files
        print(f"HCL parse error (skipping file): {str(e)[:100]}")
        return {}

@router.get("/github-dashboard/{owner}/{repo}")
async def get_github_dashboard(
    owner: str,
    repo: str,
    branch: str = "main",
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Convenience endpoint: Parse repo and return AWS resources in one call
    """
    # Parse the repo
    req = GitHubRepoRequest(owner=owner, repo=repo, branch=branch)
    catalog = await parse_github_repo(req, user)
    
    # Group AWS resources by type (reuse logic from aws_resources.py)
    from app.api.v1.endpoints.aws_resources import AWS_RESOURCE_ICONS, AWS_RESOURCE_DISPLAY_NAMES, extract_resource_attributes
    from collections import defaultdict
    
    resources_by_type: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    
    for resource in catalog["resources"]:
        resource_type = resource.get("type", "")
        
        # Only include AWS resources
        if resource_type.startswith("aws_"):
            extracted = extract_resource_attributes(resource)
            resources_by_type[resource_type].append(extracted)
    
    # Format for dashboard
    dashboard_data = []
    for resource_type, resources in resources_by_type.items():
        dashboard_data.append({
            "type": resource_type,
            "display_name": AWS_RESOURCE_DISPLAY_NAMES.get(resource_type, resource_type.replace("_", " ").title()),
            "icon": AWS_RESOURCE_ICONS.get(resource_type, "📦"),
            "count": len(resources),
            "resources": sorted(resources, key=lambda x: x.get("name", "")),
        })
    
    # Sort by count (descending)
    dashboard_data.sort(key=lambda x: x["count"], reverse=True)
    
    return {
        "ok": True,
        "repo": f"{owner}/{repo}",
        "branch": branch,
        "sha": catalog.get("sha"),
        "total_resources": sum(item["count"] for item in dashboard_data),
        "resource_types": len(dashboard_data),
        "resources": dashboard_data,
    }

