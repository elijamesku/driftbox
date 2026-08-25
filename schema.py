# schema.py
import os
import re
import json
import shutil
import tempfile
import textwrap
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple, Optional

from fastapi import FastAPI, HTTPException, Response
from rag.difficulty import score_query_difficulty
from fastapi.responses import JSONResponse
from fastapi.requests import Request
from pydantic import BaseModel
from jsonschema import Draft202012Validator
from jinja2 import Template
from starlette.exceptions import HTTPException as StarletteHTTPException

# -----------------------------
# Optional RAG stack (rag/*)
# -----------------------------
try:
    from rag.pipeline import ensure_registry_crawled, ensure_index_built, run_pipeline
    from rag.retrieve import search as rag_search
    from rag.generate import nl_to_resource_plan as rag_plan_json
    from rag.hcl import plan_to_hcl as rag_plan_to_hcl
    RAG_ENABLED = True
except Exception:
    ensure_registry_crawled = ensure_index_built = run_pipeline = None
    rag_search = rag_plan_json = rag_plan_to_hcl = None
    RAG_ENABLED = False

try:
    import hcl2  # pip install python-hcl2
except Exception:
    hcl2 = None

# --- external edit helpers ---
from editor import apply_op_to_file  # local module

# ------------------------------------------------------------------------------
# In-memory catalog (populated via /index-repo)
# ------------------------------------------------------------------------------
CATALOG: Dict[str, Any] = {"sha": None, "dir": ".", "resources": [], "modules": [], "variables": [], "outputs": []}

# ------------------------------------------------------------------------------
# Config
# ------------------------------------------------------------------------------
LLM_MODE = os.getenv("LLM_MODE", "openai")   # "openai" or "mock"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
EXEC_MODE = os.getenv("EXEC_MODE", "online") # "online" (real) or "offline" (dev)

if LLM_MODE == "openai":
    try:
        from openai import OpenAI  # SDK v1
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    except KeyError:
        raise RuntimeError("OPENAI_API_KEY not set. Export it or use LLM_MODE=mock.")
else:
    _client = None

# ------------------------------------------------------------------------------
# Schemas
# ------------------------------------------------------------------------------
IR_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["resource", "name", "properties", "actions"],
    "properties": {
        "resource": {"type": "string", "enum": ["aws_s3_bucket", "aws_iam_user", "aws_dynamodb_table"]},
        "name": {"type": "string", "minLength": 3, "maxLength": 63},
        "properties": {"type": "object"},
        "actions": {
            "type": "array",
            "items": {"enum": ["plan", "apply"]},
            "minItems": 1,
            "maxItems": 1,
        },
    },
    "additionalProperties": False,
}
VALIDATOR = Draft202012Validator(IR_SCHEMA)

EDIT_IR_SCHEMA = {
    "type": "object",
    "required": ["ops"],
    "properties": {
        "ops": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["action", "selector"],
                "properties": {
                    "action": {"enum": ["create", "update", "delete"]},
                    "selector": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string"},
                            "name": {"type": "string"},
                            "match": {"type": "object"}
                        }
                    },
                    "changes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["op", "path"],
                            "properties": {
                                "op": {"enum": ["set", "ensure_block", "remove"]},
                                "path": {"type": "string"},
                                "value": {}
                            }
                        }
                    },
                    "file_hint": {"type": "string"}
                },
                "additionalProperties": False
            }
        }
    },
    "additionalProperties": False
}
EDIT_VALIDATOR = Draft202012Validator(EDIT_IR_SCHEMA)

def validate_edit_ir(ir: dict):
    errs = sorted(EDIT_VALIDATOR.iter_errors(ir), key=lambda e: e.path)
    if errs:
        msgs = [f"{'/'.join(map(str, e.path))}: {e.message}" for e in errs]
        raise HTTPException(400, {"error": "edit_ir_validation_failed", "messages": msgs})

# --- create-intent helpers ----------------------------------------------------
def _should_force_create(prompt: str, prefer_flag: Optional[str]) -> bool:
    if prefer_flag and prefer_flag.lower() == "create":
        return True
    p = (prompt or "").strip().lower()
    verbs = ["create", "add", "make", "provision", "spin up", "spin-up", "new "]
    return any(p.startswith(v) or f" {v} " in p for v in verbs)

_BUCKET_NAME_PATTERNS = [
    r"(?:named|called)\s+([a-z0-9.-]{3,63})",
    r"\bbucket\s+([a-z0-9.-]{3,63})",
    r"\bname\s+([a-z0-9.-]{3,63})",
    r"\b([a-z0-9.-]{3,63})\b(?:\s+bucket|\s*$)",
]

def _extract_bucket_name_from_prompt(prompt: str) -> Optional[str]:
    txt = (prompt or "")
    for pat in _BUCKET_NAME_PATTERNS:
        m = re.search(pat, txt, flags=re.IGNORECASE)
        if m:
            return m.group(1)
    return None

def _existing_resource_ids(catalog: dict) -> set[str]:
    ids = set()
    for r in (catalog.get("resources") or []):
        rtype = r.get("type"); rname = r.get("name")
        if rtype and rname:
            ids.add(f"{rtype}:{rname}")
    return ids

# ------------------------------------------------------------------------------
# Terraform templates (provider uses skip flags when EXEC_MODE=offline)
# ------------------------------------------------------------------------------
TF_TPL_S3 = Template(textwrap.dedent("""
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "{{ properties.region }}"
  {% if exec_mode == "offline" %}
  skip_credentials_validation   = true
  skip_requesting_account_id    = true
  skip_region_validation        = true
  skip_metadata_api_check       = true
  {% endif %}
}

resource "aws_s3_bucket" "{{ name | replace('-', '_') }}" {
  bucket = "{{ name }}"
  {% if properties.tags %}
  tags = {
  {% for k, v in properties.tags.items() %}
    {{k}} = "{{v}}"
  {% endfor %}
  }
  {% endif %}
}

resource "aws_s3_bucket_versioning" "{{ name | replace('-', '_') }}_ver" {
  bucket = aws_s3_bucket.{{ name | replace('-', '_') }}.id
  versioning_configuration { status = "{{ 'Enabled' if properties.versioning else 'Suspended' }}" }
}

resource "aws_s3_bucket_public_access_block" "{{ name | replace('-', '_') }}_block" {
  bucket                  = aws_s3_bucket.{{ name | replace('-', '_') }}.id
  block_public_acls       = {{ 'true' if properties.block_public_access else 'false' }}
  block_public_policy     = {{ 'true' if properties.block_public_access else 'false' }}
  ignore_public_acls      = {{ 'true' if properties.block_public_access else 'false' }}
  restrict_public_buckets = {{ 'true' if properties.block_public_access else 'false' }}
}
"""))

TF_TPL_IAM_USER = Template(textwrap.dedent("""
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "{{ properties.region }}"
  {% if exec_mode == "offline" %}
  skip_credentials_validation   = true
  skip_requesting_account_id    = true
  skip_region_validation        = true
  skip_metadata_api_check       = true
  {% endif %}
}

resource "aws_iam_user" "{{ name | replace('-', '_') }}" {
  name          = "{{ name }}"
  force_destroy = false
  tags = {
    managed_by = "tfgen-mvp"
    {% if properties.tags %}
    {% for k, v in properties.tags.items() %}
    {{k}} = "{{v}}"
    {% endfor %}
    {% endif %}
  }
}
"""))

TF_TPL_DDB = Template(textwrap.dedent("""
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "{{ properties.region }}"
  {% if exec_mode == "offline" %}
  skip_credentials_validation   = true
  skip_requesting_account_id    = true
  skip_region_validation        = true
  skip_metadata_api_check       = true
  {% endif %}
}

resource "aws_dynamodb_table" "{{ name | replace('-', '_') }}" {
  name         = "{{ name }}"
  billing_mode = "PAY_PER_REQUEST"

  hash_key = "{{ properties.hash_key }}"
  attribute {
    name = "{{ properties.hash_key }}"
    type = "{{ properties.hash_key_type }}"
  }

  {% if properties.tags %}
  tags = {
  {% for k, v in properties.tags.items() %}
    {{k}} = "{{v}}"
  {% endfor %}
  }
  {% endif %}
}
"""))

# ------------------------------------------------------------------------------
# FastAPI app
# ------------------------------------------------------------------------------
app = FastAPI(title="tfgen-mvp", version="1.0.0")

# Optional: prewarm RAG on startup if available
if RAG_ENABLED:
    @app.on_event("startup")
    async def _warm_rag():
        try:
            ensure_registry_crawled()
            ensure_index_built()
        except Exception:
            pass

# -----------------------------
# Models
# -----------------------------
class NLRequest(BaseModel):
    prompt: str

class NLEditRequest(BaseModel):
    prompt: str

class EditRepoRequest(BaseModel):
    prompt: Optional[str] = None
    ir: Optional[dict] = None

class GitRemoteRequest(BaseModel):
    url: str

class IndexRequest(BaseModel):
    dir: Optional[str] = "."

class RAGSearchRequest(BaseModel):
    prompt: str
    k: int = 8

class RAGPlanRequest(BaseModel):
    prompt: str
    region_default: Optional[str] = "us-east-1"

class RAGRunRequest(BaseModel):
    prompt: str
    region_default: Optional[str] = "us-east-1"
    validate: bool = True

# ------------------------------------------------------------------------------
# Exception handlers
# ------------------------------------------------------------------------------
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": "http_exception", "detail": exc.detail})

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": "internal_server_error", "detail": str(exc)})

# ------------------------------------------------------------------------------
# NL → IR (resource generation) for /generate-plan (not the edit IR)
# ------------------------------------------------------------------------------
def _mock_ir(prompt: str) -> dict:
    p = prompt.lower()
    wants_apply = any(w in p for w in ["apply", "deploy", "create now"])
    action = "apply" if wants_apply else "plan"

    if "iam" in p or "user" in p:
        name = "demo-user"
        for t in prompt.replace(",", " ").split():
            if t.endswith("-user"):
                name = t
        return {"resource": "aws_iam_user", "name": name,
                "properties": {"region": "us-east-1", "tags": {"env": "dev"}}, "actions": [action]}
    if any(k in p for k in ["table", "ddb", "dynamo"]):
        name = "events-table"
        for t in prompt.replace(",", " ").split():
            if t.endswith("-table"):
                name = t
        return {"resource": "aws_dynamodb_table", "name": name,
                "properties": {"region": "us-east-1", "hash_key": "pk", "hash_key_type": "S", "tags": {"env": "dev"}}, "actions": [action]}
    name = "logs-bucket"
    for t in prompt.replace(",", " ").split():
        if t.endswith("-bucket"):
            name = t
    return {"resource": "aws_s3_bucket", "name": name,
            "properties": {"versioning": True, "block_public_access": True, "tags": {"env": "dev"}, "region": "us-east-1"},
            "actions": [action]}

