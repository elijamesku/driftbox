"""
File Proposals API - Handle file change proposals from agent mode.
Allows users to approve/reject proposed file changes (Cursor-style).
"""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List
from pathlib import Path
import os

from app.database.models import UserAccount
from app.services.auth import authentication_service
from app.utils.errors import sanitize_error_detail


router = APIRouter()


class FileProposal(BaseModel):
    """Represents a proposed file change"""
    action: str  # "create", "edit", "delete"
    path: str
    old_content: str | None = Field(None, alias='oldContent')
    new_content: str = Field(alias='newContent')
    description: str | None = None
    
    class Config:
        populate_by_name = True  # Accept both snake_case and camelCase


class CleanWorkspaceRequest(BaseModel):
    """Request to clean workspace of old terraform files"""
    workspace_path: str


class ApplyProposalRequest(BaseModel):
    """Request to apply a file proposal"""
    proposal: FileProposal
    workspace_path: str


class RejectProposalRequest(BaseModel):
    """Request to reject a file proposal"""
    proposal: FileProposal
    reason: str | None = None


@router.post("/proposals/apply", tags=["file-proposals"])
async def apply_file_proposal(
    req: ApplyProposalRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Apply a file proposal - write the file to the workspace.
    Like clicking the checkmark in Cursor.
    """
    try:
        proposal = req.proposal
        workspace = Path(req.workspace_path).resolve()
        
        # Validate workspace exists or can be created
        if not workspace.exists():
            workspace.mkdir(parents=True, exist_ok=True)
        
        # Validate and sanitize file path to prevent path traversal
        # Normalize the path and ensure it's within workspace
        try:
            # Resolve the target path relative to workspace
            target_file = (workspace / proposal.path).resolve()
            
            # Security check: ensure resolved path is within workspace
            if not str(target_file).startswith(str(workspace)):
                raise HTTPException(
                    status_code=400, 
                    detail="Invalid file path - path traversal detected"
                )
        except (ValueError, OSError) as e:
            raise HTTPException(
                status_code=400,
                detail="Invalid file path"
            )
        
        # Validate file content size to prevent DoS (max 10MB)
        MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
        if proposal.new_content and len(proposal.new_content.encode('utf-8')) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File content too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB"
            )
        
        # Handle different actions
        if proposal.action == "delete":
            if target_file.exists():
                target_file.unlink()
                return {
                    "success": True,
                    "message": f"Deleted {proposal.path}",
                    "file_path": str(target_file)
                }
            else:
                raise HTTPException(status_code=404, detail="File not found")
        
        elif proposal.action in ["create", "edit"]:
            # CRITICAL SAFETY CHECK: Don't overwrite existing files on "create"
            if proposal.action == "create" and target_file.exists():
                raise HTTPException(
                    status_code=400, 
                    detail=f"❌ SAFETY ERROR: File '{proposal.path}' already exists! Cannot overwrite existing files with 'create' action. Backend should have generated a different filename (e.g., storage_2.tf) or used 'edit' action."
                )
            
            # Create parent directories if needed
            target_file.parent.mkdir(parents=True, exist_ok=True)
            
            # Write the file
            with open(target_file, 'w', encoding='utf-8') as f:
                f.write(proposal.new_content)
            
            return {
                "success": True,
                "message": f"{'Created' if proposal.action == 'create' else 'Updated'} {proposal.path}",
                "file_path": str(target_file)
            }
        
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {proposal.action}")
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to apply proposal"))


@router.post("/proposals/reject", tags=["file-proposals"])
async def reject_file_proposal(
    req: RejectProposalRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Reject a file proposal - do nothing, just log the rejection.
    Like clicking the X in Cursor.
    """
    return {
        "success": True,
        "message": f"Rejected proposal for {req.proposal.path}",
        "reason": req.reason or "User rejected"
    }


@router.post("/clean-workspace", tags=["file-proposals"])
async def clean_workspace(
    req: CleanWorkspaceRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    DEPRECATED: This endpoint is being replaced by smart conflict detection.
    For now, it returns success without deleting anything to prevent data loss.
    """
    try:
        workspace = Path(req.workspace_path)
        
        # Security check
        if not workspace.exists():
            raise HTTPException(status_code=404, detail="Workspace not found")
        
        # TODO: Implement smart conflict detection instead of deletion
        # For now, just return success without deleting anything
        return {
            "success": True,
            "message": "Workspace cleaning disabled - using smart conflict detection instead",
            "removed_files": []
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to clean workspace"))

