# rag/pipeline.py
import os, json, tempfile, shutil
from pathlib import Path
from typing import Dict, Any
from rag.crawl_registry import crawl_provider_resources
from rag.ingest import build_index
from rag.retrieve import search
from rag.generate import nl_to_resource_plan
from rag.hcl import plan_to_hcl
from rag.postprocess import write_files, validate_repo

def ensure_registry_crawled():
    out = "data/registry/aws/resources.jsonl"
    if not os.path.exists(out):
        crawl_provider_resources(limit=None)

def ensure_index_built():
    jsonl = "data/registry/aws/resources.jsonl"
    idxdir = "data/index/aws"
    if not (os.path.exists(idxdir) and os.path.exists(f"{idxdir}/faiss.index")):
        build_index(jsonl, idxdir)

def run_pipeline(user_prompt: str, region_default="us-east-1") -> Dict[str, Any]:
    ensure_registry_crawled()
    ensure_index_built()
    results = search(user_prompt, "data/index/aws", k=8)
    plan = nl_to_resource_plan(user_prompt, results, model=os.getenv("OPENAI_MODEL","gpt-4o"))
    hcl_map = plan_to_hcl(plan, region_default=region_default)

    tmp = Path(tempfile.mkdtemp(prefix="tf_rag_"))
    try:
        write_files(hcl_map, tmp)
        validation = validate_repo(tmp)
        return {
            "prompt": user_prompt,
            "retrieved": results,
            "plan": plan,
            "hcl_files": {k: (tmp / k).read_text() for k in hcl_map},
            "validation": validation,
            "workdir": str(tmp),
        }
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise

if __name__ == "__main__":
    import sys, pprint
    q = sys.argv[1] if len(sys.argv) > 1 else "private S3 bucket with versioning in us-east-1"
    resp = run_pipeline(q)
    pprint.pp(resp["plan"])
    for fn, txt in resp["hcl_files"].items():
        print(f"\n=== {fn} ===\n{txt}")
    print("\nValidation:", resp["validation"]["ok"])
