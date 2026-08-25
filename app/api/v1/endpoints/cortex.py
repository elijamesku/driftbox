"""
Driftbox Cortex - Intelligence endpoint showing what Driftbox has learned about the codebase
Uses Voyage AI embeddings + FAISS for instant semantic analysis
"""
from fastapi import APIRouter, Depends, HTTPException
from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.utils.errors import sanitize_error_detail
from datetime import datetime
from typing import Dict, Any, List, Optional
import re
import requests
import base64
from collections import Counter
import os
import glob
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from app.rag.retrieve import execute_semantic_search
from app.config import RAG_INDEX_DIRECTORY

router = APIRouter()


def fetch_github_file_content(owner: str, repo: str, path: str, token: str) -> str:
    """Fetch file content from GitHub API"""
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json"
    }
    
    response = requests.get(url, headers=headers, timeout=30)
    if not response.ok:
        return ""
    
    data = response.json()
    if data.get("encoding") == "base64":
        content = base64.b64decode(data["content"]).decode("utf-8")
        return content
    
    return data.get("content", "")


def get_branch_sha(owner: str, repo: str, token: str, branch: str) -> Optional[str]:
    """Get the SHA of a branch by name"""
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json"
    }
    
    # Try to get branch ref
    url = f"https://api.github.com/repos/{owner}/{repo}/git/ref/heads/{branch}"
    response = requests.get(url, headers=headers, timeout=30)
    
    if response.ok:
        data = response.json()
        return data.get("object", {}).get("sha")
    
    return None


def fetch_github_tree(owner: str, repo: str, token: str, branch: str = "main") -> List[Dict]:
    """Fetch repository file tree from GitHub API with automatic branch detection"""
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json"
    }
    
    # First, try to get the branch SHA (more reliable than using branch name directly)
    branch_sha = get_branch_sha(owner, repo, token, branch)
    tree_ref = branch_sha if branch_sha else branch
    
    # Try the specified branch/SHA first
    url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{tree_ref}?recursive=1"
    response = requests.get(url, headers=headers, timeout=30)
    
    # If 404, try common branch names (main/master) before API call
    if response.status_code == 404:
        print(f"⚠️ [Cortex] Branch '{branch}' (SHA: {tree_ref}) not found, trying alternate branches...")
        # Try 'master' if 'main' was specified, or vice versa
        alternate_branch = "master" if branch == "main" else "main"
        alt_sha = get_branch_sha(owner, repo, token, alternate_branch)
        alt_ref = alt_sha if alt_sha else alternate_branch
        alt_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{alt_ref}?recursive=1"
        alt_response = requests.get(alt_url, headers=headers, timeout=30)
        
        if alt_response.ok:
            print(f"✅ [Cortex] Using alternate branch '{alternate_branch}' (SHA: {alt_ref}) instead of '{branch}'")
            data = alt_response.json()
            return data.get("tree", [])
        
        # If both fail, try to get the default branch from API
        repo_url = f"https://api.github.com/repos/{owner}/{repo}"
        repo_response = requests.get(repo_url, headers=headers, timeout=30)
        
        if repo_response.ok:
            repo_data = repo_response.json()
            default_branch = repo_data.get("default_branch", "master")
            
            # Try with default branch SHA
            default_sha = get_branch_sha(owner, repo, token, default_branch)
            default_ref = default_sha if default_sha else default_branch
            url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{default_ref}?recursive=1"
            response = requests.get(url, headers=headers, timeout=30)
            
            if response.ok:
                print(f"✅ [Cortex] Using default branch '{default_branch}' (SHA: {default_ref}) instead of '{branch}'")
    
    if not response.ok:
        error_msg = f"Failed to fetch repo tree: {response.status_code} - {response.text}"
        print(f"❌ [Cortex] {error_msg}")
        return []
    
    data = response.json()
    tree = data.get("tree", [])
    print(f"✅ [Cortex] Fetched {len(tree)} items from GitHub tree")
    return tree


def analyze_terraform_file(content: str) -> List[Dict[str, str]]:
    """Parse Terraform file and extract resource definitions"""
    resources = []
    # Match resource blocks: resource "type" "name" {
    pattern = r'resource\s+"([^"]+)"\s+"([^"]+)"\s*\{'
    matches = re.finditer(pattern, content)
    
    for match in matches:
        resources.append({
            'type': match.group(1),
            'name': match.group(2)
        })
    
    return resources


