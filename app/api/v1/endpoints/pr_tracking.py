"""
Pull Request tracking endpoints.
Logs all PRs created through the platform and provides analytics.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from app.database.connection import primary_session_context
from app.database.models import PullRequest, UserAccount
from app.services.auth import authentication_service
from app.utils.errors import sanitize_error_detail

router = APIRouter()


class PRCreateRequest(BaseModel):
    """Request to log a new PR creation"""
    repo_owner: str
    repo_name: str
    branch_name: str
    commit_message: str
    pr_url: Optional[str] = None
    commit_sha: Optional[str] = None
    files_changed: Optional[List[str]] = None
    files_added: Optional[List[str]] = None
    files_modified: Optional[List[str]] = None
    files_deleted: Optional[List[str]] = None
    terraform_valid: bool = True
    terraform_errors: Optional[dict] = None
    created_via: str = "web"  # web, desktop, api
    conversation_id: Optional[str] = None


class PRResponse(BaseModel):
    """PR record response"""
    id: str
    user_id: str
    repo_owner: str
    repo_name: str
    repo_full_name: str
    branch_name: str
    commit_sha: Optional[str]
    commit_message: Optional[str]
    pr_url: Optional[str]
    pr_number: Optional[int]
    files_changed: Optional[List[str]]
    terraform_valid: bool
    status: str
    created_via: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


@router.post("/log", response_model=PRResponse)
def log_pull_request(
    req: PRCreateRequest,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Log a new Pull Request created through the platform.
    Called automatically when a PR is successfully created.
    """
    with primary_session_context() as session:
        try:
            # Extract PR number from URL if available
            pr_number = None
            if req.pr_url:
                # Format: https://github.com/owner/repo/pull/123
                parts = req.pr_url.split('/')
                if 'pull' in parts:
                    try:
                        pr_number = int(parts[parts.index('pull') + 1].split('?')[0])
                    except (ValueError, IndexError):
                        pass
            
            # Create PR record
            pr_record = PullRequest(
                user_id=current_user.id,
                repo_owner=req.repo_owner,
                repo_name=req.repo_name,
                repo_full_name=f"{req.repo_owner}/{req.repo_name}",
                branch_name=req.branch_name,
                commit_sha=req.commit_sha,
                commit_message=req.commit_message,
                pr_url=req.pr_url,
                pr_number=pr_number,
                files_changed=req.files_changed,
                files_added=req.files_added,
                files_modified=req.files_modified,
                files_deleted=req.files_deleted,
                terraform_valid=req.terraform_valid,
                terraform_errors=req.terraform_errors,
                status="created",
                created_via=req.created_via,
                conversation_id=req.conversation_id
            )
            
            session.add(pr_record)
            session.commit()
            session.refresh(pr_record)
            
            print(f"✅ [PR Tracking] Logged PR for user {current_user.id}: {pr_record.repo_full_name} - {pr_record.branch_name}")
            
            return pr_record
            
        except Exception as e:
            session.rollback()
            print(f"❌ [PR Tracking] Error logging PR: {str(e)}")
            raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to log pull request"))


@router.get("/list", response_model=List[PRResponse])
def list_pull_requests(
    limit: int = 100,
    offset: int = 0,
    repo: Optional[str] = None,
    status: Optional[str] = None,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get list of all PRs created through the platform.
    Supports filtering by repo and status.
    """
    # Validate pagination parameters
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 1000")
    if offset < 0:
        raise HTTPException(status_code=400, detail="Offset must be non-negative")
    
    with primary_session_context() as session:
        try:
            query = session.query(PullRequest).filter(
                PullRequest.user_id == current_user.id
            )
            
            # Apply filters
            if repo:
                query = query.filter(PullRequest.repo_full_name == repo)
            if status:
                query = query.filter(PullRequest.status == status)
            
            # Order by most recent first
            query = query.order_by(PullRequest.created_at.desc())
            
            # Pagination
            query = query.limit(limit).offset(offset)
            
            prs = query.all()
            
            print(f"📊 [PR Tracking] Fetched {len(prs)} PRs for user {current_user.id}")
            
            return prs
            
        except Exception as e:
            print(f"❌ [PR Tracking] Error fetching PRs: {str(e)}")
            raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to fetch pull requests"))


@router.get("/stats")
def get_pr_stats(
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get PR statistics for the current user.
    """
    with primary_session_context() as session:
        try:
            user_id = current_user.id
            
            # Total PRs
            total_prs = session.query(PullRequest).filter(
                PullRequest.user_id == user_id
            ).count()
            
            # PRs by status
            created_prs = session.query(PullRequest).filter(
                PullRequest.user_id == user_id,
                PullRequest.status == "created"
            ).count()
            
            merged_prs = session.query(PullRequest).filter(
                PullRequest.user_id == user_id,
                PullRequest.status == "merged"
            ).count()
            
            # PRs by repo (top 5)
            from sqlalchemy import func
            top_repos = session.query(
                PullRequest.repo_full_name,
                func.count(PullRequest.id).label('count')
            ).filter(
                PullRequest.user_id == user_id
            ).group_by(
                PullRequest.repo_full_name
            ).order_by(
                func.count(PullRequest.id).desc()
            ).limit(5).all()
            
            # Recent activity (last 7 days)
            from datetime import timedelta
            seven_days_ago = datetime.utcnow() - timedelta(days=7)
            recent_prs = session.query(PullRequest).filter(
                PullRequest.user_id == user_id,
                PullRequest.created_at >= seven_days_ago
            ).count()
            
            return {
                "total_prs": total_prs,
                "created_prs": created_prs,
                "merged_prs": merged_prs,
                "recent_prs": recent_prs,
                "top_repos": [
                    {"repo": repo[0], "count": repo[1]}
                    for repo in top_repos
                ]
            }
            
        except Exception as e:
            print(f"❌ [PR Tracking] Error fetching stats: {str(e)}")
            raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to fetch PR statistics"))

