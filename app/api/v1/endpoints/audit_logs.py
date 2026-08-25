"""
Audit Logs API endpoints.
Provides access to comprehensive platform activity logs.
"""
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from typing import Optional, List
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.database.connection import acquire_primary_session

# Import audit log service
try:
    from app.services.audit_log_service import audit_log_service, ActionType, Severity
    AUDIT_ENABLED = True
except ImportError as e:
    print(f"[AuditLogs API] Failed to import audit_log_service: {e}")
    AUDIT_ENABLED = False
    audit_log_service = None


router = APIRouter()


@router.get("/logs")
def get_audit_logs(
    request: Request,
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
    user_id: Optional[str] = Query(default=None),
    action_type: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    resource_type: Optional[str] = Query(default=None),
    team_id: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get audit logs with filtering and pagination.
    
    Query params:
        limit: Max logs to return (default 50, max 200)
        offset: Pagination offset
        user_id: Filter by user
        action_type: Filter by action type (create, update, delete, approve, deploy, scan, alert, login, system)
        severity: Filter by severity (info, warning, critical, success)
        resource_type: Filter by resource type
        team_id: Filter by team
        search: Search in action, resource, user name
        start_date: ISO date string
        end_date: ISO date string
    """
    if not AUDIT_ENABLED or not audit_log_service:
        raise HTTPException(
            status_code=501, 
            detail={"error": "not_implemented", "message": "Audit service not available"}
        )
    
    # When no team is selected, show only the current user's audit logs
    effective_user_id = user_id
    if team_id is None:
        effective_user_id = current_user.id
    
    try:
        result = audit_log_service.get_logs(
            limit=limit,
            offset=offset,
            user_id=effective_user_id,
            action_type=action_type,
            severity=severity,
            resource_type=resource_type,
            team_id=team_id,
            search=search,
            start_date=start_date,
            end_date=end_date,
        )
        
        return {
            "ok": True,
            "logs": result.get("logs", []),
            "total": result.get("total", 0),
            "stats": result.get("stats", {}),
        }
    except Exception as e:
        error_msg = str(e)
        print(f"[AuditLogs API] Error: {error_msg}")
        # Check if it's a table not found error
        if "does not exist" in error_msg or "relation" in error_msg.lower():
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "table_not_found",
                    "message": "Audit logs table does not exist. Please run the migration: 007_add_audit_logs_table.sql"
                }
            )
        # Return empty result for other errors
        return {
            "ok": False,
            "logs": [],
            "total": 0,
            "stats": {},
            "error": error_msg
        }


@router.get("/logs/stats")
def get_audit_stats(
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get audit log statistics for dashboard.
    
    Returns:
        - Total events
        - Critical events (24h)
        - Warnings (24h)
        - Active users (7 days)
        - Events by type
        - Daily trends
    """
    if not AUDIT_ENABLED or not audit_log_service:
        raise HTTPException(
            status_code=501, 
            detail={"error": "not_implemented", "message": "Audit service not available"}
        )
    
    result = audit_log_service.get_logs(limit=1)  # Just to get stats
    
    return {
        "ok": True,
        "stats": result.get("stats", {}),
    }


@router.get("/logs/action-types")
def get_action_types(
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """Get list of all action types for filtering."""
    return {
        "ok": True,
        "action_types": [
            {"value": "create", "label": "Create"},
            {"value": "update", "label": "Update"},
            {"value": "delete", "label": "Delete"},
            {"value": "approve", "label": "Approve"},
            {"value": "reject", "label": "Reject"},
            {"value": "deploy", "label": "Deploy"},
            {"value": "scan", "label": "Scan"},
            {"value": "alert", "label": "Alert"},
            {"value": "login", "label": "Login"},
            {"value": "logout", "label": "Logout"},
            {"value": "system", "label": "System"},
            {"value": "view", "label": "View"},
            {"value": "download", "label": "Download"},
            {"value": "invite", "label": "Invite"},
        ],
    }


@router.get("/logs/severities")
def get_severities(
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """Get list of severity levels for filtering."""
    return {
        "ok": True,
        "severities": [
            {"value": "info", "label": "Info", "color": "blue"},
            {"value": "warning", "label": "Warning", "color": "amber"},
            {"value": "critical", "label": "Critical", "color": "red"},
            {"value": "success", "label": "Success", "color": "green"},
        ],
    }


@router.get("/report")
def get_compliance_report(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(acquire_primary_session),
):
    """
    Generate compliance report for governance dashboard.
    
    Shows all infrastructure changes with their governance journey:
    - Which changes followed proper process
    - Which changes had policy violations
    - Which changes were auto-approved vs manual
    - Overall compliance rate
    
    Query params:
        start_date: ISO date string (e.g., 2025-01-01T00:00:00Z)
        end_date: ISO date string
    """
    try:
        # Parse dates - default to 90 days if not specified to capture more history
        if start_date:
            start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        else:
            start = datetime.utcnow() - timedelta(days=90)  # Increased from 30 to 90 days
        
        if end_date:
            end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        else:
            end = datetime.utcnow()
        
        # Get sandbox runs (infrastructure changes that went through validation)
        sandbox_runs = []
        try:
            query = """
                SELECT 
                    id,
                    status,
                    created_at,
                    security_issues,
                    risk_level,
                    auto_healed,
                    repository,
                    branch
                FROM public.sandbox_runs
                WHERE created_at >= :start_date AND created_at <= :end_date
                ORDER BY created_at DESC
            """
            result = db.execute(text(query), {
                "start_date": start,
                "end_date": end
            })
            sandbox_runs = result.fetchall()
        except Exception as e:
            print(f"[AuditLogs API] Could not fetch sandbox runs: {e}")
        
        # Import diff_manager to get diff sessions (approval workflow changes)
        from app.services.diff_manager import diff_manager
        
        # Get diff sessions
        all_sessions = diff_manager.list_sessions(user_id=current_user.id)
        
        # Filter diff sessions by date range
        filtered_sessions = []
        for session in all_sessions:
            session_date_str = session.get('created_at') or session.get('timestamp', '')
            if session_date_str:
                try:
                    session_date = datetime.fromisoformat(session_date_str.replace('Z', '+00:00'))
                    if start <= session_date <= end:
                        filtered_sessions.append(session)
                except:
                    filtered_sessions.append(session)
            else:
                filtered_sessions.append(session)
        
        # Get audit logs for approvals and policy checks
        audit_logs = []
        try:
            audit_query = """
                SELECT 
                    action_type,
                    resource_type,
                    change_id,
                    resource_id,
                    status,
                    severity
                FROM public.audit_logs
                WHERE created_at >= :start_date AND created_at <= :end_date
                AND action_type IN ('approve', 'deploy', 'scan', 'policy_check')
            """
            audit_result = db.execute(text(audit_query), {
                "start_date": start,
                "end_date": end
            })
            audit_logs = audit_result.fetchall()
        except Exception as e:
            print(f"[AuditLogs API] Could not fetch audit logs (table may not exist): {e}")
        
        # Build change compliance data from BOTH sandbox runs and diff sessions
        changes = []
        total_changes = len(sandbox_runs) + len(filtered_sessions)
        compliant_changes = 0
        
        # Group audit logs by change_id/resource_id
        change_audits = {}
        for log in audit_logs:
            change_id = log.change_id or log.resource_id or 'unknown'
            if change_id not in change_audits:
                change_audits[change_id] = []
            change_audits[change_id].append(log)
        
        # Process sandbox runs
        for run in sandbox_runs:
            change_id = run.id
            audits = change_audits.get(change_id, [])
            
            has_policy_check = any(
                a.action_type == 'policy_check' or 
                'policy' in (a.action_type or '').lower() 
                for a in audits
            )
            has_approval = any(a.action_type == 'approve' for a in audits)
            has_risk_assessment = run.risk_level is not None and run.risk_level != ''
            
            # Determine compliance status
            status = run.status
            if status in ['passed', 'approved', 'deployed']:
                if has_policy_check and has_risk_assessment:
                    compliance_status = 'compliant'
                    compliant_changes += 1
                elif has_risk_assessment:
                    compliance_status = 'mostly_compliant'
                    compliant_changes += 1
                else:
                    compliance_status = 'incomplete'
            elif status == 'failed':
                compliance_status = 'non_compliant'
            else:
                compliance_status = 'pending'
            
            changes.append({
                "change_id": change_id,
                "current_status": status,
                "compliance_status": compliance_status,
                "has_policy_check": has_policy_check,
                "has_risk_assessment": has_risk_assessment,
                "has_approval": has_approval,
            })
        
        # Process diff sessions
        for session in filtered_sessions:
            change_id = session.get('diff_id') or session.get('id', 'unknown')
            audits = change_audits.get(change_id, [])
            
            # Check if session has risk assessment
            risk_assessment = session.get('risk_assessment') or {}
            has_risk_assessment = bool(risk_assessment)
            
            # Check for policy checks and approvals in audit logs
            has_policy_check = any(
                a.action_type == 'policy_check' or 
                'policy' in (a.action_type or '').lower() 
                for a in audits
            )
            has_approval = any(
                a.action_type == 'approve' or 
                session.get('status') in ['approved', 'auto_approved']
                for a in audits
            ) or session.get('status') in ['approved', 'auto_approved']
            
            # Determine compliance status
            status = session.get('status', 'pending')
            if status in ['approved', 'auto_approved', 'committed']:
                if has_policy_check and has_risk_assessment:
                    compliance_status = 'compliant'
                    compliant_changes += 1
                elif has_risk_assessment:
                    compliance_status = 'mostly_compliant'
                    compliant_changes += 1
                else:
                    compliance_status = 'incomplete'
            elif status == 'rejected':
                compliance_status = 'non_compliant'
            else:
                compliance_status = 'pending'
            
            changes.append({
                "change_id": change_id,
                "current_status": status,
                "compliance_status": compliance_status,
                "has_policy_check": has_policy_check,
                "has_risk_assessment": has_risk_assessment,
                "has_approval": has_approval,
            })
        
        compliance_rate = (compliant_changes / total_changes * 100) if total_changes > 0 else 100.0
        
        return {
            "ok": True,
            "report": {
                "total_changes": total_changes,
                "compliant_changes": compliant_changes,
                "compliance_rate": round(compliance_rate, 1),
                "changes": changes,
            }
        }
        
    except Exception as e:
        print(f"[AuditLogs API] Error generating compliance report: {e}")
        # Return empty report on error
        return {
            "ok": True,
            "report": {
                "total_changes": 0,
                "compliant_changes": 0,
                "compliance_rate": 100.0,
                "changes": [],
            }
        }

