"""
Dashboard API endpoints.
Provides aggregated statistics and data for the main dashboard.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from sqlalchemy import text, func
from sqlalchemy.orm import Session

from app.database.models import UserAccount
from app.services.auth import authentication_service, require_authentication
from app.database.connection import acquire_primary_session, acquire_auth_session, primary_session_context
from app.utils.errors import sanitize_error_detail

router = APIRouter()


@router.get("/dashboard/stats")
async def get_dashboard_stats(
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
    auth_db: Session = Depends(acquire_auth_session),
):
    """
    Get comprehensive dashboard statistics.
    
    Aggregates data from:
    - Sandbox runs
    - Policy violations
    - Audit logs
    - PR tracking
    - Teams
    - Drift detection
    - Cost tracking
    """
    try:
        user_id = current_user.id
        
        # 1. Sandbox Statistics
        sandbox_stats_query = text("""
            SELECT 
                COUNT(*) as total_runs,
                SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                AVG(duration_ms) as avg_duration_ms,
                SUM(security_issues) as total_security_issues,
                SUM(CASE WHEN auto_healed = true THEN 1 ELSE 0 END) as auto_healed_count
            FROM public.sandbox_runs 
            WHERE user_id = :user_id
        """)
        sandbox_result = db.execute(sandbox_stats_query, {"user_id": user_id})
        sandbox_row = sandbox_result.fetchone()
        
        sandbox_stats = {
            "total_runs": sandbox_row[0] or 0 if sandbox_row else 0,
            "passed": sandbox_row[1] or 0 if sandbox_row else 0,
            "failed": sandbox_row[2] or 0 if sandbox_row else 0,
            "pass_rate": round((sandbox_row[1] or 0) / (sandbox_row[0] or 1) * 100, 1) if sandbox_row and sandbox_row[0] else 0,
            "avg_duration_ms": int(sandbox_row[3] or 0) if sandbox_row else 0,
            "total_security_issues": sandbox_row[4] or 0 if sandbox_row else 0,
            "auto_healed_count": sandbox_row[5] or 0 if sandbox_row else 0,
        }
        
        # Sandbox activity (last 7 days)
        sandbox_activity_query = text("""
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM public.sandbox_runs 
            WHERE user_id = :user_id 
            AND created_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(created_at)
            ORDER BY date
        """)
        activity_result = db.execute(sandbox_activity_query, {"user_id": user_id})
        sandbox_activity = [{"date": str(row[0]), "count": row[1]} for row in activity_result.fetchall()]
        
        # 2. Policy Statistics
        policy_stats_query = text("""
            SELECT 
                COUNT(*) as total_policies,
                COUNT(*) FILTER (WHERE status = 'active') as active_policies,
                COALESCE(SUM(violations_count), 0) as total_violations
            FROM public.policies
        """)
        policy_result = db.execute(policy_stats_query)
        policy_row = policy_result.fetchone()
        
        policy_stats = {
            "total_policies": policy_row[0] or 0 if policy_row else 0,
            "active_policies": policy_row[1] or 0 if policy_row else 0,
            "total_violations": policy_row[2] or 0 if policy_row else 0,
        }
        
        # Policy violations by severity
        violations_query = text("""
            SELECT 
                severity,
                COUNT(*) as count
            FROM public.policy_violations
            WHERE status = 'open'
            GROUP BY severity
        """)
        violations_result = db.execute(violations_query)
        violations_by_severity = {row[0]: row[1] for row in violations_result.fetchall()}
        
        # Recent policy violations
        recent_violations_query = text("""
            SELECT 
                id,
                rule_name,
                resource_name,
                severity,
                category,
                remediation,
                created_at
            FROM public.policy_violations
            WHERE status = 'open'
            ORDER BY created_at DESC
            LIMIT 5
        """)
        recent_violations_result = db.execute(recent_violations_query)
        recent_violations = [
            {
                "id": row[0],
                "rule": row[1] or "unknown",
                "resource": row[2] or "unknown",
                "severity": row[3] or "medium",
                "category": row[4] or "General",
                "remediation": row[5] or "Review and fix",
                "detected": _format_time_ago(row[6]) if row[6] else "unknown"
            }
            for row in recent_violations_result.fetchall()
        ]
        
        # Policy compliance by category
        compliance_query = text("""
            SELECT 
                category,
                COUNT(*) as total,
                SUM(CASE WHEN violations_count = 0 THEN 1 ELSE 0 END) as compliant
            FROM public.policies
            GROUP BY category
        """)
        compliance_result = db.execute(compliance_query)
        policy_compliance = [
            {
                "name": row[0] or "Other",
                "compliant": int((row[2] or 0) / (row[1] or 1) * 100),
                "total": row[1] or 0
            }
            for row in compliance_result.fetchall()
        ]
        
        # 3. PR Statistics
        pr_stats_query = text("""
            SELECT 
                COUNT(*) as total_prs,
                SUM(CASE WHEN status = 'created' THEN 1 ELSE 0 END) as created_prs,
                SUM(CASE WHEN status = 'merged' THEN 1 ELSE 0 END) as merged_prs
            FROM public.pull_requests
            WHERE user_id = :user_id
        """)
        pr_result = db.execute(pr_stats_query, {"user_id": user_id})
        pr_row = pr_result.fetchone()
        
        pr_stats = {
            "total_prs": pr_row[0] or 0 if pr_row else 0,
            "created_prs": pr_row[1] or 0 if pr_row else 0,
            "merged_prs": pr_row[2] or 0 if pr_row else 0,
        }
        
        # Recent PRs (last 7 days)
        seven_days_ago = datetime.utcnow() - timedelta(days=7)
        recent_prs_query = text("""
            SELECT COUNT(*) 
            FROM public.pull_requests
            WHERE user_id = :user_id
            AND created_at >= :seven_days_ago
        """)
        recent_prs_result = db.execute(recent_prs_query, {"user_id": user_id, "seven_days_ago": seven_days_ago})
        recent_prs = recent_prs_result.scalar() or 0
        
        # 4. Teams Statistics
        teams_query = text("""
            SELECT COUNT(DISTINCT team_id)
            FROM public.team_members
            WHERE user_id = :user_id
        """)
        teams_result = auth_db.execute(teams_query, {"user_id": user_id})
        active_teams = teams_result.scalar() or 0
        
        # 5. Audit Logs - Recent Activity
        audit_query = text("""
            SELECT 
                action_type,
                target_resource,
                user_name,
                created_at
            FROM public.audit_logs
            WHERE user_id = :user_id
            ORDER BY created_at DESC
            LIMIT 10
        """)
        audit_result = db.execute(audit_query, {"user_id": user_id})
        recent_activity = [
            {
                "user": row[2] or "System",
                "action": _format_action(row[0] or "unknown"),
                "target": row[1] or "unknown",
                "time": _format_time_ago(row[3]) if row[3] else "unknown",
                "type": _get_activity_type(row[0] or "unknown")
            }
            for row in audit_result.fetchall()
        ]
        
        # 6. Drift Detection - Mock data structure (would need actual drift detection data)
        # For now, we'll return empty arrays and let the frontend handle it
        drift_data = []
        recent_drift_items = []
        
        # 7. Cost Data - Get from DigitalOcean if available, otherwise mock
        cost_trend_data = []
        estimated_cost = 0
        
        # 8. Change Risk Assessment - Mock for now
        change_risk_distribution = [
            {"name": "Low Risk", "value": 0, "color": "#22c55e"},
            {"name": "Medium Risk", "value": 0, "color": "#eab308"},
            {"name": "High Risk", "value": 0, "color": "#f97316"},
            {"name": "Critical Risk", "value": 0, "color": "#ef4444"},
        ]
        pending_changes = []
        
        # 9. Lifecycle Governance Phases
        lifecycle_phases = [
            {
                "name": "Pre-Deployment",
                "status": "healthy",
                "checks": sandbox_stats["total_runs"],
                "passed": sandbox_stats["passed"]
            },
            {
                "name": "Deployment",
                "status": "healthy" if pr_stats["merged_prs"] > 0 else "inactive",
                "checks": pr_stats["total_prs"],
                "passed": pr_stats["merged_prs"]
            },
            {
                "name": "Post-Deployment",
                "status": "warning" if policy_stats["total_violations"] > 0 else "healthy",
                "checks": policy_stats["active_policies"],
                "passed": policy_stats["active_policies"] - policy_stats["total_violations"]
            },
        ]
        
        # 10. Top Issues/Investigations
        investigations = [
            {
                "title": "Security Misconfigurations",
                "source": "Terraform Scan",
                "open": violations_by_severity.get("critical", 0) + violations_by_severity.get("high", 0),
                "total": policy_stats["total_violations"],
                "mttr": "70h 30m",
                "trend": [3, 5, 4, 7, 6, 8, violations_by_severity.get("critical", 0) + violations_by_severity.get("high", 0)]
            },
            {
                "title": "Infrastructure Drift",
                "source": "State Monitor",
                "open": len(recent_drift_items),
                "total": len(recent_drift_items),
                "mttr": "3h 4m",
                "trend": [2, 4, 3, 5, 8, 12, len(recent_drift_items)]
            },
            {
                "title": "Cost Anomalies",
                "source": "DigitalOcean",
                "open": 0,
                "total": 0,
                "mttr": "99h 56m",
                "trend": [5, 4, 3, 2, 1, 0, 0]
            },
            {
                "title": "Policy Violations",
                "source": "OPA/Conftest",
                "open": policy_stats["total_violations"],
                "total": policy_stats["total_violations"],
                "mttr": "75h 43m",
                "trend": [8, 6, 4, 3, 2, 1, policy_stats["total_violations"]]
            },
        ]
        
        # 11. Quick Stats
        quick_stats = {
            "connected_repos": 0,  # Would need to fetch from GitHub context
            "active_teams": active_teams,
            "sandbox_pass_rate": sandbox_stats["pass_rate"],
            "avg_resolution_time": "4.2h",  # Would need to calculate from actual data
        }
        
        return {
            "ok": True,
            "sandbox": sandbox_stats,
            "sandbox_activity": sandbox_activity,
            "policy": policy_stats,
            "policy_compliance": policy_compliance,
            "policy_violations": {
                "by_severity": violations_by_severity,
                "recent": recent_violations
            },
            "pr": pr_stats,
            "recent_prs": recent_prs,
            "teams": {
                "active": active_teams
            },
            "recent_activity": recent_activity,
            "drift": {
                "data": drift_data,
                "items": recent_drift_items
            },
            "cost": {
                "trend": cost_trend_data,
                "estimated": estimated_cost
            },
            "change_risk": {
                "distribution": change_risk_distribution,
                "pending": pending_changes
            },
            "lifecycle_phases": lifecycle_phases,
            "investigations": investigations,
            "quick_stats": quick_stats,
        }
        
    except Exception as e:
        print(f"[Dashboard API] Error getting stats: {e}")
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to fetch dashboard statistics")
        )


def _format_time_ago(timestamp: datetime) -> str:
    """Format timestamp as relative time (e.g., '2 hours ago')"""
    if not timestamp:
        return "unknown"
    
    now = datetime.utcnow()
    if timestamp.tzinfo:
        now = datetime.now(timestamp.tzinfo)
    
    diff = now - timestamp
    
    if diff.days > 0:
        return f"{diff.days}d ago"
    elif diff.seconds >= 3600:
        hours = diff.seconds // 3600
        return f"{hours}h ago"
    elif diff.seconds >= 60:
        minutes = diff.seconds // 60
        return f"{minutes}m ago"
    else:
        return "just now"


def _format_action(action_type: str) -> str:
    """Format action type as human-readable action"""
    action_map = {
        "create": "created",
        "update": "updated",
        "delete": "deleted",
        "approve": "approved",
        "reject": "rejected",
        "deploy": "deployed",
        "scan": "ran scan on",
        "alert": "detected drift in",
        "login": "signed in",
        "logout": "signed out",
        "system": "system event",
        "view": "viewed",
    }
    return action_map.get(action_type.lower(), action_type)


def _get_activity_type(action_type: str) -> str:
    """Get activity type for icon/color"""
    type_map = {
        "approve": "approve",
        "create": "create",
        "scan": "run",
        "alert": "alert",
        "deploy": "fix",
    }
    return type_map.get(action_type.lower(), "create")

