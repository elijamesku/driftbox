"""
Server-side Terraform validation and governed apply endpoints.
Providers are cached on the server, making validation instant.

Enhanced with:
- Governed apply with approval verification (MVP Feature #4)
- Risk-aware execution controls
- Post-deployment validation hooks
"""

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Dict, List, Optional, Any, AsyncGenerator, Tuple
from pathlib import Path
import tempfile
import subprocess
import json
import os
import shutil
import asyncio

from app.services.auth import require_authentication
from app.database.models import UserAccount

# Import auto-heal function from git.py
from app.api.v1.endpoints.git import auto_heal_terraform_errors

# Import governed apply functions
try:
    from app.core.terraform import execute_governed_terraform_apply, get_apply_eligibility
    GOVERNED_APPLY_AVAILABLE = True
except ImportError:
    GOVERNED_APPLY_AVAILABLE = False
    execute_governed_terraform_apply = None
    get_apply_eligibility = None

router = APIRouter()

# Global plugin cache directory
PLUGIN_CACHE_DIR = "/tmp/terraform-plugin-cache"


def _extract_digitalocean_vpc_names_from_content(content: str) -> List[str]:
    """
    Extract the 'name' attribute from each resource "digitalocean_vpc" block.
    DigitalOcean API uses this name; duplicate names cause 422 errors.
    Falls back to the Terraform resource label if no name = "..." is found in the block.
    """
    import re
    names: List[str] = []
    # Find each resource "digitalocean_vpc" "label" { ... } block
    pattern = re.compile(
        r'resource\s+"digitalocean_vpc"\s+"([^"]+)"\s*\{',
        re.MULTILINE | re.DOTALL
    )
    pos = 0
    while True:
        m = pattern.search(content, pos)
        if not m:
            break
        label = m.group(1)
        block_start = m.end()
        # Find matching closing brace
        depth = 1
        i = block_start
        while i < len(content) and depth > 0:
            if content[i] == '{':
                depth += 1
            elif content[i] == '}':
                depth -= 1
            i += 1
        block_body = content[block_start:i - 1] if depth == 0 else ""
        # name = "value" or name = 'value'
        name_m = re.search(r'name\s*=\s*"([^"]+)"', block_body)
        if not name_m:
            name_m = re.search(r"name\s*=\s*'([^']+)'", block_body)
        if name_m:
            names.append(name_m.group(1))
        else:
            names.append(label)
        pos = i
    return names


class ValidateRequest(BaseModel):
    files: Dict[str, str]  # { "main.tf": "content...", "s3.tf": "content..." }

class Diagnostic(BaseModel):
    severity: str
    summary: str
    detail: Optional[str] = None

class ValidateResponse(BaseModel):
    valid: bool
    diagnostics: List[Diagnostic] = []
    init_success: bool = True
    init_error: Optional[str] = None


