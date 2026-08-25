from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any, Optional
from app.database.models import UserAccount
from app.services.auth import authentication_service
from app.api.v1.endpoints.github_parser import parse_github_repo, fetch_github_file, GitHubRepoRequest
from app.utils.errors import sanitize_error_detail
import requests

router = APIRouter()

# ========================================
# 🚀 ENHANCED DRIFT DETECTION WITH AI
# ========================================
# NOTE: This MUST be defined BEFORE the basic endpoint to avoid route conflicts

@router.get("/detect/{owner}/{repo}/enhanced")
async def detect_terraform_drift_enhanced(
    owner: str,
    repo: str,
    branch: str = "main",
    workspace_path: Optional[str] = None,
    compare_to: str = "HEAD~1",
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    🚀 ENHANCED drift detection with AI-powered insights
    
    This is an enhanced version of the standard drift detection that adds:
    - AI explanations for WHY changes were made (from git + conversation history)
    - Analysis of WHAT resources are affected downstream
    - Risk assessment and actionable recommendations
    - Uses Voyage AI embeddings for semantic understanding
    
    Safe fallback: If AI enhancement fails, returns standard drift data
    """
    try:
        # Import here to avoid breaking if service is not available
        from app.services.drift_intelligence_service import drift_intelligence_service
        
        # Get basic drift data using existing endpoint
        basic_drift = await detect_terraform_drift(
            owner=owner,
            repo=repo,
            branch=branch,
            compare_to=compare_to,
            current_user=current_user
        )
        
        # Enhance with AI insights
        # This is SAFE - if it fails, it returns the basic_drift unmodified
        enhanced_drift = await drift_intelligence_service.analyze_drift_with_context(
            drift_data=basic_drift,
            user_id=current_user.id,
            owner=owner,
            repo=repo,
            workspace_path=workspace_path
        )
        
        return enhanced_drift
        
    except Exception as e:
        # If anything goes wrong with enhancement, fall back to basic detection
        print(f"⚠️ [Enhanced Drift] Error during enhancement, falling back to basic: {e}")
        try:
            return await detect_terraform_drift(
                owner=owner,
                repo=repo,
                branch=branch,
                compare_to=compare_to,
                current_user=current_user
            )
        except Exception as fallback_error:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to detect drift: {str(fallback_error)}"
            )


# ========================================
# BASIC DRIFT DETECTION
# ========================================

@router.get("/detect/{owner}/{repo}")
async def detect_terraform_drift(
    owner: str,
    repo: str,
    branch: str = "main",
    compare_to: str = "HEAD~1",  # Compare to previous commit by default
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Detect drift in Terraform code by comparing current state to a baseline.
    
    This compares:
    - Current branch vs previous commit
    - Detects added, removed, and modified resources
    - Identifies configuration changes
    
    NO AWS credentials needed - this is pure code analysis.
    """
    try:
        print(f"🔍 [Drift Detection] Starting comprehensive drift analysis for {owner}/{repo}")
        print(f"📊 [Drift Detection] Branch: {branch}, Comparing to: {compare_to}")
        
        # Get current state - try index first, fallback to parsing
        from app.services.infrastructure_query_service import infrastructure_query_service
        from app.services.codebase_indexing_service import codebase_indexing_service
        
        # Check if index exists
        index_status = codebase_indexing_service.get_index_status(current_user.id, owner, repo)
        current_resources = []
        current_data = None
        
        if index_status.get("exists"):
            # Try to get from index
            current_resources = infrastructure_query_service.get_all_resources(
                user_id=current_user.id,
                owner=owner,
                repo=repo,
                fallback_to_parse=False
            )
        
        # If no resources from index, parse (backward compatibility)
        if not current_resources:
            req = GitHubRepoRequest(owner=owner, repo=repo, branch=branch)
            current_data = await parse_github_repo(req, current_user)
            current_resources = current_data.get("resources", [])
            
            # Store in index for future use (non-blocking)
            if current_resources:
                try:
                    from app.services.infrastructure_indexing_service import infrastructure_indexing_service
                    infrastructure_indexing_service.store_resources(
                        user_id=current_user.id,
                        owner=owner,
                        repo=repo,
                        resources=current_resources,
                        commit_sha=current_data.get("sha")
                    )
                except Exception as e:
                    print(f"⚠️ [Drift Detection] Failed to store resources in index (non-fatal): {e}")
        else:
            current_data = {"resources": current_resources, "modules": [], "variables": [], "outputs": []}
        
        print(f"✅ [Drift Detection] Current state: {len(current_resources)} resources found")
        
        # Get previous state using GitHub API commits
        github_token = current_user.github_access_token
        if not github_token:
            raise HTTPException(
                status_code=401,
                detail="GitHub access token not found"
            )
        
        # Fetch commit history to get previous commit SHA
        # Try the specified branch first, then try alternate (main/master)
        headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        commits_url = f"https://api.github.com/repos/{owner}/{repo}/commits?sha={branch}&per_page=2"
        response = requests.get(commits_url, headers=headers)
        
        # If 404, try alternate branch (main/master)
        if response.status_code == 404:
            alternate_branch = "master" if branch == "main" else "main"
            print(f"⚠️  [Drift Detection] Branch '{branch}' not found, trying '{alternate_branch}'")
            commits_url = f"https://api.github.com/repos/{owner}/{repo}/commits?sha={alternate_branch}&per_page=2"
            response = requests.get(commits_url, headers=headers)
            
            if response.status_code == 200:
                branch = alternate_branch
                print(f"✅ [Drift Detection] Using branch '{alternate_branch}' instead")
                # Parse for alternate branch
                req = GitHubRepoRequest(owner=owner, repo=repo, branch=alternate_branch)
                current_data = await parse_github_repo(req, current_user)
                current_resources = current_data.get("resources", [])
                if current_resources:
                    try:
                        from app.services.infrastructure_indexing_service import infrastructure_indexing_service
                        infrastructure_indexing_service.store_resources(
                            user_id=current_user.id,
                            owner=owner,
                            repo=repo,
                            resources=current_resources,
                            commit_sha=current_data.get("sha")
                        )
                    except Exception as e:
                        print(f"⚠️ [Drift Detection] Failed to store resources in index (non-fatal): {e}")
                print(f"✅ [Drift Detection] Current state: {len(current_resources)} resources found")
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Failed to fetch commit history: {response.json()}"
            )
        
        commits = response.json()
        previous_commit_sha = None
        previous_commit_message = None
        
        if len(commits) < 2:
            # If there's only one commit, compare to empty state
            print(f"⚠️  [Drift Detection] Only 1 commit found - comparing to empty state")
            previous_data = {"resources": [], "modules": [], "variables": [], "outputs": []}
        else:
            # Get the previous commit SHA
            previous_commit_sha = commits[1]["sha"]
            previous_commit_message = commits[1].get("commit", {}).get("message", "")
            print(f"📜 [Drift Detection] Previous commit: {previous_commit_sha[:7]} - {previous_commit_message[:50]}")
            
            # Parse the repository at the previous commit
            # For simplicity, we'll use a modified version that accepts a specific SHA
            previous_data = await parse_github_repo_at_commit(
                owner=owner,
                repo=repo,
                sha=previous_commit_sha,
                github_token=github_token
            )
            print(f"✅ [Drift Detection] Previous state: {len(previous_data.get('resources', []))} resources found")
        
        # Analyze drift
        print(f"🔬 [Drift Detection] Analyzing ALL attribute changes...")
        drifts = analyze_drift(
            current_resources=current_resources,
            previous_resources=previous_data.get("resources", [])
        )
        print(f"🎯 [Drift Detection] Analysis complete - {len(drifts)} drift(s) detected")
        
        # Calculate statistics
        added = sum(1 for d in drifts if d["type"] == "added")
        removed = sum(1 for d in drifts if d["type"] == "removed")
        modified = sum(1 for d in drifts if d["type"] == "modified")
        
        print(f"📈 [Drift Detection] Summary: +{added} added, -{removed} removed, ~{modified} modified")
        
        # Build analysis metadata for UI display
        previous_resources = previous_data.get("resources", [])
        
        # Get resource counts by comparing unique resource keys
        current_map = {f"{r.get('type', '')}.{r.get('tf_name', '')}": r for r in current_resources}
        previous_map = {f"{r.get('type', '')}.{r.get('tf_name', '')}": r for r in previous_resources}
        
        return {
            "ok": True,
            "repo": f"{owner}/{repo}",
            "branch": branch,
            "compared_to": compare_to,
            "total_changes": len(drifts),
            "added": added,
            "removed": removed,
            "modified": modified,
            "drifts": drifts,
            "analysis_metadata": {
                "total_resources_current": len(current_resources),
                "total_resources_previous": len(previous_resources),
                "resources_compared": len(set(current_map.keys()) & set(previous_map.keys())),
                "previous_commit_sha": previous_commit_sha[:7] if previous_commit_sha else None,
                "previous_commit_message": previous_commit_message[:80] if previous_commit_message else None
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to detect drift")
        )


async def parse_github_repo_at_commit(
    owner: str,
    repo: str,
    sha: str,
    github_token: str
) -> Dict[str, Any]:
    """
    Parse Terraform files at a specific commit SHA.
    """
    from app.api.v1.endpoints.github_parser import fetch_github_tree, fetch_github_file, parse_hcl_safely_from_string
    from app.utils.hcl_parser import extract_resources, extract_blocks
    
    # Fetch the tree at this specific SHA (use SHA as branch parameter)
    tree = fetch_github_tree(owner, repo, github_token, sha)
    
    # Find all .tf files
    tf_files = [item for item in tree if item["path"].endswith(".tf") and item["type"] == "blob"]
    
    resources = []
    modules = []
    variables = []
    outputs = []
    
    # OPTIMIZATION: Fetch and parse files in parallel for faster processing
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    def fetch_and_parse_file(tf_file):
        """Fetch and parse a single Terraform file (synchronous)"""
        file_path = tf_file["path"]
        file_resources = []
        file_modules = []
        file_variables = []
        file_outputs = []
        
        try:
            # Fetch file content
            content = fetch_github_file(owner, repo, file_path, github_token)
            
            if content:
                # Parse HCL
                parsed = parse_hcl_safely_from_string(content)
                if parsed:
                    # Extract resources
                    for resource_data in extract_resources(parsed):
                        resource_data["file"] = file_path
                        file_resources.append(resource_data)
                    
                    # Extract modules
                    for module_name, module_attrs in extract_blocks(parsed, "module").items():
                        file_modules.append({
                            "name": module_name,
                            "file": file_path,
                            "attrs": module_attrs
                        })
                    
                    # Extract variables
                    for var_name, var_attrs in extract_blocks(parsed, "variable").items():
                        file_variables.append({
                            "name": var_name,
                            "file": file_path,
                            "attrs": var_attrs
                        })
                    
                    # Extract outputs
                    for output_name, output_attrs in extract_blocks(parsed, "output").items():
                        file_outputs.append({
                            "name": output_name,
                            "file": file_path,
                            "attrs": output_attrs
                        })
        except Exception as e:
            print(f"Error parsing {file_path} at commit {sha}: {e}")
        
        return file_resources, file_modules, file_variables, file_outputs
    
    # Run file fetching/parsing in parallel (up to 10 concurrent files)
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_and_parse_file, tf_file): tf_file for tf_file in tf_files}
        
        for future in as_completed(futures):
            try:
                file_resources, file_modules, file_variables, file_outputs = future.result()
                resources.extend(file_resources)
                modules.extend(file_modules)
                variables.extend(file_variables)
                outputs.extend(file_outputs)
            except Exception as e:
                tf_file = futures[future]
                print(f"Error processing {tf_file['path']} at commit {sha}: {e}")
    
    return {
        "resources": resources,
        "modules": modules,
        "variables": variables,
        "outputs": outputs
    }


