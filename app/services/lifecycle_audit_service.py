"""
Lifecycle Audit Service - Tracks complete governance journey of infrastructure changes.

COMPLIANCE STORY: Every decision is tracked - enterprise buyers love this.

Events tracked across the infrastructure lifecycle:
1. CHANGE_PROPOSED    - Infrastructure change initiated
2. POLICY_CHECKED     - OPA/Conftest policy evaluation
3. RISK_ASSESSED      - Risk score calculated
4. APPROVAL_REQUESTED - Manual approval required
5. CHANGE_APPROVED    - Change approved (manual or auto)
6. CHANGE_REJECTED    - Change rejected
7. APPLY_STARTED      - Terraform apply initiated
8. APPLY_COMPLETED    - Terraform apply succeeded
9. APPLY_FAILED       - Terraform apply failed
10. VALIDATION_PASSED - Post-deployment checks passed
11. VALIDATION_FAILED - Post-deployment checks failed
12. DRIFT_DETECTED    - Infrastructure drift detected
"""
from datetime import datetime
from typing import Dict, Any, Optional, List
from enum import Enum
import uuid
import json
from pathlib import Path
from app.config import DATA_DIRECTORY


class LifecycleEventType(str, Enum):
    """Types of events in the infrastructure lifecycle"""
    CHANGE_PROPOSED = "change_proposed"
    POLICY_CHECKED = "policy_checked"
    RISK_ASSESSED = "risk_assessed"
    APPROVAL_REQUESTED = "approval_requested"
    CHANGE_APPROVED = "change_approved"
    CHANGE_REJECTED = "change_rejected"
    APPLY_STARTED = "apply_started"
    APPLY_COMPLETED = "apply_completed"
    APPLY_FAILED = "apply_failed"
    VALIDATION_PASSED = "validation_passed"
    VALIDATION_FAILED = "validation_failed"
    DRIFT_DETECTED = "drift_detected"
    DRIFT_RESOLVED = "drift_resolved"
    ROLLBACK_INITIATED = "rollback_initiated"
    ROLLBACK_COMPLETED = "rollback_completed"