@router.post("/validate", response_model=ValidateResponse)
async def validate_terraform(
    request: ValidateRequest,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Validate Terraform files server-side.
    Uses cached providers for instant validation.
    """
    
    # Create temp directory for validation
    temp_dir = tempfile.mkdtemp(prefix="tf-validate-")
    
    try:
        # Ensure plugin cache exists
        os.makedirs(PLUGIN_CACHE_DIR, exist_ok=True)
        
        # Write all .tf files to temp dir
        for filename, content in request.files.items():
            filepath = os.path.join(temp_dir, filename)
            # Handle nested paths
            os.makedirs(os.path.dirname(filepath) if os.path.dirname(filepath) else temp_dir, exist_ok=True)
            with open(filepath, 'w') as f:
                f.write(content)
        
        # Set up environment with plugin cache
        env = os.environ.copy()
        env['TF_PLUGIN_CACHE_DIR'] = PLUGIN_CACHE_DIR
        
        # Check if providers exist in cache (for common providers)
        # If not, init will download them (first time only)
        
        # Run terraform init
        print(f"[Terraform Validate] Running init in {temp_dir}...")
        init_result = subprocess.run(
            ['terraform', 'init', '-upgrade=false', '-input=false'],
            cwd=temp_dir,
            capture_output=True,
            text=True,
            env=env,
            timeout=30  # 30 second timeout for init
        )
        
        if init_result.returncode != 0:
            print(f"[Terraform Validate] Init failed: {init_result.stderr}")
            return ValidateResponse(
                valid=False,
                init_success=False,
                init_error=init_result.stderr,
                diagnostics=[Diagnostic(
                    severity="error",
                    summary="Terraform init failed",
                    detail=init_result.stderr
                )]
            )
        
        print(f"[Terraform Validate] Init successful, running validate...")
        
        # Run terraform validate
        validate_result = subprocess.run(
            ['terraform', 'validate', '-json'],
            cwd=temp_dir,
            capture_output=True,
            text=True,
            env=env,
            timeout=15  # 15 second timeout for validate
        )
        
        # Parse JSON output
        try:
            validation = json.loads(validate_result.stdout)
            diagnostics = []
            
            for diag in validation.get('diagnostics', []):
                diagnostics.append(Diagnostic(
                    severity=diag.get('severity', 'error'),
                    summary=diag.get('summary', 'Unknown error'),
                    detail=diag.get('detail')
                ))
            
            print(f"[Terraform Validate] Valid: {validation.get('valid')}, Errors: {len(diagnostics)}")
            
            return ValidateResponse(
                valid=validation.get('valid', False),
                diagnostics=diagnostics,
                init_success=True
            )
            
        except json.JSONDecodeError:
            print(f"[Terraform Validate] Failed to parse output: {validate_result.stdout}")
            return ValidateResponse(
                valid=False,
                diagnostics=[Diagnostic(
                    severity="error",
                    summary="Failed to parse validation output",
                    detail=validate_result.stdout
                )]
            )
    
    except subprocess.TimeoutExpired:
        print(f"[Terraform Validate] Timeout!")
        return ValidateResponse(
            valid=False,
            diagnostics=[Diagnostic(
                severity="error",
                summary="Validation timed out",
                detail="Terraform command took too long to complete"
            )]
        )
    
    except Exception as e:
        print(f"[Terraform Validate] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        # Clean up temp directory
        try:
            shutil.rmtree(temp_dir)
        except:
            pass


@router.post("/fmt")
async def format_terraform(
    request: ValidateRequest,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Format Terraform files server-side.
    Returns formatted file contents.
    """
    
    temp_dir = tempfile.mkdtemp(prefix="tf-fmt-")
    
    try:
        # Write all .tf files to temp dir
        for filename, content in request.files.items():
            filepath = os.path.join(temp_dir, filename)
            os.makedirs(os.path.dirname(filepath) if os.path.dirname(filepath) else temp_dir, exist_ok=True)
            with open(filepath, 'w') as f:
                f.write(content)
        
        # Run terraform fmt
        subprocess.run(
            ['terraform', 'fmt'],
            cwd=temp_dir,
            capture_output=True,
            text=True,
            timeout=10
        )
        
        # Read back formatted files
        formatted_files = {}
        for filename in request.files.keys():
            filepath = os.path.join(temp_dir, filename)
            if os.path.exists(filepath):
                with open(filepath, 'r') as f:
                    formatted_files[filename] = f.read()
        
        return {"success": True, "files": formatted_files}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        try:
            shutil.rmtree(temp_dir)
        except:
            pass


# =============================================================================
# GOVERNED TERRAFORM APPLY ENDPOINTS (MVP Feature #4)
# =============================================================================

class GovernedApplyRequest(BaseModel):
    change_id: str  # The diff_id from diff_manager
    files: Dict[str, str]  # Terraform files to apply
    approval_verified: bool = False  # Override for senior engineers
    skip_validation: bool = False  # Skip post-deployment validation
    force_apply: bool = False  # Force apply high-risk changes


class ApplyEligibilityResponse(BaseModel):
    eligible: bool
    change_id: str
    status: Optional[str] = None
    risk_level: Optional[str] = None
    risk_score: Optional[int] = None
    blockers: List[Dict[str, str]] = []
    requires_force_apply: bool = False
    requires_senior_approval: bool = False


@router.get("/apply/{change_id}/eligibility")
async def check_apply_eligibility(
    change_id: str,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Check if a change is eligible for terraform apply.
    
    Returns:
    - Whether the change can be applied
    - Current approval status
    - Risk assessment
    - Any blockers that must be resolved
    
    Use this before calling /apply to understand requirements.
    """
    if not GOVERNED_APPLY_AVAILABLE or not get_apply_eligibility:
        raise HTTPException(
            status_code=501, 
            detail={"error": "not_implemented", "message": "Governed apply not available"}
        )
    
    eligibility = get_apply_eligibility(change_id, current_user.id)
    return eligibility


@router.post("/apply/{change_id}")
async def governed_terraform_apply(
    change_id: str,
    request: GovernedApplyRequest,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Execute governed Terraform apply with full compliance controls.
    
    This endpoint:
    1. Verifies the change has been approved (manual or auto)
    2. Checks risk assessment allows apply
    3. Records audit events for compliance
    4. Runs post-deployment validation
    
    Params:
        change_id: The diff session ID
        files: Terraform configuration files
        approval_verified: Set to true if senior approval obtained (for high-risk)
        skip_validation: Skip post-deployment validation
        force_apply: Force apply critical-risk changes (requires security team)
    
    Returns:
        Apply result with validation status and audit trail links
    """
    if not GOVERNED_APPLY_AVAILABLE or not execute_governed_terraform_apply:
        raise HTTPException(
            status_code=501, 
            detail={"error": "not_implemented", "message": "Governed apply not available"}
        )
    
    # Verify change_id matches request
    if request.change_id != change_id:
        raise HTTPException(
            status_code=400,
            detail={"error": "mismatch", "message": "change_id in path must match request body"}
        )
    
    # Create temp directory for Terraform files
    temp_dir = tempfile.mkdtemp(prefix="tf-apply-")
    
    try:
        # Ensure plugin cache exists
        os.makedirs(PLUGIN_CACHE_DIR, exist_ok=True)
        
        # Write Terraform files
        for filename, content in request.files.items():
            filepath = os.path.join(temp_dir, filename)
            os.makedirs(os.path.dirname(filepath) if os.path.dirname(filepath) else temp_dir, exist_ok=True)
            with open(filepath, 'w') as f:
                f.write(content)
        
        # Execute governed apply
        result = execute_governed_terraform_apply(
            working_directory=Path(temp_dir),
            change_id=change_id,
            user_id=current_user.id,
            approval_verified=request.approval_verified,
            skip_validation=request.skip_validation,
            force_apply=request.force_apply,
        )
        
        if not result.get("ok"):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "apply_blocked",
                    "message": result.get("output", "Apply blocked by governance"),
                    "step": result.get("step"),
                }
            )
        
        return {
            "success": True,
            "change_id": change_id,
            "steps": result.get("steps", []),
            "output": result.get("output", ""),
            "summary": result.get("summary", ""),
            "validation": result.get("validation"),
            "audit_trail": result.get("audit_trail", []),
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        # Clean up temp directory
        try:
            shutil.rmtree(temp_dir)
        except:
            pass


@router.get("/apply/{change_id}/audit")
async def get_apply_audit_trail(
    change_id: str,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Get the audit trail for a terraform apply operation.
    
    Returns all lifecycle events related to this change,
    including policy checks, risk assessment, approvals, and validation.
    """
    try:
        from app.services.lifecycle_audit_service import lifecycle_audit_service
        
        timeline = lifecycle_audit_service.get_lifecycle_timeline(change_id)
        summary = lifecycle_audit_service.get_lifecycle_summary(change_id)
        
        return {
            "ok": True,
            "change_id": change_id,
            "summary": summary,
            "timeline": timeline,
        }
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail={"error": "not_implemented", "message": "Audit service not available"}
        )


# =============================================================================
# SANDBOX TEST ENDPOINT - Pre-PR Validation
# =============================================================================

class SandboxTestRequest(BaseModel):
    repo_full_name: str
    files: List[Dict[str, str]]  # [{ "path": "main.tf", "content": "..." }]
    team_id: Optional[str] = None  # For team credential sharing

class ResourceInfo(BaseModel):
    type: str
    name: str
    action: str
    provider: str

class SandboxTestResponse(BaseModel):
    success: bool
    failed_step: Optional[str] = None
    error: Optional[str] = None
    errors: Optional[List[str]] = None
    available_cidr: Optional[str] = None
    duplicate_check: Optional[Dict[str, Any]] = None
    plan_summary: Optional[str] = None
    security_issues: Optional[int] = None
    resources_detected: Optional[List[ResourceInfo]] = None
    providers_used: Optional[List[str]] = None
    # Auto-heal fields
    auto_healed: bool = False
    fixes_applied: Optional[List[Dict[str, Any]]] = None
    attempts: int = 1


@router.post("/sandbox-test", response_model=SandboxTestResponse)
async def run_sandbox_test(
    request: SandboxTestRequest,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Run sandbox validation before PR creation.
    
    This endpoint simulates the GitHub Actions workflow:
    1. Checks for duplicate DigitalOcean resources
    2. Finds available CIDR ranges
    3. Validates Terraform syntax
    4. Runs terraform init
    5. Runs terraform plan (dry-run)
    6. Runs security policy scan
    """
    import re
    import httpx
    
    temp_dir = tempfile.mkdtemp(prefix="tf-sandbox-")
    errors = []
    available_cidr = None
    
    try:
        # Ensure plugin cache exists
        os.makedirs(PLUGIN_CACHE_DIR, exist_ok=True)
        env = os.environ.copy()
        env['TF_PLUGIN_CACHE_DIR'] = PLUGIN_CACHE_DIR
        
        # Write all files to temp dir
        tf_files = {}
        has_provider_block = False
        
        for file_info in request.files:
            filepath = os.path.join(temp_dir, file_info['path'])
            os.makedirs(os.path.dirname(filepath) if os.path.dirname(filepath) else temp_dir, exist_ok=True)
            with open(filepath, 'w') as f:
                f.write(file_info['content'])
            if file_info['path'].endswith('.tf'):
                tf_files[file_info['path']] = file_info['content']
                # Check if required_providers or terraform block exists
                if 'required_providers' in file_info['content'] or 'terraform {' in file_info['content']:
                    has_provider_block = True
        
        # Auto-add required_providers block if missing (common issue with DO provider)
        if not has_provider_block and tf_files:
            # Check if any file references digitalocean resources
            needs_do_provider = any('digitalocean_' in content for content in tf_files.values())
            needs_aws_provider = any('aws_' in content for content in tf_files.values())
            needs_random_provider = any('random_' in content for content in tf_files.values())
            
            providers_content = '''# Auto-generated providers configuration for sandbox testing
terraform {
  required_providers {
'''
            if needs_do_provider:
                providers_content += '''    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
'''
            if needs_aws_provider:
                providers_content += '''    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
'''
            if needs_random_provider:
                providers_content += '''    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
'''
            providers_content += '''  }
}
'''
            # Write providers.tf
            providers_path = os.path.join(temp_dir, '_providers.tf')
            with open(providers_path, 'w') as f:
                f.write(providers_content)
            print(f"[Sandbox Test] Auto-generated _providers.tf for missing provider configuration")
        
        # =================================================================
        # STEP 1: Check for duplicate resources (DigitalOcean API)
        # =================================================================
        print("[Sandbox Test] Step 1: Checking for duplicate resources...")
        
        all_fixes_applied: List[Dict[str, Any]] = []  # Auto-heal fixes (including duplicate VPC via LLM)
        duplicate_check = {"status": "skipped", "message": "No DigitalOcean token configured"}
        has_duplicate_vpc_issues = False
        synthetic_duplicate_diagnostics: List[Dict[str, Any]] = []
        
        # Get DO token using team service (checks team, user, then env)
        do_token = None
        token_source = None
        
        # Try to get team token - check provided team_id or user's teams
        try:
            from app.database.connection import auth_session_context
            from app.services.team_service import TeamService
            
            with auth_session_context() as auth_db:
                team_service = TeamService(auth_db)
                
                # If team_id provided, use it; otherwise check all user's teams
                if request.team_id:
                    do_token = team_service.get_digitalocean_token(request.team_id, current_user)
                    if do_token:
                        token_source = f"team:{request.team_id}"
                        print(f"[Sandbox Test] Using DO token from team: {request.team_id}")
                else:
                    # Check all teams user is a member of
                    user_teams = team_service.get_user_teams(current_user.id)
                    print(f"[Sandbox Test] Checking {len(user_teams)} team(s) for DO token...")
                    for team in user_teams:
                        token = team_service.get_digitalocean_token(team.id, current_user)
                        if token:
                            do_token = token
                            token_source = f"team:{team.id}"
                            print(f"[Sandbox Test] Found DO token from team: {team.name} ({team.id})")
                            break
        except Exception as e:
            print(f"[Sandbox Test] Error getting team token: {e}")
            import traceback
            traceback.print_exc()
        
        # Fallback to user/env if no team token
        if not do_token:
            if current_user.digitalocean_access_token:
                do_token = current_user.digitalocean_access_token
                token_source = "user"
                print(f"[Sandbox Test] Using DO token from user credentials")
            else:
                do_token = os.environ.get('DIGITALOCEAN_TOKEN')
                if do_token:
                    token_source = "environment"
                    print(f"[Sandbox Test] Using DO token from environment variable")
        
        if not do_token:
            print(f"[Sandbox Test] No DigitalOcean token found (checked teams, user, env)")
        
        if do_token:
            try:
                # Get existing VPCs to find available CIDR
                async with httpx.AsyncClient() as client:
                    vpcs_response = await client.get(
                        "https://api.digitalocean.com/v2/vpcs",
                        headers={"Authorization": f"Bearer {do_token}"}
                    )
                    
                    if vpcs_response.status_code == 200:
                        vpcs_data = vpcs_response.json()
                        used_cidrs = [vpc.get('ip_range', '') for vpc in vpcs_data.get('vpcs', [])]
                        
                        # Find next available CIDR
                        for i in range(0, 256):
                            test_cidr = f"10.{i}.0.0/16"
                            if test_cidr not in used_cidrs:
                                available_cidr = test_cidr
                                break
                        
                        # Check for duplicate VPC names (name attribute sent to DigitalOcean API)
                        vpc_names_in_tf = []
                        for content in tf_files.values():
                            vpc_names_in_tf.extend(_extract_digitalocean_vpc_names_from_content(content))
                        
                        existing_vpc_names = [vpc.get('name', '') for vpc in vpcs_data.get('vpcs', [])]
                        duplicates = set(vpc_names_in_tf) & set(existing_vpc_names)
                        
                        if duplicates:
                            duplicate_check = {
                                "status": "failed",
                                "message": f"VPC name(s) already exist in your account: {', '.join(sorted(duplicates))}. Auto-fix will rename to a unique name so a new VPC is created.",
                                "duplicates": list(duplicates),
                            }
                        else:
                            duplicate_check = {
                                "status": "passed",
                                "message": f"No duplicates found. {len(used_cidrs)} existing VPCs."
                            }
                    else:
                        duplicate_check = {
                            "status": "skipped",
                            "message": f"DO API returned {vpcs_response.status_code}"
                        }
            except Exception as e:
                duplicate_check = {"status": "skipped", "message": str(e)}
        
        # When duplicate VPC names are found, do NOT hardcode a fix. Feed to auto-heal (LLM) so
        # it can fix along with any other errors (dynamic fixes).
        has_duplicate_vpc_issues = False
        synthetic_duplicate_diagnostics: List[Dict[str, Any]] = []
        if duplicate_check.get("status") == "failed":
            dup_names = set(duplicate_check.get("duplicates") or [])
            if dup_names:
                has_duplicate_vpc_issues = True
                names_str = ", ".join(sorted(dup_names))
                synthetic_duplicate_diagnostics = [{
                    "severity": "error",
                    "summary": "Duplicate VPC name(s) in DigitalOcean account",
                    "detail": (
                        f"VPC name(s) already exist in your DigitalOcean account: {names_str}. "
                        "Rename the 'name' attribute to a unique value so Terraform creates a new VPC, "
                        "or use a data source to reference the existing VPC."
                    ),
                }]
                duplicate_check = {
                    "status": "passed",
                    "message": f"Duplicate VPC name(s) detected ({names_str}); auto-heal will fix.",
                    "duplicates": list(dup_names),
                }
                print(f"[Sandbox Test] Duplicate VPC names detected: {dup_names}; routing to auto-heal")
        
        # Auto-fix hardcoded CIDRs if we found an available one
        if available_cidr:
            for filename, content in tf_files.items():
                original = content
                # Replace common hardcoded CIDRs
                for cidr in ['10.0.0.0/16', '10.1.0.0/16', '10.10.0.0/16']:
                    content = content.replace(f'ip_range = "{cidr}"', f'ip_range = "{available_cidr}"')
                    content = content.replace(f"ip_range = '{cidr}'", f"ip_range = '{available_cidr}'")
                
                if content != original:
                    filepath = os.path.join(temp_dir, filename)
                    with open(filepath, 'w') as f:
                        f.write(content)
                    print(f"[Sandbox Test] Updated {filename} with available CIDR: {available_cidr}")
        
        # =================================================================
        # STEP 2: Validate Terraform syntax
        # =================================================================
        print("[Sandbox Test] Step 2: Validating Terraform syntax...")
        
        # Quick syntax check - look for common errors
        syntax_errors = []
        for filename, content in tf_files.items():
            # Check for unclosed braces
            if content.count('{') != content.count('}'):
                syntax_errors.append(f"{filename}: Mismatched braces")
            # Check for unclosed quotes
            if content.count('"') % 2 != 0:
                syntax_errors.append(f"{filename}: Unclosed quotes")
        
        if syntax_errors:
            return SandboxTestResponse(
                success=False,
                failed_step="syntax",
                errors=syntax_errors,
                duplicate_check=duplicate_check,
            )
        
        # =================================================================
        # STEP 3 & 4: Run terraform init + validate with AUTO-HEAL
        # =================================================================
        MAX_AUTO_HEAL_ATTEMPTS = 3
        auto_healed = False
        current_attempt = 1
        plan_summary = "Validation successful"
        current_tf_files = tf_files.copy()  # Track current state of files
        
        for attempt in range(1, MAX_AUTO_HEAL_ATTEMPTS + 1):
            current_attempt = attempt
            
            # Debug: Log files in temp_dir at start of each attempt (including subdirs)
            try:
                all_tf_files = []
                for root, dirs, files in os.walk(temp_dir):
                    for f in files:
                        if f.endswith('.tf'):
                            rel_path = os.path.relpath(os.path.join(root, f), temp_dir)
                            all_tf_files.append(rel_path)
                print(f"[Sandbox Test] 🔄 Attempt {attempt}/{MAX_AUTO_HEAL_ATTEMPTS}. .tf files in temp_dir: {all_tf_files}")
                for tf_file in all_tf_files:
                    file_path = os.path.join(temp_dir, tf_file)
                    file_size = os.path.getsize(file_path)
                    print(f"[Sandbox Test]    📄 {tf_file}: {file_size} bytes")
            except Exception as e:
                print(f"[Sandbox Test] ⚠️ Could not list temp_dir: {e}")
            
            print(f"[Sandbox Test] Attempt {attempt}/{MAX_AUTO_HEAL_ATTEMPTS}: Running terraform init...")
            
            # Run terraform init
            init_result = subprocess.run(
                ['terraform', 'init', '-upgrade=false', '-input=false', '-backend=false'],
                cwd=temp_dir,
                capture_output=True,
                text=True,
                env=env,
                timeout=60
            )
            
            init_failed = init_result.returncode != 0
            init_diagnostics = []
            
            print(f"[Sandbox Test] 🔧 terraform init returncode: {init_result.returncode}")
            if init_failed:
                print(f"[Sandbox Test] ❌ Init FAILED: {init_result.stderr[:300]}")
                init_diagnostics = [{
                    'severity': 'error',
                    'summary': 'Terraform init failed',
                    'detail': init_result.stderr[:500]
                }]
            else:
                print(f"[Sandbox Test] ✅ Init PASSED")
            
            # Run terraform validate (even if init failed, to collect all errors)
            print(f"[Sandbox Test] Attempt {attempt}/{MAX_AUTO_HEAL_ATTEMPTS}: Running terraform validate...")
            
            plan_result = subprocess.run(
                ['terraform', 'validate', '-json'],
                cwd=temp_dir,
                capture_output=True,
                text=True,
                env=env,
                timeout=30
            )
            
            validation_failed = False
            validation_diagnostics = []
            
            try:
                plan_json = json.loads(plan_result.stdout)
                if not plan_json.get('valid', False):
                    validation_failed = True
                    validation_diagnostics = plan_json.get('diagnostics', [])
                    print(f"[Sandbox Test] ❌ Validate FAILED: {len(validation_diagnostics)} diagnostics")
                else:
                    plan_summary = "Configuration valid"
                    print(f"[Sandbox Test] ✅ Validate PASSED")
            except json.JSONDecodeError:
                if plan_result.returncode != 0:
                    validation_failed = True
                    validation_diagnostics = [{
                        'severity': 'error',
                        'summary': 'Terraform validate failed',
                        'detail': plan_result.stderr[:500] if plan_result.stderr else plan_result.stdout[:500]
                    }]
                    print(f"[Sandbox Test] ❌ Validate FAILED (non-JSON): {plan_result.stderr[:200] if plan_result.stderr else plan_result.stdout[:200]}")
            
            # Combine all diagnostics (include synthetic duplicate-VPC error so auto-heal can fix it)
            all_diagnostics = init_diagnostics + validation_diagnostics
            if has_duplicate_vpc_issues:
                all_diagnostics = all_diagnostics + synthetic_duplicate_diagnostics
            
            # Debug: Log the decision factors for auto-heal
            print(f"[Sandbox Test] 🔍 Decision: init_failed={init_failed}, validation_failed={validation_failed}, has_duplicate_vpc_issues={has_duplicate_vpc_issues}")
            print(f"[Sandbox Test] 🔍 Total diagnostics: {len(all_diagnostics)}")
            for i, d in enumerate(all_diagnostics):
                print(f"[Sandbox Test]    📋 Diagnostic {i+1}: {d.get('summary', 'N/A')[:100]}")
            
            # If both init and validate passed and no duplicate VPC issues, we're done
            if not init_failed and not validation_failed and not has_duplicate_vpc_issues:
                print(f"[Sandbox Test] ✅ Validation passed on attempt {attempt}")
                break
            
            # If this is the last attempt, fail
            if attempt == MAX_AUTO_HEAL_ATTEMPTS:
                error_msgs = [d.get('summary', 'Unknown error') for d in all_diagnostics if d.get('severity') == 'error']
                print(f"[Sandbox Test] ❌ Max attempts reached, failing with {len(error_msgs)} errors")
                return SandboxTestResponse(
                    success=False,
                    failed_step="auto_heal" if auto_healed else ("init" if init_failed else "plan"),
                    error="Terraform validation failed after auto-heal attempts" if auto_healed else "Terraform validation failed",
                    errors=error_msgs[:5],
                    duplicate_check=duplicate_check,
                    available_cidr=available_cidr,
                    auto_healed=auto_healed,
                    fixes_applied=all_fixes_applied if all_fixes_applied else None,
                    attempts=current_attempt,
                )
            
            # Try auto-heal
            print(f"[Sandbox Test] 🤖 Attempting auto-heal (attempt {attempt})...")
            
            # IMPORTANT: Recompute all_diagnostics to include any errors from plan/apply failures
            all_diagnostics = init_diagnostics + validation_diagnostics
            if has_duplicate_vpc_issues:
                all_diagnostics = all_diagnostics + synthetic_duplicate_diagnostics
            print(f"[Sandbox Test] 🔄 Diagnostics for auto-heal: {len(all_diagnostics)}")
            
            try:
                # Call auto-heal with current files (pass DO token for version lookups)
                fixes = await auto_heal_terraform_errors(
                    workspace=temp_dir,
                    diagnostics=all_diagnostics,
                    attempt=attempt,
                    provided_files=current_tf_files,
                    do_token=do_token
                )
                
                if fixes and len(fixes) > 0:
                    auto_healed = True
                    print(f"[Sandbox Test] 🔧 Auto-heal generated {len(fixes)} fixes")
                    
                    # Debug: Log current state before applying fixes
                    print(f"[Sandbox Test] 📂 temp_dir: {temp_dir}")
                    print(f"[Sandbox Test] 📂 current_tf_files keys: {list(current_tf_files.keys())}")
                    
                    # Apply fixes to temp directory
                    for fix in fixes:
                        fix_path = fix.get('path', '')
                        new_content = fix.get('newContent', '')
                        
                        print(f"[Sandbox Test] 🔧 Processing fix for: {fix_path} ({len(new_content) if new_content else 0} chars)")
                        
                        if fix_path and new_content:
                            filepath = os.path.join(temp_dir, fix_path)
                            os.makedirs(os.path.dirname(filepath) if os.path.dirname(filepath) else temp_dir, exist_ok=True)
                            
                            # Debug: Check if file exists before writing
                            file_existed = os.path.exists(filepath)
                            print(f"[Sandbox Test] 📝 Writing to: {filepath} (existed: {file_existed})")
                            
                            with open(filepath, 'w') as f:
                                f.write(new_content)
                            
                            # Verify write succeeded
                            if os.path.exists(filepath):
                                written_size = os.path.getsize(filepath)
                                print(f"[Sandbox Test]   ✅ Written {written_size} bytes to {fix_path}")
                            else:
                                print(f"[Sandbox Test]   ❌ File NOT created: {filepath}")
                            
                            # Update current_tf_files to track state
                            current_tf_files[fix_path] = new_content
                            
                            all_fixes_applied.append({
                                'path': fix_path,
                                'oldContent': fix.get('oldContent', ''),
                                'newContent': new_content
                            })
                        else:
                            print(f"[Sandbox Test] ⚠️ Skipping fix - missing path or content")
                    # Re-check duplicate VPC names after fixes; clear flag if resolved
                    if has_duplicate_vpc_issues and do_token:
                        try:
                            vpc_names_in_tf = []
                            for content in current_tf_files.values():
                                vpc_names_in_tf.extend(_extract_digitalocean_vpc_names_from_content(content))
                            async with httpx.AsyncClient() as client:
                                vpcs_resp = await client.get(
                                    "https://api.digitalocean.com/v2/vpcs",
                                    headers={"Authorization": f"Bearer {do_token}"}
                                )
                            if vpcs_resp.status_code == 200:
                                vpcs_data = vpcs_resp.json()
                                existing = {vpc.get("name", "") for vpc in vpcs_data.get("vpcs", [])}
                                still_duplicates = set(vpc_names_in_tf) & existing
                                if not still_duplicates:
                                    has_duplicate_vpc_issues = False
                                    print(f"[Sandbox Test] Duplicate VPC issue resolved by auto-heal")
                        except Exception as e:
                            print(f"[Sandbox Test] Re-check duplicate VPC: {e}")
                else:
                    print(f"[Sandbox Test] ⚠️ Auto-heal returned no fixes")
                    # No fixes generated, fail immediately
                    error_msgs = [d.get('summary', 'Unknown error') for d in all_diagnostics if d.get('severity') == 'error']
                    return SandboxTestResponse(
                        success=False,
                        failed_step="auto_heal",
                        error="Auto-heal could not generate fixes",
                        errors=error_msgs[:5],
                        duplicate_check=duplicate_check,
                        available_cidr=available_cidr,
                        auto_healed=False,
                        fixes_applied=None,
                        attempts=current_attempt,
                    )
                    
            except Exception as heal_error:
                print(f"[Sandbox Test] ❌ Auto-heal error: {heal_error}")
                error_msgs = [d.get('summary', 'Unknown error') for d in all_diagnostics if d.get('severity') == 'error']
                return SandboxTestResponse(
                    success=False,
                    failed_step="auto_heal",
                    error=f"Auto-heal failed: {str(heal_error)}",
                    errors=error_msgs[:5],
                    duplicate_check=duplicate_check,
                    available_cidr=available_cidr,
                    auto_healed=False,
                    fixes_applied=None,
                    attempts=current_attempt,
                )
        
        # =================================================================
        # STEP 5: Run security policy scan
        # =================================================================
        print("[Sandbox Test] Step 5: Running security scan...")
        
        security_issues = 0
        resources_detected = []
        providers_used = set()
        
        # Detect resources and run security checks
        for filename, content in current_tf_files.items():
            # Find all resource blocks
            resource_matches = re.findall(r'resource\s+"([^"]+)"\s+"([^"]+)"', content)
            for resource_type, resource_name in resource_matches:
                provider = resource_type.split('_')[0] if '_' in resource_type else 'unknown'
                providers_used.add(provider)
                resources_detected.append({
                    "type": resource_type,
                    "name": resource_name,
                    "action": "create",  # Default to create for new resources
                    "provider": provider
                })
            
            # Find data sources too
            data_matches = re.findall(r'data\s+"([^"]+)"\s+"([^"]+)"', content)
            for data_type, data_name in data_matches:
                provider = data_type.split('_')[0] if '_' in data_type else 'unknown'
                providers_used.add(provider)
            
            # Basic security checks
            # Check for public access
            if 'publicly_accessible = true' in content.lower():
                security_issues += 1
            # Check for 0.0.0.0/0 CIDR (open to internet)
            if '0.0.0.0/0' in content:
                security_issues += 1
            # Check for disabled encryption
            if 'encryption = false' in content.lower() or 'encrypted = false' in content.lower():
                security_issues += 1
            # Check for hardcoded secrets
            if re.search(r'(password|secret|api_key|token)\s*=\s*"[^$][^"]{8,}"', content, re.I):
                security_issues += 1
        
        print(f"[Sandbox Test] Detected {len(resources_detected)} resources from {len(providers_used)} providers")
        
        # All checks passed!
        print(f"[Sandbox Test] All checks passed! (auto_healed={auto_healed}, fixes={len(all_fixes_applied)})")
        
        return SandboxTestResponse(
            success=True,
            duplicate_check=duplicate_check,
            available_cidr=available_cidr,
            plan_summary=plan_summary,
            security_issues=security_issues,
            resources_detected=resources_detected if resources_detected else None,
            providers_used=list(providers_used) if providers_used else None,
            auto_healed=auto_healed,
            fixes_applied=all_fixes_applied if all_fixes_applied else None,
            attempts=current_attempt,
        )
    
    except subprocess.TimeoutExpired:
        return SandboxTestResponse(
            success=False,
            failed_step="timeout",
            error="Sandbox test timed out",
            errors=["Operation took too long"],
        )
    
    except Exception as e:
        print(f"[Sandbox Test] Error: {str(e)}")
        return SandboxTestResponse(
            success=False,
            failed_step="unknown",
            error=str(e),
            errors=[str(e)],
        )
    
    finally:
        # Clean up temp directory
        try:
            shutil.rmtree(temp_dir)
        except:
            pass


# =============================================================================
# STREAMING SANDBOX TEST ENDPOINT - With real-time progress
# =============================================================================

@router.post("/sandbox-test/stream")
async def run_sandbox_test_stream(
    request: SandboxTestRequest,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Run sandbox validation with streaming progress updates.
    
    Streams progress (matches GitHub Actions workflow validation steps):
    - "collecting" - Collecting files
    - "duplicate_check" - Checking for duplicates
    - "syntax" - Validating syntax
    - "fmt" - Running terraform fmt -check (formatting check)
    - "init" - Running terraform init
    - "validate" - Running terraform validate
    - "plan" - Running terraform plan (shows what would change)
    - "apply" - Skipped in sandbox (validation-only). Apply runs in GitHub Actions workflow.
    - "auto_heal" - Auto-healing errors (if needed)
    - "security" - Running security scan
    - "complete" - Done
    
    Note: Sandbox is validation-only and does not create resources. 
    Apply step is skipped here but will run in the actual GitHub Actions workflow.
    
    Returns: text/event-stream with JSON events
    """
    import re
    import httpx
    
    async def generate_stream() -> AsyncGenerator[str, None]:
        temp_dir = tempfile.mkdtemp(prefix="tf-sandbox-stream-")
        
        try:
            # Helper to send step updates
            def step_event(step: str, status: str, message: str = "", data: dict = None):
                event = {"type": "step", "step": step, "status": status, "message": message}
                if data:
                    event["data"] = data
                return f"data: {json.dumps(event)}\n\n"
            
            yield step_event("collecting", "running", "Collecting workspace files...")
            await asyncio.sleep(0.05)
            
            # Ensure plugin cache exists
            os.makedirs(PLUGIN_CACHE_DIR, exist_ok=True)
            env = os.environ.copy()
            env['TF_PLUGIN_CACHE_DIR'] = PLUGIN_CACHE_DIR

            def _detail_from_output(stderr: Optional[str], stdout: Optional[str], max_len: int = 1000) -> str:
                """Build non-empty detail from subprocess stderr/stdout for diagnostics."""
                parts = [(stderr or "").strip(), (stdout or "").strip()]
                text = "\n".join(p for p in parts if p).strip()[:max_len]
                return text if text else "(no output captured)"

            def _error_detail_from_diagnostics(diagnostics: List[Dict[str, Any]], max_len: int = 1000) -> str:
                """Build error_detail string from diagnostics for complete event."""
                parts = [
                    (d.get("detail") or d.get("summary") or "Unknown error").strip()
                    for d in diagnostics
                    if d.get("severity") == "error"
                ]
                text = "\n".join(p for p in parts if p).strip()[:max_len]
                return text if text else "No error details available"

            # Write all files to temp dir
            tf_files = {}
            has_provider_block = False
            
            for file_info in request.files:
                filepath = os.path.join(temp_dir, file_info['path'])
                os.makedirs(os.path.dirname(filepath) if os.path.dirname(filepath) else temp_dir, exist_ok=True)
                with open(filepath, 'w') as f:
                    f.write(file_info['content'])
                if file_info['path'].endswith('.tf'):
                    tf_files[file_info['path']] = file_info['content']
                    if 'required_providers' in file_info['content'] or 'terraform {' in file_info['content']:
                        has_provider_block = True
            
            yield step_event("collecting", "passed", f"{len(tf_files)} .tf files collected")
            await asyncio.sleep(0.05)
            
            # Auto-add required_providers block if missing
            if not has_provider_block and tf_files:
                needs_do_provider = any('digitalocean_' in content for content in tf_files.values())
                needs_aws_provider = any('aws_' in content for content in tf_files.values())
                needs_random_provider = any('random_' in content for content in tf_files.values())
                
                if needs_do_provider or needs_aws_provider or needs_random_provider:
                    providers_content = '''terraform {
  required_providers {
'''
                    if needs_do_provider:
                        providers_content += '''    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
'''
                    if needs_aws_provider:
                        providers_content += '''    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
'''
                    if needs_random_provider:
                        providers_content += '''    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
'''
                    providers_content += '''  }
}
'''
                    providers_path = os.path.join(temp_dir, '_providers.tf')
                    with open(providers_path, 'w') as f:
                        f.write(providers_content)
            
            # STEP 1: Check for duplicate resources
            yield step_event("duplicate_check", "running", "Checking for duplicate resources...")
            await asyncio.sleep(0.05)
            
            all_fixes_applied: List[Dict[str, Any]] = []
            duplicate_check = {"status": "skipped", "message": "No DigitalOcean token configured"}
            available_cidr = None
            has_duplicate_vpc_issues = False
            synthetic_duplicate_diagnostics: List[Dict[str, Any]] = []
            
            # Get DO token using team service (checks team, user, then env)
            do_token = None
            token_source = None
            
            # Try to get team token - check provided team_id or user's teams
            try:
                from app.database.connection import auth_session_context
                from app.services.team_service import TeamService
                
                with auth_session_context() as auth_db:
                    team_service = TeamService(auth_db)
                    
                    # If team_id provided, use it; otherwise check all user's teams
                    if request.team_id:
                        do_token = team_service.get_digitalocean_token(request.team_id, current_user)
                        if do_token:
                            token_source = f"team:{request.team_id}"
                            print(f"[Sandbox Test Stream] Using DO token from team: {request.team_id}")
                    else:
                        # Check all teams user is a member of
                        user_teams = team_service.get_user_teams(current_user.id)
                        print(f"[Sandbox Test Stream] Checking {len(user_teams)} team(s) for DO token...")
                        for team in user_teams:
                            token = team_service.get_digitalocean_token(team.id, current_user)
                            if token:
                                do_token = token
                                token_source = f"team:{team.id}"
                                print(f"[Sandbox Test Stream] Found DO token from team: {team.name} ({team.id})")
                                break
            except Exception as e:
                print(f"[Sandbox Test Stream] Error getting team token: {e}")
                import traceback
                traceback.print_exc()
            
            # Fallback to user/env if no team token
            if not do_token:
                if current_user.digitalocean_access_token:
                    do_token = current_user.digitalocean_access_token
                    token_source = "user"
                    print(f"[Sandbox Test Stream] Using DO token from user credentials")
                else:
                    do_token = os.environ.get('DIGITALOCEAN_TOKEN')
                    if do_token:
                        token_source = "environment"
                        print(f"[Sandbox Test Stream] Using DO token from environment variable")
            
            if not do_token:
                print(f"[Sandbox Test Stream] No DigitalOcean token found (checked teams, user, env)")
            
            if do_token:
                try:
                    async with httpx.AsyncClient() as client:
                        vpcs_response = await client.get(
                            "https://api.digitalocean.com/v2/vpcs",
                            headers={"Authorization": f"Bearer {do_token}"}
                        )
                        
                        if vpcs_response.status_code == 200:
                            vpcs_data = vpcs_response.json()
                            used_cidrs = [vpc.get('ip_range', '') for vpc in vpcs_data.get('vpcs', [])]
                            
                            for i in range(0, 256):
                                test_cidr = f"10.{i}.0.0/16"
                                if test_cidr not in used_cidrs:
                                    available_cidr = test_cidr
                                    break
                            
                            vpc_names_in_tf = []
                            for content in tf_files.values():
                                vpc_names_in_tf.extend(_extract_digitalocean_vpc_names_from_content(content))
                            
                            existing_vpc_names = [vpc.get('name', '') for vpc in vpcs_data.get('vpcs', [])]
                            duplicates = set(vpc_names_in_tf) & set(existing_vpc_names)
                            
                            if duplicates:
                                dup_names = set(duplicates)
                                names_str = ", ".join(sorted(dup_names))
                                duplicate_check = {
                                    "status": "passed",
                                    "message": f"Duplicate VPC name(s) detected ({names_str}); auto-heal will fix.",
                                    "duplicates": list(duplicates),
                                }
                                has_duplicate_vpc_issues = True
                                synthetic_duplicate_diagnostics = [{
                                    "severity": "error",
                                    "summary": "Duplicate VPC name(s) in DigitalOcean account",
                                    "detail": (
                                        f"VPC name(s) already exist in your DigitalOcean account: {names_str}. "
                                        "Rename the 'name' attribute to a unique value so Terraform creates a new VPC, "
                                        "or use a data source to reference the existing VPC."
                                    ),
                                }]
                            else:
                                duplicate_check = {"status": "passed", "message": f"No duplicates found. {len(used_cidrs)} existing VPCs."}
                except Exception as e:
                    duplicate_check = {"status": "skipped", "message": str(e)}
            
            step_status = "passed" if duplicate_check.get("status") == "passed" else "skipped"
            yield step_event("duplicate_check", step_status, duplicate_check.get("message", ""), {"available_cidr": available_cidr})
            await asyncio.sleep(0.05)
            
            # STEP 2: Validate Terraform syntax
            yield step_event("syntax", "running", "Validating Terraform syntax...")
            await asyncio.sleep(0.05)
            
            syntax_errors = []
            for filename, content in tf_files.items():
                if content.count('{') != content.count('}'):
                    syntax_errors.append(f"{filename}: Mismatched braces")
                if content.count('"') % 2 != 0:
                    syntax_errors.append(f"{filename}: Unclosed quotes")
            
            if syntax_errors:
                yield step_event("syntax", "failed", f"{len(syntax_errors)} syntax errors", {"errors": syntax_errors})
                error_detail = "\n".join(syntax_errors)
                yield f"data: {json.dumps({'type': 'complete', 'success': False, 'failed_step': 'syntax', 'errors': syntax_errors, 'error_detail': error_detail})}\n\n"
                return
            
            yield step_event("syntax", "passed", "No syntax errors")
            await asyncio.sleep(0.05)
            
            # Initialize current_tf_files before fmt step (used for tracking file state)
            current_tf_files = tf_files.copy()
            
            # STEP 3: Terraform fmt (auto-fix formatting, matches GitHub Actions workflow)
            yield step_event("fmt", "running", "Formatting Terraform files...")
            await asyncio.sleep(0.05)
            
            # First check if formatting is needed
            fmt_check_result = subprocess.run(
                ['terraform', 'fmt', '-recursive', '-check'],
                cwd=temp_dir,
                capture_output=True,
                text=True,
                env=env,
                timeout=30
            )
            
            if fmt_check_result.returncode != 0:
                # Files need formatting - auto-fix them
                print(f"🔧 [Sandbox] Files need formatting, auto-fixing...")
                fmt_fix_result = subprocess.run(
                    ['terraform', 'fmt', '-recursive'],
                    cwd=temp_dir,
                    capture_output=True,
                    text=True,
                    env=env,
                    timeout=30
                )
                
                if fmt_fix_result.returncode == 0:
                    # Re-read the formatted files
                    for filename in tf_files.keys():
                        filepath = os.path.join(temp_dir, filename)
                        if os.path.exists(filepath):
                            with open(filepath, 'r') as f:
                                tf_files[filename] = f.read()
                                current_tf_files[filename] = tf_files[filename]
                    yield step_event("fmt", "passed", "Auto-formatted Terraform files")
                else:
                    fmt_output = fmt_fix_result.stdout + fmt_fix_result.stderr
                    yield step_event("fmt", "warning", f"Formatting attempted but may have issues: {fmt_output[:200]}")
            else:
                yield step_event("fmt", "passed", "All Terraform files are properly formatted")
            
            await asyncio.sleep(0.05)
            
            # STEP 4 & 5: Init + Validate with auto-heal (matches GitHub Actions workflow)
            MAX_AUTO_HEAL_ATTEMPTS = 3
            auto_healed = False
            current_attempt = 1
            plan_summary = "Validation successful"
            
            for attempt in range(1, MAX_AUTO_HEAL_ATTEMPTS + 1):
                current_attempt = attempt
                
                # Debug: Log files in temp_dir at start of each attempt (including subdirs)
                try:
                    all_tf_files = []
                    for root, dirs, files in os.walk(temp_dir):
                        for f in files:
                            if f.endswith('.tf'):
                                rel_path = os.path.relpath(os.path.join(root, f), temp_dir)
                                all_tf_files.append(rel_path)
                    print(f"🔄 [Sandbox Attempt {attempt}] Starting. .tf files in temp_dir: {all_tf_files}")
                    for tf_file in all_tf_files:
                        file_path = os.path.join(temp_dir, tf_file)
                        file_size = os.path.getsize(file_path)
                        print(f"   📄 {tf_file}: {file_size} bytes")
                except Exception as e:
                    print(f"⚠️  [Sandbox Attempt {attempt}] Could not list temp_dir: {e}")
                
                # Run terraform init (matches GitHub Actions workflow)
                yield step_event("init", "running", f"Running terraform init (attempt {attempt}/{MAX_AUTO_HEAL_ATTEMPTS})...")
                await asyncio.sleep(0.05)
                
                init_result = subprocess.run(
                    ['terraform', 'init', '-upgrade=false', '-input=false', '-backend=false'],
                    cwd=temp_dir,
                    capture_output=True,
                    text=True,
                    env=env,
                    timeout=60
                )
                
                init_failed = init_result.returncode != 0
                init_diagnostics = []
                
                # Debug: Log init result
                print(f"🔧 [Sandbox Attempt {attempt}] terraform init returncode: {init_result.returncode}")
                if init_failed:
                    init_detail = _detail_from_output(init_result.stderr, init_result.stdout)
                    print(f"❌ [Sandbox Attempt {attempt}] Init FAILED: {init_detail[:500]}")
                    init_diagnostics = [{'severity': 'error', 'summary': 'Terraform init failed', 'detail': init_detail}]
                    yield step_event("init", "warning", f"Init failed, will attempt auto-heal...")
                else:
                    print(f"✅ [Sandbox Attempt {attempt}] Init PASSED")
                    yield step_event("init", "passed", "Terraform init successful")
                
                await asyncio.sleep(0.05)
                
                # Run terraform validate (matches GitHub Actions workflow)
                yield step_event("validate", "running", f"Running terraform validate (attempt {attempt}/{MAX_AUTO_HEAL_ATTEMPTS})...")
                await asyncio.sleep(0.05)
                
                validate_result = subprocess.run(
                    ['terraform', 'validate', '-json'],
                    cwd=temp_dir,
                    capture_output=True,
                    text=True,
                    env=env,
                    timeout=30
                )
                
                validation_failed = False
                validation_diagnostics = []
                
                try:
                    validate_json = json.loads(validate_result.stdout)
                    if not validate_json.get('valid', False):
                        validation_failed = True
                        validation_diagnostics = validate_json.get('diagnostics', [])
                        print(f"❌ [Sandbox Attempt {attempt}] Validate FAILED: {len(validation_diagnostics)} diagnostics")
                    else:
                        plan_summary = "Configuration valid"
                        print(f"✅ [Sandbox Attempt {attempt}] Validate PASSED")
                except json.JSONDecodeError:
                    if validate_result.returncode != 0:
                        validation_failed = True
                        validate_detail = _detail_from_output(validate_result.stderr, validate_result.stdout)
                        validation_diagnostics = [{'severity': 'error', 'summary': 'Validate failed', 'detail': validate_detail}]
                        print(f"❌ [Sandbox Attempt {attempt}] Validate FAILED (non-JSON): {validate_detail[:300]}")
                else:
                    # Normalize validate diagnostics so each has non-empty detail for auto-heal
                    validation_diagnostics = [
                        {**d, 'detail': (d.get('detail') or d.get('summary') or '(no message from validate)').strip() or '(no message from validate)'}
                        for d in validation_diagnostics
                    ]
                
                all_diagnostics = init_diagnostics + validation_diagnostics
                if has_duplicate_vpc_issues:
                    all_diagnostics = all_diagnostics + synthetic_duplicate_diagnostics
                
                # Debug: Log the decision factors for auto-heal
                print(f"🔍 [Sandbox Attempt {attempt}] Decision: init_failed={init_failed}, validation_failed={validation_failed}, has_duplicate_vpc_issues={has_duplicate_vpc_issues}")
                print(f"🔍 [Sandbox Attempt {attempt}] Total diagnostics: {len(all_diagnostics)}")
                for i, d in enumerate(all_diagnostics):
                    print(f"   📋 Diagnostic {i+1}: {d.get('summary', 'N/A')[:100]}")
                
                # If both passed and no duplicate VPC issues, run terraform plan (matches GitHub Actions workflow)
                if not init_failed and not validation_failed and not has_duplicate_vpc_issues:
                    print(f"✅ [Sandbox Attempt {attempt}] Entering plan/apply path (all checks passed)")
                    yield step_event("validate", "passed", "Terraform validate successful")
                    await asyncio.sleep(0.05)
                    
                    # Run terraform plan (matches GitHub Actions workflow)
                    print(f"🔄 [Sandbox Attempt {attempt}] Running terraform plan...")
                    yield step_event("plan", "running", "Running terraform plan...")
                    await asyncio.sleep(0.05)
                    
                    plan_result = subprocess.run(
                        ['terraform', 'plan', '-out=tfplan', '-no-color', '-input=false'],
                        cwd=temp_dir,
                        capture_output=True,
                        text=True,
                        env=env,
                        timeout=120  # Plan can take longer
                    )
                    
                    print(f"🔧 [Sandbox Attempt {attempt}] terraform plan returncode: {plan_result.returncode}")
                    if plan_result.returncode == 0:
                        # Parse plan output to get summary
                        plan_output = plan_result.stdout
                        # Extract plan summary (e.g., "Plan: 2 to add, 0 to change, 0 to destroy")
                        plan_match = re.search(r'Plan:\s*(\d+)\s+to\s+add,\s*(\d+)\s+to\s+change,\s*(\d+)\s+to\s+destroy', plan_output)
                        if plan_match:
                            add, change, destroy = plan_match.groups()
                            plan_summary = f"Plan: {add} to add, {change} to change, {destroy} to destroy"
                        else:
                            plan_summary = "Plan completed successfully"
                        print(f"✅ [Sandbox Attempt {attempt}] Plan PASSED: {plan_summary}")
                        yield step_event("plan", "passed", plan_summary)
                    else:
                        # Plan failed - treat as validation error
                        validation_failed = True
                        plan_detail = _detail_from_output(plan_result.stderr, plan_result.stdout)
                        print(f"❌ [Sandbox Attempt {attempt}] Plan FAILED: {plan_detail[:300]}")
                        validation_diagnostics.append({
                            'severity': 'error',
                            'summary': 'Terraform plan failed',
                            'detail': plan_detail
                        })
                        yield step_event("plan", "failed", "Terraform plan failed")
                    
                    # If plan passed, skip apply in sandbox (sandbox is validation-only, apply happens in GitHub Actions)
                    if not validation_failed:
                        # In sandbox mode, we skip apply to avoid creating actual resources
                        # Apply will run in the actual GitHub Actions workflow after PR merge
                        print(f"⏭️  [Sandbox Attempt {attempt}] Skipping apply (sandbox is validation-only)")
                        yield step_event("apply", "skipped", "Apply skipped in sandbox (validation-only mode). Apply will run in GitHub Actions workflow.")
                        # We're done with validation
                        print(f"🎉 [Sandbox Attempt {attempt}] SUCCESS - breaking out of retry loop")
                        break
                    else:
                        print(f"⚠️  [Sandbox Attempt {attempt}] Skipping apply because validation failed")
                
                # If last attempt, fail
                if attempt == MAX_AUTO_HEAL_ATTEMPTS:
                    error_msgs = [d.get('summary', 'Unknown error') for d in all_diagnostics if d.get('severity') == 'error']
                    error_detail = _error_detail_from_diagnostics(all_diagnostics)
                    print(f"❌ [Sandbox Attempt {attempt}] MAX ATTEMPTS REACHED - failing with {len(error_msgs)} errors")
                    yield step_event("plan", "failed", f"Validation failed after {attempt} attempts", {"errors": error_msgs[:5]})
                    yield step_event("auto_heal", "failed", f"Could not fix errors after {attempt} attempts")
                    yield f"data: {json.dumps({'type': 'complete', 'success': False, 'failed_step': 'auto_heal', 'errors': error_msgs[:5], 'error_detail': error_detail, 'auto_healed': auto_healed, 'attempts': current_attempt})}\n\n"
                    return
                
                # Try auto-heal (only reached if plan or apply failed, or init/validate failed)
                print(f"🔄 [Sandbox Attempt {attempt}] Falling through to auto-heal (validation_failed={validation_failed})")
                
                # IMPORTANT: Recompute all_diagnostics to include any errors from plan/apply failures
                # (plan/apply may have added to validation_diagnostics after all_diagnostics was computed)
                all_diagnostics = init_diagnostics + validation_diagnostics
                if has_duplicate_vpc_issues:
                    all_diagnostics = all_diagnostics + synthetic_duplicate_diagnostics
                
                # Check for unfixable errors (billing, auth, rate limits) - skip auto-heal for these
                combined_error_text = " ".join([d.get('detail', '') + d.get('summary', '') for d in all_diagnostics]).lower()
                unfixable_patterns = [
                    'outstanding balance',
                    'billing',
                    'payment required',
                    'account suspended',
                    'unauthorized',
                    'invalid api token',
                    'authentication failed',
                    'rate limit',
                    'too many requests',
                    'service unavailable',
                    'quota exceeded',
                    'limit reached',
                ]
                unfixable_error = None
                for pattern in unfixable_patterns:
                    if pattern in combined_error_text:
                        unfixable_error = pattern
                        break
                
                if unfixable_error:
                    print(f"⛔ [Sandbox Attempt {attempt}] Unfixable error detected: '{unfixable_error}' - skipping auto-heal")
                    error_msgs = [d.get("summary", "Unknown error") for d in all_diagnostics if d.get("severity") == "error"]
                    error_detail = all_diagnostics[0].get("detail", "") if all_diagnostics else ""
                    yield step_event("auto_heal", "failed", f"Cannot auto-fix: {unfixable_error}")
                    yield f"data: {json.dumps({'type': 'complete', 'success': False, 'failed_step': 'apply', 'errors': error_msgs[:5], 'error_detail': error_detail, 'unfixable_error': unfixable_error, 'attempts': current_attempt})}\n\n"
                    return
                
                print(f"🔄 [Sandbox Attempt {attempt}] Diagnostics for auto-heal: {len(all_diagnostics)}")
                
                yield step_event("auto_heal", "running", f"Auto-healing errors (attempt {attempt}/{MAX_AUTO_HEAL_ATTEMPTS})...")
                await asyncio.sleep(0.05)
                # Log diagnostics passed to auto-heal for debugging (print so it appears in journald)
                for i, d in enumerate(all_diagnostics):
                    summary = d.get("summary", "")
                    detail = (d.get("detail") or "")[:300]
                    print(f"[Sandbox Stream] Auto-heal diagnostic {i + 1}: summary={summary!r}, detail_preview={detail!r}")
                try:
                    fixes = await auto_heal_terraform_errors(
                        workspace=temp_dir,
                        diagnostics=all_diagnostics,
                        attempt=attempt,
                        provided_files=current_tf_files,
                        do_token=do_token
                    )
                    
                    if fixes and len(fixes) > 0:
                        auto_healed = True
                        yield step_event("auto_heal", "running", f"Applying {len(fixes)} fixes...")
                        
                        # Debug: Log current state before applying fixes
                        print(f"📂 [Auto-Heal Apply] temp_dir: {temp_dir}")
                        print(f"📂 [Auto-Heal Apply] current_tf_files keys: {list(current_tf_files.keys())}")
                        
                        for fix in fixes:
                            fix_path = fix.get('path', '')
                            new_content = fix.get('newContent', '')
                            
                            print(f"🔧 [Auto-Heal Apply] Processing fix for: {fix_path} ({len(new_content)} chars)")
                            
                            if fix_path and new_content:
                                filepath = os.path.join(temp_dir, fix_path)
                                os.makedirs(os.path.dirname(filepath) if os.path.dirname(filepath) else temp_dir, exist_ok=True)
                                
                                # Debug: Check if file exists before writing
                                file_existed = os.path.exists(filepath)
                                print(f"📝 [Auto-Heal Apply] Writing to: {filepath} (existed: {file_existed})")
                                
                                with open(filepath, 'w') as f:
                                    f.write(new_content)
                                
                                # Verify write succeeded
                                if os.path.exists(filepath):
                                    written_size = os.path.getsize(filepath)
                                    print(f"✅ [Auto-Heal Apply] Written {written_size} bytes to {fix_path}")
                                else:
                                    print(f"❌ [Auto-Heal Apply] File NOT created: {filepath}")
                                
                                current_tf_files[fix_path] = new_content
                                all_fixes_applied.append({
                                    'path': fix_path,
                                    'oldContent': fix.get('oldContent', ''),
                                    'newContent': new_content
                                })
                            else:
                                print(f"⚠️  [Auto-Heal Apply] Skipping fix - missing path or content: path='{fix_path}', content_len={len(new_content) if new_content else 0}")
                        # Re-check duplicate VPC names after fixes; clear flag if resolved
                        if has_duplicate_vpc_issues and do_token:
                            try:
                                vpc_names_in_tf = []
                                for content in current_tf_files.values():
                                    vpc_names_in_tf.extend(_extract_digitalocean_vpc_names_from_content(content))
                                async with httpx.AsyncClient() as client:
                                    vpcs_resp = await client.get(
                                        "https://api.digitalocean.com/v2/vpcs",
                                        headers={"Authorization": f"Bearer {do_token}"}
                                    )
                                if vpcs_resp.status_code == 200:
                                    vpcs_data = vpcs_resp.json()
                                    existing = {vpc.get("name", "") for vpc in vpcs_data.get("vpcs", [])}
                                    still_duplicates = set(vpc_names_in_tf) & existing
                                    if not still_duplicates:
                                        has_duplicate_vpc_issues = False
                            except Exception:
                                pass
                        
                        yield step_event("auto_heal", "running", f"Applied {len(fixes)} fixes, retrying validation...")
                    else:
                        yield step_event("auto_heal", "failed", "Auto-heal could not generate fixes")
                        error_msgs = [d.get('summary', 'Unknown error') for d in all_diagnostics if d.get('severity') == 'error']
                        error_detail = _error_detail_from_diagnostics(all_diagnostics)
                        yield f"data: {json.dumps({'type': 'complete', 'success': False, 'failed_step': 'auto_heal', 'errors': error_msgs[:5], 'error_detail': error_detail, 'auto_healed': False, 'attempts': current_attempt})}\n\n"
                        return
                        
                except Exception as heal_error:
                    yield step_event("auto_heal", "failed", f"Auto-heal error: {str(heal_error)}")
                    error_detail = str(heal_error)
                    yield f"data: {json.dumps({'type': 'complete', 'success': False, 'failed_step': 'auto_heal', 'error': error_detail, 'error_detail': error_detail, 'auto_healed': False, 'attempts': current_attempt})}\n\n"
                    return
            
            # Mark auto-heal as complete if it ran
            if auto_healed:
                yield step_event("auto_heal", "passed", f"Fixed {len(all_fixes_applied)} file(s) in {current_attempt} attempt(s)")
            else:
                yield step_event("auto_heal", "skipped", "No errors to fix")
            
            await asyncio.sleep(0.05)
            
            # STEP 5: Security scan and resource detection
            yield step_event("security", "running", "Running security scan...")
            await asyncio.sleep(0.05)
            
            security_issues = 0
            resources_detected = []
            providers_used = set()
            
            for filename, content in current_tf_files.items():
                # Detect resources from Terraform files
                resource_matches = re.findall(r'resource\s+"([^"]+)"\s+"([^"]+)"', content)
                for resource_type, resource_name in resource_matches:
                    provider = resource_type.split('_')[0] if '_' in resource_type else 'unknown'
                    providers_used.add(provider)
                    resources_detected.append({
                        "type": resource_type,
                        "name": resource_name,
                        "action": "create",
                        "provider": provider
                    })
                
                # Security checks
                if 'publicly_accessible = true' in content.lower():
                    security_issues += 1
                if '0.0.0.0/0' in content:
                    security_issues += 1
                if 'encryption = false' in content.lower() or 'encrypted = false' in content.lower():
                    security_issues += 1
                if re.search(r'(password|secret|api_key|token)\s*=\s*"[^$][^"]{8,}"', content, re.I):
                    security_issues += 1
            
            yield step_event("security", "passed", f"{security_issues} issue(s), {len(resources_detected)} resources detected")
            await asyncio.sleep(0.05)
            
            # Complete!
            # Include duplicate fix details in complete event
            duplicate_fix_details = None
            if duplicate_check.get("auto_fixed_vpcs"):
                duplicate_fix_details = {
                    "detailed_message": duplicate_check.get("detailed_message"),
                    "auto_fixed_vpcs": duplicate_check.get("auto_fixed_vpcs")
                }
            
            yield f"data: {json.dumps({'type': 'complete', 'success': True, 'plan_summary': plan_summary, 'security_issues': security_issues, 'duplicate_check': duplicate_check, 'duplicate_fix_details': duplicate_fix_details, 'available_cidr': available_cidr, 'auto_healed': auto_healed, 'fixes_applied': all_fixes_applied if all_fixes_applied else None, 'attempts': current_attempt, 'resources_detected': resources_detected, 'providers_used': list(providers_used)})}\n\n"
            
        except subprocess.TimeoutExpired:
            yield f"data: {json.dumps({'type': 'complete', 'success': False, 'failed_step': 'timeout', 'error': 'Operation timed out', 'error_detail': 'Operation timed out'})}\n\n"
        except Exception as e:
            error_detail = str(e)
            yield f"data: {json.dumps({'type': 'complete', 'success': False, 'failed_step': 'unknown', 'error': error_detail, 'error_detail': error_detail})}\n\n"
        finally:
            try:
                shutil.rmtree(temp_dir)
            except:
                pass
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