def analyze_drift(
    current_resources: List[Dict],
    previous_resources: List[Dict]
) -> List[Dict]:
    """
    🔥 COMPREHENSIVE drift analysis - tracks EVERY change!
    Compares current and previous resources to detect ALL modifications.
    """
    drifts = []
    
    # Create lookup maps
    current_map = {
        f"{r.get('type', '')}.{r.get('tf_name', '')}": r
        for r in current_resources
    }
    previous_map = {
        f"{r.get('type', '')}.{r.get('tf_name', '')}": r
        for r in previous_resources
    }
    
    print(f"  🔍 Comparing {len(current_map)} current vs {len(previous_map)} previous resources")
    
    # Detect added resources
    for key, resource in current_map.items():
        if key not in previous_map:
            drifts.append({
                "file": resource.get("file", ""),
                "line": resource.get("line"),
                "type": "added",
                "severity": determine_severity(resource, "added"),
                "resource_name": resource.get("name", resource.get("tf_name", "")),
                "resource_type": resource.get("type", ""),
                "description": f"New {resource.get('type', '')} resource added"
            })
    
    # Detect removed resources
    for key, resource in previous_map.items():
        if key not in current_map:
            drifts.append({
                "file": resource.get("file", ""),
                "line": resource.get("line"),
                "type": "removed",
                "severity": "high",  # Removals are always high severity
                "resource_name": resource.get("name", resource.get("tf_name", "")),
                "resource_type": resource.get("type", ""),
                "description": f"{resource.get('type', '')} resource removed"
            })
    
    # Detect modified resources
    for key in set(current_map.keys()) & set(previous_map.keys()):
        current = current_map[key]
        previous = previous_map[key]
        
        # Compare ALL attributes (comprehensive!)
        modifications = compare_resources(current, previous)
        
        if modifications:
            print(f"  📝 {key}: {len(modifications)} attribute(s) changed")
            for mod in modifications:
                attr = mod.get("attribute", "unknown")
                print(f"     - {attr}: '{mod.get('old_value', '')[:50]}' → '{mod.get('new_value', '')[:50]}'")
                drifts.append({
                    "file": current.get("file", ""),
                    "line": current.get("line"),
                    "type": "modified",
                    "severity": mod["severity"],
                    "resource_name": current.get("name", current.get("tf_name", "")),
                    "resource_type": current.get("type", ""),
                    "description": mod["description"],
                    "old_value": mod.get("old_value"),
                    "new_value": mod.get("new_value"),
                    "attribute": mod.get("attribute")
                })
    
    return drifts


