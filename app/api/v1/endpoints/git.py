# api/v1/endpoints/git.py
import os
import uuid
import subprocess
import requests
import json
import asyncio
import re
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, AsyncGenerator, List, Dict, Tuple
from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.integrations.slack import slack_notifier
from app.services.llm_failover import llm_failover_service
from app.services.terraform_auto_heal import parse_llm_fixes, clean_terraform_code
from app.services.fix_learning_service import fix_learning_service
from app.services.github_actions_service import github_actions_service
from app.services.terraform_state_service import terraform_state_service
from app.services.digitalocean_versions import get_digitalocean_version_service, get_version_hints_for_autoheal

router = APIRouter()


def detect_and_fix_duplicate_resources(workspace: str, validation_errors: List[Dict]) -> Tuple[bool, str]:
    """
    Detect duplicate resource name conflicts and automatically fix them by renaming.
    
    Returns: (fixed: bool, message: str)
    """
    try:
        for diagnostic in validation_errors:
            summary = diagnostic.get('summary', '').lower()
            detail = diagnostic.get('detail', '')
            
            # Check if it's a duplicate resource error
            if 'duplicate' in summary or 'already been declared' in detail.lower():
                # Extract resource type and name from detail
                # Typical format: "A resource \"aws_s3_bucket\" \"my_bucket\" has already been declared..."
                match = re.search(r'resource\s+"([^"]+)"\s+"([^"]+)"', detail)
                if match:
                    resource_type = match.group(1)
                    resource_name = match.group(2)
                    
                    # Find all .tf files and rename the duplicate resource
                    fixed = rename_duplicate_resource(workspace, resource_type, resource_name)
                    if fixed:
                        return True, f"Renamed duplicate {resource_type}.{resource_name} to avoid conflict"
        
        return False, "No duplicate resource conflicts detected"
    except Exception as e:
        return False, f"Error detecting duplicates: {str(e)}"


def scan_and_fix_all_duplicates(workspace: str) -> Tuple[bool, List[str]]:
    """
    Proactively scan all .tf files for duplicate resources and fix them.
    This should be run BEFORE terraform init to prevent init failures.
    
    Returns: (fixed: bool, messages: List[str])
    """
    try:
        tf_files = list(Path(workspace).glob('*.tf'))
        if not tf_files:
            return False, []
        
        # Build a map of all resources: {(type, name): count}
        resource_counts: Dict[Tuple[str, str], int] = {}
        
        for tf_file in tf_files:
            content = tf_file.read_text()
            # Find all resource declarations
            resource_pattern = re.compile(
                r'resource\s+"([^"]+)"\s+"([^"]+)"\s*\{',
                re.MULTILINE
            )
            for match in resource_pattern.finditer(content):
                resource_type = match.group(1)
                resource_name = match.group(2)
                key = (resource_type, resource_name)
                resource_counts[key] = resource_counts.get(key, 0) + 1
        
        # Find duplicates and fix them
        messages = []
        fixed = False
        for (resource_type, resource_name), count in resource_counts.items():
            if count > 1:
                # Duplicate found - rename all but the first occurrence
                success = rename_duplicate_resource(workspace, resource_type, resource_name)
                if success:
                    messages.append(f"Renamed duplicate {resource_type}.{resource_name}")
                    fixed = True
        
        return fixed, messages
    except Exception as e:
        return False, [f"Error scanning for duplicates: {str(e)}"]


def rename_duplicate_resource(workspace: str, resource_type: str, resource_name: str) -> bool:
    """
    Rename a duplicate resource by adding a numbered suffix.
    
    Returns: True if renamed successfully
    """
    try:
        tf_files = list(Path(workspace).glob('*.tf'))
        resource_pattern = re.compile(
            rf'resource\s+"{re.escape(resource_type)}"\s+"{re.escape(resource_name)}"\s*\{{',
            re.MULTILINE
        )
        
        # Find the file containing the duplicate (usually the most recently modified)
        file_with_duplicate = None
        duplicate_count = 0
        
        for tf_file in tf_files:
            content = tf_file.read_text()
            matches = list(resource_pattern.finditer(content))
            duplicate_count += len(matches)
            if len(matches) > 0:
                file_with_duplicate = tf_file
        
        if duplicate_count < 2:
            return False  # Not actually a duplicate
        
        # Find a unique name by trying suffixes
        for i in range(2, 100):
            new_name = f"{resource_name}_{i}"
            # Check if this name already exists
            new_pattern = re.compile(
                rf'resource\s+"{re.escape(resource_type)}"\s+"{re.escape(new_name)}"\s*\{{',
                re.MULTILINE
            )
            
            exists = False
            for tf_file in tf_files:
                if new_pattern.search(tf_file.read_text()):
                    exists = True
                    break
            
            if not exists:
                # Found a unique name, rename the most recent occurrence
                if file_with_duplicate:
                    content = file_with_duplicate.read_text()
                    # Replace the last occurrence (most recent)
                    parts = content.rsplit(f'resource "{resource_type}" "{resource_name}"', 1)
                    if len(parts) == 2:
                        new_content = parts[0] + f'resource "{resource_type}" "{new_name}"' + parts[1]
                        file_with_duplicate.write_text(new_content)
                        return True
                break
        
        return False
    except Exception as e:
        print(f"Error renaming duplicate resource: {e}")
        return False


