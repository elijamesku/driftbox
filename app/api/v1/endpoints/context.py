"""
Context API Endpoints - Expose indexing and search operations for codebase and conversation context
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.services.context_service import context_service
from app.services.codebase_indexing_service import codebase_indexing_service
from app.services.conversation_indexing_service import conversation_indexing_service
from app.utils.errors import sanitize_error_detail

router = APIRouter()


# ===== Request/Response Models =====

class CodebaseChunk(BaseModel):
    """Codebase chunk from frontend parser"""
    text: str
    meta: Dict[str, Any]


class IndexCodebaseRequest(BaseModel):
    """Request to index codebase"""
    owner: str
    repo: str
    chunks: List[CodebaseChunk]


class UpdateCodebaseRequest(BaseModel):
    """Request to incrementally update codebase index"""
    owner: str
    repo: str
    changed_files: List[Dict[str, Any]]  # {path, type, chunks}


class SearchCodebaseRequest(BaseModel):
    """Request to search codebase"""
    owner: str
    repo: str
    query: str
    top_k: int = 8


class SearchConversationsRequest(BaseModel):
    """Request to search conversation history"""
    query: str
    conversation_id: Optional[str] = None
    top_k: int = 5


class CombinedContextRequest(BaseModel):
    """Request for combined codebase and conversation context"""
    owner: str
    repo: str
    conversation_id: Optional[str] = None
    query: str
    codebase_top_k: int = 8
    conversation_top_k: int = 5


# ===== Endpoints =====

@router.post("/index-codebase", tags=["context"])
async def index_codebase(
    req: IndexCodebaseRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Receive parsed chunks from frontend and trigger codebase indexing
    Also extracts and indexes infrastructure resources
    """
    try:
        # Convert Pydantic models to dicts
        chunks = [{"text": chunk.text, "meta": chunk.meta} for chunk in req.chunks]
        
        # Extract infrastructure resources from chunks
        from app.services.infrastructure_indexing_service import infrastructure_indexing_service
        resources = infrastructure_indexing_service.extract_resources_from_chunks(chunks)
        
        # Parse resource attributes from chunk text for resources that need it
        # For now, we'll store what we have and enhance later with full HCL parsing
        enhanced_resources = []
        for resource in resources:
            # Try to parse attributes from the chunk text if available
            # Find the chunk that corresponds to this resource
            resource_chunk = None
            for chunk in chunks:
                meta = chunk.get("meta", {})
                if (meta.get("type") == "resource" and 
                    meta.get("resource_type") == resource.get("type") and
                    meta.get("resource_name") == resource.get("name")):
                    resource_chunk = chunk
                    break
            
            # Extract additional metadata from chunk
            if resource_chunk:
                meta = resource_chunk.get("meta", {})
                resource["line"] = meta.get("line_start") or meta.get("line")
                resource["file"] = meta.get("file", resource.get("file", ""))
                # Try to parse attrs from chunk text if we have HCL parser
                # For now, we'll store basic structure
                if not resource.get("attrs"):
                    resource["attrs"] = {}
            
            # Ensure address is set
            if not resource.get("address"):
                resource["address"] = f"{resource.get('type', '')}.{resource.get('name', '')}"
            
            # Ensure tf_name is set
            if not resource.get("tf_name"):
                resource["tf_name"] = resource.get("name", "")
            
            enhanced_resources.append(resource)
        
        # Store resources in infrastructure index
        if enhanced_resources:
            resource_result = infrastructure_indexing_service.store_resources(
                user_id=user.id,
                owner=req.owner,
                repo=req.repo,
                resources=enhanced_resources
            )
            print(f"✅ [index_codebase] Stored {len(enhanced_resources)} resources in infrastructure index")
        
        # Index codebase chunks
        result = context_service.update_codebase_index(
            user_id=user.id,
            owner=req.owner,
            repo=req.repo,
            chunks=chunks
        )
        
        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error", "Failed to index codebase"))
        
        # Update metadata with timestamp
        from app.services.codebase_indexing_service import codebase_indexing_service
        metadata_path = codebase_indexing_service.get_metadata_path(user.id, req.owner, req.repo)
        if metadata_path.exists():
            import json
            with open(metadata_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
            metadata["last_updated"] = datetime.utcnow().isoformat()
            with open(metadata_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
        
        return {
            "success": True,
            "message": f"Indexed {result.get('chunk_count', 0)} chunks and {len(enhanced_resources)} resources for {req.owner}/{req.repo}",
            "chunk_count": result.get("chunk_count", 0),
            "file_count": result.get("file_count", 0),
            "resource_count": len(enhanced_resources)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to index codebase"))


@router.post("/update-codebase", tags=["context"])
async def update_codebase(
    req: UpdateCodebaseRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Incrementally update codebase index for changed files
    Also updates infrastructure resources
    """
    try:
        # Extract resources from changed files
        from app.services.infrastructure_indexing_service import infrastructure_indexing_service
        all_resources = []
        
        for file_change in req.changed_files:
            if file_change.get("type") != "deleted":
                chunks = file_change.get("chunks", [])
                file_resources = infrastructure_indexing_service.extract_resources_from_chunks(chunks)
                # Enhance resources with file path and line info
                for resource in file_resources:
                    # Find corresponding chunk
                    for chunk in chunks:
                        meta = chunk.get("meta", {})
                        if (meta.get("type") == "resource" and 
                            meta.get("resource_type") == resource.get("type") and
                            meta.get("resource_name") == resource.get("name")):
                            resource["file"] = file_change.get("path", meta.get("file", ""))
                            resource["line"] = meta.get("line_start") or meta.get("line")
                            if not resource.get("address"):
                                resource["address"] = f"{resource.get('type', '')}.{resource.get('name', '')}"
                            if not resource.get("tf_name"):
                                resource["tf_name"] = resource.get("name", "")
                            if not resource.get("attrs"):
                                resource["attrs"] = {}
                            break
                    all_resources.append(resource)
        
        # Get existing resources and update
        existing_resources = infrastructure_indexing_service.get_resources_from_index(
            user_id=user.id,
            owner=req.owner,
            repo=req.repo
        )
        
        # Build file-to-resources map for existing resources
        file_to_resources = {}
        for resource in existing_resources:
            file_path = resource.get("file", "")
            if file_path not in file_to_resources:
                file_to_resources[file_path] = []
            file_to_resources[file_path].append(resource)
        
        # Remove resources from deleted/modified files
        files_to_remove = set()
        for file_change in req.changed_files:
            file_path = file_change.get("path", "")
            change_type = file_change.get("type", "")
            if change_type in ["deleted", "modified"]:
                files_to_remove.add(file_path)
        
        # Keep resources from files that weren't changed
        final_resources = [
            r for r in existing_resources
            if r.get("file", "") not in files_to_remove
        ]
        
        # Add new/updated resources
        final_resources.extend(all_resources)
        
        # Store updated resources
        if final_resources:
            infrastructure_indexing_service.store_resources(
                user_id=user.id,
                owner=req.owner,
                repo=req.repo,
                resources=final_resources
            )
            print(f"✅ [update_codebase] Updated infrastructure index with {len(final_resources)} resources")
        
        # Update codebase chunks
        try:
            result = codebase_indexing_service.incremental_update(
                user_id=user.id,
                owner=req.owner,
                repo=req.repo,
                changed_files=req.changed_files
            )
            
            if not result.get("success"):
                error_msg = result.get("error", "Failed to update codebase index")
                print(f"❌ [update_codebase] Index update failed: {error_msg}")
                raise HTTPException(status_code=500, detail=error_msg)
            
            # Log success with stats
            print(f"✅ [update_codebase] Index updated successfully: {result.get('reused_embeddings', 0)} reused, {result.get('new_embeddings', 0)} new embeddings")
            
            return {
                "success": True,
                "message": f"Updated codebase index for {req.owner}/{req.repo}",
                "chunk_count": result.get("chunk_count", 0),
                "file_count": result.get("file_count", 0),
                "resource_count": len(final_resources),
                "reused_embeddings": result.get("reused_embeddings", 0),
                "new_embeddings": result.get("new_embeddings", 0),
                "updated_files": result.get("updated_files", 0)
            }
        except HTTPException:
            raise
        except Exception as e:
            error_detail = str(e)
            print(f"❌ [update_codebase] Exception during index update: {error_detail}")
            raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to update codebase index"))
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ [update_codebase] Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to update codebase"))


@router.post("/search-codebase", tags=["context"])
async def search_codebase(
    req: SearchCodebaseRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Search codebase (used internally by chat)
    """
    try:
        results = await context_service.get_codebase_context(
            user_id=user.id,
            owner=req.owner,
            repo=req.repo,
            query=req.query,
            top_k=req.top_k
        )
        
        return {
            "success": True,
            "results": results,
            "count": len(results)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to search codebase"))


@router.post("/search-conversations", tags=["context"])
async def search_conversations(
    req: SearchConversationsRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Search conversation history
    """
    try:
        results = context_service.get_conversation_context(
            user_id=user.id,
            conversation_id=req.conversation_id,
            query=req.query,
            top_k=req.top_k
        )
        
        return {
            "success": True,
            "results": results,
            "count": len(results)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to search conversations"))


@router.post("/combined", tags=["context"])
async def get_combined_context(
    req: CombinedContextRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get merged codebase and conversation context
    """
    try:
        result = context_service.get_combined_context(
            user_id=user.id,
            owner=req.owner,
            repo=req.repo,
            conversation_id=req.conversation_id,
            query=req.query,
            codebase_top_k=req.codebase_top_k,
            conversation_top_k=req.conversation_top_k
        )
        
        return {
            "success": True,
            "codebase_context": result["codebase_context"],
            "conversation_context": result["conversation_context"],
            "combined_text": result["combined_text"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to get combined context"))


@router.get("/index-status/{owner}/{repo}", tags=["context"])
async def get_index_status(
    owner: str,
    repo: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get codebase index status
    """
    try:
        status = codebase_indexing_service.get_index_status(
            user_id=user.id,
            owner=owner,
            repo=repo
        )
        
        return {
            "success": True,
            "status": status
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to get index status"))