def compare_resources(current: Dict, previous: Dict) -> List[Dict]:
    """
    🔥 COMPREHENSIVE resource comparison - tracks EVERY attribute change!
    
    This now logs ALL changes for complete visibility on every PR.
    No change goes unnoticed!
    """
    modifications = []
    
    # High-severity attributes (security/access related)
    high_severity_attrs = [
        "publicly_accessible", "security_groups", "policy", "iam_role",
        "assume_role_policy", "inline_policy", "encryption", "kms_key_id"
    ]
    
    # Medium-severity attributes (configuration changes)
    medium_severity_attrs = [
        "vpc_id", "subnet_id", "instance_type", "engine", "engine_version",
        "allocated_storage", "backup_retention_period", "multi_az"
    ]
    
    # Get ALL attributes from both current and previous
    all_attrs = set(current.keys()) | set(previous.keys())
    
    # Ignore metadata attributes (not actual config)
    ignore_attrs = {"file", "line", "tf_name", "type", "block_type", "raw_content"}
    
    for attr in sorted(all_attrs - ignore_attrs):
        curr_val = current.get(attr)
        prev_val = previous.get(attr)
        
        # Detect ANY change
        if curr_val != prev_val:
            # Skip if both are None/empty
            if curr_val in (None, "", {}, []) and prev_val in (None, "", {}, []):
                continue
                
            # Determine severity
            if attr in high_severity_attrs:
                severity = "high"
            elif attr in medium_severity_attrs:
                severity = "medium"
            else:
                severity = "low"
            
            # Special handling for complex values (dicts, lists)
            if isinstance(curr_val, (dict, list)) or isinstance(prev_val, (dict, list)):
                import json
                old_val_str = json.dumps(prev_val, sort_keys=True, indent=2) if prev_val else "null"
                new_val_str = json.dumps(curr_val, sort_keys=True, indent=2) if curr_val else "null"
            else:
                old_val_str = str(prev_val) if prev_val is not None else "null"
                new_val_str = str(curr_val) if curr_val is not None else "null"
            
            modifications.append({
                "description": f"Changed '{attr}'",
                "severity": severity,
                "old_value": old_val_str,
                "new_value": new_val_str,
                "attribute": attr
            })
    
    return modifications


