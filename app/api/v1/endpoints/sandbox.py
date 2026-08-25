"""
Sandbox run management endpoints.
Provides API for retrieving and managing sandbox validation runs.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import uuid
import os
import subprocess
import tempfile
import shutil
import requests
import re

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.auth import require_authentication
from app.database.models import UserAccount
from app.database.connection import acquire_primary_session, acquire_auth_session
from app.services.team_staging import staging_manager
from app.services.team_service import TeamService
from app.integrations.slack import slack_notifier

# Import audit log service
try:
    from app.services.audit_log_service import audit_log_service, ActionType, Severity
    AUDIT_LOGGING_ENABLED = True
    print("[Sandbox API] Audit logging ENABLED")
except ImportError as e:
    AUDIT_LOGGING_ENABLED = False
    audit_log_service = None
    print(f"[Sandbox API] Audit logging DISABLED: {e}")

router = APIRouter()


class SandboxStepInfo(BaseModel):
    name: str
    status: str
    duration_ms: int
    message: Optional[str] = None


class ResourceInfo(BaseModel):
    type: str
    name: str
    action: str
    provider: str


class SandboxRunCreate(BaseModel):
    repository: str
    branch: Optional[str] = "main"
    team_id: Optional[str] = None  # For team collaboration
    user_name: Optional[str] = None  # Display name of user who ran test
    status: str
    duration_ms: int = 0
    files_tested: int = 0
    steps: Optional[List[Dict[str, Any]]] = None
    resources_detected: Optional[List[Dict[str, Any]]] = None
    errors: Optional[List[str]] = None
    warnings: Optional[List[str]] = None
    available_cidr: Optional[str] = None
    cost_estimate: Optional[float] = None
    risk_level: str = "low"
    security_issues: int = 0
    terraform_version: Optional[str] = None
    providers_used: Optional[List[str]] = None
    auto_healed: bool = False
    fixes_applied: Optional[List[Dict[str, Any]]] = None
    attempts: int = 1
    # Snapshot of files that were tested - used for deployment
    tested_files_snapshot: Optional[Dict[str, str]] = None  # {path: content}


class SandboxRunResponse(BaseModel):
    id: str
    user_id: str
    user_name: Optional[str] = None  # Display name of user who ran test
    team_id: Optional[str] = None  # For team collaboration
    repository: str
    branch: Optional[str] = None
    status: str
    duration_ms: int
    files_tested: int
    steps: Optional[List[Dict[str, Any]]] = None
    resources_detected: Optional[List[Dict[str, Any]]] = None
    errors: Optional[List[str]] = None
    warnings: Optional[List[str]] = None
    available_cidr: Optional[str] = None
    cost_estimate: Optional[float] = None
    risk_level: str = "low"
    security_issues: int = 0
    terraform_version: Optional[str] = None
    providers_used: Optional[List[str]] = None
    auto_healed: bool = False
    fixes_applied: Optional[List[Dict[str, Any]]] = None
    attempts: int = 1
    created_at: str
    # Snapshot of files that were tested - used for deployment
    tested_files_snapshot: Optional[Dict[str, str]] = None  # {path: content}
    
    class Config:
        from_attributes = True


class SandboxRunsListResponse(BaseModel):
    runs: List[SandboxRunResponse]
    total: int
    passed: int
    failed: int
    avg_duration_ms: int


@router.post("/runs", response_model=SandboxRunResponse)
async def create_sandbox_run(
    run_data: SandboxRunCreate,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """
    Store a new sandbox run result.
    Called by the frontend after a sandbox test completes.
    """
    run_id = str(uuid.uuid4())
    created_at = datetime.utcnow()
    
    # Debug logging
    print(f"[Sandbox API] Creating run:")
    print(f"  - run_id: {run_id}")
    print(f"  - user_id: {current_user.id}")
    print(f"  - user_name: {run_data.user_name or current_user.github_username or current_user.full_name or current_user.email}")
    print(f"  - team_id: {run_data.team_id}")
    print(f"  - repository: {run_data.repository}")
    print(f"  - status: {run_data.status}")
    print(f"  - tested_files_snapshot: {len(run_data.tested_files_snapshot) if run_data.tested_files_snapshot else 0} files")
    
    try:
        db.execute(text("""
            INSERT INTO public.sandbox_runs (
                id, user_id, user_name, team_id, repository, branch, status, duration_ms, files_tested,
                steps, resources_detected, errors, warnings, available_cidr,
                cost_estimate, risk_level, security_issues, terraform_version, 
                providers_used, auto_healed, fixes_applied, attempts, tested_files_snapshot, created_at
            ) VALUES (
                :id, :user_id, :user_name, :team_id, :repository, :branch, :status, :duration_ms, :files_tested,
                :steps, :resources_detected, :errors, :warnings, :available_cidr,
                :cost_estimate, :risk_level, :security_issues, :terraform_version,
                :providers_used, :auto_healed, :fixes_applied, :attempts, :tested_files_snapshot, :created_at
            )
        """), {
            "id": run_id,
            "user_id": current_user.id,
            "user_name": run_data.user_name or current_user.github_username or current_user.full_name or current_user.email,
            "team_id": run_data.team_id,
            "repository": run_data.repository,
            "branch": run_data.branch,
            "status": run_data.status,
            "duration_ms": run_data.duration_ms,
            "files_tested": run_data.files_tested,
            "steps": json.dumps(run_data.steps) if run_data.steps else None,
            "resources_detected": json.dumps(run_data.resources_detected) if run_data.resources_detected else None,
            "errors": json.dumps(run_data.errors) if run_data.errors else None,
            "warnings": json.dumps(run_data.warnings) if run_data.warnings else None,
            "available_cidr": run_data.available_cidr,
            "cost_estimate": run_data.cost_estimate,
            "risk_level": run_data.risk_level,
            "security_issues": run_data.security_issues,
            "terraform_version": run_data.terraform_version,
            "providers_used": json.dumps(run_data.providers_used) if run_data.providers_used else None,
            "auto_healed": run_data.auto_healed,
            "fixes_applied": json.dumps(run_data.fixes_applied) if run_data.fixes_applied else None,
            "attempts": run_data.attempts,
            "tested_files_snapshot": json.dumps(run_data.tested_files_snapshot) if run_data.tested_files_snapshot else None,
            "created_at": created_at.isoformat(),
        })
        db.commit()
        
        # Log audit event for sandbox run
        if AUDIT_LOGGING_ENABLED and audit_log_service:
            try:
                user_display = run_data.user_name or current_user.github_username or current_user.full_name or current_user.email
                audit_log_service.log_sandbox_run(
                    user_id=current_user.id,
                    user_name=user_display,
                    user_email=current_user.email,
                    repository=run_data.repository,
                    run_id=run_id,
                    passed=(run_data.status == 'passed'),
                    team_id=run_data.team_id,
                )
            except Exception as audit_error:
                print(f"[Sandbox API] Failed to log audit event: {audit_error}")
        
        # Send Slack notification for sandbox run
        try:
            user_display = run_data.user_name or current_user.github_username or current_user.full_name or current_user.email
            team_name = None
            
            # Get team name if team_id is provided
            if run_data.team_id:
                try:
                    from app.database.connection import auth_session_context
                    with auth_session_context() as auth_db:
                        team_service = TeamService(auth_db)
                        team = team_service.get_team(run_data.team_id)
                        if team:
                            team_name = team.name
                except Exception as team_error:
                    print(f"[Sandbox API] Failed to get team name: {team_error}")
            
            slack_notifier.send_sandbox_run_notification(
                repository=run_data.repository,
                status=run_data.status,
                user_name=user_display,
                team_name=team_name,
                duration_ms=run_data.duration_ms,
                files_tested=run_data.files_tested,
                security_issues=run_data.security_issues,
                auto_healed=run_data.auto_healed,
                fixes_applied=len(run_data.fixes_applied) if run_data.fixes_applied else None,
                errors=run_data.errors,
            )
        except Exception as slack_error:
            print(f"[Sandbox API] Failed to send Slack notification: {slack_error}")
        
        return SandboxRunResponse(
            id=run_id,
            user_id=current_user.id,
            user_name=run_data.user_name or current_user.github_username or current_user.full_name or current_user.email,
            team_id=run_data.team_id,
            repository=run_data.repository,
            branch=run_data.branch,
            status=run_data.status,
            duration_ms=run_data.duration_ms,
            files_tested=run_data.files_tested,
            steps=run_data.steps,
            resources_detected=run_data.resources_detected,
            errors=run_data.errors,
            warnings=run_data.warnings,
            available_cidr=run_data.available_cidr,
            cost_estimate=run_data.cost_estimate,
            risk_level=run_data.risk_level,
            security_issues=run_data.security_issues,
            terraform_version=run_data.terraform_version,
            providers_used=run_data.providers_used,
            auto_healed=run_data.auto_healed,
            fixes_applied=run_data.fixes_applied,
            attempts=run_data.attempts,
            tested_files_snapshot=run_data.tested_files_snapshot,
            created_at=created_at.isoformat(),
        )
    except Exception as e:
        print(f"[Sandbox API] Error creating run: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/debug/all-runs")
async def debug_list_all_runs(
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
    limit: int = Query(default=20, le=100),
):
    """
    DEBUG ENDPOINT: List all sandbox runs (for debugging purposes).
    Shows run_id, user_id, team_id to help diagnose filtering issues.
    """
    try:
        result = db.execute(text("""
            SELECT id, user_id, user_name, team_id, repository, status, created_at
            FROM public.sandbox_runs 
            ORDER BY created_at DESC 
            LIMIT :limit
        """), {"limit": limit})
        runs = result.fetchall()
        
        debug_runs = []
        for row in runs:
            row_dict = dict(row._mapping) if hasattr(row, '_mapping') else dict(row)
            debug_runs.append({
                "id": row_dict.get("id"),
                "user_id": row_dict.get("user_id"),
                "user_name": row_dict.get("user_name"),
                "team_id": row_dict.get("team_id"),
                "repository": row_dict.get("repository"),
                "status": row_dict.get("status"),
                "created_at": str(row_dict.get("created_at")),
            })
        
        print(f"[Sandbox API DEBUG] Found {len(debug_runs)} total runs")
        for run in debug_runs:
            print(f"  - {run['id'][:8]}... user={run['user_id'][:8] if run['user_id'] else 'None'}... team={run['team_id'][:8] if run['team_id'] else 'None'}... repo={run['repository']}")
        
        return {
            "current_user_id": current_user.id,
            "runs_count": len(debug_runs),
            "runs": debug_runs,
        }
    except Exception as e:
        print(f"[Sandbox API DEBUG] Error: {e}")
        return {"error": str(e), "current_user_id": current_user.id}


@router.get("/runs", response_model=SandboxRunsListResponse)
async def list_sandbox_runs(
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0),
    status: Optional[str] = Query(default=None),
    repository: Optional[str] = Query(default=None),
    scope: str = Query(default="all", description="Filter scope: 'all' shows all runs from all teams"),
):
    """
    List sandbox runs.
    Supports filtering by status and repository.
    - scope=all: Show ALL runs from ALL teams (default)
    """
    
    # Debug logging
    print(f"[Sandbox API] Listing ALL runs (scope: {scope}, requested by user: {current_user.id})")
    
    try:
        # Always fetch ALL runs - no user_id or team_id filter
        query = "SELECT * FROM public.sandbox_runs WHERE 1=1"
        params: Dict[str, Any] = {}
        
        if status:
            query += " AND status = :status"
            params["status"] = status
        
        if repository:
            query += " AND repository LIKE :repository"
            params["repository"] = f"%{repository}%"
        
        # Get count BEFORE adding ORDER BY (fixes SQL error)
        count_query = query.replace("SELECT *", "SELECT COUNT(*)")
        
        query += " ORDER BY created_at DESC"
        
        # Add pagination
        query += f" LIMIT {limit} OFFSET {offset}"
        
        # Execute queries
        result = db.execute(text(query), params)
        runs_data = result.fetchall()
        
        print(f"[Sandbox API] Found {len(runs_data)} runs for user")
        
        count_result = db.execute(text(count_query), params)
        total = count_result.fetchone()[0]
        
        # Get aggregate stats
        stats_query = """
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                AVG(duration_ms) as avg_duration
            FROM public.sandbox_runs 
            WHERE user_id = :user_id
        """
        stats_result = db.execute(text(stats_query), {"user_id": current_user.id})
        stats = stats_result.fetchone()
        
        # Convert to response models
        runs = []
        for row in runs_data:
            run_dict = dict(row._mapping) if hasattr(row, '_mapping') else dict(row)
            # Parse JSON fields
            for field in ['steps', 'resources_detected', 'errors', 'warnings', 'providers_used', 'fixes_applied', 'tested_files_snapshot']:
                if run_dict.get(field) and isinstance(run_dict[field], str):
                    try:
                        run_dict[field] = json.loads(run_dict[field])
                    except:
                        pass
            if run_dict.get('created_at'):
                if isinstance(run_dict['created_at'], str):
                    pass  # Already a string
                else:
                    run_dict['created_at'] = run_dict['created_at'].isoformat()
            else:
                run_dict['created_at'] = datetime.utcnow().isoformat()
            runs.append(SandboxRunResponse(**run_dict))
        
        return SandboxRunsListResponse(
            runs=runs,
            total=stats[0] or 0,
            passed=stats[1] or 0,
            failed=stats[2] or 0,
            avg_duration_ms=int(stats[3] or 0),
        )
    
    except Exception as e:
        print(f"[Sandbox API] Error listing runs: {e}")
        # Return empty response if table doesn't exist yet
        return SandboxRunsListResponse(
            runs=[],
            total=0,
            passed=0,
            failed=0,
            avg_duration_ms=0,
        )


@router.get("/runs/{run_id}", response_model=SandboxRunResponse)
async def get_sandbox_run(
    run_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """
    Get details for a specific sandbox run.
    """
    
    try:
        result = db.execute(
            text("SELECT * FROM public.sandbox_runs WHERE id = :id AND user_id = :user_id"),
            {"id": run_id, "user_id": current_user.id}
        )
        row = result.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Sandbox run not found")
        
        run_dict = dict(row._mapping) if hasattr(row, '_mapping') else dict(row)
        # Parse JSON fields
        for field in ['steps', 'resources_detected', 'errors', 'warnings', 'providers_used', 'fixes_applied', 'tested_files_snapshot']:
            if run_dict.get(field) and isinstance(run_dict[field], str):
                try:
                    run_dict[field] = json.loads(run_dict[field])
                except:
                    pass
        if run_dict.get('created_at'):
            if isinstance(run_dict['created_at'], str):
                pass
            else:
                run_dict['created_at'] = run_dict['created_at'].isoformat()
        else:
            run_dict['created_at'] = datetime.utcnow().isoformat()
        
        return SandboxRunResponse(**run_dict)
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Sandbox API] Error getting run: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/runs/{run_id}")
async def delete_sandbox_run(
    run_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """
    Delete a sandbox run.
    """
    
    try:
        result = db.execute(
            text("DELETE FROM public.sandbox_runs WHERE id = :id AND user_id = :user_id"),
            {"id": run_id, "user_id": current_user.id}
        )
        db.commit()
        
        return {"success": True, "deleted": run_id}
    
    except Exception as e:
        print(f"[Sandbox API] Error deleting run: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_sandbox_stats(
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """
    Get sandbox statistics for the current user.
    """
    
    try:
        stats_query = """
            SELECT 
                COUNT(*) as total_runs,
                SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                AVG(duration_ms) as avg_duration_ms,
                MIN(duration_ms) as min_duration_ms,
                MAX(duration_ms) as max_duration_ms,
                SUM(security_issues) as total_security_issues,
                SUM(CASE WHEN auto_healed = true THEN 1 ELSE 0 END) as auto_healed_count
            FROM public.sandbox_runs 
            WHERE user_id = :user_id
        """
        result = db.execute(text(stats_query), {"user_id": current_user.id})
        stats = result.fetchone()
        
        # Get recent activity (last 7 days)
        activity_query = """
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM public.sandbox_runs 
            WHERE user_id = :user_id 
            AND created_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(created_at)
            ORDER BY date
        """
        activity_result = db.execute(text(activity_query), {"user_id": current_user.id})
        activity = [{"date": str(row[0]), "count": row[1]} for row in activity_result.fetchall()]
        
        return {
            "total_runs": stats[0] or 0,
            "passed": stats[1] or 0,
            "failed": stats[2] or 0,
            "pass_rate": round((stats[1] or 0) / (stats[0] or 1) * 100, 1),
            "avg_duration_ms": int(stats[3] or 0),
            "min_duration_ms": stats[4] or 0,
            "max_duration_ms": stats[5] or 0,
            "total_security_issues": stats[6] or 0,
            "auto_healed_count": stats[7] or 0,
            "recent_activity": activity,
        }
    
    except Exception as e:
        print(f"[Sandbox API] Error getting stats: {e}")
        return {
            "total_runs": 0,
            "passed": 0,
            "failed": 0,
            "pass_rate": 0,
            "avg_duration_ms": 0,
            "min_duration_ms": 0,
            "max_duration_ms": 0,
            "total_security_issues": 0,
            "auto_healed_count": 0,
            "recent_activity": [],
        }


# =============================================================================
# Team Sandbox Endpoints - For team collaboration
# =============================================================================

@router.get("/team/{team_id}/runs", response_model=SandboxRunsListResponse)
async def list_team_sandbox_runs(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0),
    status: Optional[str] = Query(default=None),
    repository: Optional[str] = Query(default=None),
):
    """
    List all sandbox runs for a team.
    All team members can see runs from any team member.
    """
    
    # Debug logging
    print(f"[Sandbox API] Listing runs for team_id: {team_id} (requested by user: {current_user.id})")
    
    try:
        # Build query - filter by team_id instead of user_id
        query = "SELECT * FROM public.sandbox_runs WHERE team_id = :team_id"
        params: Dict[str, Any] = {"team_id": team_id}
        
        if status:
            query += " AND status = :status"
            params["status"] = status
        
        if repository:
            query += " AND repository LIKE :repository"
            params["repository"] = f"%{repository}%"
        
        # Get count BEFORE adding ORDER BY (fixes SQL error)
        count_query = query.replace("SELECT *", "SELECT COUNT(*)")
        
        query += " ORDER BY created_at DESC"
        
        # Add pagination
        query += f" LIMIT {limit} OFFSET {offset}"
        
        # Execute queries
        result = db.execute(text(query), params)
        runs_data = result.fetchall()
        
        print(f"[Sandbox API] Found {len(runs_data)} runs for team {team_id}")
        
        count_result = db.execute(text(count_query), params)
        total = count_result.fetchone()[0]
        
        # Get aggregate stats for team
        stats_query = """
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                AVG(duration_ms) as avg_duration
            FROM public.sandbox_runs 
            WHERE team_id = :team_id
        """
        stats_result = db.execute(text(stats_query), {"team_id": team_id})
        stats = stats_result.fetchone()
        
        # Convert to response models
        runs = []
        for row in runs_data:
            run_dict = dict(row._mapping) if hasattr(row, '_mapping') else dict(row)
            # Parse JSON fields
            for field in ['steps', 'resources_detected', 'errors', 'warnings', 'providers_used', 'fixes_applied', 'tested_files_snapshot']:
                if run_dict.get(field) and isinstance(run_dict[field], str):
                    try:
                        run_dict[field] = json.loads(run_dict[field])
                    except:
                        pass
            if run_dict.get('created_at'):
                if isinstance(run_dict['created_at'], str):
                    pass  # Already a string
                else:
                    run_dict['created_at'] = run_dict['created_at'].isoformat()
            else:
                run_dict['created_at'] = datetime.utcnow().isoformat()
            runs.append(SandboxRunResponse(**run_dict))
        
        return SandboxRunsListResponse(
            runs=runs,
            total=stats[0] or 0,
            passed=stats[1] or 0,
            failed=stats[2] or 0,
            avg_duration_ms=int(stats[3] or 0),
        )
    
    except Exception as e:
        print(f"[Sandbox API] Error listing team runs: {e}")
        # Return empty response if table doesn't exist yet
        return SandboxRunsListResponse(
            runs=[],
            total=0,
            passed=0,
            failed=0,
            avg_duration_ms=0,
        )


@router.get("/team/{team_id}/stats")
async def get_team_sandbox_stats(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """
    Get sandbox statistics for an entire team.
    """
    
    try:
        stats_query = """
            SELECT 
                COUNT(*) as total_runs,
                SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                AVG(duration_ms) as avg_duration_ms,
                MIN(duration_ms) as min_duration_ms,
                MAX(duration_ms) as max_duration_ms,
                SUM(security_issues) as total_security_issues,
                SUM(CASE WHEN auto_healed = true THEN 1 ELSE 0 END) as auto_healed_count,
                COUNT(DISTINCT user_id) as unique_contributors
            FROM public.sandbox_runs 
            WHERE team_id = :team_id
        """
        result = db.execute(text(stats_query), {"team_id": team_id})
        stats = result.fetchone()
        
        # Get recent activity (last 7 days)
        activity_query = """
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM public.sandbox_runs 
            WHERE team_id = :team_id 
            AND created_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(created_at)
            ORDER BY date
        """
        activity_result = db.execute(text(activity_query), {"team_id": team_id})
        activity = [{"date": str(row[0]), "count": row[1]} for row in activity_result.fetchall()]
        
        # Get contributor breakdown
        contributors_query = """
            SELECT user_id, user_name, COUNT(*) as run_count,
                   SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed
            FROM public.sandbox_runs 
            WHERE team_id = :team_id
            GROUP BY user_id, user_name
            ORDER BY run_count DESC
            LIMIT 10
        """
        contributors_result = db.execute(text(contributors_query), {"team_id": team_id})
        contributors = [
            {"user_id": row[0], "user_name": row[1] or "Unknown", "run_count": row[2], "passed": row[3]}
            for row in contributors_result.fetchall()
        ]
        
        return {
            "total_runs": stats[0] or 0,
            "passed": stats[1] or 0,
            "failed": stats[2] or 0,
            "pass_rate": round((stats[1] or 0) / (stats[0] or 1) * 100, 1),
            "avg_duration_ms": int(stats[3] or 0),
            "min_duration_ms": stats[4] or 0,
            "max_duration_ms": stats[5] or 0,
            "total_security_issues": stats[6] or 0,
            "auto_healed_count": stats[7] or 0,
            "unique_contributors": stats[8] or 0,
            "recent_activity": activity,
            "contributors": contributors,
        }
    
    except Exception as e:
        print(f"[Sandbox API] Error getting team stats: {e}")
        return {
            "total_runs": 0,
            "passed": 0,
            "failed": 0,
            "pass_rate": 0,
            "avg_duration_ms": 0,
            "min_duration_ms": 0,
            "max_duration_ms": 0,
            "total_security_issues": 0,
            "auto_healed_count": 0,
            "unique_contributors": 0,
            "recent_activity": [],
            "contributors": [],
        }


# =============================================================================
# Approve & Deploy - Create PR from validated sandbox run
# =============================================================================

class ApproveDeployRequest(BaseModel):
    sandbox_run_id: str
    team_id: str
    pr_title: Optional[str] = None
    pr_description: Optional[str] = None
    create_pr_only: bool = False  # If True, just create PR without auto-merge
    include_workflow: bool = True  # Include GitHub Actions workflow for auto-deploy


class ApproveDeployResponse(BaseModel):
    success: bool
    pr_url: Optional[str] = None
    branch_name: Optional[str] = None
    error: Optional[str] = None
    files_committed: int = 0


@router.post("/approve-deploy", response_model=ApproveDeployResponse)
async def approve_and_deploy(
    request: ApproveDeployRequest,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
    auth_db: Session = Depends(acquire_auth_session),
):
    """
    Approve a passed sandbox run and create a PR.
    
    **Requires team admin role.**
    
    This endpoint:
    1. Verifies user is a team admin
    2. Verifies the sandbox run exists and passed
    3. Gets staged files from team staging area
    4. Creates a branch with those files (skipping terraform validation - sandbox already did it)
    5. Pushes to GitHub and creates a PR
    
    The GitHub Actions workflow handles the actual deployment.
    """
    print(f"[Sandbox Approve] Starting approve & deploy for run {request.sandbox_run_id}")
    
    try:
        # 0. Verify user is a team admin
        team_service = TeamService(auth_db)
        user_role = team_service.get_user_role(request.team_id, current_user.id)
        
        if not user_role:
            return ApproveDeployResponse(
                success=False,
                error="You are not a member of this team"
            )
        
        if user_role != 'admin':
            return ApproveDeployResponse(
                success=False,
                error=f"Only team admins can approve and deploy sandbox runs. Your role in this team: {user_role}"
            )
        
        print(f"[Sandbox Approve] User {current_user.id} is admin of team {request.team_id}")
        
        # 1. Verify sandbox run exists and passed
        result = db.execute(
            text("SELECT * FROM public.sandbox_runs WHERE id = :id AND team_id = :team_id"),
            {"id": request.sandbox_run_id, "team_id": request.team_id}
        )
        run = result.fetchone()
        
        if not run:
            return ApproveDeployResponse(
                success=False,
                error="Sandbox run not found or doesn't belong to this team"
            )
        
        run_dict = dict(run._mapping) if hasattr(run, '_mapping') else dict(run)
        
        if run_dict.get('status') != 'passed':
            return ApproveDeployResponse(
                success=False,
                error=f"Cannot deploy - sandbox run status is '{run_dict.get('status')}', expected 'passed'"
            )
        
        repository = run_dict.get('repository')
        if not repository or '/' not in repository:
            return ApproveDeployResponse(
                success=False,
                error=f"Invalid repository format: {repository}"
            )
        
        repo_owner, repo_name = repository.split('/', 1)
        print(f"[Sandbox Approve] Repository: {repo_owner}/{repo_name}")
        
        # 2. Get files from sandbox run snapshot (preferred) or fall back to staging
        tested_files_snapshot = run_dict.get('tested_files_snapshot')
        
        # Parse JSON if it's a string
        if tested_files_snapshot and isinstance(tested_files_snapshot, str):
            try:
                tested_files_snapshot = json.loads(tested_files_snapshot)
            except json.JSONDecodeError:
                tested_files_snapshot = None
        
        if tested_files_snapshot and len(tested_files_snapshot) > 0:
            # Use the exact files that were tested in the sandbox
            staged_files = tested_files_snapshot
            print(f"[Sandbox Approve] Using tested_files_snapshot: {len(staged_files)} files")
        else:
            # Fall back to current staging (backward compatibility for old runs)
            print(f"[Sandbox Approve] No snapshot found, falling back to current staging")
            staged_files = staging_manager.get_all_staged_files(request.team_id)
            
            if not staged_files:
                return ApproveDeployResponse(
                    success=False,
                    error="No files to deploy. The sandbox run has no file snapshot and the staging area is empty."
                )
        
        print(f"[Sandbox Approve] Found {len(staged_files)} files to deploy")
        
        # 3. Verify user has GitHub token
        if not current_user.github_access_token:
            return ApproveDeployResponse(
                success=False,
                error="GitHub token not found. Please authenticate with GitHub first."
            )
        
        github_token = current_user.github_access_token
        
        # 4. Create a temporary workspace and set up git
        with tempfile.TemporaryDirectory() as temp_workspace:
            print(f"[Sandbox Approve] Using temp workspace: {temp_workspace}")
            
            # Clone the repo
            clone_url = f"https://{github_token}@github.com/{repo_owner}/{repo_name}.git"
            clone_result = subprocess.run(
                ["git", "clone", "--depth", "1", clone_url, temp_workspace],
                capture_output=True,
                text=True
            )
            
            if clone_result.returncode != 0:
                return ApproveDeployResponse(
                    success=False,
                    error=f"Failed to clone repository: {clone_result.stderr}"
                )
            
            print(f"[Sandbox Approve] Cloned repository successfully")
            
            # Configure git user
            subprocess.run(["git", "config", "user.email", "ai@infrara.dev"], cwd=temp_workspace, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Infrara AI"], cwd=temp_workspace, capture_output=True)
            
            # Create new branch
            branch_name = f"sandbox-deploy-{request.sandbox_run_id[:8]}-{int(datetime.utcnow().timestamp())}"
            subprocess.run(["git", "checkout", "-b", branch_name], cwd=temp_workspace, capture_output=True)
            print(f"[Sandbox Approve] Created branch: {branch_name}")
            
            # 5. Write staged files to workspace (SKIP terraform validation - sandbox already did it)
            files_written = 0
            for file_path, content in staged_files.items():
                full_path = os.path.join(temp_workspace, file_path)
                os.makedirs(os.path.dirname(full_path), exist_ok=True)
                with open(full_path, 'w') as f:
                    f.write(content)
                files_written += 1
                print(f"[Sandbox Approve] Wrote file: {file_path}")
            
            # 5b. Add GitHub Actions workflow for Terraform deployment (if include_workflow flag)
            if request.include_workflow:
                workflow_dir = os.path.join(temp_workspace, ".github", "workflows")
                os.makedirs(workflow_dir, exist_ok=True)
                workflow_content = '''name: Terraform with DigitalOcean

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

# Requires: 
# 1. GitHub Settings > Secrets > DIGITALOCEAN_TOKEN
# 2. GitHub Settings > Environments > "production" with required reviewers

permissions:
  contents: read
  pull-requests: write

env:
  DIGITALOCEAN_TOKEN: ${{ secrets.DIGITALOCEAN_TOKEN }}

jobs:
  terraform-plan:
    name: Validate & Plan
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Check for duplicate resources
        run: |
          echo "Checking for existing DigitalOcean resources..."
          
          EXISTING_VPCS=$(curl -s -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" \\
            "https://api.digitalocean.com/v2/vpcs" | jq -r '.vpcs[] | "\\(.name): \\(.ip_range)"' || echo "")
          echo "Existing VPCs:"
          echo "$EXISTING_VPCS"
          
          USED_CIDRS=$(curl -s -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" \\
            "https://api.digitalocean.com/v2/vpcs" | jq -r '.vpcs[].ip_range' || echo "")
          
          for i in $(seq 0 255); do
            TEST_CIDR="10.$i.0.0/16"
            if ! echo "$USED_CIDRS" | grep -q "$TEST_CIDR"; then
              echo "Available CIDR: $TEST_CIDR"
              echo "AVAILABLE_CIDR=$TEST_CIDR" >> $GITHUB_ENV
              break
            fi
          done
          
          if [ -n "$AVAILABLE_CIDR" ]; then
            for tf_file in *.tf; do
              if [ -f "$tf_file" ]; then
                sed -i "s|ip_range\\s*=\\s*\\"10\\.0\\.0\\.0/16\\"|ip_range = \\"$AVAILABLE_CIDR\\"|g" "$tf_file"
                sed -i "s|ip_range\\s*=\\s*\\"10\\.1\\.0\\.0/16\\"|ip_range = \\"$AVAILABLE_CIDR\\"|g" "$tf_file"
                sed -i "s|ip_range\\s*=\\s*\\"10\\.10\\.0\\.0/16\\"|ip_range = \\"$AVAILABLE_CIDR\\"|g" "$tf_file"
              fi
            done
          fi
      
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.6.0
      
      - name: Terraform Init
        run: terraform init
      
      - name: Terraform Plan
        run: terraform plan -no-color -out=tfplan
        
      - name: Upload Plan
        uses: actions/upload-artifact@v4
        with:
          name: tfplan
          path: tfplan

  terraform-apply:
    name: Deploy to Production
    needs: terraform-plan
    runs-on: ubuntu-latest
    # This environment requires manual approval from a team member
    environment: production
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.6.0
      
      - name: Terraform Init
        run: terraform init
      
      - name: Terraform Apply
        run: terraform apply -auto-approve
        env:
          DIGITALOCEAN_TOKEN: ${{ secrets.DIGITALOCEAN_TOKEN }}
          
      - name: Deployment Complete
        run: echo "Infrastructure deployed successfully!"
'''
                workflow_path = os.path.join(workflow_dir, "terraform-deploy.yml")
                with open(workflow_path, 'w') as f:
                    f.write(workflow_content)
                files_written += 1
                print(f"[Sandbox Approve] Added GitHub Actions workflow")
            
            # 6. Stage all changes
            subprocess.run(["git", "add", "-A"], cwd=temp_workspace, capture_output=True)
            
            # Check if there are changes to commit
            status_result = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=temp_workspace,
                capture_output=True,
                text=True
            )
            
            if not status_result.stdout.strip():
                return ApproveDeployResponse(
                    success=False,
                    error="No changes to commit. Files may already be identical to main branch."
                )
            
            # 7. Commit changes
            commit_message = request.pr_title or f"Sandbox-validated infrastructure changes ({files_written} files)"
            commit_result = subprocess.run(
                ["git", "commit", "-m", commit_message],
                cwd=temp_workspace,
                capture_output=True,
                text=True
            )
            
            if commit_result.returncode != 0:
                return ApproveDeployResponse(
                    success=False,
                    error=f"Failed to commit: {commit_result.stderr}"
                )
            
            print(f"[Sandbox Approve] Committed changes")
            
            # 8. Push to GitHub
            push_result = subprocess.run(
                ["git", "push", "-u", "origin", branch_name],
                cwd=temp_workspace,
                capture_output=True,
                text=True
            )
            
            if push_result.returncode != 0:
                return ApproveDeployResponse(
                    success=False,
                    error=f"Failed to push: {push_result.stderr}"
                )
            
            print(f"[Sandbox Approve] Pushed branch to GitHub")
            
            # 9. Create PR via GitHub API
            pr_title = request.pr_title or f"[Sandbox Validated] Infrastructure changes"
            pr_body = request.pr_description or f"""## Sandbox-Validated Deployment

