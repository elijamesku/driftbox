"""
Diff approval workflow endpoints.
Provides Copilot-style diff review and approval functionality.

Enhanced with risk assessment for smart approvals (MVP Feature #1).
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, Any
from pydantic import BaseModel
from app.services.diff_manager import diff_manager
from app.services.git_ops import (
    create_branch_commit_and_push as git_branch_commit_push,
    parse_pull_request_url as extract_pr_url,
    locate_repository_root as repo_root
)
from app.integrations.slack import slack_notifier
from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.utils.errors import sanitize_error_detail
import time
import re

# Import risk assessment service
try:
    from app.services.risk_assessment_service import risk_assessment_service
    RISK_ASSESSMENT_ENABLED = True
except ImportError:
    RISK_ASSESSMENT_ENABLED = False
    risk_assessment_service = None


router = APIRouter()


class ApproveRequest(BaseModel):
    file_path: Optional[str] = None
    hunk_index: Optional[int] = None


class RejectRequest(BaseModel):
    file_path: Optional[str] = None
    hunk_index: Optional[int] = None
    reason: Optional[str] = None


class CommitRequest(BaseModel):
    branch_name: Optional[str] = None
    commit_message: Optional[str] = None


@router.get("/diff/sessions")
def list_diff_sessions(
    status: Optional[str] = None,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    List all diff sessions for the authenticated user, optionally filtered by status.
    
    Query params:
        status: Filter by status (pending, approved, rejected, committed)
    """
    # Filter by user_id
    sessions = diff_manager.list_sessions(status=status, user_id=user.id)
    return {
        "sessions": sessions,
        "count": len(sessions),
    }


