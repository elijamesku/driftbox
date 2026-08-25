import re
import os
import time
from typing import Optional
from fastapi import Request, Depends
from fastapi.responses import Response
from fastapi import APIRouter, HTTPException
from app.models.requests import RepositoryIndexRequest, NaturalLanguageEdit, RepositoryEditRequest
from app.services.catalog import INFRASTRUCTURE_CATALOG
from app.services.catalog import build_directory_index
from app.services.git_ops import locate_repository_root
from app.services.catalog import find_matching_resources,  build_directory_index, identify_target_resource, extract_existing_resource_identifiers
from app.core.immediate_response import validate_edit_specification   
from app.utils.nl_helpers import should_force_create, extract_bucket_name_from_prompt 
from app.services.editor import apply_ir_operation_to_terraform_file
from app.services.ci_preview import execute_ci_validation_preview
from app.services.git_ops import create_branch_commit_and_push, parse_pull_request_url
from app.services.diff_manager import infrastructure_change_approval_manager
from app.services.cost_tracker import cost_tracker
from app.services.change_explainer import change_explainer
from app.services.enhanced_nlp_processor import nl_to_multi_resource_ir
from app.services.query_logger import query_logger
from app.services.performance_tracker import performance_tracker
from app.services.terraform_validator import terraform_validator
from app.integrations.slack import slack_notifier
from app.services.prompt_validator import prompt_validator
from app.services.terraform_init import terraform_initialization_manager as terraform_init_manager
from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.config import LLM_MODE


router = APIRouter()

###############################################################################################################################################################################################################
# defining a post endpoint /index-repo - scans or"indexes" a given directory inside the selected repository to build a tf catalog og its contents so we can later query those resources efficiently           #
# catalog returns the catalog snapshot of whats currently in memory (the latest view of the repos infrastructure definition)                                                                                  #      
# snapshot of the terraform resources as parsed from git at commit                                                                                                                                            #      
###############################################################################################################################################################################################################

@router.post("/index-repo")
def index_repo(req: RepositoryIndexRequest):
    root = locate_repository_root()
    rel_dir = req.dir or "."
    base = (root / rel_dir).resolve()
    if not base.exists():
        raise HTTPException(status_code=400, detail={"error": "dir_not_found", "message": f"{rel_dir} does not exist in repo"})

    # Auto-sync with remote before indexing (non-blocking)
    import subprocess
    git_sync_status = {"synced": False, "message": None}
    try:
        # Check if it's a git repo with a remote
        print(f"🔄 [REPO-INDEX] Checking git remote for: {root}")
        remote_check = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if remote_check.returncode == 0:
            remote_url = remote_check.stdout.strip()
            print(f"🔄 [REPO-INDEX] Found remote: {remote_url}")
            
            # Fetch and pull latest changes
            print(f"⬇️  [REPO-INDEX] Running: git fetch origin")
            subprocess.run(["git", "fetch", "origin"], cwd=root, capture_output=True, timeout=10)
            
            print(f"⬇️  [REPO-INDEX] Running: git pull --ff-only")
            pull_result = subprocess.run(
                ["git", "pull", "--ff-only"],  # Fast-forward only to avoid merge conflicts
                cwd=root,
                capture_output=True,
                text=True,
                timeout=15
            )
            
            if pull_result.returncode == 0:
                if "Already up to date" in pull_result.stdout:
                    print(f"✅ [REPO-INDEX] Git pull: Already up to date")
                    git_sync_status = {"synced": True, "message": "Already up to date"}
                else:
                    print(f"✅ [REPO-INDEX] Git pull: Successfully pulled latest changes")
                    print(f"   Output: {pull_result.stdout.strip()}")
                    git_sync_status = {"synced": True, "message": "Pulled latest changes"}
            else:
                # Pull failed (maybe local changes or conflicts) - log but don't block
                print(f"⚠️  [REPO-INDEX] Git pull failed: {pull_result.stderr[:200]}")
                git_sync_status = {"synced": False, "message": f"Pull failed: {pull_result.stderr[:100]}"}
        else:
            print(f"⚠️  [REPO-INDEX] No git remote configured")
            git_sync_status = {"synced": False, "message": "No remote configured"}
    except Exception as e:
        # Git sync failed - log but don't block indexing
        print(f"❌ [REPO-INDEX] Git sync error: {str(e)}")
        git_sync_status = {"synced": False, "message": f"Sync error: {str(e)[:100]}"}

    catalog = build_directory_index(root, rel_dir)
    INFRASTRUCTURE_CATALOG.clear()
    INFRASTRUCTURE_CATALOG.update(catalog)
    
    # Auto-run terraform init (caches result, won't re-init if already done)
    init_result = terraform_init_manager.run_init(root)
    
    response = {
        "ok": True,
        "sha": catalog["sha"],
        "dir": rel_dir,
        "count": catalog["counts"]["resources"],
        "git_sync": git_sync_status,
        "terraform_init": {
            "initialized": init_result["initialized"],
            "cached": init_result.get("cached", False),
            "duration_ms": init_result["duration_ms"]
        }
    }
    
    # Add warning if init failed (but don't block indexing)
    if not init_result["initialized"]:
        response["terraform_init"]["warning"] = init_result.get("error", "Init failed")
    
    return response