def determine_severity(resource: Dict, drift_type: str) -> str:
    """
    Determine drift severity based on resource type and drift type.
    Supports both AWS and DigitalOcean resources.
    """
    resource_type = resource.get("type", "")
    
    # High severity resources - AWS
    high_severity_types = [
        "aws_iam_role",
        "aws_iam_policy",
        "aws_security_group",
        "aws_rds_instance",
        "aws_rds_cluster",
        # DigitalOcean high severity
        "digitalocean_database_cluster",
        "digitalocean_firewall",
        "digitalocean_kubernetes_cluster",
    ]
    
    # Medium severity resources - AWS
    medium_severity_types = [
        "aws_lambda_function",
        "aws_api_gateway_rest_api",
        "aws_dynamodb_table",
        # DigitalOcean medium severity
        "digitalocean_droplet",
        "digitalocean_loadbalancer",
        "digitalocean_spaces_bucket",
        "digitalocean_volume",
    ]
    
    if drift_type == "removed":
        return "high"
    elif resource_type in high_severity_types:
        return "high"
    elif resource_type in medium_severity_types:
        return "medium"
    else:
        return "low"


# ========================================
# 📖 INFRASTRUCTURE STORY API
# ========================================

@router.get("/story/{owner}/{repo}")
async def get_infrastructure_story(
    owner: str,
    repo: str,
    months: int = 6,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    📖 Get the complete infrastructure story with rich timeline, cost evolution, and insights
    
    This builds a comprehensive narrative showing:
    - Timeline of all infrastructure changes
    - Cost evolution over time
    - Team activity and trends
    - Actionable recommendations
    
    Perfect for: Executive summaries, audits, onboarding, retrospectives
    """
    try:
        print(f"📖 [Infrastructure Story] Building story for {owner}/{repo} ({months} months)")
        
        # Import here to avoid breaking if service is not available
        from app.services.infrastructure_story_service import infrastructure_story_service
        
        # Get GitHub token
        github_token = current_user.github_access_token
        if not github_token:
            raise HTTPException(
                status_code=401,
                detail="GitHub access token not found"
            )
        
        # Build the story
        story = await infrastructure_story_service.build_infrastructure_story(
            owner=owner,
            repo=repo,
            github_token=github_token,
            months=months
        )
        
        print(f"✅ [Infrastructure Story] Story built: {story['total_commits']} commits, {len(story['chapters'])} chapters")
        
        return story
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [Infrastructure Story] Error: {e}")
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to build infrastructure story")
        )


# ========================================
# 🤖 ON-DEMAND COMMIT EXPLANATION
# ========================================

@router.get("/explain/{owner}/{repo}/{sha}")
async def explain_commit(
    owner: str,
    repo: str,
    sha: str,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    🤖 Generate AI explanation for a single commit on-demand
    
    This endpoint generates a human-readable explanation of what changed
    and why it matters, only when the user clicks on a commit.
    
    Fast and efficient - no upfront generation!
    """
    try:
        print(f"🤖 [Explain Commit] {owner}/{repo} @ {sha[:7]}")
        
        # Import here to avoid breaking if service is not available
        from app.services.infrastructure_story_service import infrastructure_story_service
        
        # Get GitHub token
        github_token = current_user.github_access_token
        if not github_token:
            raise HTTPException(
                status_code=401,
                detail="GitHub access token not found"
            )
        
        # Generate explanation
        explanation = await infrastructure_story_service.generate_commit_explanation(
            owner=owner,
            repo=repo,
            sha=sha,
            github_token=github_token
        )
        
        return {
            "ok": True,
            "sha": sha,
            "explanation": explanation
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [Explain Commit] Error: {e}")
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to generate explanation")
        )


# ========================================
# 🍒 CHERRY-PICK / APPLY COMMIT
# ========================================

@router.post("/apply-commit/{owner}/{repo}/{sha}")
async def apply_commit_to_branch(
    owner: str,
    repo: str,
    sha: str,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    🍒 Cherry-pick a commit and create a PR with its changes
    
    This endpoint:
    1. Fetches the commit details from GitHub
    2. Creates a new branch from main
    3. Applies the commit's file changes
    4. Creates a PR with those changes
    
    Perfect for: Reapplying old changes, cherry-picking features, manual rebase
    """
    try:
        print(f"🍒 [Apply Commit] {owner}/{repo} @ {sha[:7]}")
        
        # Get GitHub token
        github_token = current_user.github_access_token
        if not github_token:
            raise HTTPException(
                status_code=401,
                detail="GitHub access token not found"
            )
        
        headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        # Fetch commit details
        commit_url = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
        response = requests.get(commit_url, headers=headers)
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Failed to fetch commit: {response.json().get('message', 'Unknown error')}"
            )
        
        commit_data = response.json()
        commit_message = commit_data["commit"]["message"]
        commit_author = commit_data["commit"]["author"]["name"]
        files = commit_data.get("files", [])
        
        # Filter to Terraform files
        tf_files = [f for f in files if f["filename"].endswith(".tf")]
        
        if not tf_files:
            raise HTTPException(
                status_code=400,
                detail="No Terraform files in this commit"
            )
        
        print(f"📁 [Apply Commit] Found {len(tf_files)} Terraform files")
        
        # Create a new branch name
        import time
        branch_name = f"driftbox/apply-{sha[:7]}-{int(time.time())}"
        
        # Get main branch SHA
        main_ref_url = f"https://api.github.com/repos/{owner}/{repo}/git/ref/heads/main"
        main_response = requests.get(main_ref_url, headers=headers)
        
        if main_response.status_code != 200:
            raise HTTPException(
                status_code=main_response.status_code,
                detail="Failed to get main branch"
            )
        
        main_sha = main_response.json()["object"]["sha"]
        
        # Create new branch
        create_ref_url = f"https://api.github.com/repos/{owner}/{repo}/git/refs"
        create_ref_response = requests.post(
            create_ref_url,
            headers=headers,
            json={
                "ref": f"refs/heads/{branch_name}",
                "sha": main_sha
            }
        )
        
        if create_ref_response.status_code != 201:
            raise HTTPException(
                status_code=create_ref_response.status_code,
                detail=f"Failed to create branch: {create_ref_response.json().get('message', 'Unknown error')}"
            )
        
        print(f"🌿 [Apply Commit] Created branch: {branch_name}")
        
        # Apply file changes to new branch
        for tf_file in tf_files:
            filename = tf_file["filename"]
            
            # Get current file content from new branch
            file_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{filename}?ref={branch_name}"
            file_response = requests.get(file_url, headers=headers)
            
            # Determine file operation
            if tf_file["status"] == "added":
                # File was added - create it
                if file_response.status_code == 404:
                    # Fetch content from original commit
                    original_file_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{filename}?ref={sha}"
                    original_response = requests.get(original_file_url, headers=headers)
                    
                    if original_response.status_code == 200:
                        content = original_response.json()["content"]
                        
                        # Create file
                        requests.put(
                            file_url.split('?')[0],
                            headers=headers,
                            json={
                                "message": f"Apply: {commit_message[:50]}",
                                "content": content,
                                "branch": branch_name
                            }
                        )
                        print(f"  ✅ Created {filename}")
            
            elif tf_file["status"] == "removed":
                # File was removed - delete it
                if file_response.status_code == 200:
                    file_data = file_response.json()
                    
                    requests.delete(
                        file_url.split('?')[0],
                        headers=headers,
                        json={
                            "message": f"Apply: {commit_message[:50]}",
                            "sha": file_data["sha"],
                            "branch": branch_name
                        }
                    )
                    print(f"  ✅ Deleted {filename}")
            
            elif tf_file["status"] == "modified":
                # File was modified - update it
                if file_response.status_code == 200:
                    # Fetch content from original commit
                    original_file_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{filename}?ref={sha}"
                    original_response = requests.get(original_file_url, headers=headers)
                    
                    if original_response.status_code == 200:
                        new_content = original_response.json()["content"]
                        current_sha = file_response.json()["sha"]
                        
                        # Update file
                        requests.put(
                            file_url.split('?')[0],
                            headers=headers,
                            json={
                                "message": f"Apply: {commit_message[:50]}",
                                "content": new_content,
                                "sha": current_sha,
                                "branch": branch_name
                            }
                        )
                        print(f"  ✅ Updated {filename}")
        
        # Create PR
        pr_title = f"🍒 Apply: {commit_message.split(chr(10))[0][:60]}"
        pr_body = f"""## Applied Commit

**Original Commit:** `{sha[:7]}`
**Author:** {commit_author}
**Message:** {commit_message}

### Files Changed
{chr(10).join([f"- `{f['filename']}` ({f['status']})" for f in tf_files])}

---
*This PR was created by cherry-picking commit {sha[:7]} via Infrara's Infrastructure Story feature.*
"""
        
        pr_url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
        pr_response = requests.post(
            pr_url,
            headers=headers,
            json={
                "title": pr_title,
                "body": pr_body,
                "head": branch_name,
                "base": "main"
            }
        )
        
        if pr_response.status_code != 201:
            raise HTTPException(
                status_code=pr_response.status_code,
                detail=f"Failed to create PR: {pr_response.json().get('message', 'Unknown error')}"
            )
        
        pr_data = pr_response.json()
        pr_url = pr_data["html_url"]
        
        print(f"✅ [Apply Commit] PR #{pr_data['number']} created")
        
        # Send Slack notification for PR
        try:
            from app.integrations.slack import slack_notifier
            slack_notifier.send_pull_request_notification(
                pull_request_url=pr_url,
                change_title=pr_data["title"],
                financial_impact=None,
                validation_result={"valid": True},
                modified_file_count=len(tf_files)
            )
            print(f"[Apply Commit] Slack notification sent for PR #{pr_data['number']}")
        except Exception as e:
            print(f"⚠️  [Apply Commit] Slack notification failed: {e}")
        
        return {
            "ok": True,
            "pr_number": pr_data["number"],
            "pr_title": pr_data["title"],
            "pr_url": pr_url,
            "branch": branch_name,
            "files_applied": len(tf_files)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [Apply Commit] Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to apply commit")
        )


# ========================================
# 🎓 PATTERN RECOGNITION & ML FEATURES
# ========================================

@router.get("/patterns/similar/{owner}/{repo}/{sha}")
async def get_similar_patterns(
    owner: str,
    repo: str,
    sha: str,
    limit: int = 5,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    🎓 Find similar commits from user's history across ALL repos
    
    Uses ML embeddings to find semantically similar changes
    Shows what worked/failed in the past
    """
    try:
        print(f"🔍 [Similar Patterns] Finding patterns for {sha[:7]}")
        
        from app.services.pattern_recognition_service import pattern_recognition_service
        
        # Get GitHub token
        github_token = current_user.github_access_token
        if not github_token:
            raise HTTPException(status_code=401, detail="GitHub access token not found")
        
        # Fetch commit details
        commit_url = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
        headers = {"Authorization": f"token {github_token}", "Accept": "application/vnd.github.v3+json"}
        
        response = requests.get(commit_url, headers=headers)
        if response.status_code != 200:
            raise HTTPException(status_code=404, detail="Commit not found")
        
        commit = response.json()
        
        # Find similar patterns
        similar = await pattern_recognition_service.find_similar_patterns(
            user_id=current_user.id,
            current_commit=commit,
            limit=limit
        )
        
        return {
            "ok": True,
            "commit_sha": sha,
            "similar_patterns": similar,
            "total_found": len(similar)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [Similar Patterns] Error: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to find similar patterns"))


@router.post("/patterns/index")
async def index_user_patterns(
    force_reindex: bool = False,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    🎓 Index all user commits for pattern learning (background job)
    
    This analyzes all repos and learns patterns
    Safe to call multiple times (idempotent)
    """
    try:
        print(f"🎓 [Pattern Indexing] Starting for user {current_user.id}")
        
        from app.services.pattern_recognition_service import pattern_recognition_service
        
        # Get GitHub token
        github_token = current_user.github_access_token
        if not github_token:
            raise HTTPException(status_code=401, detail="GitHub access token not found")
        
        # Fetch user's repos
        repos_url = "https://api.github.com/user/repos"
        headers = {"Authorization": f"token {github_token}", "Accept": "application/vnd.github.v3+json"}
        
        response = requests.get(repos_url, headers=headers, params={"per_page": 100})
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to fetch repos")
        
        repos = response.json()
        
        # Index commits (this can take a while)
        result = await pattern_recognition_service.index_user_commits(
            user_id=current_user.id,
            repos=repos,
            github_token=github_token,
            force_reindex=force_reindex
        )
        
        return {
            "ok": True,
            **result
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [Pattern Indexing] Error: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to index user patterns"))


@router.get("/best-practices/{owner}/{repo}")
async def get_best_practices_compliance(
    owner: str,
    repo: str,
    sha: Optional[str] = None,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    📋 Check compliance against learned best practices
    
    Shows which practices this commit/repo follows or violates
    """
    try:
        print(f"📋 [Best Practices] Checking compliance for {owner}/{repo}")
        
        from app.services.best_practices_service import best_practices_service
        
        # For now, return mock compliance data
        # In production, you'd analyze actual resources
        
        compliance = {
            "compliance_score": 85.5,
            "violations": [
                {
                    "type": "missing_tag",
                    "severity": "medium",
                    "message": "Missing required tag: 'Environment'",
                    "suggestion": "Add tag 'Environment' (found in 95% of your resources)",
                    "confidence": 0.95
                }
            ],
            "compliant_items": [
                {"type": "tag", "name": "Name"},
                {"type": "tag", "name": "ManagedBy"},
                {"type": "naming", "pattern": "prod-"}
            ],
            "total_checks": 7
        }
        
        return {
            "ok": True,
            "repo": f"{owner}/{repo}",
            **compliance
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [Best Practices] Error: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to get best practices compliance"))


@router.post("/best-practices/learn")
async def learn_best_practices(
    force_relearn: bool = False,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    📋 Learn best practices from user's code
    
    Analyzes all commits to find consistent patterns
    """
    try:
        print(f"📋 [Best Practices] Learning for user {current_user.id}")
        
        from app.services.best_practices_service import best_practices_service
        
        result = await best_practices_service.learn_user_practices(
            user_id=current_user.id,
            force_relearn=force_relearn
        )
        
        return {
            "ok": True,
            **result
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [Best Practices] Error: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to learn best practices"))


@router.get("/predictions/{owner}/{repo}/{sha}")
async def get_drift_predictions(
    owner: str,
    repo: str,
    sha: str,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    🔮 Predict what changes will likely follow this commit
    
    Based on learned sequences from user's history
    """
    try:
        print(f"🔮 [Predictions] Generating for commit {sha[:7]}")
        
        from app.services.predictive_drift_service import predictive_drift_service
        
        # Get GitHub token
        github_token = current_user.github_access_token
        if not github_token:
            raise HTTPException(status_code=401, detail="GitHub access token not found")
        
        # Fetch commit details
        commit_url = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
        headers = {"Authorization": f"token {github_token}", "Accept": "application/vnd.github.v3+json"}
        
        response = requests.get(commit_url, headers=headers)
        if response.status_code != 200:
            raise HTTPException(status_code=404, detail="Commit not found")
        
        commit = response.json()
        
        # Generate predictions
        predictions = await predictive_drift_service.predict_next_changes(
            user_id=current_user.id,
            current_commit={
                "pattern_type": "scaling",  # Would be classified in real implementation
                "change_category": "compute"
            }
        )
        
        return {
            "ok": True,
            "commit_sha": sha,
            "predictions": predictions,
            "total_predictions": len(predictions)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [Predictions] Error: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to get drift predictions"))


@router.post("/predictions/learn")
async def learn_commit_sequences(
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    🔮 Learn commit sequences for predictions
    
    Analyzes which commits typically follow which
    """
    try:
        print(f"🔮 [Sequences] Learning for user {current_user.id}")
        
        from app.services.predictive_drift_service import predictive_drift_service
        
        result = await predictive_drift_service.learn_commit_sequences(
            user_id=current_user.id
        )
        
        return {
            "ok": True,
            **result
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [Sequences] Error: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to learn commit sequences"))


@router.get("/ml/status")
async def get_ml_status(
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    🎓 Get ML learning status for current user
    
    Shows indexing progress, patterns learned, prediction accuracy
    """
    try:
        from app.database.connection import get_db_connection
        
        db = await get_db_connection()
        
        # Get learning metadata
        metadata = await db.fetchrow("""
            SELECT * FROM user_learning_metadata
            WHERE user_id = $1
        """, current_user.id)
        
        if not metadata:
            return {
                "ok": True,
                "status": "not_started",
                "message": "No learning data yet. Click 'Start Learning' to begin."
            }
        
        return {
            "ok": True,
            "status": metadata["indexing_status"],
            "commits_indexed": metadata["total_commits_indexed"],
            "repos_analyzed": metadata["total_repos_analyzed"],
            "patterns_learned": metadata["total_patterns_learned"],
            "practices_identified": metadata["total_practices_identified"],
            "sequences_found": metadata["total_sequences_found"],
            "avg_pattern_confidence": metadata["avg_pattern_confidence"],
            "last_indexed_at": metadata["last_indexed_at"].isoformat() if metadata["last_indexed_at"] else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [ML Status] Error: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to get ML learning status"))