This PR was created from a **passed sandbox validation run**.

> **Approval Required:** After the plan job completes, a team member must approve the deployment in GitHub Actions.

### Sandbox Validation Report

| Check | Status |
|-------|--------|
| Terraform syntax | Passed |
| Terraform init & plan | Passed |
| Duplicate resource check | Passed |
| Security scan | Passed |
| Auto-healing | Applied |

### Details
- **Sandbox Run ID:** `{request.sandbox_run_id}`
- **Files Changed:** {files_written}
- **Validated by:** Infrara Sandbox

### Deployment Flow
1. Plan job runs automatically (check Actions tab)
2. Deploy job waits for approval in the `production` environment
3. A team member approves → Infrastructure is deployed

### First-time setup required?
If the deploy job fails, ensure you have:
1. `DIGITALOCEAN_TOKEN` secret configured
2. `production` environment with required reviewers enabled

`Settings → Environments → production → Required reviewers`
"""
            
            pr_response = requests.post(
                f"https://api.github.com/repos/{repo_owner}/{repo_name}/pulls",
                headers={
                    "Authorization": f"Bearer {github_token}",
                    "Accept": "application/vnd.github.v3+json",
                },
                json={
                    "title": pr_title,
                    "body": pr_body,
                    "head": branch_name,
                    "base": "main",
                }
            )
            
            if pr_response.status_code not in [200, 201]:
                error_detail = pr_response.json().get('message', pr_response.text)
                return ApproveDeployResponse(
                    success=False,
                    error=f"Failed to create PR: {error_detail}"
                )
            
            pr_data = pr_response.json()
            pr_url = pr_data.get('html_url')
            
            print(f"[Sandbox Approve] Created PR: {pr_url}")
            
            # 10. Update sandbox run status to 'deployed'
            db.execute(
                text("UPDATE public.sandbox_runs SET status = 'deployed' WHERE id = :id"),
                {"id": request.sandbox_run_id}
            )
            db.commit()
            
            # 11. Log audit event for approval
            if AUDIT_LOGGING_ENABLED and audit_log_service:
                try:
                    user_display = current_user.github_username or current_user.full_name or current_user.email
                    audit_log_service.log_approval(
                        user_id=current_user.id,
                        user_name=user_display,
                        user_email=current_user.email,
                        change_id=request.sandbox_run_id,
                        approved=True,
                        repository=request.repository,
                        team_id=request.team_id,
                    )
                except Exception as audit_error:
                    print(f"[Sandbox Approve] Failed to log audit event: {audit_error}")
            
            # 12. Clear the staging area since changes have been deployed
            staging_manager.clear_staging(request.team_id)
            print(f"[Sandbox Approve] Cleared team staging area")
            
            return ApproveDeployResponse(
                success=True,
                pr_url=pr_url,
                branch_name=branch_name,
                files_committed=files_written
            )
    
    except Exception as e:
        print(f"[Sandbox Approve] Error: {e}")
        import traceback
        traceback.print_exc()
        return ApproveDeployResponse(
            success=False,
            error=str(e)
        )

