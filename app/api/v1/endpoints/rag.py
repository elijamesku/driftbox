from fastapi import APIRouter
from app.config import RAG_ENABLED
from app.rag.pipeline import (
    ensure_terraform_registry_documentation_crawled as ensure_registry_crawled,
    ensure_vector_search_index_constructed as ensure_index_built,
    execute_full_rag_infrastructure_pipeline as run_pipeline
)
from app.rag.retrieve import execute_semantic_search as rag_search
from app.rag.generate import convert_natural_language_to_infrastructure_plan as rag_plan_json
from app.rag.hcl import convert_resource_plan_to_hcl as rag_plan_to_hcl
from app.models.requests import RAGSearchQuery, RAGInfrastructurePlan, RAGInfrastructureExecution
from fastapi import HTTPException

router = APIRouter()

# ------------------------------------------------------------------------------
# RAG endpoints (optional, if rag/ is present)
# ------------------------------------------------------------------------------
 

@router.post("/rag/search")
def rag_search_route(req: RAGSearchQuery):
    if not RAG_ENABLED:
        raise HTTPException(500, {"error": "rag_unavailable", "message": "rag/ modules not importable"})
    ensure_registry_crawled()
    ensure_index_built()
    results = rag_search(req.prompt, "app/data/index/aws", top_k_results=int(req.k or 8))
    return {"query": req.prompt, "k": req.k, "results": results}

@router.post("/rag/plan")
def rag_plan(req: RAGInfrastructurePlan):
    if not RAG_ENABLED:
        raise HTTPException(500, {"error": "rag_unavailable", "message": "rag/ modules not importable"})
    ensure_registry_crawled()
    ensure_index_built()
    retrieved = rag_search(req.prompt, "app/data/index/aws", top_k_results=8)
    plan = rag_plan_json(req.prompt, retrieved)
    hcl_map = rag_plan_to_hcl(plan, default_region=req.region_default or "us-east-1")
    return {"prompt": req.prompt, "retrieved": retrieved, "plan": plan, "hcl_files": hcl_map}

@router.post("/rag/run")
def rag_run(req: RAGInfrastructureExecution):
    if not RAG_ENABLED:
        raise HTTPException(500, {"error": "rag_unavailable", "message": "rag/ modules not importable"})
    ensure_registry_crawled()
    ensure_index_built()
    if req.validate_run:
        resp = run_pipeline(req.prompt, default_aws_region=req.region_default or "us-east-1")
        return {
            "prompt": req.prompt,
            "retrieved": resp.get("retrieved"),
            "plan": resp.get("plan"),
            "hcl_files": resp.get("hcl_files"),
            "validation": resp.get("validation"),
            "workdir": resp.get("workdir"),
        }
    else:
        retrieved = rag_search(req.prompt, "app/data/index/aws", top_k_results=8)
        plan = rag_plan_json(req.prompt, retrieved)
        hcl_map = rag_plan_to_hcl(plan, default_region=req.region_default or "us-east-1")
        return {"prompt": req.prompt, "retrieved": retrieved, "plan": plan, "hcl_files": hcl_map}
