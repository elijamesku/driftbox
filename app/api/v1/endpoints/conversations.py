"""
Conversation API endpoints for chat-based infrastructure management.
Provides auditable lineage tracking with git commits.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from pydantic import BaseModel
from app.services.conversation_manager import conversation_manager
from app.services.auth import authentication_service
from app.database.models import UserAccount


router = APIRouter()


class CreateConversationRequest(BaseModel):
    title: str
    user_id: Optional[str] = None
    repository_path: Optional[str] = None


class AddMessageRequest(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str
    ir: Optional[dict] = None
    diff_id: Optional[str] = None
    commit_sha: Optional[str] = None
    branch_name: Optional[str] = None
    pr_url: Optional[str] = None


@router.post("/conversations")
def create_conversation(
    req: CreateConversationRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Create a new conversation thread.
    
    Body:
        title: Conversation title (e.g., "Setup prod infrastructure")
        user_id: Optional user identifier (ignored - uses authenticated user)
        repository_path: Optional repo path
    """
    # Use authenticated user's ID, ignore user_id from request for security
    conversation_id = conversation_manager.initialize_conversation_thread(
        thread_title=req.title,
        account_id=user.id,
        repository_location=req.repository_path,
    )
    
    return {
        "ok": True,
        "conversation_id": conversation_id,
        "message": f"Conversation '{req.title}' created",
    }


@router.get("/conversations")
def list_conversations(
    limit: int = 50,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    List recent conversations for the authenticated user.
    
    Query params:
        limit: Max results (default 50)
    """
    # Validate pagination parameters
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 1000")
    
    # Only return conversations for authenticated user
    conversations = conversation_manager.enumerate_conversation_threads(account_id=user.id, result_limit=limit)
    
    return {
        "ok": True,
        "conversations": conversations,
        "count": len(conversations),
    }


@router.get("/conversations/{conversation_id}")
def get_conversation(
    conversation_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get full conversation with all messages.
    Only accessible by the conversation owner.
    """
    # Verify ownership by passing user_id
    conversation = conversation_manager.retrieve_conversation_thread(conversation_id, user_id=user.id)
    if not conversation:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Conversation {conversation_id} not found"})
    
    return {
        "ok": True,
        "conversation": conversation,
    }


@router.get("/conversations/{conversation_id}/lineage")
def get_conversation_lineage(
    conversation_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get conversation with commit lineage.
    Shows how infrastructure evolved through the conversation.
    Only accessible by the conversation owner.
    """
    # Verify ownership by passing user_id
    lineage = conversation_manager.retrieve_conversation_with_git_lineage(conversation_id, user_id=user.id)
    if not lineage:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Conversation {conversation_id} not found"})
    
    return {
        "ok": True,
        "conversation": lineage,
        "lineage_count": len(lineage.get("lineage", [])),
    }


@router.post("/conversations/{conversation_id}/messages")
def add_message(
    conversation_id: str,
    req: AddMessageRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Add a message to a conversation.
    Only accessible by the conversation owner.
    
    Body:
        role: 'user' or 'assistant'
        content: Message text
        ir: Optional infrastructure changes
        diff_id: Optional link to diff session
        commit_sha: Optional git commit
        branch_name: Optional branch name
        pr_url: Optional PR URL
    """
    # Verify ownership before allowing message addition
    conversation = conversation_manager.retrieve_conversation_thread(conversation_id, user_id=user.id)
    if not conversation:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Conversation {conversation_id} not found"})
    
    message_id = conversation_manager.append_message_to_thread(
        conversation_id=conversation_id,
        role=req.role,
        content=req.content,
        ir=req.ir,
        diff_id=req.diff_id,
        commit_sha=req.commit_sha,
        branch_name=req.branch_name,
        pr_url=req.pr_url,
    )
    
    return {
        "ok": True,
        "message_id": message_id,
        "conversation_id": conversation_id,
    }


@router.get("/conversations/search")
def search_conversations(
    q: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Search conversations by content.
    Only searches conversations owned by the authenticated user.
    
    Query params:
        q: Search query
    """
    # Only search conversations for authenticated user
    results = conversation_manager.search_conversation_threads(search_query=q, account_id=user.id)
    
    return {
        "ok": True,
        "query": q,
        "results": results,
        "count": len(results),
    }


@router.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """Delete a conversation and all its messages. Only accessible by the conversation owner."""
    # Verify ownership before deletion
    conversation = conversation_manager.retrieve_conversation_thread(conversation_id, user_id=user.id)
    if not conversation:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Conversation {conversation_id} not found"})
    
    success = conversation_manager.remove_conversation_thread(conversation_id)
    if not success:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Conversation {conversation_id} not found"})
    
    return {
        "ok": True,
        "message": f"Conversation {conversation_id} deleted",
    }

