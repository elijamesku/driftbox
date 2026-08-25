"""
Lifecycle Audit API endpoints.
Provides access to infrastructure governance audit trail.

COMPLIANCE STORY: Complete visibility into every infrastructure decision.
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List
from app.services.auth import authentication_service
from app.database.models import UserAccount

# Import lifecycle audit service
try:
    from app.services.lifecycle_audit_service import lifecycle_audit_service, LifecycleEventType
    AUDIT_ENABLED = True
except ImportError:
    AUDIT_ENABLED = False
    lifecycle_audit_service = None
    LifecycleEventType = None


router = APIRouter()


@router.get("/audit/lifecycle/{change_id}")
def get_lifecycle_timeline(
    change_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get complete lifecycle audit trail for an infrastructure change.
    
    Returns chronological list of all governance events:
    - Change proposed
    - Policy checks
    - Risk assessment
    - Approvals
    - Terraform apply
    - Post-deployment validation
    
    This is the "story" of the change for auditors and compliance.
    """
    if not AUDIT_ENABLED:
        raise HTTPException(status_code=501, detail={"error": "not_implemented", "message": "Audit service not available"})
    
    timeline = lifecycle_audit_service.get_lifecycle_timeline(change_id)
    summary = lifecycle_audit_service.get_lifecycle_summary(change_id)
    
    return {
        "ok": True,
        "change_id": change_id,
        "summary": summary,
        "timeline": timeline,
        "total_events": len(timeline),
    }


@router.get("/audit/lifecycle/{change_id}/summary")
def get_lifecycle_summary(
    change_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get summary of lifecycle status for an infrastructure change.
    Quick overview of governance journey without full event details.
    """
    if not AUDIT_ENABLED:
        raise HTTPException(status_code=501, detail={"error": "not_implemented", "message": "Audit service not available"})
    
    summary = lifecycle_audit_service.get_lifecycle_summary(change_id)
    
    return {
        "ok": True,
        "summary": summary,
    }


@router.get("/audit/recent")
def get_recent_audit_events(
    limit: int = Query(default=50, le=200),
    event_type: Optional[str] = None,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get recent lifecycle events across all changes.
    
    Useful for:
    - Activity feeds
    - Monitoring dashboards
    - Compliance oversight
    
    Query params:
        limit: Max events to return (default 50, max 200)
        event_type: Filter by event type (change_proposed, policy_checked, etc.)
    """
    if not AUDIT_ENABLED:
        raise HTTPException(status_code=501, detail={"error": "not_implemented", "message": "Audit service not available"})
    
    # Convert event_type string to enum if provided
    event_types = None
    if event_type:
        try:
            event_types = [LifecycleEventType(event_type)]
        except ValueError:
            raise HTTPException(
                status_code=400, 
                detail={
                    "error": "invalid_event_type", 
                    "message": f"Invalid event type: {event_type}",
                    "valid_types": [e.value for e in LifecycleEventType],
                }
            )
    
    events = lifecycle_audit_service.get_recent_events(
        limit=limit,
        event_types=event_types,
    )
    
    return {
        "ok": True,
        "events": events,
        "count": len(events),
    }


@router.get("/audit/report")
def get_compliance_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Generate compliance report for auditors.
    
    Shows all infrastructure changes with their governance journey:
    - Which changes followed proper process
    - Which changes had policy violations
    - Which changes were auto-approved vs manual
    - Overall compliance rate
    
    Query params:
        start_date: ISO date string (e.g., 2025-01-01T00:00:00Z)
        end_date: ISO date string
    """
    if not AUDIT_ENABLED:
        raise HTTPException(status_code=501, detail={"error": "not_implemented", "message": "Audit service not available"})
    
    report = lifecycle_audit_service.get_compliance_report(
        start_date=start_date,
        end_date=end_date,
    )
    
    return {
        "ok": True,
        "report": report,
    }


@router.get("/audit/event-types")
def get_event_types(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get list of all lifecycle event types.
    Useful for building filters in UI.
    """
    return {
        "ok": True,
        "event_types": [
            {
                "value": e.value,
                "name": e.name,
                "description": _get_event_description(e),
            }
            for e in LifecycleEventType
        ],
    }


def _get_event_description(event_type) -> str:
    """Get human-readable description for event type"""
    if not AUDIT_ENABLED or LifecycleEventType is None:
        return str(event_type)
    
    descriptions = {
        LifecycleEventType.CHANGE_PROPOSED: "Infrastructure change was proposed/initiated",
        LifecycleEventType.POLICY_CHECKED: "OPA/Conftest policy evaluation completed",
        LifecycleEventType.RISK_ASSESSED: "Risk score calculated for the change",
        LifecycleEventType.APPROVAL_REQUESTED: "Manual approval was requested",
        LifecycleEventType.CHANGE_APPROVED: "Change was approved (manual or automatic)",
        LifecycleEventType.CHANGE_REJECTED: "Change was rejected",
        LifecycleEventType.APPLY_STARTED: "Terraform apply was initiated",
        LifecycleEventType.APPLY_COMPLETED: "Terraform apply completed successfully",
        LifecycleEventType.APPLY_FAILED: "Terraform apply failed",
        LifecycleEventType.VALIDATION_PASSED: "Post-deployment validation passed",
        LifecycleEventType.VALIDATION_FAILED: "Post-deployment validation failed",
        LifecycleEventType.DRIFT_DETECTED: "Infrastructure drift was detected",
        LifecycleEventType.DRIFT_RESOLVED: "Drift was resolved/remediated",
        LifecycleEventType.ROLLBACK_INITIATED: "Rollback was initiated",
        LifecycleEventType.ROLLBACK_COMPLETED: "Rollback completed",
    }
    return descriptions.get(event_type, getattr(event_type, 'value', str(event_type)))

