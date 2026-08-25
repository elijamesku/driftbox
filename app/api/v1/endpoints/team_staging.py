"""
Team Staging API endpoints.
Manages server-side staging area for team collaboration.
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
from pydantic import BaseModel

from app.services.auth import require_authentication
from app.database.models import UserAccount
from app.services.team_staging import staging_manager

router = APIRouter(prefix="/teams", tags=["team-staging"])


# ========== Request Models ==========

class FileChange(BaseModel):
    path: str
    content: str
    original_content: str = ""
    lines_added: int = 0
    lines_removed: int = 0


class StageChangesRequest(BaseModel):
    repo_full_name: str
    files: List[FileChange]
    metadata: Optional[dict] = None
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    clear_existing: bool = False  # If True, clear user's existing staged files before staging new ones


class CreateTeamPRRequest(BaseModel):
    title: str
    description: str
    repo_full_name: str
    contributor_ids: Optional[List[str]] = None  # If None, include all


# ========== Endpoints ==========

@router.post("/{team_id}/staging/stage")
async def stage_changes(
    team_id: str,
    request: StageChangesRequest,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Stage changes for current user.
    Changes accumulate in team staging area.
    
    Required fields:
    - repo_full_name: str (e.g., "owner/repo")
    - files: List[FileChange] where each FileChange has:
      - path: str (file path)
      - content: str (file content)
      - original_content: str (optional)
      - lines_added: int (optional)
      - lines_removed: int (optional)
    """
    try:
        # Validate required fields
        if not request.repo_full_name:
            raise HTTPException(status_code=400, detail="repo_full_name is required")
        
        if not request.files or len(request.files) == 0:
            raise HTTPException(status_code=400, detail="files array is required and cannot be empty")
        
        # Validate each file
        for i, file_change in enumerate(request.files):
            if not file_change.path:
                raise HTTPException(status_code=400, detail=f"files[{i}].path is required")
            if file_change.content is None:
                raise HTTPException(status_code=400, detail=f"files[{i}].content is required")
        
        # Get user info from authenticated user or request body
        user_id = request.user_id or current_user.id
        user_name = request.user_name or current_user.github_username or current_user.full_name or current_user.email or "Unknown User"
        
        result = staging_manager.stage_user_changes(
            team_id=team_id,
            user_id=user_id,
            user_name=user_name,
            repo_full_name=request.repo_full_name,
            files=[f.dict() for f in request.files],
            metadata=request.metadata,
            clear_existing=request.clear_existing
        )
        
        return {
            "ok": True,
            "message": "Changes staged successfully",
            **result
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Staging Error] {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"Failed to stage changes: {str(e)}")


@router.delete("/{team_id}/staging/unstage")
async def unstage_changes(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Unstage current user's changes.
    """
    result = staging_manager.unstage_user_changes(team_id, current_user.id)
    
    if not result['success']:
        raise HTTPException(status_code=404, detail=result.get('error'))
    
    return {
        "ok": True,
        **result
    }


@router.post("/{team_id}/staging/clear")
async def clear_user_staging(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Clear current user's staged files.
    Use this before starting a fresh generation to remove stale files.
    """
    result = staging_manager.clear_user_staging(team_id, current_user.id)
    
    return {
        "ok": True,
        **result
    }


@router.get("/{team_id}/staging")
async def get_staging(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Get all staged changes for team.
    Shows who staged what, stats, conflicts, etc.
    No DB needed - all in-memory.
    """
    staged = staging_manager.get_staged_changes(team_id)
    stats = staging_manager.get_staging_stats(team_id)
    conflicts = staging_manager.detect_file_conflicts(team_id)
    
    return {
        "ok": True,
        "team_id": team_id,
        **staged,
        "stats": stats,
        "conflicts": conflicts
    }


@router.get("/{team_id}/staging/files")
async def get_staged_files(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Get all staged files as flat dict.
    Used for Terraform validation before PR creation.
    No DB needed - all in-memory.
    """
    files = staging_manager.get_all_staged_files(team_id)
    
    return {
        "ok": True,
        "team_id": team_id,
        "files": files,
        "count": len(files)
    }


@router.get("/{team_id}/staging/metadata")
async def get_pr_metadata(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Get metadata for PR creation.
    Includes contributors, stats, co-author info.
    No DB needed - all in-memory.
    """
    metadata = staging_manager.get_pr_metadata(team_id)
    
    return {
        "ok": True,
        "team_id": team_id,
        **metadata
    }


@router.post("/{team_id}/staging/validate")
async def validate_staging(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Validate all staged changes with Terraform.
    Returns validation results and any errors.
    
    Note: Actual validation happens client-side (Electron).
    This endpoint just prepares the data.
    No DB needed - all in-memory.
    """
    files = staging_manager.get_all_staged_files(team_id)
    conflicts = staging_manager.detect_file_conflicts(team_id)
    
    return {
        "ok": True,
        "team_id": team_id,
        "ready_for_validation": len(files) > 0,
        "files": files,
        "file_count": len(files),
        "conflicts": conflicts,
        "has_conflicts": len(conflicts) > 0
    }


@router.post("/{team_id}/staging/clear")
async def clear_staging(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Clear staging area after PR creation.
    Only team admins can do this.
    """
    # Verify user is team admin
    from app.database.connection import acquire_auth_session
    from app.services.team_service import TeamService
    
    auth_db = next(acquire_auth_session())
    team_service = TeamService(auth_db)
    user_role = team_service.get_user_role(team_id, current_user.id)
    
    if user_role != 'admin':
        raise HTTPException(
            status_code=403,
            detail=f"Only team admins can clear staging. Your role: {user_role}"
        )
    
    result = staging_manager.clear_staging(team_id)
    
    return {
        "ok": True,
        **result
    }


@router.get("/{team_id}/staging/stats")
async def get_staging_stats(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication)
):
    """
    Get staging statistics.
    No DB needed - all in-memory.
    """
    stats = staging_manager.get_staging_stats(team_id)
    
    return {
        "ok": True,
        **stats
    }