@router.get("/catalog")
def get_catalog():
    if not INFRASTRUCTURE_CATALOG.get("sha"):
        raise HTTPException(status_code=404, detail={"error": "not_indexed", "message": "Run /index-repo first"})
    return INFRASTRUCTURE_CATALOG

########################################################################
# Checks that the repo is indexed by running /index-repo               #
# Parses the prompt                                                    #
# Figures out which resources is meant                                 #
# Detects the intent(s3, encryption, tags, iam user creation, dynamodb)#
# Builds machine-readable edit instructions                            #
# AI/NLP terraform edit translator                                     #
########################################################################
@router.post("/nl-edit")
def nl_edit(req: NaturalLanguageEdit):
    if not INFRASTRUCTURE_CATALOG.get("resources"):
        raise HTTPException(400, {"error": "not_indexed", "message": "Run /index-repo first"})

    p = req.prompt.lower()

    # -------------------------
    # small helpers
    # -------------------------
    def _first_match(kind: str, hint: str, limit=5):
        cands = [r for r in find_matching_resources(INFRASTRUCTURE_CATALOG, hint, limit=limit) if r.get("type") == kind]
        return cands

    def _pick_single(kind: str, hint: str):
        cands = _first_match(kind, hint, limit=5)
        if len(cands) > 1:
            raise HTTPException(
                409,
                {
                    "error": "ambiguous",
                    "message": f"Multiple {kind} matched. Please specify by exact name.",
                    "candidates": [{"address": r["address"], "file": r.get("file")} for r in cands[:5]],
                },
            )
        return cands[0] if cands else None

    def _env_from_prompt(text: str) -> Optional[str]:
        if "prod" in text or "production" in text: return "prod"
        if "stage" in text or "staging" in text:   return "stage"
        if "dev" in text or "development" in text: return "dev"
        return None

    # ---- NEW: intent helpers -------------------------------------------------
    CREATE_WORDS = {"create","new","provision","make","spin up","add bucket","add a bucket"}
    UPDATE_WORDS = {"update","edit","modify","change","enable","disable","turn on","turn off","set","enforce","block","apply","configure"}

    def _wants_create(text: str) -> bool:
        return any(w in text for w in CREATE_WORDS)

    def _wants_update(text: str) -> bool:
        return any(w in text for w in UPDATE_WORDS)

    # best-effort bucket name parser: "named X", "name X", "bucket X", quotes, etc.
    def _bucket_name_from_prompt(text: str) -> Optional[str]:
        # quoted name first
        m = re.search(r'(?:named|name|bucket)\s+"([^"]+)"', text)
        if m: return m.group(1)
        m = re.search(r"(?:named|name|bucket)\s+([a-z0-9.\-_]+)", text)
        if m: return m.group(1)
        # plain token after "create/new/provision"
        m = re.search(r"(?:create|new|provision|make)\s+(?:an?\s+)?s3\s+bucket\s+(?:named\s+)?([a-z0-9.\-_]+)", text)
        if m: return m.group(1)
        return None

    # build a CREATE IR for S3 with optional knobs
    def _build_s3_create_ir(bucket_name: Optional[str], *, want_versioning: Optional[bool]=None,
                            sse_algo: Optional[str]=None, kms_key: Optional[str]=None, env: Optional[str]=None):
        name = bucket_name or "new-bucket"
        env = env or "dev"
        ops = [
            {
                "action": "create",
                "selector": {"type": "aws_s3_bucket", "name": name},
                "changes": [
                    {"op": "set", "path": "bucket", "value": name},
                    {"op": "set", "path": "tags.env", "value": env},
                ],
                "file_hint": "main.tf",
            }
        ]
        if want_versioning is not None:
            ops[0]["changes"].append({"op": "ensure_block", "path": "versioning.enabled", "value": bool(want_versioning)})
        if sse_algo:
            ops[0]["changes"].append({
                "op": "ensure_block",
                "path": "server_side_encryption_configuration.rule.apply_server_side_encryption_by_default.sse_algorithm",
                "value": sse_algo,
            })
            if sse_algo == "aws:kms" and kms_key:
                ops[0]["changes"].append({
                    "op": "ensure_block",
                    "path": "server_side_encryption_configuration.rule.apply_server_side_encryption_by_default.kms_master_key_id",
                    "value": kms_key,
                })
        return {"ops": ops}

    # -------------------------
    # S3 intents
    # -------------------------
    if ("version" in p) and ("s3" in p or "bucket" in p):
        # detect create vs update
        want_create = _wants_create(p) and not _wants_update(p)
        requested_name = _bucket_name_from_prompt(p)
        env = _env_from_prompt(p)

        c = _pick_single("aws_s3_bucket", p)

        # CREATE path: if user asked to create, or no existing bucket matched
        if want_create or not c:
            ir = _build_s3_create_ir(
                requested_name,
                want_versioning=True,
                env=env,
            )
            validate_edit_specification(ir)
            return {"ir": ir}

        # UPDATE path (existing bucket)
        sel = {"type": "aws_s3_bucket", "name": c["name"]}
        op = {
            "action": "update",
            "selector": sel,
            "changes": [{"op": "ensure_block", "path": "versioning.enabled", "value": True}],
        }
        if c.get("file"):
            op["file_hint"] = c.get("file")
        ir = {"ops": [op]}
        validate_edit_specification(ir)
        return {"ir": ir}

    if ("block public" in p) or ("public access" in p and ("block" in p or "disable" in p)):
        want_create = _wants_create(p) and not _wants_update(p)
        requested_name = _bucket_name_from_prompt(p)
        env = _env_from_prompt(p)

        c = _pick_single("aws_s3_bucket", p)
        if want_create or not c:
            # create a bucket and block public access
            ir = _build_s3_create_ir(requested_name, env=env)
            # add public access block flags on the created bucket resource
            ir["ops"][0]["changes"].extend([
                {"op": "ensure_block", "path": "public_access_block.block_public_acls", "value": True},
                {"op": "ensure_block", "path": "public_access_block.block_public_policy", "value": True},
                {"op": "ensure_block", "path": "public_access_block.ignore_public_acls", "value": True},
                {"op": "ensure_block", "path": "public_access_block.restrict_public_buckets", "value": True},
            ])
            validate_edit_specification(ir)
            return {"ir": ir}

        # UPDATE path
        sel = {"type": "aws_s3_bucket", "name": c["name"]}
        changes = [
            {"op": "ensure_block", "path": "public_access_block.block_public_acls", "value": True},
            {"op": "ensure_block", "path": "public_access_block.block_public_policy", "value": True},
            {"op": "ensure_block", "path": "public_access_block.ignore_public_acls", "value": True},
            {"op": "ensure_block", "path": "public_access_block.restrict_public_buckets", "value": True},
        ]
        op = {"action": "update", "selector": sel, "changes": changes}
        if c.get("file"):
            op["file_hint"] = c.get("file")
        ir = {"ops": [op]}
        validate_edit_specification(ir)
        return {"ir": ir}

    if ("encrypt" in p or "encryption" in p or "sse" in p) and ("s3" in p or "bucket" in p):
        want_create = _wants_create(p) and not _wants_update(p)
        requested_name = _bucket_name_from_prompt(p)
        env = _env_from_prompt(p)

        c = _pick_single("aws_s3_bucket", p)

        use_kms = ("kms" in p) or ("aws:kms" in p)
        algo = "aws:kms" if use_kms else "AES256"
        m = re.search(r"(?:kms[_\s-]?key|key_id|key)=([^\s]+)", p)
        kms_key = m.group(1) if (use_kms and m) else None

        if want_create or not c:
            # create new bucket with requested encryption
            ir = _build_s3_create_ir(
                requested_name,
                sse_algo=algo,
                kms_key=kms_key,
                env=env,
            )
            validate_edit_specification(ir)
            return {"ir": ir}

        # UPDATE path
        sel = {"type": "aws_s3_bucket", "name": c["name"]}
        changes = [
            {
                "op": "ensure_block",
                "path": "server_side_encryption_configuration.rule.apply_server_side_encryption_by_default.sse_algorithm",
                "value": algo,
            }
        ]
        if kms_key:
            changes.append(
                {
                    "op": "ensure_block",
                    "path": "server_side_encryption_configuration.rule.apply_server_side_encryption_by_default.kms_master_key_id",
                    "value": kms_key,
                }
            )
        op = {"action": "update", "selector": sel, "changes": changes}
        if c.get("file"):
            op["file_hint"] = c.get("file")
        ir = {"ops": [op]}
        validate_edit_specification(ir)
        return {"ir": ir}

    if "tag" in p and ("s3" in p or "bucket" in p):
        want_create = _wants_create(p) and not _wants_update(p)
        requested_name = _bucket_name_from_prompt(p)
        env = _env_from_prompt(p)

        c = _pick_single("aws_s3_bucket", p)

        kv = re.search(r"tag[s]?\s+([a-z0-9_.-]+)\s*=\s*([a-z0-9_.:-]+)", p)
        tag_changes = []
        if kv:
            k, v = kv.group(1), kv.group(2)
            tag_changes.append({"op": "set", "path": f"tags.{k}", "value": v})
        elif env:
            tag_changes.append({"op": "set", "path": "tags.env", "value": env})
        else:
            tag_changes.append({"op": "set", "path": "tags.env", "value": "dev"})

        if want_create or not c:
            # create bucket and apply tags
            ir = _build_s3_create_ir(requested_name, env=env)
            ir["ops"][0]["changes"].extend(tag_changes)
            validate_edit_specification(ir)
            return {"ir": ir}

        # UPDATE path
        sel = {"type": "aws_s3_bucket", "name": c["name"]}
        op = {"action": "update", "selector": sel, "changes": tag_changes}
        if c.get("file"):
            op["file_hint"] = c.get("file")
        ir = {"ops": [op]}
        validate_edit_specification(ir)
        return {"ir": ir}

    # -------------------------
    # IAM intents
    # -------------------------
    if ("create" in p or "new" in p) and ("iam" in p) and ("user" in p):
        m = re.search(r"(?:user|username)\s+([a-z0-9._-]+)", p)
        uname = m.group(1) if m else "app-user"
        ir = {
            "ops": [
                {
                    "action": "create",
                    "selector": {"type": "aws_iam_user", "name": uname},
                    "changes": [
                        {"op": "set", "path": "name", "value": uname},
                        {"op": "set", "path": "tags.env", "value": _env_from_prompt(p) or "dev"},
                        {"op": "set", "path": "force_destroy", "value": False},
                    ],
                    "file_hint": "iam.tf",
                }
            ]
        }
        validate_edit_ir(ir)
        return {"ir": ir}

    # -------------------------
    # DynamoDB intents
    # -------------------------
    if (("enable" in p or "turn on" in p) and "ttl" in p) and ("ddb" in p or "dynamo" in p or "table" in p):
        c = _pick_single("aws_dynamodb_table", p)
        sel = {"type": "aws_dynamodb_table"}
        file_hint = None
        if c:
            sel["name"] = c["name"]
            file_hint = c.get("file")

        attr = "expiresAt"
        m = re.search(r"ttl[_\s-]?attr(?:ibute)?\s*=\s*([a-zA-Z0-9_.-]+)", p)
        if m:
            attr = m.group(1)

        changes = [
            {"op": "ensure_block", "path": "ttl.enabled", "value": True},
            {"op": "set", "path": "ttl.attribute_name", "value": attr},
        ]
        op = {"action": "update", "selector": sel, "changes": changes}
        if file_hint:
            op["file_hint"] = file_hint

        ir = {"ops": [op]}
        validate_edit_ir(ir)
        return {"ir": ir}

    # -------------------------
    # Fallback — create a minimal S3 w/ versioning & env tag
    # -------------------------
    ir = {
        "ops": [
            {
                "action": "create",
                "selector": {"type": "aws_s3_bucket"},
                "changes": [
                    {"op": "set", "path": "bucket", "value": "new-bucket"},
                    {"op": "ensure_block", "path": "versioning.enabled", "value": True},
                    {"op": "set", "path": "tags.env", "value": "dev"},
                ],
                "file_hint": "main.tf",
            }
        ]
    }
    validate_edit_specification(ir)
    return {"ir": ir}