class LifecycleAuditService:
    """
    Records and retrieves infrastructure lifecycle audit events.
    
    Storage: JSON files in data/lifecycle_audit/ directory
    (Can be upgraded to database storage for production)
    """
    
    def __init__(self, storage_directory: Optional[str] = None):
        self.storage_path = Path(storage_directory or DATA_DIRECTORY) / "lifecycle_audit"
        self.storage_path.mkdir(parents=True, exist_ok=True)
    
    def record_event(
        self,
        change_id: str,
        event_type: LifecycleEventType,
        user_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        summary: Optional[str] = None,
        related_ids: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """
        Record a lifecycle event for an infrastructure change.
        
        Args:
            change_id: The diff_id or change identifier this event relates to
            event_type: Type of lifecycle event
            user_id: User who triggered or is associated with this event
            details: Event-specific data (policy results, risk scores, etc.)
            summary: Human-readable summary of the event
            related_ids: Links to other entities (policy_check_id, terraform_run_id, etc.)
        
        Returns:
            The recorded event with generated ID and timestamp
        """
        event_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat() + "Z"
        
        event = {
            "id": event_id,
            "change_id": change_id,
            "event_type": event_type.value,
            "user_id": user_id,
            "timestamp": timestamp,
            "details": details or {},
            "summary": summary or self._generate_summary(event_type, details),
            "related_ids": related_ids or {},
        }
        
        # Store event
        self._store_event(change_id, event)
        
        return event
    
    def get_lifecycle_timeline(self, change_id: str) -> List[Dict[str, Any]]:
        """
        Get complete audit trail for a change.
        
        Returns events in chronological order showing the full governance journey:
        Proposed → Policy Check → Risk Assessment → Approval → Apply → Validation
        """
        events = self._load_events(change_id)
        
        # Sort by timestamp ascending
        events.sort(key=lambda e: e.get("timestamp", ""))
        
        # Add computed fields
        for i, event in enumerate(events):
            event["sequence"] = i + 1
            event["duration_from_start"] = self._calculate_duration(
                events[0].get("timestamp") if events else None,
                event.get("timestamp")
            )
        
        return events
    
    def get_lifecycle_summary(self, change_id: str) -> Dict[str, Any]:
        """
        Get a summary of the lifecycle status for a change.
        
        Returns:
            {
                "change_id": str,
                "current_status": str,
                "total_events": int,
                "started_at": timestamp,
                "last_event_at": timestamp,
                "duration": str,
                "key_milestones": {...},
                "compliance_status": str,
            }
        """
        events = self.get_lifecycle_timeline(change_id)
        
        if not events:
            return {
                "change_id": change_id,
                "current_status": "unknown",
                "total_events": 0,
                "message": "No lifecycle events found for this change",
            }
        
        # Determine current status from latest event
        latest_event = events[-1]
        current_status = self._determine_current_status(latest_event["event_type"])
        
        # Extract key milestones
        milestones = {}
        for event in events:
            event_type = event["event_type"]
            if event_type not in milestones:
                milestones[event_type] = {
                    "timestamp": event["timestamp"],
                    "summary": event["summary"],
                }
        
        # Calculate compliance status
        compliance_status = self._calculate_compliance_status(events)
        
        return {
            "change_id": change_id,
            "current_status": current_status,
            "total_events": len(events),
            "started_at": events[0]["timestamp"],
            "last_event_at": latest_event["timestamp"],
            "duration": self._calculate_duration(events[0]["timestamp"], latest_event["timestamp"]),
            "key_milestones": milestones,
            "compliance_status": compliance_status,
            "has_policy_check": "policy_checked" in milestones,
            "has_risk_assessment": "risk_assessed" in milestones,
            "has_approval": "change_approved" in milestones,
            "has_validation": "validation_passed" in milestones or "validation_failed" in milestones,
        }
    
    def get_recent_events(
        self,
        limit: int = 50,
        event_types: Optional[List[LifecycleEventType]] = None,
        user_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get recent lifecycle events across all changes.
        Useful for activity feeds and audit dashboards.
        """
        all_events = []
        
        # Scan all change directories
        for change_dir in self.storage_path.iterdir():
            if change_dir.is_dir():
                events = self._load_events(change_dir.name)
                all_events.extend(events)
        
        # Filter by event types if specified
        if event_types:
            type_values = [t.value for t in event_types]
            all_events = [e for e in all_events if e["event_type"] in type_values]
        
        # Filter by user_id if specified
        if user_id:
            all_events = [e for e in all_events if e.get("user_id") == user_id]
        
        # Sort by timestamp descending (most recent first)
        all_events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
        
        return all_events[:limit]
    
    def get_compliance_report(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate compliance report for auditors.
        Shows all changes with their governance journey status.
        """
        all_events = self.get_recent_events(limit=1000)
        
        # Filter by date range if specified
        if start_date:
            all_events = [e for e in all_events if e.get("timestamp", "") >= start_date]
        if end_date:
            all_events = [e for e in all_events if e.get("timestamp", "") <= end_date]
        
        # Group by change_id
        changes = {}
        for event in all_events:
            change_id = event["change_id"]
            if change_id not in changes:
                changes[change_id] = []
            changes[change_id].append(event)
        
        # Generate report for each change
        change_reports = []
        for change_id, events in changes.items():
            summary = self.get_lifecycle_summary(change_id)
            change_reports.append(summary)
        
        # Calculate overall statistics
        total_changes = len(change_reports)
        compliant_changes = len([c for c in change_reports if c.get("compliance_status") == "compliant"])
        
        return {
            "report_generated_at": datetime.utcnow().isoformat() + "Z",
            "date_range": {"start": start_date, "end": end_date},
            "total_changes": total_changes,
            "compliant_changes": compliant_changes,
            "compliance_rate": round(compliant_changes / total_changes * 100, 2) if total_changes > 0 else 0,
            "changes": change_reports,
        }
    
    # =========================================================================
    # Convenience methods for recording specific event types
    # =========================================================================
    
    def record_change_proposed(
        self,
        change_id: str,
        user_id: str,
        prompt: str,
        file_count: int,
        resource_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Record that an infrastructure change was proposed"""
        return self.record_event(
            change_id=change_id,
            event_type=LifecycleEventType.CHANGE_PROPOSED,
            user_id=user_id,
            details={
                "prompt": prompt,
                "file_count": file_count,
                "resource_type": resource_type,
            },
            summary=f"Infrastructure change proposed: {prompt[:100]}",
        )
    
    def record_policy_check(
        self,
        change_id: str,
        passed: bool,
        violations: List[Dict] = None,
        policy_engine: str = "conftest",
    ) -> Dict[str, Any]:
        """Record policy check result"""
        return self.record_event(
            change_id=change_id,
            event_type=LifecycleEventType.POLICY_CHECKED,
            details={
                "passed": passed,
                "violations": violations or [],
                "violation_count": len(violations or []),
                "policy_engine": policy_engine,
            },
            summary=f"Policy check {'passed' if passed else f'failed with {len(violations or [])} violation(s)'}",
        )
    
    def record_risk_assessment(
        self,
        change_id: str,
        risk_score: int,
        risk_level: str,
        auto_approved: bool,
        factors: List[Dict] = None,
    ) -> Dict[str, Any]:
        """Record risk assessment result"""
        return self.record_event(
            change_id=change_id,
            event_type=LifecycleEventType.RISK_ASSESSED,
            details={
                "risk_score": risk_score,
                "risk_level": risk_level,
                "auto_approved": auto_approved,
                "factors": factors or [],
            },
            summary=f"Risk assessed: {risk_level} (score: {risk_score})" + (" - auto-approved" if auto_approved else ""),
        )
    
    def record_approval(
        self,
        change_id: str,
        user_id: str,
        approved: bool,
        reason: Optional[str] = None,
        auto_approved: bool = False,
    ) -> Dict[str, Any]:
        """Record approval or rejection"""
        event_type = LifecycleEventType.CHANGE_APPROVED if approved else LifecycleEventType.CHANGE_REJECTED
        return self.record_event(
            change_id=change_id,
            event_type=event_type,
            user_id=user_id,
            details={
                "approved": approved,
                "reason": reason,
                "auto_approved": auto_approved,
            },
            summary=f"Change {'auto-approved' if auto_approved else 'approved' if approved else 'rejected'}" + (f": {reason}" if reason else ""),
        )
    
    def record_apply_result(
        self,
        change_id: str,
        user_id: str,
        success: bool,
        terraform_output: Optional[str] = None,
        resources_affected: int = 0,
        error_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Record Terraform apply result"""
        event_type = LifecycleEventType.APPLY_COMPLETED if success else LifecycleEventType.APPLY_FAILED
        return self.record_event(
            change_id=change_id,
            event_type=event_type,
            user_id=user_id,
            details={
                "success": success,
                "resources_affected": resources_affected,
                "error_message": error_message,
                "terraform_output_length": len(terraform_output or ""),
            },
            summary=f"Terraform apply {'completed successfully' if success else 'failed'}" + (f" ({resources_affected} resources)" if success else f": {error_message}" if error_message else ""),
        )
    
    def record_validation_result(
        self,
        change_id: str,
        passed: bool,
        checks: List[Dict] = None,
        drift_detected: bool = False,
    ) -> Dict[str, Any]:
        """Record post-deployment validation result"""
        event_type = LifecycleEventType.VALIDATION_PASSED if passed else LifecycleEventType.VALIDATION_FAILED
        return self.record_event(
            change_id=change_id,
            event_type=event_type,
            details={
                "passed": passed,
                "checks": checks or [],
                "check_count": len(checks or []),
                "drift_detected": drift_detected,
            },
            summary=f"Post-deployment validation {'passed' if passed else 'failed'}" + (" (drift detected)" if drift_detected else ""),
        )
    
    # =========================================================================
    # Private helper methods
    # =========================================================================
    
    def _store_event(self, change_id: str, event: Dict[str, Any]):
        """Store event to file system"""
        change_dir = self.storage_path / change_id
        change_dir.mkdir(exist_ok=True)
        
        event_file = change_dir / f"{event['id']}.json"
        event_file.write_text(json.dumps(event, indent=2))
    
    def _load_events(self, change_id: str) -> List[Dict[str, Any]]:
        """Load all events for a change from file system"""
        change_dir = self.storage_path / change_id
        if not change_dir.exists():
            return []
        
        events = []
        for event_file in change_dir.glob("*.json"):
            try:
                events.append(json.loads(event_file.read_text()))
            except Exception:
                continue
        
        return events
    
    def _generate_summary(self, event_type: LifecycleEventType, details: Optional[Dict]) -> str:
        """Generate human-readable summary for event"""
        details = details or {}
        
        summaries = {
            LifecycleEventType.CHANGE_PROPOSED: "Infrastructure change proposed",
            LifecycleEventType.POLICY_CHECKED: f"Policy check {'passed' if details.get('passed') else 'failed'}",
            LifecycleEventType.RISK_ASSESSED: f"Risk level: {details.get('risk_level', 'unknown')} (score: {details.get('risk_score', '?')})",
            LifecycleEventType.APPROVAL_REQUESTED: "Manual approval requested",
            LifecycleEventType.CHANGE_APPROVED: "Change approved for deployment",
            LifecycleEventType.CHANGE_REJECTED: "Change rejected",
            LifecycleEventType.APPLY_STARTED: "Terraform apply started",
            LifecycleEventType.APPLY_COMPLETED: "Terraform apply completed successfully",
            LifecycleEventType.APPLY_FAILED: "Terraform apply failed",
            LifecycleEventType.VALIDATION_PASSED: "Post-deployment validation passed",
            LifecycleEventType.VALIDATION_FAILED: "Post-deployment validation failed",
            LifecycleEventType.DRIFT_DETECTED: "Infrastructure drift detected",
            LifecycleEventType.DRIFT_RESOLVED: "Drift resolved",
            LifecycleEventType.ROLLBACK_INITIATED: "Rollback initiated",
            LifecycleEventType.ROLLBACK_COMPLETED: "Rollback completed",
        }
        return summaries.get(event_type, event_type.value)
    
    def _determine_current_status(self, event_type: str) -> str:
        """Determine overall status from latest event type"""
        status_map = {
            "change_proposed": "pending_review",
            "policy_checked": "pending_approval",
            "risk_assessed": "pending_approval",
            "approval_requested": "awaiting_approval",
            "change_approved": "approved",
            "change_rejected": "rejected",
            "apply_started": "deploying",
            "apply_completed": "deployed",
            "apply_failed": "failed",
            "validation_passed": "validated",
            "validation_failed": "validation_failed",
            "drift_detected": "drifted",
            "drift_resolved": "synchronized",
        }
        return status_map.get(event_type, "unknown")
    
    def _calculate_compliance_status(self, events: List[Dict]) -> str:
        """Determine if the change followed proper governance process"""
        event_types = {e["event_type"] for e in events}
        
        # Check for required governance steps
        has_policy_check = "policy_checked" in event_types
        has_risk_assessment = "risk_assessed" in event_types
        has_approval = "change_approved" in event_types
        
        # Check for any failures
        has_failures = any(
            e["event_type"] in ["apply_failed", "validation_failed", "change_rejected"]
            for e in events
        )
        
        if has_policy_check and has_risk_assessment and has_approval and not has_failures:
            return "compliant"
        elif has_failures:
            return "failed"
        elif not has_policy_check or not has_risk_assessment:
            return "incomplete_governance"
        else:
            return "pending"
    
    def _calculate_duration(self, start_time: Optional[str], end_time: Optional[str]) -> str:
        """Calculate duration between two timestamps"""
        if not start_time or not end_time:
            return "N/A"
        
        try:
            start = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            end = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            
            duration = end - start
            seconds = int(duration.total_seconds())
            
            if seconds < 60:
                return f"{seconds}s"
            elif seconds < 3600:
                return f"{seconds // 60}m {seconds % 60}s"
            else:
                hours = seconds // 3600
                minutes = (seconds % 3600) // 60
                return f"{hours}h {minutes}m"
        except Exception:
            return "N/A"


# Global instance
lifecycle_audit_service = LifecycleAuditService()