async def auto_heal_terraform_errors(workspace: str, diagnostics: List[Dict], attempt: int, provided_files: Optional[Dict[str, str]] = None, do_token: Optional[str] = None) -> List[Dict]:
    """
    Use AI to automatically fix Terraform validation errors.
    
    Args:
        workspace: Path to workspace with .tf files
        diagnostics: List of validation error diagnostics from terraform validate -json
        attempt: Current validation attempt number
        provided_files: Optional dict of files provided by desktop client
        do_token: Optional DigitalOcean API token for fetching valid versions
    
    Returns:
        List[Dict]: List of file proposals (path, oldContent, newContent) for frontend diff preview
                    Empty list if unable to fix
    """
    try:
        print(f"🤖 [Auto-Heal] Starting AI auto-heal (attempt {attempt})")
        
        # 1. Extract error details
        error_summary = []
        for d in diagnostics:
            summary = d.get('summary', '')
            detail = d.get('detail', '')
            address = d.get('address', '')
            
            error_info = {
                'summary': summary,
                'detail': detail,
                'address': address,
                'range': d.get('range', {})
            }
            error_summary.append(error_info)
        
        # 2. Read all .tf files
        workspace_path = Path(workspace)
        original_content = {}
        files_content = {}
        
        if provided_files:
            # Desktop mode: files provided by client
            print(f"🖥️  [Auto-Heal] Using {len(provided_files)} files provided by desktop client")
            original_content = provided_files.copy()
            files_content = provided_files.copy()
        elif workspace_path.exists():
            # Server mode: read files from disk
            tf_files = list(workspace_path.glob("**/*.tf"))
            if not tf_files:
                print("⚠️  [Auto-Heal] No .tf files found in workspace")
                return []
            
            for tf_file in tf_files:
                rel_path = tf_file.relative_to(workspace_path)
                content = tf_file.read_text()
                path_str = str(rel_path)
                original_content[path_str] = content
                files_content[path_str] = content
        else:
            print("⚠️  [Auto-Heal] Workspace doesn't exist and no files provided")
            return []
        
        # 3. Build prompt for AI
        # Get recently learned fixes to enhance the prompt
        learned_fixes_summary = fix_learning_service.get_recent_fixes_summary(days=30, limit=5)
        
        # Check for version-related errors and get valid versions from DigitalOcean API
        version_hints = ""
        combined_error_text = " ".join([e.get('detail', '') + e.get('summary', '') for e in error_summary])
        
        # Check if this is a DigitalOcean deployment with version-related errors
        is_do_deployment = any('digitalocean' in content.lower() for content in files_content.values())
        has_version_error = any(term in combined_error_text.lower() for term in [
            'invalid version', 'version slug', 'invalid size', 'size slug', 
            'invalid region', 'region slug', 'validation error'
        ])
        
        if is_do_deployment and has_version_error:
            try:
                print("[Auto-Heal] Detected DigitalOcean version-related error, fetching valid versions...")
                do_version_service = get_digitalocean_version_service()
                
                # Get specific hints based on the error
                specific_hint = await do_version_service.get_fix_hint_for_error(combined_error_text, do_token)
                if specific_hint:
                    version_hints = f"\n**IMPORTANT - VALID OPTIONS:**\n{specific_hint}\n"
                    print(f"[Auto-Heal] Got version hint: {specific_hint[:100]}...")
                else:
                    # Get comprehensive version summary
                    all_versions = await do_version_service.get_all_versions_summary(do_token)
                    version_hints = f"\n**IMPORTANT - VALID DIGITALOCEAN OPTIONS:**\n{all_versions}\n"
                    print(f"[Auto-Heal] Got comprehensive version info")
            except Exception as e:
                print(f"[Auto-Heal] Warning: Could not fetch DO versions: {e}")
                import traceback
                traceback.print_exc()
        
        system_prompt = f"""You are a Terraform expert that fixes validation errors in infrastructure code (AWS and DigitalOcean).

**CRITICAL: JSON POLICY SYNTAX**
ANY field containing JSON (policy, assume_role_policy, container_definitions, etc.) MUST use jsonencode():

WRONG (causes "Invalid multi-line string" error):
```
policy = "{{
  \\"Version\\": \\"2012-10-17\\",
  ...
}}"
```

CORRECT:
```
policy = jsonencode({{
  "Version": "2012-10-17",
  ...
}})
```

**CRITICAL: DUPLICATE RESOURCE NAMES**
ALWAYS check for duplicate resource blocks across ALL files:
- Scan EVERY file for resource blocks with pattern: `resource "type" "name"`
- If you find `resource "aws_s3_bucket" "logs"` in MULTIPLE files → RENAME duplicates
- Rename strategy: Add suffix like `_2`, `_backup`, `_secondary`, etc.
- Example: Change second `resource "aws_s3_bucket" "logs"` to `resource "aws_s3_bucket" "logs_secondary"`
- Update ALL references to renamed resources (e.g., `aws_s3_bucket.logs.id` → `aws_s3_bucket.logs_secondary.id`)

**CRITICAL: UNIQUE RESOURCE VALUES**
When fixing duplicate resource names, ALSO fix duplicate values inside:
- S3 bucket names MUST be globally unique: Change bucket = "my-bucket" to bucket = "my-bucket-1", "my-bucket-2", etc.
- IAM role names must be unique: Change name = "app-role" to name = "app-role-1", "app-role-2"
- **DigitalOcean VPC names** must be unique in the account: If error says "VPC name(s) already exist", either (1) rename the `name` attribute to a unique value (e.g. add suffix like `-prod` or `-abc123`), or (2) convert to a data source: `data "digitalocean_vpc" "label" {{ name = "existing-name" }}` and update references to `data.digitalocean_vpc.label`
- Example: If you have aws_s3_bucket.main_1 and aws_s3_bucket.main_2, their bucket values must ALSO be different

**CRITICAL: DIGITALOCEAN VERSION ERRORS**
When you see "invalid version slug" or similar version errors for DigitalOcean resources:
- **NEVER guess version numbers** - only use versions from the VALID OPTIONS list provided
- For Kubernetes: Use the exact slug format provided (e.g., "1.31.1-do.5", NOT "1.31" or "1.31.1")
- For databases: Use the exact version string provided
- For droplet sizes: Use the exact slug provided (e.g., "s-2vcpu-2gb")
- If no valid versions are provided, use a data source to fetch dynamically:
  ```
  data "digitalocean_kubernetes_versions" "available" {{
    version_prefix = "1.31."
  }}
  # Then use: data.digitalocean_kubernetes_versions.available.latest_version
  ```

**COMMON TERRAFORM FIXES:**
- "Invalid multi-line string" → ALWAYS use jsonencode() for JSON values OR heredoc syntax
- "Unterminated template string" → Missing jsonencode() OR incorrect heredoc syntax
- **HEREDOC SYNTAX (for user_data, scripts, etc.):**
  * WRONG: `user_data = "<<-EOF\n...EOF"` (quotes around heredoc!)
  * CORRECT: `user_data = <<-EOF\n...\nEOF` (NO quotes!)
- **DUPLICATE RESOURCES** → Scan ALL files, rename duplicates with unique suffixes
- "Unsupported argument" → Check provider docs, argument might not exist
  * COMMON: "db_subnet_group_name" for aws_redshift_cluster → Use "cluster_subnet_group_name"
  * COMMON: Invalid argument → Remove it completely if it doesn't exist
- "Missing required argument" → Add the required field with appropriate value
- **"invalid version slug"** → Use ONLY the valid versions provided in the error context, or use a data source
- **"Reference to undeclared resource"** → Two scenarios:
  * If missing aws_subnet.public_1 / public_2: ALBs need 2+ subnets in different AZs - CREATE them
  * Example: aws_subnet.public_1 (cidr: 10.0.1.0/24, AZ: us-east-1a) and aws_subnet.public_2 (cidr: 10.0.2.0/24, AZ: us-east-1b)
  * If other missing resource: Either CREATE the resource or FIX the reference to use correct name
  * **IMPORTANT:** If missing `random_id` or `random_string` resource - ADD the hashicorp/random provider and CREATE the resource
  * Example for random_id:
    ```
    terraform {{
      required_providers {{
        random = {{ source = "hashicorp/random", version = "~> 3.0" }}
      }}
    }}
    resource "random_id" "bucket_suffix" {{
      byte_length = 8
    }}
    ```
  * Then reference as: `random_id.bucket_suffix.hex`
- Attribute vs Block → Some fields are blocks (use `key {{ }}`) not attributes (use `key = value`)

**FIX STRATEGY:**
1. FIRST: Scan ALL files for duplicate resource names (same type + name appearing multiple times)
   - Build a map of all resources: `{{"aws_s3_bucket.logs": ["file1.tf:line5", "file2.tf:line12"]}}`
   - If any resource appears > 1 time → Rename duplicates with unique suffixes
   - Update references across all files
2. Read the error message - it tells you EXACTLY what's wrong and where
3. If error mentions "multi-line string" or "unterminated":
   - For JSON (policy, assume_role_policy, etc.) → USE JSONENCODE()
   - For user_data/scripts → REMOVE QUOTES from heredoc (user_data = <<-EOF not "<<-EOF")
4. Check if argument name is correct for that resource type
5. Remove invalid arguments that don't exist in AWS provider
6. Use jsonencode() for ALL policy/JSON fields
7. Use heredoc WITHOUT QUOTES for user_data/scripts

**OUTPUT FORMAT:**
FILENAME: path/to/file.tf
[complete fixed HCL code for this file]

FILENAME: another/file.tf
[complete fixed HCL code for this file]

**RULES:**
- Output ONLY fixed files (not all files)
- NO markdown, NO explanations, ONLY HCL code
- Preserve all working code
- Fix ALL mentioned errors
- ALWAYS use jsonencode() for policy fields

{learned_fixes_summary}"""

        error_details = "\n".join([
            f"- {e['summary']}: {e['detail']} (at {e.get('address', 'unknown')})"
            for e in error_summary
        ])
        
        files_listing = "\n\n".join([
            f"FILE: {path}\n```hcl\n{content}\n```"
            for path, content in files_content.items()
        ])
        
        user_prompt = f"""**Terraform Validation Errors to Fix:**
{error_details}
{version_hints}
**Current Terraform Files:**
{files_listing}

**Instructions:**
1. **FIRST**: Scan ALL files above for duplicate resource blocks (same `resource "type" "name"` appearing multiple times)
   - If found, rename duplicates with unique suffixes and update ALL references
2. Analyze each error message - it tells you the exact file, line, and what's wrong
3. For "Unsupported argument" errors: Remove the invalid argument or rename it to the correct provider argument name
4. For "Invalid multi-line string" errors: Wrap the JSON with jsonencode()
5. For "Missing required" errors: Add the required field
6. **For "invalid version" errors**: Use ONLY the valid versions listed above - do NOT guess version numbers!
7. Output ONLY the files that need changes, with complete fixed code

Fix all errors above (including any duplicate resources) and output the corrected Terraform files."""

        # 4. Call LLM (non-streaming)
        print(f"🤖 [Auto-Heal] Calling AI to generate fixes...")
        
        try:
            full_response = await llm_failover_service.create_completion(
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                max_tokens=8192,  # Increased for complex multi-file fixes
                temperature=0.1  # Low temperature for precise fixes
            )
        except Exception as llm_error:
            print(f"❌ [Auto-Heal] LLM error: {llm_error}")
            return []
        
        if not full_response or not full_response.strip():
            print("⚠️  [Auto-Heal] No response from AI")
            return []
        
        # 5. Parse response and generate file proposals
        print(f"🔧 [Auto-Heal] Parsing AI fixes...")
        print(f"📄 [Auto-Heal] LLM Response preview: {full_response[:500]}...")
        
        # Use robust parser to extract file sections
        file_sections = parse_llm_fixes(full_response)
        print(f"📦 [Auto-Heal] Found {len(file_sections)} file sections in response")
        
        # Debug: Log original file paths for troubleshooting path mismatch issues
        print(f"📂 [Auto-Heal] Original file paths: {list(original_content.keys())}")
        
        def find_matching_path(ai_filename: str, original_paths: dict) -> str | None:
            """
            Find the matching original file path for an AI-output filename.
            Handles cases where AI outputs just 'kubernetes.tf' but original was 'project/kubernetes.tf'.
            """
            # Exact match first
            if ai_filename in original_paths:
                return ai_filename
            
            # Try to find by basename match (handles directory prefixes)
            ai_basename = ai_filename.split('/')[-1]
            matches = []
            for original_path in original_paths.keys():
                original_basename = original_path.split('/')[-1]
                if original_basename == ai_basename:
                    matches.append(original_path)
            
            if len(matches) == 1:
                print(f"🔗 [Auto-Heal] Mapped AI path '{ai_filename}' → original path '{matches[0]}'")
                return matches[0]
            elif len(matches) > 1:
                # Multiple matches - prefer the shortest path (closest to root)
                shortest = min(matches, key=len)
                print(f"🔗 [Auto-Heal] Multiple matches for '{ai_filename}', using shortest: '{shortest}'")
                return shortest
            
            return None
        
        file_proposals = []
        for section in file_sections:
            ai_filename = section['path']
            fixed_code = clean_terraform_code(section['content'])
            
            # Try to find matching original file path (handles path mismatches)
            filename = find_matching_path(ai_filename, original_content)
            
            # Check if file exists - UPDATE or CREATE accordingly
            if filename:
                # EXISTING FILE - check if actually changed
                old_content = original_content[filename]
                
                if old_content.strip() != fixed_code.strip():
                    # Learn from this fix!
                    try:
                        # Extract resource type from filename or code
                        resource_type = None
                        resource_match = re.search(r'resource\s+"([^"]+)"', fixed_code)
                        if resource_match:
                            resource_type = resource_match.group(1)
                        
                        # Combine all error messages for context
                        combined_errors = "\n".join([e['summary'] + ": " + e['detail'] for e in error_summary])
                        
                        # Learn from the fix
                        fix_learning_service.learn_from_fix(
                            error_message=combined_errors,
                            old_code=old_content,
                            new_code=fixed_code,
                            resource_type=resource_type
                        )
                    except Exception as learn_error:
                        print(f"⚠️  [Auto-Heal] Failed to learn from fix: {learn_error}")
                    
                    # Create file proposal for frontend diff
                    file_proposals.append({
                        "action": "update",
                        "path": filename,
                        "oldContent": old_content,
                        "newContent": fixed_code + "\n",
                        "description": f"AI auto-fix: {filename}"
                    })
                    
                    # Write fix to disk ONLY if server can access workspace
                    if workspace_path.exists() and not provided_files:
                        target_file = workspace_path / filename
                        print(f"  ✅ Applying AI fix to: {filename}")
                        target_file.write_text(fixed_code + "\n")
                    else:
                        print(f"  📋 Generated fix proposal for: {filename} (desktop client will apply)")
                else:
                    print(f"  ⏭️  No changes needed for: {filename}")
            else:
                # NEW FILE - AI is creating a missing resource file (e.g., random.tf for random_id)
                # Use the AI's filename since it doesn't exist in original files
                filename = ai_filename
                print(f"  🆕 [Auto-Heal] Creating new file: {filename} (not found in original paths)")
                
                # Create file proposal for frontend diff
                file_proposals.append({
                    "action": "create",
                    "path": filename,
                    "oldContent": "",
                    "newContent": fixed_code + "\n",
                    "description": f"AI auto-fix: Create {filename} (missing resource)"
                })
                
                # Write new file to disk ONLY if server can access workspace
                if workspace_path.exists() and not provided_files:
                    target_file = workspace_path / filename
                    target_file.parent.mkdir(parents=True, exist_ok=True)
                    print(f"  ✅ Creating new file: {filename}")
                    target_file.write_text(fixed_code + "\n")
                else:
                    print(f"  📋 Generated create proposal for: {filename} (desktop client will apply)")
        
        if file_proposals:
            print(f"✅ [Auto-Heal] Generated {len(file_proposals)} fix proposals")
            return file_proposals
        else:
            print("⚠️  [Auto-Heal] No fixes could be applied")
            return []
            
    except Exception as e:
        print(f"❌ [Auto-Heal] Error during auto-heal: {e}")
        import traceback
        traceback.print_exc()
        return []