@router.post("/edit-repo")
def edit_repo_generic(req: RepositoryEditRequest, request: Request):
    if not INFRASTRUCTURE_CATALOG.get("resources"):
        raise HTTPException(400, {"error": "not_indexed", "message": "Run /index-repo first"})

    # 1) Resolve/validate Edit IR
    if req.ir:
        edit_ir = req.ir
        validate_edit_specification(edit_ir)
    elif req.prompt:
        resp = nl_edit(NaturalLanguageEdit(prompt=req.prompt))  # reuse local fn
        edit_ir = resp["ir"]
    else:
        raise HTTPException(400, {"error": "missing_input", "message": "Provide 'prompt' or 'ir'"})
    
        # --- BEGIN: promote create intent for non-existent targets ---------------
    force_create =  should_force_create(req.prompt or "", request.query_params.get("prefer"))
    want_bucket_name =  extract_bucket_name_from_prompt(req.prompt or "")
    existing_ids =  extract_existing_resource_identifiers(INFRASTRUCTURE_CATALOG)

    for op in edit_ir.get("ops", []):
        sel = op.setdefault("selector", {})
        rtype = sel.get("type")
        rname = sel.get("name")
        res_id = f"{rtype}:{rname}" if (rtype and rname) else None

        # If the target doesn't exist and we have create intent, flip update→create
        if force_create and (not res_id or res_id not in existing_ids):
            if op.get("action") == "update":
                op["action"] = "create"
                op["note"] = "Promoted from update → create based on prompt intent"

            # If this is an S3 bucket and we have a name in the prompt, bind it
            if rtype == "aws_s3_bucket" and want_bucket_name:
                # Terraform logical name (identifier) can't have dashes
                sel["name"] = want_bucket_name.replace("-", "_")
                # Ensure the HCL bucket attribute is set to the literal bucket name
                changes = op.setdefault("changes", [])
                if not any(c.get("op") in ("set",) and c.get("path") == "bucket" for c in changes):
                    changes.append({"op": "set", "path": "bucket", "value": want_bucket_name})

            # Ensure we have somewhere to write the resource
            op.setdefault("file_hint", "main.tf")
    # --- END: promote create intent ------------------------------------------


    # 2) Apply ops
    root =  locate_repository_root()
    any_change = False
    touched_files: set[str] = set()

    for op in edit_ir["ops"]:
        target =  identify_target_resource(INFRASTRUCTURE_CATALOG, op["selector"], op.get("file_hint"))
        if not target and op["action"] != "create":
            raise HTTPException(404, {"error": "target_not_found", "message": op["selector"]})
        tf_file = (root / (target["file"] if target else (op.get("file_hint") or "main.tf")))
        try:
            changed = apply_ir_operation_to_terraform_file(tf_file, op, target)  # from editor.py
        except ValueError as e:
            raise HTTPException(400, {"error": "edit_apply_failed", "message": str(e)})
        if changed:
            any_change = True
            touched_files.add(str(tf_file.relative_to(root)))

    # 3) CI preview BEFORE commit/push (fmt → init → validate → plan)
    ci = execute_ci_validation_preview(root, INFRASTRUCTURE_CATALOG.get("dir") or ".")
    if not ci.get("ok"):
        return {
            "ok": False,
            "changed": any_change,
            "ci_preview": ci,
            "note": "Terraform checks failed; fix the issues and retry. No branch was pushed.",
        }

    # 4) Commit + push + PR link (after successful validation)
    safe = re.sub(r"[^a-z0-9-]+", "-", (req.prompt or "edit").lower()).strip("-")[:30]
    branch = f"driftbox/{safe or 'edit'}-{int(time.time())}"
    push_out =  create_branch_commit_and_push(branch, f"Infrara: {req.prompt or 'Apply IR'}", root)
    pr_url =  parse_pull_request_url(push_out)
    repo_env = os.getenv("GITHUB_REPO")
    fallback_url = f"https://github.com/{repo_env}/compare/{branch}?expand=1" if (not pr_url and repo_env) else pr_url

    # --- Minimal plain-text view (no logs), e.g. ?format=min ---
    if request.query_params.get("format") == "min":
        steps = ci.get("steps", [])
        steps_sorted = sorted(steps, key=lambda s: s.get("started_at", ""))

        lines: list[str] = []
        lines.append("RUN ORDER:")
        for s in steps_sorted:
            # BEGIN markers only (no logs)
            lines.append(f"  BEGIN {s['name']}  {s.get('started_at','')}")

        lines.append("")
        lines.append(f"STATUS: {'OK' if ci.get('ok') else 'FAILED'}")
        lines.append(f"BRANCH: {branch}")
        if pr_url or fallback_url:
            lines.append(f"PR: {pr_url or fallback_url}")
        if touched_files:
            lines.append("FILES:")
            for f in sorted(touched_files):
                lines.append(f"  - {f}")

        lines.append("")
        lines.append("CI STEPS SUMMARY:")
        for s in steps_sorted:
            lines.append(f"  {s['name']}: ok={s['ok']}  exit={s['exit_code']}  cmd={s['cmd']}")

        return Response("\n".join(lines) + "\n", media_type="text/plain")

    # Default JSON response
    return {
        "ok": True,
        "changed": any_change,
        "branch": branch,
        "pr_url": pr_url or fallback_url,
        "touched_files": sorted(touched_files),
        "ci_preview": ci,  # includes detailed step logs/timestamps
        "note": "Open this URL to create the PR." if (pr_url or fallback_url) else "Push succeeded; open your repo to create a PR.",
        "ir": edit_ir,
    }