def nl_to_ir(prompt: str) -> dict:
    if LLM_MODE == "mock":
        return _mock_ir(prompt)

    try:
        from openai import OpenAI
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    except KeyError:
        raise HTTPException(
            status_code=500,
            detail={"error": "llm_config", "message": "OPENAI_API_KEY not set. Set it or use LLM_MODE=mock."}
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "llm_init_error", "message": str(e)}
        )

    sysmsg = (
        "Convert requests into STRICT JSON matching this JSON Schema:\n"
        + json.dumps(IR_SCHEMA)
        + "\nRules:\n- Only emit JSON (no markdown).\n"
          "- Only these resources: aws_s3_bucket, aws_iam_user, aws_dynamodb_table.\n"
          "- Safe defaults.\n"
          "- Actions allowed: plan or apply (single-item array).\n"
          "- For s3: region=us-east-1, versioning=true, block_public_access=true.\n"
          "- For iam_user: region=us-east-1.\n"
          "- For dynamodb_table: region=us-east-1, billing_mode=PAY_PER_REQUEST, hash_key=pk, hash_key_type=S."
    )

    try:
        resp = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": sysmsg},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )
        txt = resp.choices[0].message.content.strip()
        return json.loads(txt)

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "llm_parse_error", "message": str(e)}
        )

    except Exception as e:
        msg = str(e)
        code = getattr(e, "status_code", None)

        if code == 429 or "rate limit" in msg.lower() or "quota" in msg.lower():
            raise HTTPException(
                status_code=429,
                detail={"error": "rate_limited_or_no_quota",
                        "message": "LLM quota exceeded. Use LLM_MODE=mock or update billing."}
            )

        if code == 401 or "invalid api key" in msg.lower() or "incorrect api key" in msg.lower():
            raise HTTPException(
                status_code=401,
                detail={"error": "llm_auth_error", "message": msg}
            )

        raise HTTPException(
            status_code=500,
            detail={"error": "llm_error", "message": msg}
        )

# ------------------------------------------------------------------------------
# Policy checks & summarizers
# ------------------------------------------------------------------------------
PLAN_RE = re.compile(r"Plan:\s*(\d+)\s+to add,\s*(\d+)\s+to change,\s*(\d+)\s+to destroy", re.IGNORECASE)
RESOURCE_LINE = re.compile(r'^[ \t]*#\s*(?P<addr>[A-Za-z0-9_.\-\[\]]+)\s+will be\s+(?P<action>created|updated in-place|destroyed)$', re.MULTILINE)

def policy_validate(ir: dict):
    errs = sorted(VALIDATOR.iter_errors(ir), key=lambda e: e.path)
    if errs:
        msgs = [f"{'/'.join(map(str, e.path))}: {e.message}" for e in errs]
        raise HTTPException(status_code=400, detail={"error": "ir_validation_failed", "messages": msgs})

    rtype = ir["resource"]
    name = ir["name"]
    props = ir["properties"]

    if not re.match(r"^[a-z0-9\-_.]+$", name):
        raise HTTPException(status_code=400, detail={"error": "invalid_name", "message": "Name must be lowercase alphanum plus - _ ."})
    if name.startswith(("admin", "root", "prod-unsafe", "public-")):
        raise HTTPException(status_code=400, detail={"error": "unsafe_name_prefix", "message": "Disallowed resource name prefix."})

    if rtype == "aws_s3_bucket":
        if not props.get("block_public_access", True):
            raise HTTPException(status_code=400, detail={"error": "unsafe_request", "message": "Public buckets are blocked in MVP."})
        props.setdefault("versioning", True)
        props.setdefault("region", "us-east-1")
        props.setdefault("tags", {"env": "dev"})

    if rtype == "aws_iam_user":
        props.setdefault("region", "us-east-1")
        props.setdefault("tags", {"env": "dev"})

    if rtype == "aws_dynamodb_table":
        props.setdefault("region", "us-east-1")
        t = props.get("hash_key_type", "S")
        if t not in ("S", "N", "B"):
            raise HTTPException(status_code=400, detail={"error": "invalid_hash_key_type", "message": "hash_key_type must be S, N, or B"})
        props.setdefault("hash_key", "pk")
        props["hash_key_type"] = t
        props.setdefault("tags", {"env": "dev"})

def summarize_plan(output: str) -> dict:
    add = change = destroy = 0
    m = PLAN_RE.search(output or "")
    if m:
        add, change, destroy = map(int, m.groups())
    verdict = "ok" if (add + change + destroy) > 0 else "no_changes_or_failed"
    if "No valid credential sources found" in (output or ""):
        verdict = "credentials_missing"
    if "Failed to query available provider packages" in (output or ""):
        verdict = "cannot_reach_terraform_registry"
    if "Error:" in (output or "") and "Plan:" not in (output or ""):
        verdict = "error"
    return {"to_add": add, "to_change": change, "to_destroy": destroy, "verdict": verdict}

def summarize_details(output: str) -> List[dict]:
    details = []
    for m in RESOURCE_LINE.finditer(output or ""):
        details.append({"address": m.group("addr"), "action": m.group("action")})
    return details

# ------------------------------------------------------------------------------
# Safe HCL loading + indexing helpers
# ------------------------------------------------------------------------------
def _safe_hcl_load(path: Path) -> Dict[str, Any]:
    with open(path, "r") as f:
        try:
            return hcl2.load(f) if hcl2 else {}
        except Exception as e:
            return {"_parse_error": str(e)}

def _collect_blocks(obj: Dict[str, Any], key: str) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    block = obj.get(key)
    if not block:
        return out
    if isinstance(block, list):
        for item in block:
            if isinstance(item, dict):
                for name, attrs in item.items():
                    if isinstance(attrs, list) and attrs and isinstance(attrs[0], dict):
                        attrs = attrs[0]
                    out[name] = attrs if isinstance(attrs, dict) else {}
    elif isinstance(block, dict):
        for name, attrs in block.items():
            if isinstance(attrs, list) and attrs and isinstance(attrs[0], dict):
                attrs = attrs[0]
            out[name] = attrs if isinstance(attrs, dict) else {}
    return out

def _repo_root() -> Path:
    p = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if p.returncode != 0:
        raise HTTPException(status_code=500, detail={"error": "not_a_git_repo", "message": p.stderr.strip()})
    return Path(p.stdout.strip())

def _git_sha(root: Path) -> str:
    p = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True)
    if p.returncode != 0:
        raise HTTPException(status_code=500, detail={"error": "git_error", "message": p.stderr.strip()})
    return p.stdout.strip()

def _current_branch(root: Path) -> str:
    p = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=root, capture_output=True, text=True)
    if p.returncode != 0:
        return "unknown"
    return p.stdout.strip()

def _origin_url(root: Path) -> Optional[str]:
    p = subprocess.run(["git", "remote", "get-url", "origin"], cwd=root, capture_output=True, text=True)
    if p.returncode != 0:
        return None
    return p.stdout.strip()

def _collect_resources(obj: Dict[str, Any]) -> List[Dict[str, Any]]:
    res: List[Dict[str, Any]] = []
    block = obj.get("resource")
    if not block:
        return res

    def _push(rtype: str, name: str, attrs_any):
        attrs = attrs_any
        if isinstance(attrs_any, list) and attrs_any and isinstance(attrs_any[0], dict):
            attrs = attrs_any[0]
        if not isinstance(attrs, dict):
            attrs = {}
        res.append({"address": f"{rtype}.{name}", "type": rtype, "name": name, "attrs": attrs})

    if isinstance(block, dict):
        for rtype, items in block.items():
            if isinstance(items, dict):
                for name, attrs in items.items():
                    _push(rtype, name, attrs)
            elif isinstance(items, list):
                for ent in items:
                    if isinstance(ent, dict):
                        for name, attrs in ent.items():
                            _push(rtype, name, attrs)
    elif isinstance(block, list):
        for item in block:
            if isinstance(item, dict):
                for rtype, arr in item.items():
                    if isinstance(arr, list):
                        for ent in arr:
                            if isinstance(ent, dict):
                                for name, attrs in ent.items():
                                    _push(rtype, name, attrs)
                    elif isinstance(arr, dict):
                        for name, attrs in arr.items():
                            _push(rtype, name, attrs)
    return res

def _index_dir(root: Path, rel_dir: str) -> Dict[str, Any]:
    if hcl2 is None:
        raise HTTPException(status_code=500, detail={"error": "missing_dependency", "message": "python-hcl2 not installed. Run: pip install python-hcl2"})
    base = (root / rel_dir).resolve()
    if not base.exists():
        raise HTTPException(status_code=400, detail={"error": "dir_not_found", "message": f"{rel_dir} does not exist in repo"})

    resources: List[Dict[str, Any]] = []
    modules: List[Dict[str, Any]] = []
    variables: List[Dict[str, Any]] = []
    outputs: List[Dict[str, Any]] = []

    for tf in sorted(base.rglob("*.tf")):
        obj = _safe_hcl_load(tf)
        for r in _collect_resources(obj):
            r["file"] = str(tf.relative_to(root))
            resources.append(r)
        for name, attrs in _collect_blocks(obj, "module").items():
            modules.append({"name": name, "file": str(tf.relative_to(root)), "attrs": attrs})
        for name, attrs in _collect_blocks(obj, "variable").items():
            variables.append({"name": name, "file": str(tf.relative_to(root)), "attrs": attrs})
        for name, attrs in _collect_blocks(obj, "output").items():
            outputs.append({"name": name, "file": str(tf.relative_to(root)), "attrs": attrs})

    sha = _git_sha(root)
    return {
        "sha": sha,
        "dir": rel_dir,
        "resources": resources,
        "modules": modules,
        "variables": variables,
        "outputs": outputs,
        "counts": {
            "resources": len(resources),
            "modules": len(modules),
            "variables": len(variables),
            "outputs": len(outputs),
        },
    }

def _search_candidates(catalog: Dict[str, Any], hint: str, limit: int = 5) -> List[Dict[str, Any]]:
    hint_l = hint.lower()
    scored = []
    for r in catalog.get("resources", []):
        hay = f"{r.get('address','')} {r.get('name','')}".lower()
        tags = r.get("attrs", {}).get("tags", {})
        if isinstance(tags, dict):
            hay += " " + " ".join([f"{k}:{v}" for k, v in tags.items()])
        score = 0
        if hint_l in hay:
            score += 10
        for tok in hint_l.split():
            if tok in hay:
                score += 2
        if score > 0:
            scored.append((score, r))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in scored[:limit]]


# --- label rename helpers -----------------------------------------------------
import re

def _append_moved_block(dirpath: Path, from_addr: str, to_addr: str):
    """Append a Terraform 'moved' block into moved.tf (idempotent)."""
    moved_file = dirpath / "moved.tf"
    block = f"moved {{\n  from = {from_addr}\n  to   = {to_addr}\n}}\n"
    existing = moved_file.read_text() if moved_file.exists() else ""
    if block not in existing:
        with moved_file.open("a") as f:
            if existing and not existing.endswith("\n"):
                f.write("\n")
            f.write(block)
            if not block.endswith("\n"):
                f.write("\n")

def _rename_resource_label_in_text(text: str, rtype: str, old_label: str, new_label: str) -> str:
    """
    Change only the resource header label:
      resource "aws_vpc" "old" {  ->  resource "aws_vpc" "new" {
    """
    pattern = rf'(^\s*resource\s+"{re.escape(rtype)}"\s+"){re.escape(old_label)}(" \{{)'
    return re.sub(pattern, rf"\1{new_label}\2", text, flags=re.MULTILINE)

def _update_references_repo_wide(root: Path, rtype: str, old_label: str, new_label: str):
    """
    Update HCL references across *.tf files:
      aws_vpc.old.*   -> aws_vpc.new.*
      ${aws_vpc.old.* -> ${aws_vpc.new.*
    """
    patterns = [
        (rf'(\b{re.escape(rtype)}\.){re.escape(old_label)}(\b)', rf'\1' + new_label + r'\2'),
        (rf'(\${{\s*{re.escape(rtype)}\.){re.escape(old_label)}(\.)', rf'\1' + new_label + r'\2'),
    ]
    for tf in root.rglob("*.tf"):
        original = tf.read_text()
        updated = original
        for pat, repl in patterns:
            updated = re.sub(pat, repl, updated)
        if updated != original:
            tf.write_text(updated)