@router.get("/diff/{diff_id}")
def get_diff_session(
    diff_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get a specific diff session by ID.
    Returns full diff details including file changes and approval status.
    Only accessible by the session owner.
    """
    # Verify ownership by passing user_id
    session = diff_manager.get_diff_session(diff_id, user_id=user.id)
    if not session:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Diff session {diff_id} not found"})
    
    return session


@router.post("/diff/{diff_id}/approve")
def approve_diff(
    diff_id: str,
    req: ApproveRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Approve changes in a diff session.
    Only accessible by the session owner.
    
    Body:
        file_path: Optional. If provided, approve only this file. If None, approve all.
        hunk_index: Optional. If provided (with file_path), approve only this hunk.
    """
    # Verify ownership before allowing approval
    session = diff_manager.get_diff_session(diff_id, user_id=user.id)
    if not session:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Diff session {diff_id} not found"})
    
    try:
        session = diff_manager.approve_changes(
            diff_id=diff_id,
            file_path=req.file_path,
            hunk_index=req.hunk_index,
        )
        
        # Send Slack notification
        try:
            prompt = session.get("prompt", "Infrastructure changes")
            slack_notifier.notify_diff_approved(
                diff_id=diff_id,
                prompt=prompt,
                approver="User"
            )
        except Exception as e:
            print(f"⚠️  Slack notification failed: {e}")
        
        return {
            "ok": True,
            "diff_id": diff_id,
            "status": session["status"],
            "message": "Changes approved",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": "invalid_request", "message": sanitize_error_detail(e, "Invalid request")})


@router.post("/diff/{diff_id}/reject")
def reject_diff(
    diff_id: str,
    req: RejectRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Reject changes in a diff session.
    Only accessible by the session owner.
    
    Body:
        file_path: Optional. If provided, reject only this file. If None, reject all.
        hunk_index: Optional. If provided (with file_path), reject only this hunk.
    """
    # Verify ownership before allowing rejection
    session = diff_manager.get_diff_session(diff_id, user_id=user.id)
    if not session:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Diff session {diff_id} not found"})
    
    try:
        session = diff_manager.reject_changes(
            diff_id=diff_id,
            file_path=req.file_path,
            hunk_index=req.hunk_index,
        )
        
        # Send Slack notification
        try:
            prompt = session.get("prompt", "Infrastructure changes")
            slack_notifier.notify_diff_rejected(
                diff_id=diff_id,
                prompt=prompt,
                reason=req.reason
            )
        except Exception as e:
            print(f"⚠️  Slack notification failed: {e}")
        
        return {
            "ok": True,
            "diff_id": diff_id,
            "status": session["status"],
            "message": "Changes rejected",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": "invalid_request", "message": sanitize_error_detail(e, "Invalid request")})


@router.post("/diff/{diff_id}/commit")
def commit_diff(
    diff_id: str,
    req: CommitRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Commit approved changes to a branch and push to GitHub.
    Creates a branch, commits approved files, and returns PR URL.
    Only accessible by the session owner.
    
    Body:
        branch_name: Optional custom branch name
        commit_message: Optional custom commit message
    """
    # Verify ownership before allowing commit
    session = diff_manager.get_diff_session(diff_id, user_id=user.id)
    if not session:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Diff session {diff_id} not found"})
    
    if session["status"] == "committed":
        raise HTTPException(status_code=400, detail={"error": "already_committed", "message": "This diff has already been committed"})
    
    # Get approved changes
    approved_changes = diff_manager.get_approved_changes(diff_id)
    if not approved_changes:
        raise HTTPException(status_code=400, detail={"error": "no_approved_changes", "message": "No changes have been approved yet"})
    
    # Apply approved changes to files
    root = repo_root()
    for file_path, new_content in approved_changes.items():
        file = root / file_path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(new_content)
    
    # Create branch and commit
    prompt = session.get("prompt", "infrastructure changes")
    safe_prompt = re.sub(r"[^a-z0-9-]+", "-", prompt.lower()).strip("-")[:30]
    
    branch = req.branch_name or f"driftbox/{safe_prompt or 'changes'}-{int(time.time())}"
    message = req.commit_message or f"Infrara: {prompt}"
    
    try:
        push_output = git_branch_commit_push(branch, message, root, files=list(approved_changes.keys()))
        pr_url = extract_pr_url(push_output)
        
        # Mark session as committed
        diff_manager.mark_as_committed(diff_id, branch, pr_url)
        
        # Send Slack notification if PR was created
        try:
            if pr_url:
                cost_impact = session.get("cost_impact")
                validation = session.get("validation")
                slack_notifier.notify_pr_created(
                    pr_url=pr_url,
                    title=prompt,
                    cost_impact=cost_impact,
                    validation=validation,
                    file_count=len(approved_changes)
                )
        except Exception as e:
            print(f"⚠️  Slack notification failed: {e}")
        
        return {
            "ok": True,
            "diff_id": diff_id,
            "branch": branch,
            "pr_url": pr_url,
            "files_committed": list(approved_changes.keys()),
            "message": "Changes committed and pushed to GitHub",
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "commit_failed", "message": sanitize_error_detail(e, "Failed to commit changes")})


@router.delete("/diff/{diff_id}")
def delete_diff_session(
    diff_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Delete a diff session.
    Only allowed for non-committed sessions.
    Only accessible by the session owner.
    """
    # Verify ownership before allowing deletion
    session = diff_manager.get_diff_session(diff_id, user_id=user.id)
    if not session:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Diff session {diff_id} not found"})
    
    if session["status"] == "committed":
        raise HTTPException(status_code=400, detail={"error": "cannot_delete", "message": "Cannot delete committed session"})
    
    # Delete session file
    session_file = diff_manager.cache_dir / f"{diff_id}.json"
    if session_file.exists():
        session_file.unlink()
    
    return {
        "ok": True,
        "message": f"Diff session {diff_id} deleted",
    }


# ============================================================================
# RISK ASSESSMENT ENDPOINTS (MVP Feature #1)
# ============================================================================

class RecalculateRiskRequest(BaseModel):
    environment: Optional[str] = None
    team_settings: Optional[Dict[str, Any]] = None


@router.get("/diff/{diff_id}/risk")
def get_risk_assessment(
    diff_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get the risk assessment for a diff session.
    Returns risk score, level, factors, and approval requirements.
    """
    if not RISK_ASSESSMENT_ENABLED:
        raise HTTPException(status_code=501, detail={"error": "not_implemented", "message": "Risk assessment service not available"})
    
    session = diff_manager.get_diff_session(diff_id, user_id=user.id)
    if not session:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Diff session {diff_id} not found"})
    
    risk_assessment = session.get("risk_assessment")
    if not risk_assessment:
        return {
            "ok": False,
            "message": "Risk assessment not available for this session",
            "risk_assessment": None,
        }
    
    return {
        "ok": True,
        "diff_id": diff_id,
        "risk_assessment": risk_assessment,
    }


@router.post("/diff/{diff_id}/risk/recalculate")
def recalculate_risk_assessment(
    diff_id: str,
    req: RecalculateRiskRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Recalculate risk assessment for a diff session.
    Useful when environment changes or team settings are updated.
    """
    if not RISK_ASSESSMENT_ENABLED:
        raise HTTPException(status_code=501, detail={"error": "not_implemented", "message": "Risk assessment service not available"})
    
    session = diff_manager.get_diff_session(diff_id, user_id=user.id)
    if not session:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": f"Diff session {diff_id} not found"})
    
    if session["status"] == "committed":
        raise HTTPException(status_code=400, detail={"error": "already_committed", "message": "Cannot recalculate risk for committed session"})
    
    # Reconstruct file modifications from diffs
    file_modifications = {}
    for file_diff in session.get("diffs", []):
        file_modifications[file_diff["file"]] = {
            "old": file_diff.get("old_content", ""),
            "new": file_diff.get("new_content", ""),
        }
    
    # Get policy violations from validation
    policy_violations = []
    security_issues = []
    if session.get("validation"):
        policy_violations = session["validation"].get("policy_violations", [])
        security_issues = session["validation"].get("security_issues", [])
    
    # Recalculate risk
    environment = req.environment or session.get("environment", "dev")
    new_risk = risk_assessment_service.calculate_risk(
        ir=session.get("ir", {}),
        file_modifications=file_modifications,
        policy_violations=policy_violations,
        security_issues=security_issues,
        environment=environment,
        team_settings=req.team_settings,
    )
    
    # Update session with new risk assessment
    session["risk_assessment"] = new_risk
    session["environment"] = environment
    
    # Update auto-approval status if applicable
    if new_risk.get("auto_approve", False) and session["status"] == "pending":
        session["status"] = "auto_approved"
        session["auto_approved_at"] = new_risk["assessed_at"]
        session["auto_approved_reason"] = new_risk.get("approval_reason", "Low risk change")
        for file_diff in session["diffs"]:
            file_diff["status"] = "approved"
            for hunk in file_diff.get("hunks", []):
                hunk["status"] = "approved"
    
    # Persist updated session
    diff_manager._persist_session_data(diff_id, session)
    
    return {
        "ok": True,
        "diff_id": diff_id,
        "risk_assessment": new_risk,
        "status": session["status"],
        "message": "Risk assessment recalculated",
    }


@router.get("/risk/thresholds")
def get_risk_thresholds(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get current risk assessment thresholds.
    These can be customized per team/organization.
    """
    if not RISK_ASSESSMENT_ENABLED:
        raise HTTPException(status_code=501, detail={"error": "not_implemented", "message": "Risk assessment service not available"})
    
    return {
        "ok": True,
        "thresholds": risk_assessment_service.thresholds,
        "resource_weights": dict(list(risk_assessment_service.RESOURCE_RISK_WEIGHTS.items())[:20]),  # Sample
        "operation_weights": risk_assessment_service.OPERATION_RISK_WEIGHTS,
        "environment_multipliers": risk_assessment_service.ENVIRONMENT_MULTIPLIERS,
    }