def scan_local_repository(repo_path: str) -> tuple[List[Dict[str, str]], List[str], int]:
    """
    Scan local repository for Terraform files (FAST!)
    Returns: (all_resources, tf_files, total_lines)
    """
    all_resources = []
    tf_files = []
    total_lines = 0
    
    # Debug: List all files in repo to see what's there
    try:
        all_files = []
        for root, dirs, files in os.walk(repo_path):
            # Skip .git directory
            dirs[:] = [d for d in dirs if d != '.git']
            for file in files:
                rel_path = os.path.relpath(os.path.join(root, file), repo_path)
                all_files.append(rel_path)
        print(f"🔍 [Cortex Local] Total files in repo: {len(all_files)}")
        print(f"🔍 [Cortex Local] Sample files: {all_files[:10]}{'...' if len(all_files) > 10 else ''}")
    except Exception as e:
        print(f"⚠️ [Cortex Local] Could not list files: {e}")
    
    # Find all .tf files recursively
    tf_file_paths = glob.glob(os.path.join(repo_path, "**/*.tf"), recursive=True)
    print(f"🔍 [Cortex Local] Found {len(tf_file_paths)} .tf files via glob: {tf_file_paths[:5]}{'...' if len(tf_file_paths) > 5 else ''}")
    
    # Also try without ** pattern in case glob isn't working as expected
    if not tf_file_paths:
        # Try alternative: walk the directory manually
        print(f"⚠️ [Cortex Local] Glob found no files, trying manual walk...")
        for root, dirs, files in os.walk(repo_path):
            # Skip .git directory
            dirs[:] = [d for d in dirs if d != '.git']
            for file in files:
                if file.endswith('.tf'):
                    full_path = os.path.join(root, file)
                    if full_path not in tf_file_paths:
                        tf_file_paths.append(full_path)
        print(f"🔍 [Cortex Local] Manual walk found {len(tf_file_paths)} .tf files: {[os.path.relpath(p, repo_path) for p in tf_file_paths[:5]]}")
    
    for tf_path in tf_file_paths:
        try:
            with open(tf_path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Store relative path
            rel_path = os.path.relpath(tf_path, repo_path)
            tf_files.append(rel_path)
            
            # Count lines
            total_lines += len(content.split('\n'))
            
            # Analyze resources
            resources = analyze_terraform_file(content)
            all_resources.extend(resources)
        except Exception as e:
            print(f"Error scanning local file {tf_path}: {e}")
            continue
    
    return all_resources, tf_files, total_lines


def fetch_github_file_parallel(owner: str, repo: str, path: str, token: str) -> tuple[str, str, int]:
    """
    Fetch file content from GitHub API - Returns (path, content, line_count)
    """
    try:
        content = fetch_github_file_content(owner, repo, path, token)
        if content:
            line_count = len(content.split('\n'))
            return path, content, line_count
    except Exception as e:
        print(f"Error fetching {path}: {e}")
    
    return path, "", 0


def analyze_with_rag(resources: List[Dict[str, str]], repo_name: str) -> tuple[List[str], List[str], List[str]]:
    """
    Use Voyage AI + FAISS to get intelligent insights (FAST!)
    Returns: (patterns, common_deps, recommendations)
    """
    try:
        resource_types = [r['type'] for r in resources]
        resource_summary = f"Repository {repo_name} contains these AWS resources: {', '.join(set(resource_types[:20]))}"
        
        # Query 1: Detect patterns using RAG (semantic understanding)
        pattern_query = f"What infrastructure patterns are indicated by these AWS resources: {', '.join(set(resource_types[:10]))}?"
        pattern_results = execute_semantic_search(pattern_query, RAG_INDEX_DIRECTORY, top_k_results=3)
        
        # Query 2: Get dependency recommendations
        dep_query = f"What are common dependencies for {resource_types[0] if resource_types else 'AWS infrastructure'}?"
        dep_results = execute_semantic_search(dep_query, RAG_INDEX_DIRECTORY, top_k_results=3)
        
        # Query 3: Get best practice recommendations
        rec_query = f"What are best practices for {', '.join(set(resource_types[:5]))}?"
        rec_results = execute_semantic_search(rec_query, RAG_INDEX_DIRECTORY, top_k_results=3)
        
        # Extract insights from RAG results
        patterns = []
        for result in pattern_results:
            text = result['text'][:200]  # First 200 chars
            if any(keyword in text.lower() for keyword in ['vpc', 'network', 'compute', 'database', 'storage']):
                patterns.append(text.split('.')[0] + '.')
        
        # Fallback to rule-based if RAG doesn't return good results
        if not patterns:
            patterns = detect_patterns(resources)[:3]
        
        # Get common dependencies
        common_deps = get_common_dependencies(resources)
        
        # Get recommendations
        recommendations = generate_recommendations(resources, patterns)
        
        print(f"✅ [Cortex RAG] Generated insights using Voyage AI embeddings")
        return patterns[:4], common_deps[:5], recommendations[:4]
        
    except Exception as e:
        print(f"⚠️ [Cortex RAG] RAG analysis failed, using fallback: {e}")
        # Fallback to rule-based
        return detect_patterns(resources)[:4], get_common_dependencies(resources)[:5], generate_recommendations(resources, [])[:4]


def detect_patterns(resources: List[Dict[str, str]]) -> List[str]:
    """Detect common infrastructure patterns from resources"""
    patterns = []
    resource_types = [r['type'] for r in resources]
    
    # VPC pattern
    if 'aws_vpc' in resource_types:
        has_subnet = 'aws_subnet' in resource_types
        has_igw = 'aws_internet_gateway' in resource_types
        has_rt = 'aws_route_table' in resource_types
        
        if has_subnet and has_igw and has_rt:
            patterns.append("Complete VPC setup with networking (subnet, IGW, route tables)")
        elif has_subnet:
            patterns.append("Basic VPC with subnets configured")
    
    # EC2/Compute pattern
    if 'aws_instance' in resource_types or 'aws_launch_template' in resource_types:
        if 'aws_security_group' in resource_types:
            patterns.append("Compute resources with security groups properly configured")
        if 'aws_autoscaling_group' in resource_types:
            patterns.append("Auto-scaling infrastructure for high availability")
    
    # Database pattern
    if 'aws_db_instance' in resource_types or 'aws_rds_cluster' in resource_types:
        if 'aws_db_subnet_group' in resource_types:
            patterns.append("Multi-AZ database setup with subnet groups")
        patterns.append("Managed database infrastructure (RDS)")
    
    # Container pattern
    if 'aws_ecs_cluster' in resource_types or 'aws_eks_cluster' in resource_types:
        if 'aws_ecs_service' in resource_types:
            patterns.append("Container orchestration with ECS services")
        if 'aws_eks_node_group' in resource_types:
            patterns.append("Kubernetes infrastructure (EKS) with managed node groups")
    
    # Load balancer pattern
    if 'aws_lb' in resource_types or 'aws_alb' in resource_types:
        patterns.append("Load balancer for distributing traffic across resources")
    
    # Serverless pattern
    if 'aws_lambda_function' in resource_types:
        if 'aws_iam_role' in resource_types:
            patterns.append("Serverless functions with proper IAM permissions")
        if 'aws_api_gateway_rest_api' in resource_types:
            patterns.append("API Gateway + Lambda serverless architecture")
    
    # Storage pattern
    if 'aws_s3_bucket' in resource_types:
        if 'aws_s3_bucket_versioning' in resource_types:
            patterns.append("S3 storage with versioning enabled for backup/recovery")
        if 'aws_s3_bucket_server_side_encryption_configuration' in resource_types:
            patterns.append("Encrypted S3 storage following security best practices")
    
    # Security pattern
    sg_count = resource_types.count('aws_security_group')
    if sg_count >= 3:
        patterns.append(f"Network security with {sg_count} security groups for isolation")
    
    return patterns


def get_common_dependencies(resources: List[Dict[str, str]]) -> List[str]:
    """Extract common resource dependencies"""
    dependencies = []
    resource_types = [r['type'] for r in resources]
    
    # Count occurrences
    type_counter = Counter(resource_types)
    
    # Get top dependencies (resources used multiple times or frequently referenced)
    common = ['aws_vpc', 'aws_subnet', 'aws_security_group', 'aws_iam_role', 'aws_db_subnet_group']
    
    for dep in common:
        if dep in resource_types:
            count = type_counter[dep]
            dependencies.append(f"{dep} (used {count}x)")
    
    return dependencies[:5]  # Top 5


def generate_recommendations(resources: List[Dict[str, str]], patterns: List[str]) -> List[str]:
    """Generate recommendations based on what's detected"""
    recommendations = []
    resource_types = [r['type'] for r in resources]
    
    # Check for missing encryption
    if 'aws_s3_bucket' in resource_types and 'aws_s3_bucket_server_side_encryption_configuration' not in resource_types:
        recommendations.append("Consider enabling S3 bucket encryption for enhanced security")
    
    # Check for missing versioning
    if 'aws_s3_bucket' in resource_types and 'aws_s3_bucket_versioning' not in resource_types:
        recommendations.append("Enable S3 versioning to protect against accidental deletions")
    
    # Check for monitoring
    if ('aws_instance' in resource_types or 'aws_db_instance' in resource_types) and 'aws_cloudwatch_metric_alarm' not in resource_types:
        recommendations.append("Add CloudWatch alarms for monitoring critical resources")
    
    # Check for backup
    if 'aws_db_instance' in resource_types:
        recommendations.append("Ensure automated backups are enabled for RDS instances")
    
    # Check for tags
    if len(resources) > 5:
        recommendations.append("Use consistent tagging across all resources for better organization")
    
    # Check for multi-AZ
    if 'aws_db_instance' in resource_types and 'Multi-AZ database' not in ' '.join(patterns):
        recommendations.append("Consider enabling Multi-AZ for RDS to improve availability")
    
    return recommendations[:4]  # Top 4


@router.get("/insights/{owner}/{repo}")
async def get_cortex_insights(
    owner: str,
    repo: str,
    branch: str = "main",
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Analyze repository and return insights about learned infrastructure patterns
    Optimized: Tries local scan first (instant), falls back to parallel GitHub API
    """
    try:
        # Get user's GitHub token
        if not current_user.github_access_token:
            raise HTTPException(status_code=401, detail="GitHub token required")
        
        token = current_user.github_access_token
        all_resources = []
        tf_files = []
        total_lines = 0
        scan_method = "github"
        
        # Try local scanning first (FAST! ~50ms for large repos)
        # NOTE: Local scan uses whatever branch is currently checked out locally
        # For branch-specific scans, we should use GitHub API instead
        home_dir = Path.home()
        local_repo_path = home_dir / '.infrara' / 'repos' / owner / repo
        
        # Only use local scan if we're scanning the default branch or if local repo doesn't exist
        # Otherwise, use GitHub API to ensure we get the correct branch
        use_local_scan = False
        if local_repo_path.exists() and (local_repo_path / '.git').exists():
            # Check what branch the local repo is on
            import subprocess
            try:
                result = subprocess.run(
                    ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
                    cwd=str(local_repo_path),
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                local_branch = result.stdout.strip() if result.returncode == 0 else None
                print(f"🔍 [Cortex] Local repo branch: {local_branch}, requested branch: {branch}")
                
                # Only use local scan if branches match (or if we can't determine local branch)
                if local_branch == branch or local_branch is None:
                    use_local_scan = True
                    print(f"🚀 [Cortex] Using local scan (branch matches or unknown)")
                else:
                    print(f"⚠️ [Cortex] Local branch ({local_branch}) doesn't match requested ({branch}), using GitHub API")
            except Exception as e:
                print(f"⚠️ [Cortex] Could not check local branch, using GitHub API: {e}")
        
        if use_local_scan:
            print(f"🚀 [Cortex] Local scan for {owner}/{repo} at {local_repo_path}")
            print(f"🔍 [Cortex] Checking if path exists: {local_repo_path.exists()}")
            if local_repo_path.exists():
                print(f"🔍 [Cortex] Path contents: {list(local_repo_path.iterdir())[:10]}")
            all_resources, tf_files, total_lines = scan_local_repository(str(local_repo_path))
            
            # If local scan found no Terraform files, fall back to GitHub API
            # This handles cases where local repo is out of sync or on wrong branch
            if not tf_files:
                print(f"⚠️ [Cortex] Local scan found 0 Terraform files, falling back to GitHub API for branch {branch}")
                use_local_scan = False
                scan_method = "github"
            else:
                scan_method = "local"
                print(f"📄 [Cortex] Local scan result: {len(tf_files)} Terraform files, {len(all_resources)} resources, {total_lines} lines")
                print(f"📄 [Cortex] Files: {tf_files[:5]}{'...' if len(tf_files) > 5 else ''}")
        
        if not use_local_scan:
            # Fall back to GitHub API with parallel fetching (FASTER! ~2-3s instead of 10s+)
            print(f"🌐 [Cortex] GitHub parallel scan for {owner}/{repo} on branch {branch}")
            tree = fetch_github_tree(owner, repo, token, branch)
            if not tree:
                print(f"❌ [Cortex] Tree is empty or failed to fetch")
                raise HTTPException(status_code=404, detail="Repository not found or empty")
            
            print(f"🔍 [Cortex] Scanning {len(tree)} items in tree for .tf files...")
            
            # Debug: Show sample of tree items
            sample_items = [item.get('path') for item in tree[:10] if item.get('type') == 'blob']
            print(f"🔍 [Cortex] Sample tree items (first 10 blobs): {sample_items}")
            
            # Find all .tf files
            tf_file_paths = [item.get('path') for item in tree 
                            if item.get('type') == 'blob' and item.get('path', '').endswith('.tf')]
            
            print(f"📄 [Cortex] Found {len(tf_file_paths)} Terraform files: {tf_file_paths[:5]}{'...' if len(tf_file_paths) > 5 else ''}")
            
            # Debug: If no .tf files found, show what file types we did find
            if not tf_file_paths:
                file_extensions = {}
                for item in tree:
                    if item.get('type') == 'blob':
                        path = item.get('path', '')
                        ext = path.split('.')[-1] if '.' in path else 'no-ext'
                        file_extensions[ext] = file_extensions.get(ext, 0) + 1
                print(f"⚠️ [Cortex] No .tf files found. File extensions in repo: {dict(sorted(file_extensions.items(), key=lambda x: x[1], reverse=True)[:10])}")
            
            # Check if no Terraform files exist
            if not tf_file_paths:
                return {
                    "noTerraform": True,
                    "message": "NEURAL SCAN COMPLETE: Zero Terraform configurations detected in repository matrix",
                    "suggestion": "This repository appears to operate outside the Infrastructure-as-Code paradigm. Driftbox Cortex specializes in Terraform neural pattern recognition.",
                    "repoStats": {
                        "tfFileCount": 0,
                        "totalLines": 0,
                        "lastScanned": datetime.now().strftime("%Y-%m-%d %H:%M")
                    }
                }
            
            # Fetch all .tf files in parallel (much faster!)
            with ThreadPoolExecutor(max_workers=10) as executor:
                futures = {
                    executor.submit(fetch_github_file_parallel, owner, repo, path, token): path
                    for path in tf_file_paths
                }
                
                for future in as_completed(futures):
                    path, content, line_count = future.result()
                    if content:
                        tf_files.append(path)
                        total_lines += line_count
                        resources = analyze_terraform_file(content)
                        all_resources.extend(resources)
        
        # Check if we found any Terraform files (for local scan)
        if not tf_files:
            return {
                "noTerraform": True,
                "message": "NEURAL SCAN COMPLETE: Zero Terraform configurations detected in repository matrix",
                "suggestion": "This repository appears to operate outside the Infrastructure-as-Code paradigm. Driftbox Cortex specializes in Terraform neural pattern recognition.",
                "repoStats": {
                    "tfFileCount": 0,
                    "totalLines": 0,
                    "lastScanned": datetime.now().strftime("%Y-%m-%d %H:%M")
                }
            }
        
        # Analyze with RAG (Voyage AI + FAISS) - FAST!
        detected_patterns, common_deps, recommendations = analyze_with_rag(all_resources, f"{owner}/{repo}")
        
        # Count resources by type
        resource_by_type = {}
        for resource in all_resources:
            res_type = resource['type']
            resource_by_type[res_type] = resource_by_type.get(res_type, 0) + 1
        
        # Sort by count
        resource_by_type = dict(sorted(resource_by_type.items(), key=lambda x: x[1], reverse=True))
        
        print(f"✅ [Cortex] Scan complete via {scan_method}: {len(tf_files)} files, {len(all_resources)} resources")
        
        return {
            "scannedResources": {
                "total": len(all_resources),
                "byType": resource_by_type
            },
            "detectedPatterns": detected_patterns,
            "dependencies": {
                "total": len(set([r['type'] for r in all_resources])),
                "common": common_deps
            },
            "recommendations": recommendations,
            "repoStats": {
                "tfFileCount": len(tf_files),
                "totalLines": total_lines,
                "lastScanned": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "scanMethod": scan_method
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in cortex insights: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to analyze repository"))