# ------------------------------------------------------------------------------
# OPA / Conftest policy gate
# ------------------------------------------------------------------------------
def opa_check(ir: dict):
    import subprocess as sp
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        with open(path, "w") as f:
            json.dump(ir, f)

        base = ["conftest", "test", "--policy", "policies", path]
        candidates = [base + ["--input", "json"], base]
        last = None
        for cmd in candidates:
            p = sp.run(cmd, capture_output=True, text=True)
            out = (p.stdout or "") + (p.stderr or "")
            if "unknown flag" in out:
                continue
            last = p
            break
        if last is None:
            raise HTTPException(500, {"error": "policy_error", "message": "Conftest invocation failed for all flag styles"})

        if last.returncode != 0:
            msg = (last.stdout or last.stderr or "").strip()
            raise HTTPException(status_code=400, detail={"error": "policy_denied", "message": msg})
    finally:
        try: os.remove(path)
        except Exception: pass

# ------------------------------------------------------------------------------
# Terraform exec helpers
# ------------------------------------------------------------------------------
def _timestamp() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"

def _run(cmd: List[str], cwd: Path) -> Tuple[int, str]:
    try:
        p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        out, _ = p.communicate()
        return p.returncode, out
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail={"error": "missing_dependency", "message": f"{cmd[0]} not found on PATH"})

def _run_step(name: str, cmd: List[str], cwd: Path) -> Dict[str, Any]:
    started = _timestamp()
    code, out = _run(cmd, cwd)
    finished = _timestamp()
    return {
        "name": name,
        "cmd": " ".join(cmd),
        "ok": code == 0,
        "exit_code": code,
        "started_at": started,
        "finished_at": finished,
        "output": out,
    }

def terraform_plan(workdir: Path) -> dict:
    skip_plan = os.getenv("SKIP_TF_PLAN", "false").lower() == "true"

    if EXEC_MODE == "offline" or skip_plan:
        fake = "# (plan skipped)\nPlan: 0 to add, 0 to change, 0 to destroy."
        steps = [
            {"name":"fmt","ok":True,"exit_code":0,"started_at":_timestamp(),"finished_at":_timestamp(),"cmd":"terraform fmt -recursive","output":"(skipped)"},
            {"name":"init","ok":True,"exit_code":0,"started_at":_timestamp(),"finished_at":_timestamp(),"cmd":"terraform init -backend=false -input=false -no-color","output":"(skipped)"},
            {"name":"validate","ok":True,"exit_code":0,"started_at":_timestamp(),"finished_at":_timestamp(),"cmd":"terraform validate","output":"(skipped)"},
        ]
        return {
            "step": "plan",
            "ok": True,
            "steps": steps,
            "output": fake,
            "summary": summarize_plan(fake),
            "details": summarize_details(fake),
        }

    steps_cfg = [
        (["terraform", "fmt", "-recursive"], "fmt"),
        (["terraform", "init", "-backend=false", "-input=false", "-no-color"], "init"),
        (["terraform", "validate"], "validate"),
    ]
    steps: List[Dict[str, Any]] = []
    last_out = ""
    for cmd, name in steps_cfg:
        rec = _run_step(name, cmd, workdir)
        steps.append(rec)
        last_out = rec["output"]
        if not rec["ok"]:
            return {"step": name, "ok": False, "steps": steps, "output": last_out, "summary": summarize_plan(last_out)}
    fake = "# (plan skipped)\nPlan: 0 to add, 0 to change, 0 to destroy."
    return {
        "step": "plan",
        "ok": True,
        "steps": steps,
        "output": fake,
        "summary": summarize_plan(fake),
        "details": summarize_details(fake),
    }

def terraform_apply(workdir: Path) -> dict:
    fake = "# (apply disabled)\nApply not executed in this environment."
    if EXEC_MODE == "offline":
        steps = [
            {"name":"fmt","ok":True,"exit_code":0,"cmd":"terraform fmt -recursive","output":"(skipped)"},
            {"name":"init","ok":True,"exit_code":0,"cmd":"terraform init -backend=false","output":"(skipped)"},
            {"name":"validate","ok":True,"exit_code":0,"cmd":"terraform validate","output":"(skipped)"},
        ]
        return {
            "step": "apply",
            "ok": True,
            "steps": steps,
            "output": fake,
            "summary": summarize_plan(fake),
            "details": summarize_details(fake),
        }

    steps_cfg = [
        (["terraform", "fmt", "-recursive"], "fmt"),
        (["terraform", "init", "-backend=false", "-input=false", "-no-color"], "init"),
        (["terraform", "validate"], "validate"),
    ]
    steps: List[Dict[str, Any]] = []
    last_out = ""
    for cmd, name in steps_cfg:
        rec = _run_step(name, cmd, workdir)
        steps.append(rec)
        last_out = rec["output"]
        if not rec["ok"]:
            return {"step": name, "ok": False, "steps": steps, "output": last_out, "summary": summarize_plan(last_out)}
    return {
        "step": "apply",
        "ok": True,
        "steps": steps,
        "output": fake,
        "summary": summarize_plan(fake),
        "details": summarize_details(fake),
    }

def write_tf(ir: dict, workdir: Path):
    ctx = {**ir, "exec_mode": EXEC_MODE}
    rtype = ir["resource"]
    if rtype == "aws_s3_bucket":
        (workdir / "main.tf").write_text(TF_TPL_S3.render(**ctx))
    elif rtype == "aws_iam_user":
        (workdir / "main.tf").write_text(TF_TPL_IAM_USER.render(**ctx))
    elif rtype == "aws_dynamodb_table":
        (workdir / "main.tf").write_text(TF_TPL_DDB.render(**ctx))
    else:
        raise HTTPException(status_code=400, detail={"error": "unsupported_resource", "message": rtype})

def run_infra(ir: dict, workdir: Path) -> dict:
    action = (ir.get("actions") or ["plan"])[0]
    return terraform_apply(workdir) if action == "apply" else terraform_plan(workdir)

# ------------------------------------------------------------------------------
# Git + PR helpers
# ------------------------------------------------------------------------------
_PR_URL_RE = re.compile(r"https://github\.com/\S+/pull/new/\S+")

def _extract_pr_url(push_stdout: str) -> Optional[str]:
    if not push_stdout:
        return None
    m = _PR_URL_RE.search(push_stdout)
    return m.group(0) if m else None

def _git_branch_commit_push(branch: str, message: str, cwd: Path) -> str:
    subprocess.run(["git", "checkout", "-B", branch], cwd=cwd, check=True)
    try:
        subprocess.run(["terraform", "fmt", "-recursive"], cwd=cwd, check=False)
    except Exception:
        pass

    subprocess.run(["git", "add", "-A"], cwd=cwd, check=True)

    # If no staged changes, bail out — don't create phantom commits/branches.
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=cwd).returncode == 0:
        return ""

    subprocess.run(["git", "commit", "-m", message], cwd=cwd, check=True)
    push = subprocess.run(
        ["git", "push", "-u", "origin", branch],
        cwd=cwd, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    return push.stdout or ""

# ------------------------------------------------------------------------------
# Target resolution (from catalog)
# ------------------------------------------------------------------------------
def _resolve_target(catalog: dict, sel: dict, file_hint: Optional[str]):
    rtype = sel.get("type")
    name = sel.get("name")
    match = sel.get("match", {})
    candidates = []
    for r in catalog.get("resources", []):
        if rtype and r["type"] != rtype:
            continue
        score = 0
        if name and r["name"] == name:
            score += 10
        for k, v in (match or {}).items():
            if isinstance(r.get("attrs", {}).get(k), str) and r["attrs"][k] == v:
                score += 6
        if file_hint and r.get("file") == file_hint:
            score += 2
        if score > 0 or (not name and not match and rtype):
            candidates.append((score, r))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]

# ------------------------------------------------------------------------------
# Lightweight CI preview
# ------------------------------------------------------------------------------
def _ci_preview(root: Path, rel_dir: str = ".") -> Dict[str, Any]:
    base = (root / rel_dir).resolve()
    if not base.exists():
        raise HTTPException(status_code=400, detail={"error": "dir_not_found", "message": f"{rel_dir} does not exist in repo"})
    res = terraform_plan(base)
    return res

# ------------------------------------------------------------------------------
# LLM-only edit IR endpoint support
# ------------------------------------------------------------------------------
IR_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "ops": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "action":   {"type": "string", "enum": ["create", "update", "delete"]},
                    "selector": {"type": "object",
                        "properties": {
                            "type": {"type": "string"},
                            "name": {"type": "string"},
                            "match": {"type": "object"}
                        },
                        "required": ["type"]
                    },
                    "changes":  {"type": "array", "items": {
                        "type": "object",
                        "properties": {
                            "op":   {"type": "string", "enum": ["set", "ensure_block", "remove"]},
                            "path": {"type": "string"},
                            "value": {}
                        },
                        "required": ["op", "path"]
                    }},
                    "file_hint": {"type": "string"}
                },
                "required": ["action", "selector", "changes"],
                "additionalProperties": False
            }
        }
    },
    "required": ["ops"],
    "additionalProperties": False
}

def _tf_safe_label(s: Optional[str]) -> str:
    s = (s or "resource").strip()
    s = re.sub(r"[^A-Za-z0-9_-]", "_", s)
    s = re.sub(r"_+", "_", s)
    if not re.match(r"^[A-Za-z_]", s):
        s = "r_" + s
    return (s or "r_resource")[:64]

def _postprocess_ir(ir: Dict[str, Any]) -> Dict[str, Any]:
    ops: List[Dict[str, Any]] = ir.get("ops") or []
    for op in ops:
        sel = op.get("selector") or {}
        name = sel.get("name")
        if name:
            sel["name"] = _tf_safe_label(name)
            op["selector"] = sel
        op.setdefault("changes", [])
        op.setdefault("file_hint", "main.tf")
    return {"ops": ops}

def _first_json_object(text: str) -> str | None:
    in_string = False
    escape = False
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if in_string:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == '"':
                in_string = False
            continue
        else:
            if ch == '"':
                in_string = True
                continue
            if ch == '{':
                if depth == 0:
                    start = i
                depth += 1
            elif ch == '}':
                if depth > 0:
                    depth -= 1
                    if depth == 0 and start != -1:
                        return text[start:i + 1]
    return None

def _from_fenced_block(text: str) -> str | None:
    if "```" not in text:
        return None
    parts = text.split("```", 2)
    if len(parts) < 3:
        return None
    block = parts[1]
    lines = block.splitlines()
    if lines and lines[0].strip().lower().startswith(("json", "javascript")):
        lines = lines[1:]
    return "\n".join(lines).strip() or None

# ------------------------------------------------------------------------------
# IR Normalizers & Helpers
# ------------------------------------------------------------------------------
import json as _json, ast as _ast, re as _re
from typing import Any as _Any, Dict as _Dict, List as _List

_R_RULE = _re.compile(r'^rule($|[\.\[])')

def _coerce_jsonish(v: _Any) -> _Any:
    if not isinstance(v, str):
        return v
    v = v.strip()
    if (v.startswith("{") and v.endswith("}")) or (v.startswith("[") and v.endswith("]")):
        try:
            import json as _json
            return _json.loads(v)
        except Exception:
            pass
    try:
        import ast as _ast
        return _ast.literal_eval(v)
    except Exception:
        return v

