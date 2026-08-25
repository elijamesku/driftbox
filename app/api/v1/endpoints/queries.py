"""
Query logging API endpoints for LLM training data collection.
Tracks all prompts and responses for future model fine-tuning.
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from typing import Optional
from app.services.query_logger import query_logger
from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.utils.errors import sanitize_error_detail
import tempfile


router = APIRouter()


@router.get("/queries")
def list_queries(
    limit: int = 100,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    List recent queries for the authenticated user.
    
    Query params:
        limit: Max results (default 100)
    """
    # Validate pagination parameters
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 1000")
    
    # Only return queries for authenticated user
    queries = query_logger.fetch_recent_queries(result_limit=limit, account_id=user.id)
    
    return {
        "ok": True,
        "queries": queries,
        "count": len(queries),
    }


@router.get("/queries/{query_id}")
def get_query(
    query_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """Get a specific query by ID. Only accessible by the query owner."""
    query = query_logger.retrieve_query_by_id(query_id)
    if not query:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Query {query_id} not found"})
    
    # Verify ownership
    if query.get("user_id") != user.id:
        raise HTTPException(status_code=403, detail={"error": "forbidden", "message": "Access denied"})
    
    return {
        "ok": True,
        "query": query,
    }


@router.get("/queries/statistics")
def get_query_statistics(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get query statistics for the authenticated user.
    Returns success rates, average times, model usage, etc.
    """
    # Note: compute_query_statistics returns global stats, but we should filter by user
    # For now, we'll return user-specific stats by fetching their queries
    user_queries = query_logger.fetch_recent_queries(result_limit=10000, account_id=user.id)
    total = len(user_queries)
    successful = sum(1 for q in user_queries if q.get("success", False))
    
    stats = {
        "total_queries": total,
        "successful_queries": successful,
        "failed_queries": total - successful,
        "success_rate": (successful / total * 100) if total > 0 else 0,
    }
    
    return {
        "ok": True,
        "statistics": stats,
    }


@router.post("/queries/export")
def export_training_data(
    format: str = "jsonl",
    limit: Optional[int] = None,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Export queries as training data for LLM fine-tuning.
    Only exports queries owned by the authenticated user.
    
    Query params:
        format: 'jsonl' or 'json' (default jsonl)
        limit: Max queries to export (default all)
    
    Returns:
        File download with training data
    """
    # Validate pagination parameters
    if limit is not None and (limit < 1 or limit > 10000):
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 10000")
    
    # Validate format
    if format not in ["jsonl", "json"]:
        raise HTTPException(status_code=400, detail="Format must be 'jsonl' or 'json'")
    
    # Create temp file
    temp_file = tempfile.NamedTemporaryFile(
        mode='w',
        delete=False,
        suffix=f".{format}",
        prefix="training_data_"
    )
    temp_file.close()
    
    # Export to file - note: export_fine_tuning_dataset doesn't filter by user
    # We need to fetch user queries first, then export them
    try:
        # Fetch user's queries
        user_queries = query_logger.fetch_recent_queries(result_limit=limit or 10000, account_id=user.id)
        
        # Export only user's queries
        import json
        formatted_data = []
        for query in user_queries:
            if query.get("success", False):  # Only export successful queries
                formatted_data.append({
                    "prompt": query.get("prompt", ""),
                    "completion": json.dumps(query.get("ir", {})),
                    "metadata": {
                        "reasoning": query.get("reasoning_tree"),
                        "execution_time_ms": query.get("execution_time_ms"),
                        "model": query.get("llm_model"),
                        "timestamp": query.get("created_at"),
                    }
                })
        
        # Write to file
        with open(temp_file.name, 'w') as f:
            if format == "jsonl":
                for item in formatted_data:
                    f.write(json.dumps(item) + "\n")
            else:
                json.dump(formatted_data, f, indent=2)
        
        count = len(formatted_data)
        
        return FileResponse(
            path=temp_file.name,
            filename=f"training_data_{format}.{format}",
            media_type="application/json" if format == "json" else "application/x-ndjson",
            headers={"X-Query-Count": str(count)}
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "export_failed", "message": sanitize_error_detail(e, "Failed to export queries")})