class AutoHealRequest(BaseModel):
    workspace_path: str
    diagnostics: List[Dict]
    repo_owner: str
    repo_name: str
    files: Optional[Dict[str, str]] = None  # For desktop mode: {filename: content}


@router.post("/auto-heal")
async def auto_heal_endpoint(
    req: AutoHealRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Standalone endpoint for AI auto-heal.
    Used by desktop/frontend when validation fails.
    
    Returns: List of file proposals (for diff preview) or error
    """
    try:
        print(f"🤖 [Auto-Heal API] Request from {user.email} for {req.repo_owner}/{req.repo_name}")
        print(f"🤖 [Auto-Heal API] Workspace: {req.workspace_path}")
        print(f"🤖 [Auto-Heal API] Diagnostics: {len(req.diagnostics)} errors")
        
        # Call the auto-heal function
        file_proposals = await auto_heal_terraform_errors(
            workspace=req.workspace_path,
            diagnostics=req.diagnostics,
            attempt=1,
            provided_files=req.files
        )
        
        if file_proposals:
            return {
                "success": True,
                "fixes": file_proposals,
                "message": f"Generated {len(file_proposals)} fixes"
            }
        else:
            return {
                "success": False,
                "fixes": [],
                "message": "Unable to generate fixes"
            }
    
    except Exception as e:
        print(f"❌ [Auto-Heal API] Error: {e}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "fixes": [],
            "error": str(e)
        }


class ApprovalRequest(BaseModel):
    workspace_path: str
    commit_message: Optional[str] = None  # Auto-generated if not provided
    repo_owner: Optional[str] = None  # Auto-detected from git remote
    repo_name: Optional[str] = None  # Auto-detected from git remote
    base_branch: Optional[str] = "main"
    target_branch: Optional[str] = None  # User can specify, otherwise auto-generated


class ApprovalResponse(BaseModel):
    success: bool
    pr_url: Optional[str] = None
    branch_name: Optional[str] = None
    validation_output: Optional[str] = None
    error: Optional[str] = None


@router.post("/approve/stream", tags=["git"])
async def approve_and_create_pr_stream(
    req: ApprovalRequest,
    request: Request,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Approve Terraform changes and create GitHub PR with real-time streaming updates.
    
    Streams progress:
    - "🔍 Detecting repository..."
    - "🔧 Running terraform init..."
    - "✔️  Running terraform validate..."
    - "📤 Pushing to GitHub..."
    - "🎉 PR created!"
    
    Returns: text/event-stream with JSON events
    """
    async def generate_stream() -> AsyncGenerator[str, None]:
        try:
            workspace = req.workspace_path
            
            # Security check
            if not os.path.exists(workspace):
                yield f"data: {json.dumps({'type': 'error', 'message': f'Workspace not found: {workspace}'})}\n\n"
                return
            
            # Step 0: Auto-detect repo info
            yield f"data: {json.dumps({'type': 'status', 'message': '🔍 Detecting repository...'})}\n\n"
            await asyncio.sleep(0.1)
            
            detected_owner = None
            detected_repo = None
            
            # Try to get git remote from workspace first
            try:
                remote_url_result = subprocess.run(
                    ["git", "config", "--get", "remote.origin.url"],
                    cwd=workspace,
                    capture_output=True,
                    text=True,
                    check=True
                )
                remote_url = remote_url_result.stdout.strip()
                
                import re
                match = re.search(r'github\.com[:/]([^/]+)/(.+?)(?:\.git)?$', remote_url)
                if match:
                    detected_owner = match.group(1)
                    detected_repo = match.group(2)
                    yield f"data: {json.dumps({'type': 'status', 'message': f'✅ Detected repo: {detected_owner}/{detected_repo}'})}\n\n"
            except:
                yield f"data: {json.dumps({'type': 'status', 'message': '⚠️  Initializing git repository...'})}\n\n"
                
                try:
                    # Initialize git in workspace
                    subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
                    
                    # Create .gitignore for Terraform
                    gitignore_content = """# Terraform
.terraform/
.terraform.lock.hcl
*.tfstate
*.tfstate.*
*.tfvars
*.tfvars.json
crash.log
crash.*.log
override.tf
override.tf.json
*_override.tf
*_override.tf.json
.terraformrc
terraform.rc
"""
                    gitignore_path = os.path.join(workspace, ".gitignore")
                    with open(gitignore_path, "w") as f:
                        f.write(gitignore_content)
                    
                    # Configure git user
                    subprocess.run(
                        ["git", "config", "user.email", "ai@infrara.dev"],
                        cwd=workspace,
                        capture_output=True
                    )
                    subprocess.run(
                        ["git", "config", "user.name", "Infrara AI"],
                        cwd=workspace,
                        capture_output=True
                    )
                    
                    # Get backend's repo info as default
                    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
                    backend_remote_result = subprocess.run(
                        ["git", "config", "--get", "remote.origin.url"],
                        cwd=backend_dir,
                        capture_output=True,
                        text=True
                    )
                    if backend_remote_result.returncode == 0:
                        backend_remote = backend_remote_result.stdout.strip()
                        match = re.search(r'github\.com[:/]([^/]+)/(.+?)(?:\.git)?$', backend_remote)
                        if match:
                            detected_owner = match.group(1)
                            detected_repo = match.group(2)
                            
                            # Set remote to match backend
                            subprocess.run(
                                ["git", "remote", "add", "origin", backend_remote],
                                cwd=workspace,
                                capture_output=True
                            )
                            
                            yield f"data: {json.dumps({'type': 'status', 'message': f'✅ Using backend repo: {detected_owner}/{detected_repo}'})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'message': f'Failed to initialize git: {str(e)}'})}\n\n"
                    return
            
            # Use provided repo info or detected info
            repo_owner = req.repo_owner or detected_owner
            repo_name = req.repo_name or detected_repo
            
            if not repo_owner or not repo_name:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Could not auto-detect repository. Please provide repo_owner and repo_name.'})}\n\n"
                return
            
            # Auto-generate commit message
            yield f"data: {json.dumps({'type': 'status', 'message': '✍️  Generating commit message...'})}\n\n"
            
            commit_message = req.commit_message
            if not commit_message:
                tf_files = [f for f in os.listdir(workspace) if f.endswith('.tf')]
                if tf_files:
                    resources_found = []
                    for tf_file in tf_files:
                        file_path = os.path.join(workspace, tf_file)
                        with open(file_path, 'r') as f:
                            content = f.read()
                            import re
                            resources = re.findall(r'resource\s+"([^"]+)"\s+"([^"]+)"', content)
                            resources_found.extend([f"{r[0]}.{r[1]}" for r in resources])
                    
                    if resources_found:
                        commit_message = f"Add infrastructure: {', '.join(resources_found[:3])}"
                        if len(resources_found) > 3:
                            commit_message += f" (+{len(resources_found) - 3} more)"
                    else:
                        commit_message = "Update infrastructure configuration"
                else:
                    commit_message = "Update infrastructure configuration"
            
            yield f"data: {json.dumps({'type': 'status', 'message': f'✅ Commit: {commit_message}'})}\n\n"
            
            # Generate branch name
            branch_name = req.target_branch or f"driftbox/terraform-{uuid.uuid4().hex[:8]}"
            yield f"data: {json.dumps({'type': 'status', 'message': f'✅ Branch: {branch_name}'})}\n\n"
            
            # Step 1: Terraform init
            # Check if .tf files exist
            from pathlib import Path
            tf_files = list(Path(workspace).rglob("*.tf"))
            has_tf_files = len(tf_files) > 0
            
            if not has_tf_files:
                yield f"data: {json.dumps({'type': 'status', 'message': '⚠️  No Terraform files found - skipping Terraform operations'})}\n\n"
            else:
                # Pre-scan for duplicate resources and fix them BEFORE terraform init
                yield f"data: {json.dumps({'type': 'status', 'message': f'🔍 Scanning {len(tf_files)} .tf files for duplicates...'})}\n\n"
                fixed, fix_messages = scan_and_fix_all_duplicates(workspace)
                if fixed:
                    for msg in fix_messages:
                        yield f"data: {json.dumps({'type': 'status', 'message': f'🔧 {msg}'})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'status', 'message': '✅ No duplicates found'})}\n\n"
                
                yield f"data: {json.dumps({'type': 'status', 'message': f'🔧 Running terraform init...'})}\n\n"
                
                plugin_cache_dir = os.path.expanduser("~/.terraform.d/plugin-cache")
                os.makedirs(plugin_cache_dir, exist_ok=True)
                
                env = os.environ.copy()
                env["TF_PLUGIN_CACHE_DIR"] = plugin_cache_dir
                
                result = subprocess.run(
                    ["terraform", "init", "-upgrade=false"],
                    cwd=workspace,
                    capture_output=True,
                    text=True,
                    env=env
                )
                if result.returncode != 0:
                    yield f"data: {json.dumps({'type': 'error', 'message': f'terraform init failed: {result.stderr}'})}\n\n"
                    return
                
                yield f"data: {json.dumps({'type': 'status', 'message': '✅ terraform init completed'})}\n\n"
                
                # Step 2: Terraform fmt
                yield f"data: {json.dumps({'type': 'status', 'message': '🎨 Running terraform fmt...'})}\n\n"
                subprocess.run(["terraform", "fmt"], cwd=workspace, capture_output=True, env=env)
                yield f"data: {json.dumps({'type': 'status', 'message': '✅ terraform fmt completed'})}\n\n"
            
            # Step 3: Terraform validate (with automatic duplicate resource resolution)
            if not has_tf_files:
                validation_passed = True  # Skip validation if no .tf files
            else:
                yield f"data: {json.dumps({'type': 'status', 'message': '✔️  Running terraform validate...'})}\n\n"
                
                max_validation_retries = 3
                validation_attempt = 0
                validation_passed = False
                
                while validation_attempt < max_validation_retries and not validation_passed:
                    validation_attempt += 1
                    
                    result = subprocess.run(
                        ["terraform", "validate", "-json"],
                        cwd=workspace,
                        capture_output=True,
                        text=True,
                        env=env,
                        timeout=30
                    )
                    
                    if result.returncode == 0:
                        validation_passed = True
                        yield f"data: {json.dumps({'type': 'status', 'message': '✅ terraform validate passed'})}\n\n"
                        break
                    
                    # Parse JSON output to get error details
                    error_msg = "Unknown validation error"
                    diagnostics = []
                    try:
                        if result.stdout:
                            validate_json = json.loads(result.stdout)
                            if 'diagnostics' in validate_json and validate_json['diagnostics']:
                                diagnostics = validate_json['diagnostics']
                                errors = []
                                for d in diagnostics:
                                    summary = d.get('summary', '')
                                    detail = d.get('detail', '')
                                    errors.append(f"{summary}: {detail}" if summary and detail else (summary or detail))
                                error_msg = '; '.join(errors[:3])  # Show first 3 errors
                                
                                # Try to fix errors using AI auto-heal
                                if validation_attempt < max_validation_retries:
                                    # First try specific fixes (duplicate resources)
                                    fixed, fix_message = detect_and_fix_duplicate_resources(workspace, diagnostics)
                                    if fixed:
                                        yield f"data: {json.dumps({'type': 'status', 'message': f'🔧 Auto-fixing: {fix_message}'})}\n\n"
                                        # Re-run fmt after fixing
                                        subprocess.run(["terraform", "fmt"], cwd=workspace, capture_output=True, env=env)
                                        yield f"data: {json.dumps({'type': 'status', 'message': f'♻️  Retrying validation (attempt {validation_attempt + 1}/{max_validation_retries})...'})}\n\n"
                                        continue  # Retry validation
                                    
                                    # If specific fix didn't work, try AI auto-heal
                                    yield f"data: {json.dumps({'type': 'status', 'message': f'🤖 AI auto-healing validation errors... (attempt {validation_attempt}/{max_validation_retries})'})}\n\n"
                                    ai_fixes = await auto_heal_terraform_errors(workspace, diagnostics, validation_attempt)
                                    if ai_fixes:
                                        # Stream the fixes back to frontend as file proposals
                                        yield f"data: {json.dumps({'type': 'status', 'message': f'✅ AI generated {len(ai_fixes)} fixes - streaming to frontend...'})}\n\n"
                                        
                                        for fix in ai_fixes:
                                            # Send each fix as a file_proposal event (for diff preview)
                                            yield f"data: {json.dumps({'type': 'ai_fix', 'file_proposal': fix})}\n\n"
                                            await asyncio.sleep(0.05)  # Small delay for UI
                                        
                                        # Re-run fmt after AI fix
                                        subprocess.run(["terraform", "fmt"], cwd=workspace, capture_output=True, env=env)
                                        yield f"data: {json.dumps({'type': 'status', 'message': f'♻️  Retrying validation (attempt {validation_attempt + 1}/{max_validation_retries})...'})}\n\n"
                                        continue  # Retry validation
                                    else:
                                        yield f"data: {json.dumps({'type': 'status', 'message': '⚠️  AI auto-heal could not fix errors'})}\n\n"
                    except Exception as e:
                        # If JSON parsing fails, show raw output
                        error_msg = result.stderr or result.stdout or "Validation failed with no output"
                        print(f"[DEBUG] Failed to parse terraform validate JSON: {e}")
                        print(f"[DEBUG] stdout: {result.stdout}")
                        print(f"[DEBUG] stderr: {result.stderr}")
                    
                    # If we get here, validation failed and we couldn't fix it
                    yield f"data: {json.dumps({'type': 'error', 'message': f'terraform validate failed: {error_msg}'})}\n\n"
                    return
                
                if not validation_passed:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'terraform validate failed after multiple retries'})}\n\n"
                    return
            
            # Step 4: Git operations
            yield f"data: {json.dumps({'type': 'status', 'message': '🔄 Syncing with remote...'})}\n\n"
            
            # Ensure git user is configured
            subprocess.run(
                ["git", "config", "user.email", "ai@infrara.dev"],
                cwd=workspace,
                capture_output=True
            )
            subprocess.run(
                ["git", "config", "user.name", "Infrara AI"],
                cwd=workspace,
                capture_output=True
            )
            
            # CRITICAL FIX: Stash changes, pull main, restore changes
            try:
                # Stash current changes (your new files)
                subprocess.run(["git", "add", "."], cwd=workspace, capture_output=True)
                stash_result = subprocess.run(
                    ["git", "stash", "push", "-m", "temp-stash-for-pr"],
                    cwd=workspace,
                    capture_output=True,
                    text=True
                )
                has_stash = "No local changes" not in stash_result.stdout
                
                # Fetch latest from remote
                subprocess.run(["git", "fetch", "origin"], cwd=workspace, capture_output=True)
                
                # Switch to main and pull latest
                subprocess.run(["git", "checkout", req.base_branch or "main"], cwd=workspace, capture_output=True)
                subprocess.run(["git", "pull", "origin", req.base_branch or "main"], cwd=workspace, capture_output=True)
                
                yield f"data: {json.dumps({'type': 'status', 'message': '✅ Synced with remote main'})}\n\n"
                
                # Restore stashed changes
                if has_stash:
                    subprocess.run(["git", "stash", "pop"], cwd=workspace, capture_output=True)
                    yield f"data: {json.dumps({'type': 'status', 'message': '✅ Restored your changes'})}\n\n"
            except:
                # If pull fails (no remote yet), that's ok - continue
                pass
            
            yield f"data: {json.dumps({'type': 'status', 'message': f'🌿 Creating branch: {branch_name}...'})}\n\n"
            
            # Create new branch from fresh main
            subprocess.run(["git", "checkout", "-b", branch_name], cwd=workspace, capture_output=True)
            yield f"data: {json.dumps({'type': 'status', 'message': f'✅ Branch created: {branch_name}'})}\n\n"
            
            # Check if there are changes to commit
            status_check = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=workspace,
                capture_output=True,
                text=True
            )
            
            if not status_check.stdout.strip():
                print(f"❌ [PR-CREATE-STREAM] No changes detected!")
                print(f"   Workspace: {workspace}")
                yield f"data: {json.dumps({'type': 'error', 'message': 'No changes detected in workspace. Files may not have been written to disk.'})}\n\n"
                return
            
            print(f"✅ [PR-CREATE-STREAM] Changes detected: {status_check.stdout[:200]}")
            
            # Stage and commit
            yield f"data: {json.dumps({'type': 'status', 'message': '📝 Committing changes...'})}\n\n"
            subprocess.run(["git", "add", "."], cwd=workspace, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", commit_message],
                cwd=workspace,
                capture_output=True
            )
            yield f"data: {json.dumps({'type': 'status', 'message': '✅ Changes committed'})}\n\n"
            
            # Step 5: Push to GitHub
            yield f"data: {json.dumps({'type': 'status', 'message': '🔑 Authenticating with GitHub...'})}\n\n"
            
            # Use user's GitHub OAuth token
            if not user.github_access_token:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Please authenticate with GitHub first'})}\n\n"
                return
            
            yield f"data: {json.dumps({'type': 'status', 'message': '✅ Authenticated with GitHub'})}\n\n"
            yield f"data: {json.dumps({'type': 'status', 'message': '📤 Pushing to GitHub...'})}\n\n"
            
            # Build authenticated URL
            remote_url = f"https://{user.github_access_token}@github.com/{repo_owner}/{repo_name}.git"
            
            push_result = subprocess.run(
                ["git", "push", remote_url, branch_name],
                cwd=workspace,
                capture_output=True,
                text=True
            )
            
            if push_result.returncode != 0:
                error_msg = f"Git push failed. Error: {push_result.stderr}\n\nStdout: {push_result.stdout}"
                yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"
                return
            
            yield f"data: {json.dumps({'type': 'status', 'message': '✅ Pushed to GitHub'})}\n\n"
            
            # Step 6: Generate GitHub PR creation URL
            yield f"data: {json.dumps({'type': 'status', 'message': '🔗 Generating PR creation link...'})}\n\n"
            
            # Auto-detect default branch
            base_branch = req.base_branch or "main"
            try:
                repo_info_url = f"https://api.github.com/repos/{repo_owner}/{repo_name}"
                repo_response = requests.get(
                    repo_info_url,
                    headers={
                        "Authorization": f"Bearer {user.github_access_token}",
                        "Accept": "application/vnd.github.v3+json"
                    },
                    timeout=5
                )
                if repo_response.status_code == 200:
                    base_branch = repo_response.json().get("default_branch", "main")
            except:
                pass  # Use default
            
            # Generate GitHub compare URL (opens PR creation page)
            pr_url = f"https://github.com/{repo_owner}/{repo_name}/compare/{base_branch}...{branch_name}?expand=1"
            
            yield f"data: {json.dumps({'type': 'status', 'message': '✅ Ready to create PR'})}\n\n"
            
            # Send completion
            response_data = {
                "type": "complete",
                "success": True,
                "pr_url": pr_url,
                "branch_name": branch_name,
                "message": f"🎉 Branch pushed successfully!"
            }
            yield f"data: {json.dumps(response_data)}\n\n"
        
        except subprocess.TimeoutExpired:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Terraform validation timed out after 30 seconds'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Failed: {str(e)}'})}\n\n"
    
    return StreamingResponse(generate_stream(), media_type="text/event-stream")