# --- TAGS ---------------------------------------------------------------------
def _normalize_nested_interpolations(edit_ir: dict) -> dict:
    """
    Fix nested interpolations like ${prefix-${aws_s3_bucket.id}} which are INVALID in Terraform.
    Converts them to simple static values or single references.
    """
    import re
    ops = edit_ir.get("ops") or []
    for op in ops:
        changes = op.get("changes") or []
        fixed: _List[dict] = []
        for ch in changes:
            if ch.get("op") == "set":
                val = ch.get("value")
                if isinstance(val, str) and "${" in val:
                    # Count ${...} patterns
                    interpolation_count = val.count("${")
                    if interpolation_count > 1:
                        # NESTED interpolation detected - extract last reference only
                        # Pattern: ${main-bucket-${random_id.suffix.hex}} → ${random_id.suffix.hex}
                        matches = re.findall(r'\$\{([^}]+)\}', val)
                        if matches:
                            # Use the LAST match (usually the actual resource reference)
                            last_ref = matches[-1]
                            # Check if it's a valid terraform reference
                            if "." in last_ref:
                                ch = {**ch, "value": f"${{{last_ref}}}"}
                            else:
                                # Not a ref, use as static value
                                ch = {**ch, "value": last_ref}
            fixed.append(ch)
        op["changes"] = fixed
    edit_ir["ops"] = ops
    return edit_ir


def _normalize_tag_ops(edit_ir: dict) -> dict:
    import json, ast
    ops = edit_ir.get("ops") or []
    for op in ops:
        changes = op.get("changes") or []
        fixed: _List[dict] = []
        for ch in changes:
            if ch.get("op") == "set" and ch.get("path") == "tags":
                val = ch.get("value")
                tags_dict = None
                if isinstance(val, dict):
                    tags_dict = val
                elif isinstance(val, str):
                    try:
                        tags_dict = json.loads(val)
                    except Exception:
                        try:
                            parsed = ast.literal_eval(val)
                            if isinstance(parsed, dict):
                                tags_dict = parsed
                        except Exception:
                            tags_dict = None
                if isinstance(tags_dict, dict):
                    for k, v in tags_dict.items():
                        fixed.append({"op": "set", "path": f"tags.{k}", "value": "" if v is None else str(v)})
                    continue
            if ch.get("op") == "set" and isinstance(ch.get("path"), str) and ch["path"].startswith("tags."):
                v = ch.get("value")
                if not isinstance(v, str):
                    ch = {**ch, "value": "" if v is None else str(v)}
            fixed.append(ch)
        op["changes"] = fixed
    edit_ir["ops"] = ops
    return edit_ir
# --- helpers: generic matching ------------------------------------------------
def _flatten_tags(attrs: dict) -> dict:
    out = dict(attrs or {})
    tags = out.get("tags")
    if isinstance(tags, dict):
        for k, v in tags.items():
            out[f"tags.{k}"] = v
    return out

def _match_dict(attrs: dict, wanted: dict) -> bool:
    if not wanted:
        return True
    attrs = _flatten_tags(attrs or {})
    for k, v in (wanted or {}).items():
        if attrs.get(k) != v:
            return False
    return True

def _glob_match(s: str, pat: str) -> bool:
    import fnmatch
    return fnmatch.fnmatch(s or "", pat or "")

def _regex_match(s: str, pat: str) -> bool:
    import re
    try:
        return re.search(pat, s or "") is not None
    except re.error:
        return False
    
def _normalize_block_lists(edit_ir: dict) -> dict:
    ops = edit_ir.get("ops") or []
    for op in ops:
        out = []
        for ch in op.get("changes") or []:
            if ch.get("op") == "ensure_block" and isinstance(ch.get("value"), list):
                for item in ch["value"]:
                    out.append({"op":"ensure_block","path":ch["path"],"value":item})
            else:
                out.append(ch)
        op["changes"] = out
    edit_ir["ops"] = ops
    return edit_ir

def _normalize_ecs_json(edit_ir: dict) -> dict:
    """
    Mark ECS container_definitions to be wrapped in jsonencode().
    Store the raw dict/list with a special wrapper that HCL generator will recognize.
    """
    ops = edit_ir.get("ops") or []
    for op in ops:
        sel = op.get("selector") or {}
        if sel.get("type") == "aws_ecs_task_definition":
            for ch in op.get("changes") or []:
                if ch.get("op") == "set" and ch.get("path") == "container_definitions":
                    val = ch.get("value")
                    # If it's not already marked, wrap it in a special dict
                    if not isinstance(val, dict) or "__terraform_jsonencode__" not in val:
                        if not isinstance(val, str):
                            # Store as a special marker dict that HCL generator will recognize
                            ch["value"] = {
                                "__terraform_jsonencode__": True,
                                "data": val
                            }
    edit_ir["ops"] = ops
    return edit_ir

def _normalize_alb_types(edit_ir: dict) -> dict:
    mapping = {"aws_alb":"aws_lb","aws_alb_listener":"aws_lb_listener","aws_alb_target_group":"aws_lb_target_group"}
    ops = edit_ir.get("ops") or []
    for op in ops:
        sel = op.get("selector") or {}
        t = sel.get("type")
        if t in mapping:
            sel["type"] = mapping[t]
            op["selector"] = sel
    edit_ir["ops"] = ops
    return edit_ir

def _unwrap_single_element_lists(edit_ir: dict) -> dict:
    """
    Unwrap single-element lists for fields that should be strings.
    E.g., subnet_group_name = ["${aws_...}"] -> subnet_group_name = "${aws_...}"
    """
    # Fields that should be strings, not lists
    STRING_FIELDS = {
        "subnet_group_name",           # ElastiCache
        "db_subnet_group_name",        # RDS
        "replication_group_id",        # ElastiCache
        "cluster_identifier",          # RDS
        "db_cluster_identifier",       # RDS Aurora
        "engine",                      # RDS
        "engine_version",              # RDS
        "iam_role_arn",               # Various
        "kms_key_id",                  # Encryption
        "vpc_id",                      # Networking
    }
    
    ops = edit_ir.get("ops") or []
    for op in ops:
        changes = op.get("changes") or []
        for ch in changes:
            if ch.get("op") == "set":
                path = ch.get("path", "")
                value = ch.get("value")
                
                # If it's a list with exactly one element and the field should be a string
                if isinstance(value, list) and len(value) == 1 and path in STRING_FIELDS:
                    ch["value"] = value[0]
    
    edit_ir["ops"] = ops
    return edit_ir
def _rewrite_blockish_sets(edit_ir: dict) -> dict:
    """
    Turn `{"op":"set","path":"ingress","value": {... or [...]}}` into one or more
    `{"op":"ensure_block","path":"ingress","value": {...}}`.
    Same for: egress, route, health_check, default_action,
              network_configuration, load_balancer.
    """
    BLOCK_PATHS = {
        "ingress", "egress", "route",
        "health_check",
        "default_action",
        "network_configuration",
        "load_balancer",
    }
    ops = edit_ir.get("ops") or []
    for op in ops:
        out = []
        for ch in op.get("changes") or []:
            if ch.get("op") == "set" and (ch.get("path") or "") in BLOCK_PATHS:
                val = ch.get("value")
                if isinstance(val, list):
                    for item in val:
                        out.append({"op":"ensure_block","path":ch["path"],"value":item})
                else:
                    out.append({"op":"ensure_block","path":ch["path"],"value":val})
                continue
            out.append(ch)
        op["changes"] = out
    edit_ir["ops"] = ops
    return edit_ir

def _normalize_block_lists(edit_ir: dict) -> dict:
    """If ensure_block value is a list, explode to multiple blocks."""
    ops = edit_ir.get("ops") or []
    for op in ops:
        out = []
        for ch in op.get("changes") or []:
            if ch.get("op") == "ensure_block" and isinstance(ch.get("value"), list):
                for item in ch["value"]:
                    out.append({"op":"ensure_block","path":ch["path"],"value":item})
            else:
                out.append(ch)
        op["changes"] = out
    edit_ir["ops"] = ops
    return edit_ir

def _fix_listener_default_action(edit_ir: dict) -> dict:
    """
    Sometimes models emit listener.default_action as a SET with a list.
    Ensure it's ensure_block and exploded.
    """
    ops = edit_ir.get("ops") or []
    for op in ops:
        sel = op.get("selector") or {}
        if sel.get("type") != "aws_lb_listener":
            continue
        out = []
        for ch in op.get("changes") or []:
            if ch.get("path") == "default_action":
                v = ch.get("value")
                if ch.get("op") == "set":
                    if isinstance(v, list):
                        for item in v:
                            out.append({"op":"ensure_block","path":"default_action","value":item})
                    else:
                        out.append({"op":"ensure_block","path":"default_action","value":v})
                    continue
            out.append(ch)
        op["changes"] = out
    edit_ir["ops"] = ops
    return edit_ir

# --- multi-target resolver (resources + modules) ------------------------------
from typing import List

def _resolve_targets(catalog: dict, sel: dict, file_hint: Optional[str]) -> List[dict]:
    """
    Returns zero, one, or many targets.
    Supported selector keys (others ignored):
      address: "aws_s3_bucket.logs"
      address_glob: "aws_*.*"
      type: e.g. "aws_iam_role" or "module"
      name: Terraform label (resource or module)
      name_regex: Python regex for label
      match: dict of attr filters; supports "tags.Key": "Val"
      module: alias for {"type":"module","name": "..."}
    """
    sel = sel or {}
    rtype = sel.get("type")
    name = sel.get("name")
    match = sel.get("match") or {}
    address = sel.get("address")
    addr_glob = sel.get("address_glob")
    name_regex = sel.get("name_regex")
    if sel.get("module") and not rtype:
        rtype = "module"
        name = sel.get("module")

    res_hits: List[dict] = []

    # 1) exact address
    if address:
        for r in catalog.get("resources", []):
            if r.get("address") == address:
                return [r]

    # 2) address glob
    if addr_glob:
        for r in catalog.get("resources", []):
            if _glob_match(r.get("address", ""), addr_glob):
                if (not rtype or r.get("type") == rtype) and _match_dict(r.get("attrs", {}), match):
                    if not file_hint or r.get("file") == file_hint:
                        res_hits.append(r)

    # 3) type/name(/regex)/match filter
    for r in catalog.get("resources", []):
        if rtype and r.get("type") != rtype:
            continue
        if name and r.get("name") != name:
            continue
        if name_regex and not _regex_match(r.get("name",""), name_regex):
            continue
        if not _match_dict(r.get("attrs", {}), match):
            continue
        if file_hint and r.get("file") != file_hint:
            continue
        res_hits.append(r)

    # 4) module inputs (when requested or when no resource hits)
    mod_hits: List[dict] = []
    if rtype == "module" or sel.get("module") or (not res_hits and rtype in (None,)):
        for m in catalog.get("modules", []):
            if name and m.get("name") != name:
                continue
            if name_regex and not _regex_match(m.get("name",""), name_regex):
                continue
            if file_hint and m.get("file") != file_hint:
                continue
            if not _match_dict(m.get("attrs", {}), match):
                continue
            # shape like a resource for editor
            mod_hits.append({
                "address": f"module.{m['name']}",
                "type": "module",
                "name": m["name"],
                "attrs": m.get("attrs", {}),
                "file": m.get("file"),
            })

    return res_hits or mod_hits

