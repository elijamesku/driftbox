"""
Infrastructure Index API Endpoints - Status, trigger indexing, and query resources
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.services.infrastructure_indexing_service import infrastructure_indexing_service
from app.services.infrastructure_query_service import infrastructure_query_service
from app.services.codebase_indexing_service import codebase_indexing_service
from app.utils.errors import sanitize_error_detail

router = APIRouter()


class TriggerIndexingRequest(BaseModel):
    """Request to trigger infrastructure indexing"""
    branch: Optional[str] = "main"


@router.get("/status/{owner}/{repo}", tags=["infrastructure"])
async def get_index_status(
    owner: str,
    repo: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get infrastructure index status for a repository
    
    Returns:
        Status dictionary with exists, resource_count, last_updated
    """
    try:
        # Check codebase index status
        codebase_status = codebase_indexing_service.get_index_status(
            user_id=user.id,
            owner=owner,
            repo=repo
        )
        
        # Check resources
        resources = infrastructure_indexing_service.get_resources_from_index(
            user_id=user.id,
            owner=owner,
            repo=repo
        )
        
        return {
            "success": True,
            "codebase_indexed": codebase_status.get("exists", False),
            "resources_indexed": len(resources) > 0,
            "resource_count": len(resources),
            "chunk_count": codebase_status.get("chunk_count", 0),
            "file_count": codebase_status.get("file_count", 0),
            "last_updated": codebase_status.get("last_updated")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to get index status"))


@router.post("/{owner}/{repo}", tags=["infrastructure"])
async def trigger_indexing(
    owner: str,
    repo: str,
    req: TriggerIndexingRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Trigger infrastructure indexing for a repository
    
    This will parse the repository and index both code chunks and infrastructure resources.
    Note: This endpoint triggers parsing via GitHub API. For full indexing with resources,
    use the /context/index-codebase endpoint which receives parsed chunks from frontend.
    """
    try:
        # Check if already indexed
        status = codebase_indexing_service.get_index_status(user.id, owner, repo)
        if status.get("exists"):
            return {
                "success": True,
                "message": "Repository already indexed",
                "resource_count": len(infrastructure_indexing_service.get_resources_from_index(user.id, owner, repo))
            }
        
        # Trigger parsing via GitHub parser
        # This will populate INFRASTRUCTURE_CATALOG temporarily
        from app.api.v1.endpoints.github_parser import parse_github_repo, GitHubRepoRequest
        parse_req = GitHubRepoRequest(owner=owner, repo=repo, branch=req.branch or "main")
        parsed_data = await parse_github_repo(parse_req, user)
        
        # Extract resources from parsed data
        resources = parsed_data.get("resources", [])
        
        # Store resources in infrastructure index
        if resources:
            infrastructure_indexing_service.store_resources(
                user_id=user.id,
                owner=owner,
                repo=repo,
                resources=resources,
                commit_sha=parsed_data.get("sha")
            )
        
        return {
            "success": True,
            "message": f"Indexed {len(resources)} resources for {owner}/{repo}",
            "resource_count": len(resources),
            "note": "For full codebase indexing with RAG, use /context/index-codebase endpoint"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to trigger indexing"))


@router.get("/{owner}/{repo}/resources", tags=["infrastructure"])
async def get_resources(
    owner: str,
    repo: str,
    resource_type: Optional[str] = None,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get infrastructure resources from index
    
    Args:
        owner: Repository owner
        repo: Repository name
        resource_type: Optional filter by resource type (e.g., "aws_s3_bucket")
        
    Returns:
        List of resources
    """
    try:
        if resource_type:
            resources = infrastructure_query_service.get_resources_by_type(
                user_id=user.id,
                owner=owner,
                repo=repo,
                resource_type=resource_type,
                fallback_to_parse=False  # Don't auto-parse, return empty if not indexed
            )
        else:
            resources = infrastructure_query_service.get_all_resources(
                user_id=user.id,
                owner=owner,
                repo=repo,
                fallback_to_parse=False  # Don't auto-parse, return empty if not indexed
            )
        
        return {
            "success": True,
            "resources": resources,
            "count": len(resources)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to get resources"))


@router.get("/{owner}/{repo}/relationships", tags=["infrastructure"])
async def get_relationships(
    owner: str,
    repo: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get relationships between infrastructure resources
    
    Returns:
        List of relationship dictionaries with source, target, and relationship type
    """
    try:
        relationships = infrastructure_query_service.get_resource_relationships(
            user_id=user.id,
            owner=owner,
            repo=repo
        )
        
        return {
            "success": True,
            "relationships": relationships,
            "count": len(relationships)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to get relationships"))