@router.post("/edit-repo-with-approval")
async def edit_repo_with_approval(
    req: RepositoryEditRequest,
    request: Request,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Enhanced edit endpoint with diff approval workflow, cost tracking, and change explanations.
    Instead of auto-committing, creates a diff session for review and approval.
    Automatically logs all queries for LLM training.
    """
    import time as time_module
    workflow_start = time_module.time()
    
    if not CATALOG.get("resources"):
        raise HTTPException(400, {"error": "not_indexed", "message": "Run /index-repo first"})
    
    # Validate that prompt is infrastructure-related (reject casual chat)
    if req.prompt:
        prompt_validator.validate_or_raise(req.prompt)

    # 1) Resolve/validate Edit IR with performance tracking
    ir_start = time_module.time()
    if req.ir:
        edit_ir = req.ir
        validate_edit_specification(edit_ir)
    elif req.prompt:
        with performance_tracker.track_operation("prompt_to_ir", prompt_length=len(req.prompt), llm_model=LLM_MODE):
            # Use Claude-powered multi-resource parser instead of manual rule-based parser
            # This understands EC2, VPC, Lambda, and all AWS resources, not just S3
            edit_ir = await nl_to_multi_resource_ir(req.prompt)
            validate_edit_specification(edit_ir)
    else:
        raise HTTPException(400, {"error": "missing_input", "message": "Provide 'prompt' or 'ir'"})
    
    ir_time = int((time_module.time() - ir_start) * 1000)
    
    # Promote create intent for non-existent targets
    force_create = should_force_create(req.prompt or "", request.query_params.get("prefer"))
    want_bucket_name = extract_bucket_name_from_prompt(req.prompt or "")
    existing_ids = existing_resource_ids(CATALOG)

    for op in edit_ir.get("ops", []):
        sel = op.setdefault("selector", {})
        rtype = sel.get("type")
        rname = sel.get("name")
        res_id = f"{rtype}:{rname}" if (rtype and rname) else None

        if force_create and (not res_id or res_id not in existing_ids):
            if op.get("action") == "update":
                op["action"] = "create"
                op["note"] = "Promoted from update → create based on prompt intent"

            if rtype == "aws_s3_bucket" and want_bucket_name:
                sel["name"] = want_bucket_name.replace("-", "_")
                changes = op.setdefault("changes", [])
                if not any(c.get("op") in ("set",) and c.get("path") == "bucket" for c in changes):
                    changes.append({"op": "set", "path": "bucket", "value": want_bucket_name})

            op.setdefault("file_hint", "main.tf")

    # 2) Generate file changes (but don't commit yet)
    # Group operations by file to handle multiple creates to the same file
    root = repo_root()
    file_changes = {}
    ops_by_file = {}
    
    # Group ops by target file
    for op in edit_ir["ops"]:
        target = resolve_target(CATALOG, op["selector"], op.get("file_hint"))
        if not target and op["action"] != "create":
            raise HTTPException(404, {"error": "target_not_found", "message": op["selector"]})
        
        tf_file = root / (target["file"] if target else (op.get("file_hint") or "main.tf"))
        file_path = str(tf_file.relative_to(root))
        
        if file_path not in ops_by_file:
            ops_by_file[file_path] = {
                "tf_file": tf_file,
                "ops": [],
                "targets": []
            }
        ops_by_file[file_path]["ops"].append(op)
        ops_by_file[file_path]["targets"].append(target)
    
    # Apply all ops per file, then save and revert
    for file_path, file_info in ops_by_file.items():
        tf_file = file_info["tf_file"]
        
        # Read original content once
        old_content = tf_file.read_text() if tf_file.exists() else ""
        
        # Apply all operations for this file
        for op, target in zip(file_info["ops"], file_info["targets"]):
            try:
                apply_ir_operation_to_terraform_file(tf_file, op, target)
            except ValueError as e:
                # Revert before raising
                if old_content:
                    tf_file.write_text(old_content)
                elif tf_file.exists():
                    tf_file.unlink()
                raise HTTPException(400, {"error": "edit_apply_failed", "message": str(e)})
        
        # Read final content after all ops applied
        new_content = tf_file.read_text() if tf_file.exists() else ""
        
        # Store the change
        if old_content != new_content:
            file_changes[file_path] = {
                "old": old_content,
                "new": new_content,
            }
        
        # Revert the file (we'll apply it later when approved)
        if old_content:
            tf_file.write_text(old_content)
        elif tf_file.exists():
            tf_file.unlink()

    if not file_changes:
        return {
            "ok": True,
            "message": "No changes detected",
            "ir": edit_ir,
        }

    # 2.5) Fast validation (fmt + syntax check, no init)
    validation_results = None
    if file_changes:
        try:
            # Temporarily write files (create parent dirs if needed)
            for file_path, change in file_changes.items():
                file = root / file_path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(change["new"])
            
            # Run fast validation
            validation_results = terraform_validator.quick_validate(root)
            
            # Revert files
            for file_path, change in file_changes.items():
                if change["old"]:
                    (root / file_path).write_text(change["old"])
                else:
                    (root / file_path).unlink()
            
            # Only fail on critical syntax errors
            if validation_results and validation_results.get("valid") is False:
                error_msg = "\n".join(validation_results["errors"][:3])  # Show first 3
                
                # Send Slack notification about validation failure
                try:
                    slack_notifier.notify_validation_failed(
                        errors=validation_results["errors"],
                        prompt=req.prompt or "Infrastructure changes"
                    )
                except Exception as e:
                    print(f"⚠️  Slack notification failed: {e}")
                
                raise HTTPException(400, {
                    "error": "terraform_invalid",
                    "message": f"Generated Terraform has syntax errors:\n{error_msg}",
                    "validation": validation_results
                })
                
        except HTTPException:
            raise
        except Exception as e:
            # Don't fail workflow - just warn
            validation_results = {
                "valid": None,
                "warnings": [f"Validation unavailable: {str(e)}"]
            }

    # 3) Estimate cost impact
    cost_impact = None
    try:
        cost_impact = cost_tracker.estimate_change_cost_impact(CATALOG, edit_ir.get("ops", []))
    except Exception as e:
        # Cost estimation is optional, don't fail if it errors
        cost_impact = {"error": str(e)}

    # 4) Generate AI explanation
    explanation = None
    try:
        explanation = change_explainer.explain_changes(req.prompt or "Infrastructure changes", edit_ir, file_changes)
    except Exception as e:
        explanation = f"Explanation unavailable: {str(e)}"

    # 5) Create diff session with user_id for authorization
    diff_session = infrastructure_change_approval_manager.initialize_diff_session(
        user_prompt=req.prompt or "Infrastructure changes",
        infrastructure_changes=edit_ir,
        file_modifications=file_changes,
        user_id=user.id,  # Store user_id for authorization
        cost_impact_data=cost_impact,
        change_explanation=explanation,
        validation_results=validation_results,
    )

    # 6) Add cost explanation if available
    cost_explanation = None
    if cost_impact and "error" not in cost_impact:
        try:
            cost_explanation = change_explainer.explain_cost_impact(cost_impact)
        except Exception:
            pass
    
    # 7) Log query for LLM training (async, don't fail if it errors)
    workflow_time = int((time_module.time() - workflow_start) * 1000)
    try:
        query_logger.log_query(
            prompt=req.prompt or "IR provided directly",
            ir=edit_ir,
            reasoning_tree={"explanation": explanation, "cost_impact": cost_impact},
            execution_time_ms=workflow_time,
            llm_model=LLM_MODE,
            user_id=request.headers.get("X-User-ID"),  # Optional user tracking
            success=True,
        )
    except Exception as e:
        # Don't fail the request if logging fails
        print(f"⚠️  Query logging failed: {e}")

    return {
        "ok": True,
        "diff_id": diff_session["diff_id"],
        "prompt": req.prompt,
        "explanation": explanation,
        "cost_impact": cost_impact,
        "validation": validation_results,
        "cost_explanation": cost_explanation,
        "file_count": len(file_changes),
        "files": list(file_changes.keys()),
        "status": "pending_approval",
        "timing": {
            "ir_generation_ms": ir_time,
            "total_workflow_ms": workflow_time,
        },
        "message": f"Changes ready for review. Use /diff/{diff_session['diff_id']} to view and approve.",
        "next_steps": [
            f"GET /diff/{diff_session['diff_id']} - View full diff",
            f"POST /diff/{diff_session['diff_id']}/approve - Approve changes",
            f"POST /diff/{diff_session['diff_id']}/reject - Reject changes",
            f"POST /diff/{diff_session['diff_id']}/commit - Commit approved changes",
        ],
    }