# --- S3 NAMES / REFS / BLOCK STRINGS -----------------------------------------
def _normalize_s3_names(edit_ir: dict) -> dict:
    ops = edit_ir.get("ops") or []
    for op in ops:
        sel = op.get("selector") or {}
        if not isinstance(sel, dict):
            continue
        rtype = sel.get("type") or ""
        if rtype.startswith("aws_s3_"):
            name = sel.get("name")
            if isinstance(name, str) and "-" in name:
                sel["name"] = name.replace("-", "_")
    edit_ir["ops"] = ops
    return edit_ir

def _normalize_bucket_refs(edit_ir: dict) -> dict:
    ops = edit_ir.get("ops") or []
    for op in ops:
        sel = op.get("selector") or {}
        rtype = (sel or {}).get("type")
        name  = (sel or {}).get("name")
        for ch in op.get("changes") or []:
            if ch.get("op") == "set" and ch.get("path") == "bucket" and isinstance(ch.get("value"), str):
                v = ch["value"]
                if ".bucket}" in v:
                    ch["value"] = v.replace(".bucket}", ".id}")
                if rtype == "aws_s3_bucket" and name and f"aws_s3_bucket.{name}." in ch["value"]:
                    pass
    return edit_ir

def _normalize_iam_policy_json(edit_ir: dict) -> dict:
    """
    Ensure IAM JSON attributes are emitted as HCL expressions:
      assume_role_policy = jsonencode({...})
      policy             = jsonencode({...})
    Accepts dicts, JSON strings, or Python-literal strings.
    """
    def _to_obj(v):
        if isinstance(v, dict):
            return v
        if isinstance(v, str):
            s = v.strip()
            if (s.startswith("{") and s.endswith("}")) or (s.startswith("[") and s.endswith("]")):
                try:
                    return json.loads(s)
                except Exception:
                    pass
            try:
                import ast
                val = ast.literal_eval(s)
                if isinstance(val, (dict, list)):
                    return val
            except Exception:
                pass
        return None

    TARGETS = {
        ("aws_iam_role", "assume_role_policy"),
        ("aws_iam_policy", "policy"),
        ("aws_iam_role_policy", "policy"),
        ("aws_iam_policy_document", "statement"),
    }

    ops = edit_ir.get("ops") or []
    for op in ops:
        sel = op.get("selector") or {}
        rtype = (sel.get("type") or "").strip()
        changes = op.get("changes") or []
        fixed = []
        for ch in changes:
            if ch.get("op") == "set" and isinstance(ch.get("path"), str):
                path = ch["path"].strip()
                if (rtype, path) in TARGETS:
                    obj = _to_obj(ch.get("value"))
                    if obj is not None:
                        # Use special marker dict for HCL generator
                        ch = {**ch, "value": {
                            "__terraform_jsonencode__": True,
                            "data": obj
                        }}
            fixed.append(ch)
        op["changes"] = fixed
    edit_ir["ops"] = ops
    return edit_ir

def _drop_stringified_blocks(edit_ir: dict) -> dict:
    """
    Drop any attempts to assign nested blocks as strings.
    """
    BLOCKY_SEGMENTS = {
        "rule",
        "versioning",
        "versioning_configuration",
        "server_side_encryption_configuration",
        "apply_server_side_encryption_by_default",
        "logging",
        "lifecycle_rule",
        "cors_rule",
        "ingress",
        "egress",
        "lambda_function",
    }

    def _has_blocky_segment(path: str) -> bool:
        for seg in (path or "").split("."):
            if seg in BLOCKY_SEGMENTS:
                return True
        return False

    ops = edit_ir.get("ops") or []
    for op in ops:
        fixed = []
        for ch in (op.get("changes") or []):
            if ch.get("op") == "set" and isinstance(ch.get("path"), str) and _has_blocky_segment(ch["path"]):
                v = ch.get("value")
                if isinstance(v, str) and v.strip().startswith(("{", "[")):
                    continue
            fixed.append(ch)
        op["changes"] = fixed
    edit_ir["ops"] = ops
    return edit_ir

def _explode_stringified_resource_body(edit_ir: dict) -> dict:
    ops = edit_ir.get("ops") or []
    for op in ops:
        changes = op.get("changes") or []
        fixed: List[dict] = []
        exploded = False
        for ch in changes:
            if ch.get("op") == "set":
                p = (ch.get("path") or "").strip()
                if p in ("", "=", "resource"):
                    val = _coerce_jsonish(ch.get("value"))
                    if isinstance(val, dict):
                        for k, v in val.items():
                            fixed.append({"op":"set","path":k,"value":v})
                        exploded = True
                        continue
            fixed.append(ch)
        if exploded:
            op["changes"] = fixed
    edit_ir["ops"] = ops
    return edit_ir

# --- S3 SSE ENFORCEMENT -------------------------------------------------------
def _pick_sse(v: _Any) -> _Dict[str, _Any]:
    out: _Dict[str, _Any] = {}
    v = _coerce_jsonish(v)
    items: _List[_Dict[str, _Any]] = []
    if isinstance(v, dict):
        items = [v]
    elif isinstance(v, list):
        items = v
    for item in items:
        if not isinstance(item, dict):
            continue
        inner = item.get("apply_server_side_encryption_by_default")
        if inner is None:
            continue
        if isinstance(inner, list) and inner and isinstance(inner[0], dict):
            inner = inner[0]
        if isinstance(inner, dict):
            if "sse_algorithm" in inner and "sse_algorithm" not in out:
                out["sse_algorithm"] = inner["sse_algorithm"]
            if "kms_master_key_id" in inner and "kms_master_key_id" not in out:
                out["kms_master_key_id"] = inner["kms_master_key_id"]
    return out

def _enforce_s3_sse_ir(edit_ir: dict) -> dict:
    """
    Normalize & enforce correct S3 SSE IR for Terraform v5.
    """
    import re

    ops = edit_ir.get("ops") or []

    merged = {}
    ordered_keys = []
    for op in ops:
        sel = op.get("selector") or {}
        key = (op.get("action"), sel.get("type"), sel.get("name"))
        if key in merged:
            merged[key]["changes"] = (merged[key].get("changes") or []) + (op.get("changes") or [])
        else:
            merged[key] = {**op, "changes": list(op.get("changes") or [])}
            ordered_keys.append(key)

    def _bucket_label_from_op(op) -> str | None:
        sel = op.get("selector") or {}
        name = sel.get("name")
        if name:
            return name
        for ch in op.get("changes") or []:
            if ch.get("op") == "set" and ch.get("path") == "bucket":
                v = str(ch.get("value") or "")
                m = re.match(r"\$\{\s*aws_s3_bucket\.([A-Za-z0-9_]+)\.(?:id|bucket)\s*\}", v)
                if m:
                    return m.group(1)
        return None

    new_ops = []
    buckets_needing_sse: set[str] = set()

    for key in ordered_keys:
        op = merged[key]
        action, rtype, rname = key
        changes = op.get("changes") or []

        # drop invalid "rule = <string>" writes
        fixed_changes = []
        for ch in changes:
            if ch.get("path") == "rule":
                continue
            fixed_changes.append(ch)
        op["changes"] = fixed_changes

        if action == "create" and rtype == "aws_s3_bucket":
            buckets_needing_sse.add(rname or _bucket_label_from_op(op) or "bucket")
            new_ops.append(op)
            continue

        if rtype == "aws_s3_bucket_server_side_encryption_configuration":
            bucket_label = _bucket_label_from_op(op)

            has_bucket_attr = False
            for ch in op["changes"]:
                if ch.get("op") == "set" and ch.get("path") == "bucket":
                    has_bucket_attr = True
                    if isinstance(ch.get("value"), str) and ".bucket}" in ch["value"]:
                        ch["value"] = ch["value"].replace(".bucket}", ".id}")

            if bucket_label and not has_bucket_attr:
                op["changes"].insert(0, {
                    "op": "set",
                    "path": "bucket",
                    "value": f"${{aws_s3_bucket.{bucket_label}.id}}",
                })

            filtered = []
            have_block_ensure = False
            block_path = "rule.apply_server_side_encryption_by_default"
            for ch in op["changes"]:
                p = ch.get("path", "")

                # drop any 'set' directly on the whole block path
                if ch.get("op") == "set" and p == block_path:
                    continue

                # drop leaf sets to avoid arg form
                if p.endswith("apply_server_side_encryption_by_default.sse_algorithm") or \
                   p.endswith("apply_server_side_encryption_by_default.kms_master_key_id"):
                    continue

                if ch.get("op") == "ensure_block" and p == block_path:
                    have_block_ensure = True

                filtered.append(ch)

            if not have_block_ensure:
                filtered.append({
                    "op": "ensure_block",
                    "path": block_path,
                    "value": {"sse_algorithm": "AES256"},
                })

            op["changes"] = filtered
            new_ops.append(op)

            if bucket_label:
                buckets_needing_sse.discard(bucket_label)
            continue

        new_ops.append(op)

    for bucket_label in sorted(buckets_needing_sse):
        if not bucket_label:
            continue
        new_ops.append({
            "action": "create",
            "selector": {
                "type": "aws_s3_bucket_server_side_encryption_configuration",
                "name": f"{bucket_label}_sse",
            },
            "changes": [
                {"op": "ensure_block",
                 "path": "rule.apply_server_side_encryption_by_default",
                 "value": {"sse_algorithm": "AES256"}},
                {"op": "set",
                 "path": "bucket",
                 "value": f"${{aws_s3_bucket.{bucket_label}.id}}"},
            ],
            "file_hint": "main.tf",
        })

    edit_ir["ops"] = new_ops
    return edit_ir

# --- S3 bucket notifications → real blocks + lambda permission ----------------
def _normalize_s3_notifications_ir(edit_ir: dict) -> dict:
    import json, ast, re
    ops = edit_ir.get("ops") or []
    new_ops = []

    def _jsonish(val):
        if isinstance(val, (dict, list)):
            return val
        if isinstance(val, str):
            s = val.strip()
            if s.startswith(("{","[")):
                try: return json.loads(s)
                except Exception:
                    try: return ast.literal_eval(s)
                    except Exception: return s
        return val

    def _bucket_label_from_changes(changes):
        for ch in changes:
            if ch.get("op") == "set" and ch.get("path") == "bucket":
                v = str(ch.get("value") or "")
                m = re.match(r"\$\{\s*aws_s3_bucket\.([A-Za-z0-9_]+)\.(?:id|bucket)\s*\}", v)
                if m: return m.group(1)
        return None

    for op in ops:
        sel = op.get("selector") or {}
        rtype = sel.get("type")
        if rtype != "aws_s3_bucket_notification":
            new_ops.append(op)
            continue

        changes = op.get("changes") or []
        fixed = []
        lambda_blocks = []

        for ch in changes:
            if ch.get("op") == "set" and ch.get("path") == "bucket" and isinstance(ch.get("value"), str):
                if ".bucket}" in ch["value"]:
                    ch = {**ch, "value": ch["value"].replace(".bucket}", ".id}")}

            if ch.get("op") == "set" and ch.get("path") == "lambda_function":
                val = _jsonish(ch.get("value"))
                if isinstance(val, dict):
                    val = [val]
                if isinstance(val, list):
                    for item in val:
                        if not isinstance(item, dict):
                            continue
                        arn = item.get("lambda_function_arn") or item.get("arn")
                        events = item.get("events") or ["s3:ObjectCreated:*"]
                        filter_prefix = item.get("filter_prefix")
                        filter_suffix = item.get("filter_suffix")
                        block_value = {"lambda_function_arn": arn, "events": events}
                        if filter_prefix: block_value["filter_prefix"] = filter_prefix
                        if filter_suffix: block_value["filter_suffix"] = filter_suffix
                        lambda_blocks.append({
                            "op": "ensure_block",
                            "path": "lambda_function",
                            "value": block_value
                        })
                continue  # drop original

            fixed.append(ch)

        fixed.extend(lambda_blocks)
        op["changes"] = fixed
        new_ops.append(op)

        target_lambda_name = None
        for lb in lambda_blocks:
            v = lb.get("value") or {}
            arn = v.get("lambda_function_arn", "")
            m = re.match(r"\$\{\s*aws_lambda_function\.([A-Za-z0-9_]+)\.arn\s*\}", arn or "")
            if m:
                target_lambda_name = m.group(1)
                break
        bucket_label = _bucket_label_from_changes(fixed)
        if target_lambda_name and bucket_label:
            new_ops.append({
                "action": "create",
                "selector": {
                    "type": "aws_lambda_permission",
                    "name": f"{target_lambda_name}_from_{bucket_label}",
                },
                "file_hint": "main.tf",
                "changes": [
                    {"op": "set", "path": "statement_id", "value": "AllowExecutionFromS3"},
                    {"op": "set", "path": "action", "value": "lambda:InvokeFunction"},
                    {"op": "set", "path": "function_name", "value": f"${{aws_lambda_function.{target_lambda_name}.function_name}}"},
                    {"op": "set", "path": "principal", "value": "s3.amazonaws.com"},
                    {"op": "set", "path": "source_arn", "value": f"${{aws_s3_bucket.{bucket_label}.arn}}"},
                ],
            })

    edit_ir["ops"] = new_ops
    return edit_ir