@router.post("/approve", response_model=ApprovalResponse, tags=["git"])
def approve_and_create_pr(
    req: ApprovalRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Approve Terraform changes and automatically create a GitHub PR.
    
    Workflow:
    1. Auto-detect repo info from git remote
    2. Auto-generate commit message from changed files
    3. Run terraform init, fmt, validate
    4. Commit changes to new branch
    5. Push to GitHub
    6. Create PR via GitHub API
    7. Return PR URL
    
    **Note:** For real-time progress updates, use /approve/stream instead.
    """
    try:
        workspace = req.workspace_path
        
        # Security check - ensure workspace path is valid
        if not os.path.exists(workspace):
            raise HTTPException(status_code=404, detail=f"Workspace not found: {workspace}")
        
        validation_steps = []
        
        # Step 0: Auto-detect repo info from git remote
        validation_steps.append("🔍 Detecting repository information...")
        print(f"[PR-CREATE] Detecting repo info from git remote")
        
        detected_owner = None
        detected_repo = None
        
        # Try to get git remote from workspace first
        try:
            remote_url_result = subprocess.run(
                ["git", "config", "--get", "remote.origin.url"],
                cwd=workspace,
                capture_output=True,
                text=True,
                check=True
            )
            remote_url = remote_url_result.stdout.strip()
            
            # Parse GitHub URL (handles both HTTPS and SSH)
            # Examples:
            # https://github.com/owner/repo.git
            # git@github.com:owner/repo.git
            import re
            match = re.search(r'github\.com[:/]([^/]+)/(.+?)(?:\.git)?$', remote_url)
            if match:
                detected_owner = match.group(1)
                detected_repo = match.group(2)
                validation_steps.append(f"✅ Detected repo from workspace: {detected_owner}/{detected_repo}")
                print(f"[PR-CREATE] Detected from workspace: {detected_owner}/{detected_repo}")
        except:
            # Workspace is not a git repo - clone it properly to have git history
            validation_steps.append("⚠️  Workspace is not a git repository")
            print(f"[PR-CREATE] Workspace not a git repo, need to clone")
            
            # Get backend's repo info
            backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
            backend_remote_result = subprocess.run(
                ["git", "config", "--get", "remote.origin.url"],
                cwd=backend_dir,
                capture_output=True,
                text=True
            )
            
            if backend_remote_result.returncode != 0:
                return ApprovalResponse(
                    success=False,
                    error="Could not detect repository URL from backend",
                    validation_output="\n".join(validation_steps)
                )
            
            backend_url = backend_remote_result.stdout.strip()
            import re
            match = re.search(r'github\.com[:/]([^/]+)/(.+?)(?:\.git)?$', backend_url)
            if not match:
                return ApprovalResponse(
                    success=False,
                    error=f"Could not parse repository URL: {backend_url}",
                    validation_steps="\n".join(validation_steps)
                )
            
            detected_owner = match.group(1)
            detected_repo = match.group(2)
            
            # Check if user has GitHub token
            if not user.github_access_token:
                return ApprovalResponse(
                    success=False,
                    error="Workspace is not a git repository. Please authenticate with GitHub OAuth first to clone the repo.",
                    validation_output="\n".join(validation_steps)
                )
            
            try:
                validation_steps.append(f"📥 Cloning {detected_owner}/{detected_repo} into workspace...")
                print(f"[PR-CREATE] Cloning {detected_owner}/{detected_repo}")
                
                # Build authenticated clone URL
                clone_url = f"https://{user.github_access_token}@github.com/{detected_owner}/{detected_repo}.git"
                
                # Clone into a temp directory first
                import tempfile
                import shutil
                
                with tempfile.TemporaryDirectory() as temp_dir:
                    # Clone the repo
                    clone_result = subprocess.run(
                        ["git", "clone", "--depth", "1", clone_url, temp_dir],
                        capture_output=True,
                        text=True
                    )
                    
                    if clone_result.returncode != 0:
                        return ApprovalResponse(
                            success=False,
                            error=f"Git clone failed: {clone_result.stderr}",
                            validation_output="\n".join(validation_steps)
                        )
                    
                    # Copy .git directory to workspace (preserves git history)
                    shutil.copytree(
                        os.path.join(temp_dir, ".git"),
                        os.path.join(workspace, ".git"),
                        dirs_exist_ok=True
                    )
                    
                    # Copy .gitignore if exists, otherwise create one
                    gitignore_src = os.path.join(temp_dir, ".gitignore")
                    gitignore_dst = os.path.join(workspace, ".gitignore")
                    if os.path.exists(gitignore_src) and not os.path.exists(gitignore_dst):
                        shutil.copy2(gitignore_src, gitignore_dst)
                    elif not os.path.exists(gitignore_dst):
                        # Create .gitignore for Terraform
                        gitignore_content = """# Terraform
.terraform/
.terraform.lock.hcl
*.tfstate
*.tfstate.*
*.tfvars
*.tfvars.json
crash.log
crash.*.log
override.tf
override.tf.json
*_override.tf
*_override.tf.json
.terraformrc
terraform.rc
"""
                        with open(gitignore_dst, "w") as f:
                            f.write(gitignore_content)
                
                # Configure git user
                subprocess.run(
                    ["git", "config", "user.email", "ai@infrara.dev"],
                    cwd=workspace,
                    capture_output=True
                )
                subprocess.run(
                    ["git", "config", "user.name", "Infrara AI"],
                    cwd=workspace,
                    capture_output=True
                )
                
                # Checkout the default branch (so we have a proper base)
                subprocess.run(
                    ["git", "checkout", "-f"],
                    cwd=workspace,
                    capture_output=True
                )
                
                validation_steps.append(f"✅ Cloned repo: {detected_owner}/{detected_repo}")
                print(f"[PR-CREATE] Successfully cloned repo")
                
            except Exception as e:
                return ApprovalResponse(
                    success=False,
                    error=f"Failed to clone repository: {str(e)}",
                    validation_output="\n".join(validation_steps)
                )
        
        # Fallback to provided values or error
        if not detected_owner or not detected_repo:
            if req.repo_owner and req.repo_name:
                detected_owner = req.repo_owner
                detected_repo = req.repo_name
                validation_steps.append(f"✅ Using provided repo: {detected_owner}/{detected_repo}")
            else:
                return ApprovalResponse(
                    success=False,
                    error="Could not auto-detect repository. Please provide repo_owner and repo_name, or ensure workspace is a git repository.",
                    validation_output="\n".join(validation_steps)
                )
        
        repo_owner = req.repo_owner or detected_owner
        repo_name = req.repo_name or detected_repo
        
        # Auto-generate commit message if not provided
        if not req.commit_message:
            validation_steps.append("✍️  Auto-generating commit message...")
            
            # Get list of changed files
            status_result = subprocess.run(
                ["git", "status", "--short"],
                cwd=workspace,
                capture_output=True,
                text=True
            )
            changed_files = [line.strip() for line in status_result.stdout.split('\n') if line.strip()]
            
            # Parse terraform files to understand what was created
            tf_resources = []
            for file in changed_files:
                if '.tf' in file:
                    file_path = os.path.join(workspace, file.split()[-1])
                    if os.path.exists(file_path):
                        with open(file_path, 'r') as f:
                            content = f.read()
                            # Extract resource types (very basic parsing)
                            import re
                            resources = re.findall(r'resource\s+"([^"]+)"\s+"([^"]+)"', content)
                            tf_resources.extend([f"{r[0]}.{r[1]}" for r in resources])
            
            if tf_resources:
                commit_message = f"Add infrastructure: {', '.join(tf_resources[:3])}"
                if len(tf_resources) > 3:
                    commit_message += f" (+{len(tf_resources)-3} more)"
            else:
                commit_message = "Update infrastructure via Infrara AI"
            
            validation_steps.append(f"✅ Commit message: {commit_message}")
            print(f"[PR-CREATE] Generated commit message: {commit_message}")
        else:
            commit_message = req.commit_message
            validation_steps.append(f"✅ Using provided commit message: {commit_message}")
        
        # Generate unique branch name
        branch_name = req.target_branch or f"driftbox/terraform-{uuid.uuid4().hex[:8]}"
        validation_steps.append(f"✅ Branch name: {branch_name}")
        
        # Step 1: Terraform init with plugin cache (much faster!)
        validation_steps.append("\n🔧 Running terraform init...")
        print(f"[PR-CREATE] Running terraform init in {workspace}")
        
        # Set up Terraform plugin cache directory to avoid re-downloading providers
        plugin_cache_dir = os.path.expanduser("~/.terraform.d/plugin-cache")
        os.makedirs(plugin_cache_dir, exist_ok=True)
        
        env = os.environ.copy()
        env["TF_PLUGIN_CACHE_DIR"] = plugin_cache_dir
        
        result = subprocess.run(
            ["terraform", "init", "-upgrade=false"],  # Don't check for updates
            cwd=workspace,
            capture_output=True,
            text=True,
            env=env
        )
        if result.returncode != 0:
            return ApprovalResponse(
                success=False,
                error=f"terraform init failed: {result.stderr}",
                validation_output="\n".join(validation_steps)
            )
        validation_steps.append("✅ terraform init completed")
        
        # Step 2 & 3: Run fmt and validate (fmt always succeeds, so run in sequence but fast)
        validation_steps.append("🎨 Running terraform fmt...")
        print(f"[PR-CREATE] Running terraform fmt in {workspace}")
        subprocess.run(["terraform", "fmt"], cwd=workspace, capture_output=True, env=env)
        validation_steps.append("✅ terraform fmt completed")
        
        validation_steps.append("✔️  Running terraform validate...")
        print(f"[PR-CREATE] Running terraform validate in {workspace}")
        result = subprocess.run(
            ["terraform", "validate", "-json"],  # JSON output is faster to parse
            cwd=workspace,
            capture_output=True,
            text=True,
            env=env,
            timeout=30  # Fail fast if validation hangs
        )
        if result.returncode != 0:
            # Parse JSON output to get actual error details
            error_msg = "Unknown validation error"
            try:
                if result.stdout:
                    validate_json = json.loads(result.stdout)
                    if 'diagnostics' in validate_json and validate_json['diagnostics']:
                        errors = []
                        for d in validate_json['diagnostics']:
                            summary = d.get('summary', '')
                            detail = d.get('detail', '')
                            errors.append(f"{summary}: {detail}" if summary and detail else (summary or detail))
                        error_msg = '; '.join(errors[:3])  # Show first 3 errors
            except Exception as e:
                # If JSON parsing fails, show raw output
                error_msg = result.stderr or result.stdout or "Validation failed with no output"
                print(f"[DEBUG] Failed to parse terraform validate JSON: {e}")
                print(f"[DEBUG] stdout: {result.stdout}")
                print(f"[DEBUG] stderr: {result.stderr}")
            
            return ApprovalResponse(
                success=False,
                error=f"terraform validate failed: {error_msg}",
                validation_output="\n".join(validation_steps)
            )
        validation_steps.append("✅ terraform validate passed")
        
        # Step 4: Ensure git user is configured (in case workspace already existed)
        subprocess.run(
            ["git", "config", "user.email", "ai@infrara.dev"],
            cwd=workspace,
            capture_output=True
        )
        subprocess.run(
            ["git", "config", "user.name", "Infrara AI"],
            cwd=workspace,
            capture_output=True
        )
        
        # CRITICAL FIX: Stash changes, pull main, restore changes
        validation_steps.append("🔄 Syncing with remote...")
        try:
            # Stash current changes (your new files)
            subprocess.run(["git", "add", "."], cwd=workspace, capture_output=True)
            stash_result = subprocess.run(
                ["git", "stash", "push", "-m", "temp-stash-for-pr"],
                cwd=workspace,
                capture_output=True,
                text=True
            )
            has_stash = "No local changes" not in stash_result.stdout
            
            # Fetch latest from remote
            subprocess.run(["git", "fetch", "origin"], cwd=workspace, capture_output=True)
            
            # Switch to main and pull latest
            base_branch_sync = req.base_branch or "main"
            subprocess.run(["git", "checkout", base_branch_sync], cwd=workspace, capture_output=True)
            subprocess.run(["git", "pull", "origin", base_branch_sync], cwd=workspace, capture_output=True)
            
            validation_steps.append(f"✅ Synced with remote {base_branch_sync}")
            
            # Restore stashed changes
            if has_stash:
                subprocess.run(["git", "stash", "pop"], cwd=workspace, capture_output=True)
                validation_steps.append("✅ Restored your changes")
        except:
            # If pull fails (no remote yet), that's ok - continue
            validation_steps.append("⚠️  No remote to sync with (fresh repo)")
        
        # Step 5: Create new git branch from fresh main
        validation_steps.append(f"🌿 Creating branch: {branch_name}...")
        print(f"[PR-CREATE] Creating branch {branch_name}")
        subprocess.run(
            ["git", "checkout", "-b", branch_name],
            cwd=workspace,
            check=True,
            capture_output=True
        )
        validation_steps.append(f"✅ Branch created: {branch_name}")
        
        # Step 6: Check if there are changes to commit
        print(f"[PR-CREATE] Checking for git changes in workspace: {workspace}")
        status_check = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=workspace,
            capture_output=True,
            text=True
        )
        
        print(f"[PR-CREATE] Git status output: {repr(status_check.stdout)}")
        
        if not status_check.stdout.strip():
            print(f"❌ [PR-CREATE] No changes detected in workspace!")
            print(f"   Workspace path: {workspace}")
            print(f"   Files in workspace: {os.listdir(workspace) if os.path.exists(workspace) else 'DOES NOT EXIST'}")
            return ApprovalResponse(
                success=False,
                error="No changes detected in workspace. Make sure files are created in the correct location.",
                validation_output="\n".join(validation_steps)
            )
        
        # Step 7: Stage and commit changes
        validation_steps.append("📝 Committing changes...")
        print(f"[PR-CREATE] Committing changes")
        subprocess.run(["git", "add", "."], cwd=workspace, check=True, capture_output=True)
        result = subprocess.run(
            ["git", "commit", "-m", commit_message],
            cwd=workspace,
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            # Check if it's a "nothing to commit" error
            if "nothing to commit" in result.stdout or "nothing to commit" in result.stderr:
                return ApprovalResponse(
                    success=False,
                    error="No changes to commit. The files may already be committed or were not written to the workspace.",
                    validation_output="\n".join(validation_steps)
                )
            return ApprovalResponse(
                success=False,
                error=f"Git commit failed: {result.stderr}\nStdout: {result.stdout}",
                validation_output="\n".join(validation_steps)
            )
        validation_steps.append("✅ Changes committed")
        
        # Step 8: Set up authenticated remote using user's GitHub token
        if user.github_access_token:
            # User authenticated via GitHub OAuth - use their token
            validation_steps.append("🔑 Using your GitHub credentials...")
            authenticated_url = f"https://{user.github_access_token}@github.com/{repo_owner}/{repo_name}.git"
            subprocess.run(
                ["git", "remote", "set-url", "origin", authenticated_url],
                cwd=workspace,
                capture_output=True
            )
            validation_steps.append("✅ Authenticated with GitHub")
        else:
            validation_steps.append("⚠️  No GitHub token found - using existing git config")
        
        # Step 9: Push to GitHub
        validation_steps.append("📤 Pushing to GitHub...")
        print(f"[PR-CREATE] Pushing branch to GitHub")
        push_result = subprocess.run(
            ["git", "push", "origin", branch_name],
            cwd=workspace,
            capture_output=True,
            text=True
        )
        if push_result.returncode != 0:
            error_msg = "Git push failed. "
            if not user.github_access_token:
                error_msg += "You need to authenticate with GitHub OAuth first.\n\n"
                error_msg += "Visit: http://YOUR_DOMAIN/auth/github to connect your GitHub account."
            else:
                error_msg += f"Error: {push_result.stderr}\nStdout: {push_result.stdout}"
            
            return ApprovalResponse(
                success=False,
                error=error_msg,
                validation_output="\n".join(validation_steps)
            )
        validation_steps.append("✅ Pushed to GitHub")
        
        # Step 10: Generate GitHub PR creation URL
        # Instead of creating the PR automatically, give the user a link to GitHub's PR creation page
        # This allows them to review changes and customize the PR description
        validation_steps.append("🔗 Generating PR creation link...")
        print(f"[PR-CREATE] Generating GitHub PR creation URL")
        
        # Auto-detect default branch if not specified
        base_branch = req.base_branch or "main"
        
        # If user has GitHub token, try to detect the default branch
        if user.github_access_token:
            try:
                repo_info_url = f"https://api.github.com/repos/{repo_owner}/{repo_name}"
                repo_response = requests.get(
                    repo_info_url,
                    headers={
                        "Authorization": f"Bearer {user.github_access_token}",
                        "Accept": "application/vnd.github.v3+json"
                    },
                    timeout=5
                )
                if repo_response.status_code == 200:
                    base_branch = repo_response.json().get("default_branch", "main")
                    print(f"[PR-CREATE] Detected default branch: {base_branch}")
            except Exception as e:
                print(f"[PR-CREATE] Failed to detect default branch: {e}")
                base_branch = "main"  # Fallback
        
        # Generate GitHub PR creation URL
        pr_url = f"https://github.com/{repo_owner}/{repo_name}/compare/{base_branch}...{branch_name}?expand=1"
        
        validation_steps.append(f"✅ Ready to create PR: {pr_url}")
        print(f"[PR-CREATE] PR creation URL ready: {pr_url}")
        
        return ApprovalResponse(
            success=True,
            pr_url=pr_url,
            branch_name=branch_name,
            validation_output="\n".join(validation_steps)
        )
    
    except subprocess.CalledProcessError as e:
        return ApprovalResponse(
            success=False,
            error=f"Command failed: {e.cmd}\nOutput: {e.output if hasattr(e, 'output') else 'N/A'}",
            validation_output="\n".join(validation_steps) if 'validation_steps' in locals() else None
        )
    except Exception as e:
        return ApprovalResponse(
            success=False,
            error=str(e),
            validation_output="\n".join(validation_steps) if 'validation_steps' in locals() else None
        )


def create_github_pr(token: str, owner: str, repo: str, head: str, base: str, title: str, body: str) -> str:
    """Create a GitHub PR via the API"""
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
    }
    data = {
        "title": title,
        "head": head,
        "base": base,
        "body": body
    }
    
    print(f"[PR-CREATE] Creating PR: {owner}/{repo} - {head} → {base}")
    response = requests.post(url, headers=headers, json=data)
    
    if response.status_code not in [200, 201]:
        error_data = response.json()
        error_message = error_data.get('message', 'Unknown error')
        
        # Add helpful context for common errors
        if 'validation failed' in error_message.lower():
            errors = error_data.get('errors', [])
            if errors:
                error_details = '; '.join([f"{e.get('field', 'unknown')}: {e.get('message', 'invalid')}" for e in errors])
                error_message = f"Validation Failed: {error_details}"
            
            # Common issues
            if 'base' in error_message.lower():
                error_message += f"\n\nTip: The base branch '{base}' may not exist. Common default branches are 'main', 'master', or 'develop'."
            elif 'head' in error_message.lower():
                error_message += f"\n\nTip: The branch '{head}' may already have an open PR or doesn't exist on the remote."
        
        print(f"[PR-CREATE] GitHub API error ({response.status_code}): {error_message}")
        raise HTTPException(
            status_code=response.status_code,
            detail=f"{response.status_code}: GitHub API error: {error_message}"
        )
    
    pr_url = response.json()["html_url"]
    pr_number = response.json().get("number", "N/A")
    print(f"[PR-CREATE] PR created successfully: {pr_url}")
    
    return pr_url


class AddStateFileRequest(BaseModel):
    workspace_path: str
    repo_owner: Optional[str] = None
    repo_name: Optional[str] = None
    branch_name: Optional[str] = None
    pr_number: Optional[int] = None


@router.post("/add-state-file", tags=["git"])
async def add_terraform_state_to_pr(
    req: AddStateFileRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Save Terraform state file locally after successful GitHub Actions deployment.
    
    Workflow:
    1. Verify GitHub Actions deployment succeeded
    2. Generate Terraform state file (terraform show -json)
    3. Save state file locally in workspace
    4. Ensure state file is in .gitignore (not committed to GitHub)
    
    This should be called after:
    - Sandbox test completes successfully
    - PR is deployed via GitHub Actions
    - Deployment workflow completes successfully
    
    Note: State file is saved locally only and will NOT be committed to git.
    """
    try:
        workspace = req.workspace_path
        
        if not os.path.exists(workspace):
            raise HTTPException(status_code=404, detail=f"Workspace not found: {workspace}")
        
        if not user.github_access_token:
            raise HTTPException(status_code=401, detail="GitHub authentication required")
        
        # Step 1: Detect repo info if not provided
        repo_owner = req.repo_owner
        repo_name = req.repo_name
        branch_name = req.branch_name
        
        if not repo_owner or not repo_name:
            # Try to detect from git remote
            try:
                remote_url_result = subprocess.run(
                    ["git", "config", "--get", "remote.origin.url"],
                    cwd=workspace,
                    capture_output=True,
                    text=True,
                    check=True
                )
                remote_url = remote_url_result.stdout.strip()
                match = re.search(r'github\.com[:/]([^/]+)/(.+?)(?:\.git)?$', remote_url)
                if match:
                    repo_owner = match.group(1)
                    repo_name = match.group(2)
                else:
                    raise HTTPException(status_code=400, detail="Could not detect repository from git remote")
            except:
                raise HTTPException(status_code=400, detail="Repository information required (repo_owner, repo_name)")
        
        if not branch_name:
            # Try to detect current branch
            try:
                branch_result = subprocess.run(
                    ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                    cwd=workspace,
                    capture_output=True,
                    text=True,
                    check=True
                )
                branch_name = branch_result.stdout.strip()
            except:
                raise HTTPException(status_code=400, detail="Branch name required")
        
        print(f"[ADD-STATE] Adding state file to PR: {repo_owner}/{repo_name} branch {branch_name}")
        
        # Step 2: Verify GitHub Actions deployment succeeded
        print(f"[ADD-STATE] Checking GitHub Actions deployment status...")
        deployment_successful = github_actions_service.is_deployment_successful(
            token=user.github_access_token,
            owner=repo_owner,
            repo=repo_name,
            branch=branch_name
        )
        
        if not deployment_successful:
            # Get latest run for more details
            runs = github_actions_service.get_workflow_runs_for_pr(
                token=user.github_access_token,
                owner=repo_owner,
                repo=repo_name,
                branch=branch_name
            )
            
            if runs:
                latest_run = runs[0]
                status = latest_run.get("status", "unknown")
                conclusion = latest_run.get("conclusion", "unknown")
                return {
                    "success": False,
                    "error": f"Deployment not successful. Status: {status}, Conclusion: {conclusion}",
                    "workflow_run_url": latest_run.get("html_url"),
                    "message": "Please wait for GitHub Actions deployment to complete successfully before adding state file."
                }
            else:
                return {
                    "success": False,
                    "error": "No GitHub Actions workflow runs found for this branch",
                    "message": "Ensure GitHub Actions workflow has run and completed."
                }
        
        print(f"[ADD-STATE] ✅ Deployment successful, generating state file...")
        
        # Step 2.5: Check backend configuration and state locking
        print(f"[ADD-STATE] Checking Terraform backend configuration and state locking...")
        backend_info = terraform_state_service.detect_backend_config(workspace)
        
        if backend_info["has_backend"] and backend_info["supports_locking"]:
            print(f"[ADD-STATE] ✅ Backend with locking detected: {backend_info['backend_type']}")
            # Ensure state lock is released before proceeding
            lock_status = terraform_state_service.ensure_state_lock_released(workspace)
            if not lock_status["success"]:
                return {
                    "success": False,
                    "error": "State is locked",
                    "message": lock_status["message"],
                    "lock_info": lock_status.get("lock_info"),
                    "backend_info": backend_info
                }
            if lock_status["was_locked"]:
                print(f"[ADD-STATE] ✅ State lock released: {lock_status['message']}")
        else:
            locking_guidance = terraform_state_service.get_backend_locking_guidance(backend_info)
            print(f"[ADD-STATE] ⚠️  {locking_guidance}")
        
        # Step 3: Generate Terraform state file locally
        # Check if backend is configured - if so, use it; otherwise use -backend=false
        use_backend = backend_info["has_backend"]
        init_flags = ["-input=false", "-no-color"]
        if not use_backend:
            init_flags.append("-backend=false")
        
        print(f"[ADD-STATE] Running terraform init ({'with backend' if use_backend else 'without backend'})...")
        init_result = subprocess.run(
            ["terraform", "init"] + init_flags,
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=60
        )
        
        if init_result.returncode != 0:
            return {
                "success": False,
                "error": f"Terraform init failed: {init_result.stderr[:200]}",
                "message": "Could not initialize Terraform workspace"
            }
        
        # Generate state file using terraform show -json
        state_file_path = os.path.join(workspace, "terraform.tfstate.json")
        
        # Try to get state from terraform show
        show_result = subprocess.run(
            ["terraform", "show", "-json"],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if show_result.returncode != 0:
            # If terraform show fails, try to get state from .terraform directory or create empty state
            print(f"[ADD-STATE] terraform show failed, checking for existing state...")
            
            # Check for existing state files
            state_files = list(Path(workspace).glob("*.tfstate*"))
            if state_files:
                # Use existing state file
                state_file_path = str(state_files[0])
                print(f"[ADD-STATE] Using existing state file: {state_file_path}")
            else:
                return {
                    "success": False,
                    "error": "Could not generate or find Terraform state file",
                    "message": "Terraform state is not available. Ensure terraform apply has been run."
                }
        else:
            # Write state file from terraform show output
            try:
                state_json = json.loads(show_result.stdout)
                with open(state_file_path, "w") as f:
                    json.dump(state_json, f, indent=2)
                print(f"[ADD-STATE] ✅ Generated state file: {state_file_path}")
            except json.JSONDecodeError:
                return {
                    "success": False,
                    "error": "Invalid JSON from terraform show",
                    "message": "Could not parse Terraform state"
                }
        
        # Step 4: Ensure terraform init creates/updates the lock file
        # The lock file is automatically created by terraform init when providers are downloaded
        # Run terraform init with -upgrade to ensure lock file is created/updated
        print(f"[ADD-STATE] Ensuring Terraform lock file is created...")
        
        # Check if lock file already exists
        lock_file_path = os.path.join(workspace, ".terraform.lock.hcl")
        lock_file_exists_before = os.path.exists(lock_file_path)
        
        if not lock_file_exists_before:
            # Run terraform init to create the lock file
            # Use -upgrade to ensure providers are downloaded and lock file is created
            init_for_lock_result = subprocess.run(
                ["terraform", "init", "-upgrade", "-input=false", "-no-color"],
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if init_for_lock_result.returncode == 0:
                print(f"[ADD-STATE] ✅ Terraform init completed")
            else:
                print(f"[ADD-STATE] ⚠️  Terraform init warning: {init_for_lock_result.stderr[:200]}")
        
        # Check if lock file exists now
        lock_file_exists = os.path.exists(lock_file_path)
        
        if lock_file_exists:
            print(f"[ADD-STATE] ✅ Lock file exists: {lock_file_path}")
            # Verify lock file has content
            try:
                lock_file_size = os.path.getsize(lock_file_path)
                if lock_file_size > 0:
                    print(f"[ADD-STATE] ✅ Lock file is valid ({lock_file_size} bytes)")
                else:
                    print(f"[ADD-STATE] ⚠️  Lock file is empty")
            except Exception as e:
                print(f"[ADD-STATE] ⚠️  Could not verify lock file: {e}")
        else:
            print(f"[ADD-STATE] ⚠️  Lock file not found (may be created when providers are downloaded)")
        
        # Step 5: Ensure state file and lock file are in .gitignore
        gitignore_path = os.path.join(workspace, ".gitignore")
        terraform_ignore_patterns = [
            "# Terraform state files",
            "*.tfstate",
            "*.tfstate.*",
            "terraform.tfstate.json",
            "# Terraform lock file",
            ".terraform.lock.hcl",
            "# Terraform directory",
            ".terraform/"
        ]
        
        gitignore_updated = False
        if os.path.exists(gitignore_path):
            with open(gitignore_path, "r") as f:
                gitignore_content = f.read()
            
            # Check which patterns are missing
            missing_patterns = []
            for pattern in terraform_ignore_patterns:
                # Skip comment lines for checking
                if pattern.startswith("#"):
                    continue
                # Check if pattern exists (exact match or as part of a line)
                pattern_found = False
                for line in gitignore_content.split("\n"):
                    line_stripped = line.strip()
                    if pattern in line_stripped or line_stripped == pattern:
                        pattern_found = True
                        break
                if not pattern_found:
                    missing_patterns.append(pattern)
            
            if missing_patterns:
                # Add missing patterns to .gitignore
                with open(gitignore_path, "a") as f:
                    f.write("\n# Terraform files (auto-added by Driftbox)\n")
                    # Add comment for state files
                    if any("tfstate" in p for p in missing_patterns):
                        f.write("# Terraform state files\n")
                    # Add state file patterns
                    for pattern in missing_patterns:
                        if "tfstate" in pattern:
                            f.write(f"{pattern}\n")
                    # Add comment for lock file
                    if ".terraform.lock.hcl" in missing_patterns:
                        f.write("# Terraform lock file\n")
                        f.write(".terraform.lock.hcl\n")
                    # Add comment for .terraform directory
                    if ".terraform/" in missing_patterns:
                        f.write("# Terraform directory\n")
                        f.write(".terraform/\n")
                gitignore_updated = True
                print(f"[ADD-STATE] ✅ Updated .gitignore to exclude Terraform files")
        else:
            # Create .gitignore if it doesn't exist
            with open(gitignore_path, "w") as f:
                f.write("# Terraform files (auto-added by Driftbox)\n")
                f.write("# Terraform state files\n")
                f.write("*.tfstate\n")
                f.write("*.tfstate.*\n")
                f.write("terraform.tfstate.json\n")
                f.write("# Terraform lock file\n")
                f.write(".terraform.lock.hcl\n")
                f.write("# Terraform directory\n")
                f.write(".terraform/\n")
            gitignore_updated = True
            print(f"[ADD-STATE] ✅ Created .gitignore to exclude Terraform files")
        
        # Step 6: Verify files are ignored by git
        ignored_files = []
        for file_path in [state_file_path, lock_file_path]:
            if os.path.exists(file_path):
                check_ignore_result = subprocess.run(
                    ["git", "check-ignore", "-v", file_path],
                    cwd=workspace,
                    capture_output=True,
                    text=True
                )
                
                if check_ignore_result.returncode == 0:
                    ignored_files.append(os.path.basename(file_path))
                    print(f"[ADD-STATE] ✅ {os.path.basename(file_path)} is ignored by git")
                else:
                    print(f"[ADD-STATE] ⚠️  {os.path.basename(file_path)} may not be ignored yet (this is OK if .gitignore was just updated)")
        
        print(f"[ADD-STATE] ✅ State file saved locally: {state_file_path}")
        if lock_file_exists:
            print(f"[ADD-STATE] ✅ Lock file exists locally: {lock_file_path}")
        print(f"[ADD-STATE] ✅ Terraform files are in .gitignore and will NOT be committed")
        
        result = {
            "success": True,
            "message": "Terraform state file saved locally (not committed to git)",
            "state_file": os.path.basename(state_file_path),
            "state_file_path": state_file_path,
            "lock_file_exists": lock_file_exists,
            "gitignore_updated": gitignore_updated,
            "ignored_files": ignored_files,
            "backend_info": backend_info,
            "state_locking_enabled": backend_info["supports_locking"],
            "note": "State file and lock file are in .gitignore and will not be committed to GitHub"
        }
        
        if lock_file_exists:
            result["lock_file"] = ".terraform.lock.hcl"
            result["lock_file_path"] = lock_file_path
        
        # Add state locking information
        if backend_info["supports_locking"]:
            result["state_locking_status"] = "enabled"
            result["state_locking_note"] = "State locking is configured and active. This prevents concurrent operations from corrupting the state file."
            if backend_info.get("lock_table"):
                result["dynamodb_lock_table"] = backend_info["lock_table"]
        else:
            result["state_locking_status"] = "not_configured"
            locking_guidance = terraform_state_service.get_backend_locking_guidance(backend_info)
            result["state_locking_note"] = locking_guidance
            result["warning"] = "State locking is not configured. Concurrent Terraform operations may corrupt the state file. Consider configuring a remote backend with locking support."
        
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ADD-STATE] Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to add state file: {str(e)}"
        )
