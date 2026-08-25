from fastapi import APIRouter
from app.config import AI_PROVIDER, EXECUTION_ENVIRONMENT, RAG_SYSTEM_ACTIVE

router = APIRouter()

@router.get("/health")
def health_check_endpoint():
    return {
        "status": "ok",
        "mode": AI_PROVIDER,
        "exec_mode": EXECUTION_ENVIRONMENT,
        "rag": "available" if RAG_SYSTEM_ACTIVE else "unavailable",
        "actions_supported": ["plan", "apply"],
        "resources_supported": ["aws_s3_bucket", "aws_iam_user", "aws_dynamodb_table"],
        "endpoints": [
            "/generate-plan", "/index-repo", "/catalog", "/nl-edit", "/edit-repo",
            "/git/status", "/git/set-remote",
            "/rag/health", "/rag/search", "/rag/plan", "/rag/run"
        ],
    }

@router.get("/rag/health")
def rag_system_health_check():
    return {
        "rag": "available" if RAG_SYSTEM_ACTIVE else "unavailable",
        "notes": None if RAG_SYSTEM_ACTIVE else "rag/ package not importable; ensure PYTHONPATH and files present",
        "endpoints": ["/rag/search", "/rag/plan", "/rag/run"],
    }