# --- Lambda: ensure role + required minimum attributes ------------------------
def _ensure_lambda_role_ir(edit_ir: dict) -> dict:
    import json
    TRUST = {
        "Version": "2012-10-17",
        "Statement": [{
            "Action": "sts:AssumeRole",
            "Principal": {"Service": "lambda.amazonaws.com"},
            "Effect": "Allow",
            "Sid": ""
        }]
    }

    ops = edit_ir.get("ops") or []
    new_ops = []
    for op in ops:
        new_ops.append(op)
        sel = op.get("selector") or {}
        if sel.get("type") != "aws_lambda_function":
            continue

        name = sel.get("name") or "lambda"
        changes = op.get("changes") or []
        has_role = any(ch.get("op") == "set" and ch.get("path") == "role" for ch in changes)

        present = { (ch.get("op"), ch.get("path")): True for ch in changes }
        def _ensure(path, value):
            if ("set", path) not in present:
                changes.append({"op":"set","path":path,"value":value})

        _ensure("runtime", "python3.11")
        _ensure("handler", "index.handler")
        _ensure("filename", "lambda.zip")

        if not has_role:
            new_ops.append({
                "action": "create",
                "selector": {"type": "aws_iam_role", "name": f"{name}_role"},
                "file_hint": "main.tf",
                "changes": [
                    {"op": "set", "path": "name", "value": f"{name}-role"},
                    {"op": "set", "path": "assume_role_policy", "value": json.dumps(TRUST)},
                ],
            })
            new_ops.append({
                "action": "create",
                "selector": {"type": "aws_iam_role_policy_attachment", "name": f"{name}_role_basic"},
                "file_hint": "main.tf",
                "changes": [
                    {"op": "set", "path": "role", "value": f"${{aws_iam_role.{name}_role.name}}"},
                    {"op": "set", "path": "policy_arn", "value": "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"},
                ],
            })
            changes.append({
                "op": "set",
                "path": "role",
                "value": f"${{aws_iam_role.{name}_role.arn}}"
            })

        op["changes"] = changes

    edit_ir["ops"] = new_ops
    return edit_ir

# --- S3 public access block hardening ----------------------------------------
def _normalize_public_access_block_ops(edit_ir: dict) -> dict:
    BOOL_KEYS = (
        "block_public_acls",
        "block_public_policy",
        "ignore_public_acls",
        "restrict_public_buckets",
    )

    ops = edit_ir.get("ops") or []
    for op in ops:
        sel = op.get("selector") or {}
        if sel.get("type") != "aws_s3_bucket_public_access_block":
            continue

        name = (sel.get("name") or "").strip()
        bucket_label_guess = name[:-6] if name.endswith("_block") else name

        changes = op.get("changes") or []
        out: List[dict] = []
        bucket_seen = False

        for ch in changes:
            if ch.get("op") == "set" and ch.get("path") == "bucket":
                bucket_seen = True
                v = ch.get("value")
                if isinstance(v, str) and ".bucket}" in v:
                    ch = {**ch, "value": v.replace(".bucket}", ".id}")}
            if ch.get("op") == "set" and ch.get("path") in BOOL_KEYS:
                v = ch.get("value")
                if isinstance(v, str):
                    v = v.strip().lower() in ("1","true","t","yes","y","on")
                ch = {**ch, "value": bool(v)}
            out.append(ch)

        if not bucket_seen and bucket_label_guess:
            out.insert(0, {
                "op": "set",
                "path": "bucket",
                "value": f"${{aws_s3_bucket.{bucket_label_guess}.id}}"
            })

        present = { c.get("path"): True for c in out if c.get("op") == "set" }
        for k in BOOL_KEYS:
            if k not in present:
                out.append({"op": "set", "path": k, "value": True})

        op["changes"] = out

    edit_ir["ops"] = ops
    return edit_ir

def _normalize_name_field_to_tag(edit_ir: dict) -> dict:
    """
    For resource types that don't have a 'name' argument, rewrite 'name' -> 'tags.Name'.
    """
    NAMELESS_TYPES = {
        "aws_vpc", "aws_subnet", "aws_internet_gateway", "aws_route_table",
        "aws_nat_gateway", "aws_security_group", "aws_route", "aws_vpc_endpoint"
    }
    ops = edit_ir.get("ops") or []
    for op in ops:
        sel = op.get("selector") or {}
        rtype = (sel.get("type") or "").strip()
        if rtype not in NAMELESS_TYPES:
            continue
        changes = op.get("changes") or []
        for ch in changes:
            if ch.get("op") == "set" and (ch.get("path") or "").strip() == "name":
                ch["path"] = "tags.Name"
    edit_ir["ops"] = ops
    return edit_ir


# ------------------------------------------------------------------------------
# Sanitize (relaxed)
# ------------------------------------------------------------------------------
def sanitize_edit_ir(ir: dict, catalog: Optional[dict] = None) -> dict:
    BLOCKY_PREFIXES = (
        "rule", "versioning_configuration", "logging", "server_side_encryption_configuration",
        "ingress", "egress", "lifecycle_rule", "cors_rule", "lambda_function"
    )
    ops: List[Dict[str, Any]] = list(ir.get("ops") or [])
    for op in ops:
        fixed = []
        for ch in (op.get("changes") or []):
            op_name = ch.get("op")
            path = ch.get("path") or ""
            if op_name == "set":
                head = path.split(".", 1)[0]
                if head in BLOCKY_PREFIXES and isinstance(ch.get("value"), str) and ch["value"].strip().startswith(("{", "[")):
                    continue
            fixed.append(ch)
        op["changes"] = fixed
    ir["ops"] = ops
    return ir

# ------------------------------------------------------------------------------
# (optional) op ordering helpers (kept, not currently used)
# ------------------------------------------------------------------------------
def _order_resource_ops(edit_ir: dict) -> dict:
    priority = {"create": 0, "update": 1, "delete": 2}
    ops = edit_ir.get("ops") or []
    ops.sort(key=lambda o: (priority.get(o.get("action"), 1),
                            (o.get("selector") or {}).get("type", ""),
                            (o.get("selector") or {}).get("name", "")))
    edit_ir["ops"] = ops
    return edit_ir

def _ensure_file_hints(edit_ir: dict, default_file: str = "main.tf") -> dict:
    ops = edit_ir.get("ops") or []
    for op in ops:
        if not op.get("file_hint"):
            op["file_hint"] = default_file
    edit_ir["ops"] = ops
    return edit_ir

def _dedupe_and_compact_ops(edit_ir: dict) -> dict:
    from collections import OrderedDict
    buckets = {}
    ops = edit_ir.get("ops") or []
    for op in ops:
        key = (op.get("action"), tuple(sorted((op.get("selector") or {}).items())), op.get("file_hint"))
        buckets.setdefault(key, []).append(op)

    merged_ops = []
    for key, group in buckets.items():
        path_last = OrderedDict()
        for op in group:
            for ch in op.get("changes") or []:
                ident = (ch.get("op"), ch.get("path"))
                path_last[ident] = ch
        sample = group[-1]
        merged = {
            "action": sample.get("action"),
            "selector": sample.get("selector"),
            "file_hint": sample.get("file_hint"),
            "changes": list(path_last.values())
        }
        merged_ops.append(merged)

    edit_ir["ops"] = _order_resource_ops({"ops": merged_ops}).get("ops", merged_ops)
    return edit_ir

# ------------------------------------------------------------------------------
# LLM IR generator (Responses API variant)
# ------------------------------------------------------------------------------
def _llm_generate_ir(prompt: str, catalog: dict) -> dict:
    use_llm = os.getenv("USE_LLM_FOR_IR", "false").lower() == "true" or \
              os.getenv("ALWAYS_USE_LLM", "false").lower() == "true"
    if not use_llm:
        raise HTTPException(400, {"error": "llm_disabled", "message": "Set USE_LLM_FOR_IR=true to enable LLM mode."})

    try:
        from openai import OpenAI
    except Exception:
        raise HTTPException(500, {"error": "sdk_missing", "message": "openai SDK not installed. pip install openai"})

    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    except Exception as e:
        raise HTTPException(401, {"error": "llm_auth_error", "message": f"OpenAI init failed: {e}"})

    model = os.getenv("OPENAI_IR_MODEL", "gpt-4o")

    system = (
        "You are an infra edit translator. Convert the user's request and the Terraform catalog "
        "into a STRICT JSON Edit IR that matches this JSON Schema exactly. "
        "RULES:\n"
        "1) Output JSON ONLY. No markdown, no prose, no prefixes/suffixes.\n"
        "2) Must match the schema: {\"ops\": [{\"action\": \"create|update|delete\", "
        "\"selector\": {\"type\": string, \"name\": string, \"match\": object?}, "
        "\"changes\": [{\"op\": \"set|ensure_block|remove\", \"path\": string, \"value\": any?}] , "
        "\"file_hint\": string?}]}\n"
        "3) Use the catalog to target existing resources for update/delete. Prefer minimal diffs.\n"
        "4) If unsure which file to edit, set file_hint to \"main.tf\".\n"
        "5) Do not invent fields outside the schema."
    )

    user_payload = [
        {"role": "system", "content": system},
        {"role": "user", "content": "JSON_SCHEMA=" + json.dumps(IR_JSON_SCHEMA, separators=(',', ':'))},
        {"role": "user", "content": "CATALOG=" + json.dumps(catalog, separators=(',', ':'))},
        {"role": "user", "content": "PROMPT=" + prompt},
        {"role": "user", "content": "Return ONLY the JSON object. Nothing else."},
    ]

    def _extract_text(resp_obj) -> str:
        try:
            return resp_obj.output[0].content[0].text
        except Exception:
            return getattr(resp_obj, "output_text", None) or str(resp_obj)

    def _extract_first_json_object(s: str) -> str:
        i = s.find("{")
        if i == -1:
            raise ValueError("no '{' found in model output")
        depth = 0
        for j in range(i, len(s)):
            ch = s[j]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return s[i:j+1]
        raise ValueError("unterminated JSON object in model output")

    try:
        resp = client.responses.create(
            model=model,
            input=user_payload,
            temperature=0,
        )
        text = _extract_text(resp).strip()
        raw_json = _extract_first_json_object(text)
        ir = json.loads(raw_json)
        return ir

    except json.JSONDecodeError as e:
        raise HTTPException(500, {"error": "llm_parse_error", "message": f"JSON parse failed: {e}"})
    except ValueError as e:
        raise HTTPException(500, {"error": "llm_output_error", "message": str(e)})
    except Exception as e:
        msg = str(e)
        code = getattr(e, "status_code", None)
        if code == 401 or "api key" in msg.lower():
            raise HTTPException(401, {"error": "llm_auth_error", "message": msg})
        if code == 429 or "rate limit" in msg.lower() or "quota" in msg.lower():
            raise HTTPException(429, {"error": "rate_limited_or_no_quota", "message": msg})
        raise HTTPException(500, {"error": "llm_error", "message": msg})

# --- NLP rename helpers (label + tags.Name) -----------------------------------
import re as _re

_RENAME_PATTERNS = [
    _re.compile(r"\b(?:rename|change|update)\s+(?:the\s+)?name\s+of\s+([A-Za-z0-9._-]+)\s+(?:to|->)\s+([A-Za-z0-9._-]+)\b", _re.I),
    _re.compile(r"\b(?:rename|change|update)\s+([A-Za-z0-9._-]+)\s+(?:vpc|bucket|table|user|role)\s+(?:to|->)\s+([A-Za-z0-9._-]+)\b", _re.I),
    _re.compile(r"\b(?:rename|change|update)\s+([A-Za-z0-9._-]+)\s+(?:to|->)\s+([A-Za-z0-9._-]+)\b", _re.I),
]

def _guess_rtype_from_prompt(prompt: str) -> Optional[str]:
    p = (prompt or "").lower()
    if " vpc" in p: return "aws_vpc"
    if " bucket" in p or " s3" in p: return "aws_s3_bucket"
    if " dynamo" in p or " ddb" in p or " table" in p: return "aws_dynamodb_table"
    if " iam user" in p or " user " in p: return "aws_iam_user"
    # Return None to allow any type
    return None

def _find_resources_for_old_name(catalog: dict, old: str, type_hint: Optional[str]) -> List[dict]:
    hits: List[dict] = []
    for r in catalog.get("resources", []):
        if type_hint and r.get("type") != type_hint:
            continue
        label = r.get("name") or ""
        if label == old:
            hits.append(r); continue
        tags = r.get("attrs", {}).get("tags", {})
        if isinstance(tags, dict) and str(tags.get("Name", "")) == old:
            hits.append(r)
    return hits

def _nl_rename_to_ir(prompt: str, catalog: dict) -> Optional[dict]:
    if not prompt: return None
    m = None
    for pat in _RENAME_PATTERNS:
        m = pat.search(prompt)
        if m: break
    if not m: return None

    old_raw, new_raw = m.group(1).strip(), m.group(2).strip()
    type_hint = _guess_rtype_from_prompt(prompt)

    matches = _find_resources_for_old_name(catalog, old_raw, type_hint)
    if not matches and type_hint:
        # If hint filtered too hard, try again without it
        matches = _find_resources_for_old_name(catalog, old_raw, None)

    if not matches:
        # Let the LLM path handle it (could be a module-only case)
        return None

    ops: List[dict] = []
    for r in matches:
        rtype = r.get("type")
        old_label = r.get("name")
        address = r.get("address")
        file_hint = r.get("file")
        if not rtype or not old_label or not address:
            # skip malformed entries
            continue
        new_label = _tf_safe_label(new_raw)  # reuse your helper to make TF-safe
        to_addr = f"{rtype}.{new_label}"
        op = {
            "action": "update",
            "selector": {"address": address},
            "file_hint": file_hint,
            "changes": [
                {"op": "set", "path": "__rename_label__", "value": {"from": address, "to": to_addr}},
                {"op": "set", "path": "tags.Name", "value": new_raw}
            ]
        }
        ops.append(op)

    # If nothing valid constructed, let LLM handle
    if not ops:
        return None

    return {"ops": ops}

# ------------------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------------------
@app.get("/")
def health():
    return {
        "status": "ok",
        "mode": LLM_MODE,
        "exec_mode": EXEC_MODE,
        "rag": "available" if RAG_ENABLED else "unavailable",
        "actions_supported": ["plan", "apply"],
        "resources_supported": ["aws_s3_bucket", "aws_iam_user", "aws_dynamodb_table"],
        "endpoints": [
            "/generate-plan", "/index-repo", "/catalog", "/nl-edit", "/edit-repo",
            "/git/status", "/git/set-remote",
            "/rag/health", "/rag/search", "/rag/plan", "/rag/run"
        ],
    }

# Git helpers
@app.get("/git/status")
def git_status():
    root = _repo_root()
    return {
        "root": str(root),
        "branch": _current_branch(root),
        "origin": _origin_url(root),
        "sha": _git_sha(root),
    }

@app.post("/git/set-remote")
def git_set_remote(req: GitRemoteRequest):
    root = _repo_root()
    subprocess.run(["git", "remote", "remove", "origin"], cwd=root, check=False)
    subprocess.run(["git", "remote", "add", "origin", req.url], cwd=root, check=True)
    return {"ok": True, "origin": req.url}

# Core generation (IR)
@app.post("/generate-plan")
def generate_plan(req: NLRequest):
    ir = nl_to_ir(req.prompt)
    policy_validate(ir)
    opa_check(ir)

    tmp = Path(tempfile.mkdtemp(prefix="tfgen_"))
    try:
        write_tf(ir, tmp)
        result = run_infra(ir, tmp)
        terraform_str = (tmp / "main.tf").read_text()
        return {"ir": ir, "terraform": terraform_str, "result": result}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

# Index + catalog
@app.post("/index-repo")
def index_repo(req: IndexRequest):
    root = _repo_root()
    rel_dir = req.dir or "."
    base = (root / rel_dir).resolve()
    if not base.exists():
        raise HTTPException(status_code=400, detail={"error": "dir_not_found", "message": f"{rel_dir} does not exist in repo"})

    catalog = _index_dir(root, rel_dir)
    CATALOG.clear()
    CATALOG.update(catalog)
    return {"ok": True, "sha": catalog["sha"], "dir": rel_dir, "count": catalog["counts"]["resources"]}

@app.get("/catalog")
def get_catalog():
    if not CATALOG.get("sha"):
        raise HTTPException(status_code=404, detail={"error": "not_indexed", "message": "Run /index-repo first"})
    return CATALOG

# LLM-only edit IR endpoint
@app.post("/nl-edit")
def nl_edit(req: NLEditRequest):
    if not CATALOG.get("resources"):
        raise HTTPException(
            400,
            {"error": "not_indexed", "message": "Run /index-repo first"}
        )

    prompt = req.prompt or ""

    # 0) Difficulty scoring — rank the query complexity
    diff = score_query_difficulty(prompt, CATALOG)
    # You can log this for visibility
    print({"difficulty": diff}, flush=True)

    # 1) Fast-path rename / change-name detection
    ir_fast = _nl_rename_to_ir(prompt, CATALOG)
    if ir_fast and diff["bucket"] in ("easy", "medium"):
        ir_fast = _postprocess_ir(ir_fast)
        validate_edit_ir(ir_fast)
        return {"ir": ir_fast, "difficulty": diff}

    # 2) Choose LLM vs RAG route
    use_rag = diff["policy"].get("use_rag", False) and RAG_ENABLED

    if use_rag:
        # RAG-assisted generation (if available)
        try:
            ir = _llm_generate_ir(prompt, CATALOG, use_rag=True)
        except TypeError:
            # fallback if your _llm_generate_ir doesn't yet take use_rag arg
            ir = _llm_generate_ir(prompt, CATALOG)
    else:
        # Direct LLM generation
        ir = _llm_generate_ir(prompt, CATALOG)

    # 3) Post-process and validate
    ir = _postprocess_ir(ir)
    validate_edit_ir(ir)

    return {"ir": ir, "difficulty": diff}

# ----------------------
# Apply edit IR to repo + CI preview + push PR link
# ----------------------
@app.post("/nl-edit")
def nl_edit(req: NLEditRequest):
    if not CATALOG.get("resources"):
        raise HTTPException(
            400,
            {"error": "not_indexed", "message": "Run /index-repo first"}
        )

    prompt = req.prompt or ""

    # 0) Difficulty scoring — rank the query complexity
    diff = score_query_difficulty(prompt, CATALOG)
    # Optional: log for visibility
    try:
        print({"difficulty": diff}, flush=True)
    except Exception:
        pass

    # 1) Fast-path rename / change-name detection
    ir_fast = _nl_rename_to_ir(prompt, CATALOG)
    if ir_fast and diff["bucket"] in ("easy", "medium"):
        ir_fast = _postprocess_ir(ir_fast)
        validate_edit_ir(ir_fast)
        return {"ir": ir_fast, "difficulty": diff}

    # 2) Choose LLM vs RAG route (only if you actually have rag_* wired)
    use_rag = diff["policy"].get("use_rag", False) and bool(globals().get("rag_search"))

    if use_rag:
        # Prefer RAG-assisted generation if available
        try:
            ir = _llm_generate_ir(prompt, CATALOG, use_rag=True)
        except TypeError:
            # fallback if your _llm_generate_ir doesn't accept use_rag yet
            ir = _llm_generate_ir(prompt, CATALOG)
    else:
        # Direct LLM generation
        ir = _llm_generate_ir(prompt, CATALOG)

    # 3) Post-process and validate
    ir = _postprocess_ir(ir)
    validate_edit_ir(ir)

    return {"ir": ir, "difficulty": diff}


@app.post("/edit-repo")
def edit_repo_generic(req: EditRepoRequest, request: Request):
    if not CATALOG.get("resources"):
        raise HTTPException(400, {"error": "not_indexed", "message": "Run /index-repo first"})

    # --- Difficulty scoring (best-effort; optional) --------------------------
    difficulty = None
    try:
        if req.prompt:
            difficulty = score_query_difficulty(req.prompt or "", CATALOG)
    except Exception:
        difficulty = None

    root = _repo_root()
    fresh = _index_dir(root, CATALOG.get("dir") or ".")
    CATALOG.clear(); CATALOG.update(fresh)

    # 1) Resolve/validate Edit IR
    if req.ir:
        edit_ir = req.ir
        validate_edit_ir(edit_ir)
    elif req.prompt:
        # Reuse local fn; nl_edit also returns difficulty (which we keep if present)
        resp = nl_edit(NLEditRequest(prompt=req.prompt))
        edit_ir = resp["ir"]
        difficulty = resp.get("difficulty", difficulty)
    else:
        raise HTTPException(400, {"error": "missing_input", "message": "Provide 'prompt' or 'ir'"})

    # 2) Normalize & sanitize (order matters)
    edit_ir = _normalize_nested_interpolations(edit_ir)  # FIX: Remove invalid nested ${...} patterns
    edit_ir = _normalize_tag_ops(edit_ir)
    edit_ir = _normalize_s3_names(edit_ir)
    edit_ir = _normalize_bucket_refs(edit_ir)
    edit_ir = _drop_stringified_blocks(edit_ir)
    edit_ir = _rewrite_blockish_sets(edit_ir)
    edit_ir = _normalize_block_lists(edit_ir)
    edit_ir = _fix_listener_default_action(edit_ir)
    edit_ir = _normalize_alb_types(edit_ir)            # <-- enable ALB→LB v5 mapping
    edit_ir = _normalize_ecs_json(edit_ir)             # Enable ECS container_definitions JSON wrapping
    edit_ir = _unwrap_single_element_lists(edit_ir)    # Unwrap single-element lists for string fields

    # Lambda + S3 helpers enabled to avoid validate errors in composite prompts
    edit_ir = _ensure_lambda_role_ir(edit_ir)
    edit_ir = _normalize_s3_notifications_ir(edit_ir)

    edit_ir = _normalize_public_access_block_ops(edit_ir)
    edit_ir = _normalize_iam_policy_json(edit_ir)
    edit_ir = _enforce_s3_sse_ir(edit_ir)
    edit_ir = _normalize_name_field_to_tag(edit_ir)  # map unsupported 'name' -> 'tags.Name'

    # relaxed final guard
    edit_ir = sanitize_edit_ir(edit_ir, CATALOG)

    # 3) Apply ops (with rollback snapshot) — multi-target resolution + fan-out + label-rename
    root = _repo_root()
    any_change = False
    touched_files: set[str] = set()
    backups: dict[str, str] = {}

    # Fan-out policy
    ALLOW_FANOUT_DEFAULT = os.getenv("EDIT_FANOUT", "safe").lower()  # "none"|"safe"|"all"

    def _is_safe_changes(op: dict) -> bool:
        # Define what's safe to fan out. Tweak as needed.
        safe_blocks = {"tags"}
        for ch in op.get("changes") or []:
            opn = (ch.get("op") or "").strip()
            path = (ch.get("path") or "").strip()
            head = path.split(".", 1)[0] if path else ""
            if opn in ("set", "remove"):
                continue
            if opn == "ensure_block" and head in safe_blocks:
                continue
            return False
        return True

    # Choose resolver (prefer multi-target if available)
    _resolver = globals().get("_resolve_targets") or (lambda catalog, sel, fh: (
        [_resolve_target(catalog, sel, fh)] if _resolve_target(catalog, sel, fh) else []
    ))

    # Helpers for label rename (must be defined elsewhere in this file)
    _rename_in_text = globals().get("_rename_resource_label_in_text")
    _append_moved   = globals().get("_append_moved_block")
    _update_refs    = globals().get("_update_references_repo_wide")

    for op in edit_ir["ops"]:
        selector = op.get("selector") or {}
        targets = _resolver(CATALOG, selector, op.get("file_hint"))

        if not targets and op["action"] != "create":
            raise HTTPException(404, {"error": "target_not_found", "message": selector})

        # per-op override via selector.fanout
        fanout_mode = (selector.get("fanout") or ALLOW_FANOUT_DEFAULT).lower()

        if op["action"] == "create":
            targets = [None]  # create uses file_hint only

        # Ambiguity handling
        if len(targets) > 1:
            if fanout_mode == "all" or (fanout_mode == "safe" and _is_safe_changes(op)):
                pass  # proceed with fan-out
            else:
                cand = [
                    {"address": t.get("address"), "type": t.get("type"),
                     "name": t.get("name"), "file": t.get("file")}
                    for t in targets
                ]
                raise HTTPException(409, {"error": "ambiguous_selector", "selector": selector, "candidates": cand})

        # Apply to each target (fan-out)
        for target in targets:
            tf_rel = (target or {}).get("file") or (op.get("file_hint") or "main.tf")
            tf_file = (root / tf_rel)

            key = str(tf_file.relative_to(root))
            if key not in backups and tf_file.exists():
                backups[key] = tf_file.read_text()

            # ---- Intercept sentinel label-rename BEFORE writing HCL -----------
            rename_change = None
            for ch in (op.get("changes") or []):
                if ch.get("op") == "set" and (ch.get("path") or "") == "__rename_label__":
                    rename_change = ch
                    break

            if rename_change:
                if not (_rename_in_text and _append_moved and _update_refs):
                    raise HTTPException(400, {
                        "error": "edit_apply_failed",
                        "message": "label-rename helpers not loaded; define "
                                   "_rename_resource_label_in_text, _append_moved_block, "
                                   "_update_references_repo_wide"
                    })

                val = rename_change.get("value") or {}
                _from = str(val.get("from", "")).strip()
                _to   = str(val.get("to", "")).strip()
                if not _from or not _to or "." not in _from or "." not in _to:
                    raise HTTPException(400, {"error": "edit_apply_failed", "message": "invalid __rename_label__ payload"})

                fr_type, fr_label = _from.split(".", 1)
                to_type, to_label = _to.split(".", 1)
                if fr_type != to_type:
                    raise HTTPException(400, {"error": "edit_apply_failed", "message": "type mismatch in __rename_label__ from/to"})

                # (1) rewrite resource header label in the file where the resource lives
                current = tf_file.read_text() if tf_file.exists() else ""
                updated = _rename_in_text(current, fr_type, fr_label, to_label)
                if updated == current:
                    raise HTTPException(400, {"error": "edit_apply_failed",
                                              "message": f"resource header {fr_type}.{fr_label} not found in {tf_rel}"})
                tf_file.write_text(updated)

                # (2) append 'moved' block (idempotent)
                _append_moved(tf_file.parent, _from, _to)

                # (3) update references across repo (all *.tf files)
                _update_refs(root, fr_type, fr_label, to_label)

                any_change = True
                touched_files.add(key)

                # remove sentinel so it never gets written as an attribute
                op["changes"] = [c for c in (op.get("changes") or []) if c is not rename_change]

                # If no other changes for this op, continue
                if not op["changes"]:
                    continue
            # ---- END label-rename --------------------------------------------

            try:
                changed = apply_op_to_file(tf_file, op, target)  # from editor.py
            except ValueError as e:
                if key in backups:
                    tf_file.write_text(backups[key])
                raise HTTPException(400, {"error": "edit_apply_failed", "message": str(e)})

            if changed:
                any_change = True
                touched_files.add(key)

    # 4) CI preview BEFORE commit/push
    ci = _ci_preview(root, CATALOG.get("dir") or ".")
    if not ci.get("ok"):
        for rel in touched_files:
            fpath = root / rel
            if rel in backups:
                fpath.write_text(backups[rel])
            else:
                try:
                    fpath.unlink()
                except Exception:
                    pass
        return {
            "ok": False,
            "changed": any_change,
            "ci_preview": ci,
            "note": "Terraform checks failed; changes were rolled back; no branch was pushed.",
            "difficulty": difficulty,
        }

    # Early return on no-op: no branch, no PR link
    if not any_change:
        if request.query_params.get("format") == "min":
            steps = ci.get("steps", [])
            steps_sorted = sorted(steps, key=lambda s: s.get("started_at", ""))
            lines: list[str] = []
            lines.append("RUN ORDER:")
            for s in steps_sorted:
                lines.append(f"  BEGIN {s['name']}  {s.get('started_at','')}")
            lines.append("")
            lines.append("STATUS: OK")
            lines.append("BRANCH: (none — no changes)")
            if touched_files:
                lines.append("FILES:")
                for f in sorted(touched_files):
                    lines.append(f"  - {f}")
            lines.append("")
            lines.append("CI STEPS SUMMARY:")
            for s in steps_sorted:
                lines.append(f"  {s['name']}: ok={s['ok']}  exit={s['exit_code']}  cmd={s['cmd']}")
            return Response("\n".join(lines) + "\n", media_type="text/plain")

        return {
            "ok": True,
            "changed": False,
            "touched_files": sorted(touched_files),
            "ci_preview": ci,
            "note": "No changes detected; nothing to commit.",
            "difficulty": difficulty,
        }

    # 5) Commit + push + PR link
    safe = re.sub(r"[^a-z0-9-]+", "-", (req.prompt or "edit").lower()).strip("-")[:30]
    branch = f"driftbox/{safe or 'edit'}-{int(time.time())}"
    push_out = _git_branch_commit_push(branch, f"Infrara: {req.prompt or 'Apply IR'}", root)
    pr_url = _extract_pr_url(push_out)
    repo_env = os.getenv("GITHUB_REPO")
    fallback_url = f"https://github.com/{repo_env}/compare/{branch}?expand=1" if (not pr_url and repo_env) else pr_url

    if request.query_params.get("format") == "min":
        steps = ci.get("steps", [])
        steps_sorted = sorted(steps, key=lambda s: s.get("started_at", ""))
        lines: list[str] = []
        lines.append("RUN ORDER:")
        for s in steps_sorted:
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

    return {
        "ok": True,
        "changed": any_change,
        "branch": branch,
        "pr_url": pr_url or fallback_url,
        "touched_files": sorted(touched_files),
        "ci_preview": ci,
        "note": "Open this URL to create the PR." if (pr_url or fallback_url) else "Push succeeded; open your repo to create a PR.",
        "ir": edit_ir,
        "difficulty": difficulty,
    }


# ------------------------------------------------------------------------------
# RAG endpoints
# ------------------------------------------------------------------------------
@app.get("/rag/health")
def rag_health():
    return {
        "rag": "available" if RAG_ENABLED else "unavailable",
        "notes": None if RAG_ENABLED else "rag/ package not importable; ensure PYTHONPATH and files present",
        "endpoints": ["/rag/search", "/rag/plan", "/rag/run"],
    }

@app.post("/rag/search")
def rag_search_route(req: RAGSearchRequest):
    if not RAG_ENABLED:
        raise HTTPException(500, {"error": "rag_unavailable", "message": "rag/ modules not importable"})
    ensure_registry_crawled()
    ensure_index_built()
    results = rag_search(req.prompt, "data/index/aws", k=int(req.k or 8))
    return {"query": req.prompt, "k": req.k, "results": results}

@app.post("/rag/plan")
def rag_plan(req: RAGPlanRequest):
    if not RAG_ENABLED:
        raise HTTPException(500, {"error": "rag_unavailable", "message": "rag/ modules not importable"})
    ensure_registry_crawled()
    ensure_index_built()
    retrieved = rag_search(req.prompt, "data/index/aws", k=8)
    plan = rag_plan_json(req.prompt, retrieved)
    hcl_map = rag_plan_to_hcl(plan, region_default=req.region_default or "us-east-1")
    return {"prompt": req.prompt, "retrieved": retrieved, "plan": plan, "hcl_files": hcl_map}

@app.post("/rag/run")
def rag_run(req: RAGRunRequest):
    if not RAG_ENABLED:
        raise HTTPException(500, {"error": "rag_unavailable", "message": "rag/ modules not importable"})
    ensure_registry_crawled()
    ensure_index_built()
    if req.validate:
        resp = run_pipeline(req.prompt, region_default=req.region_default or "us-east-1")
        return {
            "prompt": req.prompt,
            "retrieved": resp.get("retrieved"),
            "plan": resp.get("plan"),
            "hcl_files": resp.get("hcl_files"),
            "validation": resp.get("validation"),
            "workdir": resp.get("workdir"),
        }
    else:
        retrieved = rag_search(req.prompt, "data/index/aws", k=8)
        plan = rag_plan_json(req.prompt, retrieved)
        hcl_map = rag_plan_to_hcl(plan, region_default=req.region_default or "us-east-1")
        return {"prompt": req.prompt, "retrieved": retrieved, "plan": plan, "hcl_files": hcl_map}

# ------------------------------------------------------------------------------
# Entrypoint
# ------------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)

