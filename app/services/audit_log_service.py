"""
Comprehensive Audit Log Service - Tracks ALL user activity across the platform.

This service captures:
- User authentication (login, logout, failed attempts)
- Team operations (create, update, delete, join, leave)
- Repository actions (connect, disconnect, scan)
- Sandbox runs (initiate, pass, fail)
- Approvals (approve, reject changes)
- Deployments (start, complete, fail)
- Policy changes (create, update, delete policies)
- System events (drift detected, auto-remediation)

Used for:
- Compliance auditing
- Security monitoring
- Activity dashboards
- Forensic analysis
"""
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
from enum import Enum
import uuid
import json
from sqlalchemy import text
from app.database.connection import primary_session_context


class ActionType(str, Enum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    APPROVE = "approve"
    REJECT = "reject"
    DEPLOY = "deploy"
    SCAN = "scan"
    ALERT = "alert"
    LOGIN = "login"
    LOGOUT = "logout"
    SYSTEM = "system"
    VIEW = "view"
    DOWNLOAD = "download"
    INVITE = "invite"


class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
    SUCCESS = "success"


class AuditLogService:
    """
    Records and retrieves comprehensive audit logs for the platform.
    All user actions are tracked for compliance and monitoring.
    """
    
    def log(
        self,
        action: str,
        action_type: ActionType,
        user_id: Optional[str] = None,
        user_name: Optional[str] = None,
        user_email: Optional[str] = None,
        resource: Optional[str] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        severity: Severity = Severity.INFO,
        status: str = "completed",
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        location: Optional[str] = None,
        details: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        team_id: Optional[str] = None,
        repository: Optional[str] = None,
        change_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Record an audit log entry.
        
        Args:
            action: Description of the action (e.g., "Created sandbox test")
            action_type: Type of action (create, update, delete, etc.)
            user_id: ID of user performing action
            user_name: Name of user
            user_email: Email of user
            resource: Name of resource affected
            resource_type: Type of resource (e.g., "Sandbox Run", "Team", "Repository")
            resource_id: ID of the resource
            severity: Event severity (info, warning, critical, success)
            status: Status of the action
            ip_address: Client IP address
            user_agent: Client user agent
            location: Geographic location
            details: Additional details text
            metadata: Extra key-value data
            team_id: Related team ID
            repository: Related repository name
            change_id: Related change/diff ID
            
        Returns:
            The recorded audit log entry
        """
        log_id = str(uuid.uuid4())
        timestamp = datetime.utcnow()
        
        log_entry = {
            "id": log_id,
            "user_id": user_id,
            "user_name": user_name or "System",
            "user_email": user_email or "system",
            "action": action,
            "action_type": action_type.value if isinstance(action_type, ActionType) else action_type,
            "resource": resource,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "severity": severity.value if isinstance(severity, Severity) else severity,
            "status": status,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "location": location,
            "details": details,
            "metadata": json.dumps(metadata) if metadata else None,
            "team_id": team_id,
            "repository": repository,
            "change_id": change_id,
            "created_at": timestamp.isoformat() + "Z",
        }
        
        # Store in database
        try:
            self._store_log(log_entry)
            print(f"[AuditLog] Logged: {action_type} - {action} by {user_name}")
        except Exception as e:
            print(f"[AuditLog] Failed to store log: {e}")
            import traceback
            traceback.print_exc()
        
        return log_entry
    
    def _store_log(self, log_entry: Dict[str, Any]):
        """Store log entry in the database"""
        with primary_session_context() as db:
            query = text("""
                INSERT INTO public.audit_logs (
                    id, user_id, user_name, user_email,
                    action, action_type, resource, resource_type, resource_id,
                    severity, status, ip_address, user_agent, location,
                    details, metadata, team_id, repository, change_id, created_at
                ) VALUES (
                    :id, :user_id, :user_name, :user_email,
                    :action, :action_type, :resource, :resource_type, :resource_id,
                    :severity, :status, :ip_address, :user_agent, :location,
                    :details, :metadata, :team_id, :repository, :change_id, :created_at
                )
            """)
            db.execute(query, {
                "id": log_entry["id"],
                "user_id": log_entry["user_id"],
                "user_name": log_entry["user_name"],
                "user_email": log_entry["user_email"],
                "action": log_entry["action"],
                "action_type": log_entry["action_type"],
                "resource": log_entry["resource"],
                "resource_type": log_entry["resource_type"],
                "resource_id": log_entry["resource_id"],
                "severity": log_entry["severity"],
                "status": log_entry["status"],
                "ip_address": log_entry["ip_address"],
                "user_agent": log_entry["user_agent"],
                "location": log_entry["location"],
                "details": log_entry["details"],
                "metadata": log_entry["metadata"],
                "team_id": log_entry["team_id"],
                "repository": log_entry["repository"],
                "change_id": log_entry["change_id"],
                "created_at": log_entry["created_at"],
            })
            db.commit()
    
    def get_logs(
        self,
        limit: int = 50,
        offset: int = 0,
        user_id: Optional[str] = None,
        action_type: Optional[str] = None,
        severity: Optional[str] = None,
        resource_type: Optional[str] = None,
        team_id: Optional[str] = None,
        search: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Get audit logs with filtering and pagination.
        
        Returns:
            {
                "logs": [...],
                "total": int,
                "stats": {...}
            }
        """
        try:
            with primary_session_context() as db:
                # Build query
                where_clauses = []
                params: Dict[str, Any] = {}
                
                if user_id:
                    where_clauses.append("user_id = :user_id")
                    params["user_id"] = user_id
                
                if action_type:
                    where_clauses.append("action_type = :action_type")
                    params["action_type"] = action_type
                
                if severity:
                    where_clauses.append("severity = :severity")
                    params["severity"] = severity
                
                if resource_type:
                    where_clauses.append("resource_type = :resource_type")
                    params["resource_type"] = resource_type
                
                if team_id:
                    where_clauses.append("team_id = :team_id")
                    params["team_id"] = team_id
                
                if search:
                    where_clauses.append("(action ILIKE :search OR resource ILIKE :search OR user_name ILIKE :search)")
                    params["search"] = f"%{search}%"
                
                if start_date:
                    where_clauses.append("created_at >= :start_date")
                    params["start_date"] = start_date
                
                if end_date:
                    where_clauses.append("created_at <= :end_date")
                    params["end_date"] = end_date
                
                where_str = " AND ".join(where_clauses) if where_clauses else "1=1"
                
                # Get total count
                count_query = text(f"SELECT COUNT(*) FROM public.audit_logs WHERE {where_str}")
                total = db.execute(count_query, params).scalar() or 0
                
                # Get logs
                query = text(f"""
                    SELECT * FROM public.audit_logs 
                    WHERE {where_str}
                    ORDER BY created_at DESC
                    LIMIT :limit OFFSET :offset
                """)
                params["limit"] = limit
                params["offset"] = offset
                
                result = db.execute(query, params)
                rows = result.fetchall()
                
                logs = []
                for row in rows:
                    log = {
                        "id": row.id,
                        "user": row.user_name,
                        "userEmail": row.user_email,
                        "action": row.action,
                        "actionType": row.action_type,
                        "resource": row.resource,
                        "resourceType": row.resource_type,
                        "severity": row.severity,
                        "timestamp": row.created_at.isoformat() + "Z" if row.created_at else None,
                        "ip": row.ip_address or "N/A",
                        "location": row.location,
                        "details": row.details,
                        "metadata": json.loads(row.metadata) if row.metadata else None,
                    }
                    logs.append(log)
                
                # Get stats (filtered by team or by user when no team)
                stats = self._get_stats(db, team_id=team_id, user_id=user_id)
                
                return {
                    "logs": logs,
                    "total": total,
                    "stats": stats,
                }
        except Exception as e:
            print(f"[AuditLog] Error getting logs: {e}")
            import traceback
            traceback.print_exc()
            return {"logs": [], "total": 0, "stats": {}}
    
    def _get_stats(self, db, team_id: Optional[str] = None, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Get statistics for audit dashboard, filtered by team or by user when no team"""
        try:
            # Build filter: team takes precedence; when no team, filter by user (personal view)
            if team_id:
                scope_filter = "AND team_id = :team_id"
                params: Dict[str, Any] = {"team_id": team_id}
            elif user_id:
                scope_filter = "AND user_id = :user_id"
                params = {"user_id": user_id}
            else:
                scope_filter = ""
                params = {}
            
            # Total events
            total_query = f"SELECT COUNT(*) FROM public.audit_logs WHERE 1=1 {scope_filter}"
            total = db.execute(text(total_query), params).scalar() or 0
            
            # Critical events (last 24h)
            critical_query = f"""
                SELECT COUNT(*) FROM public.audit_logs 
                WHERE severity = 'critical' 
                AND created_at >= NOW() - INTERVAL '24 hours'
                {scope_filter}
            """
            critical = db.execute(text(critical_query), params).scalar() or 0
            
            # Warnings (last 24h)
            warnings_query = f"""
                SELECT COUNT(*) FROM public.audit_logs 
                WHERE severity = 'warning' 
                AND created_at >= NOW() - INTERVAL '24 hours'
                {scope_filter}
            """
            warnings = db.execute(text(warnings_query), params).scalar() or 0
            
            # Unique users (last 7 days) - for user scope this is 0 or 1
            users_query = f"""
                SELECT COUNT(DISTINCT user_id) FROM public.audit_logs 
                WHERE created_at >= NOW() - INTERVAL '7 days'
                AND user_id IS NOT NULL
                {scope_filter}
            """
            active_users = db.execute(text(users_query), params).scalar() or 0
            
            # Events by type (last 7 days)
            by_type_query = f"""
                SELECT action_type, COUNT(*) as count 
                FROM public.audit_logs 
                WHERE created_at >= NOW() - INTERVAL '7 days'
                {scope_filter}
                GROUP BY action_type
                ORDER BY count DESC
            """
            by_type_result = db.execute(text(by_type_query), params)
            by_type = {row.action_type: row.count for row in by_type_result}
            
            # Events per day (last 7 days)
            daily_query = f"""
                SELECT DATE(created_at) as day, COUNT(*) as count 
                FROM public.audit_logs 
                WHERE created_at >= NOW() - INTERVAL '7 days'
                {scope_filter}
                GROUP BY DATE(created_at)
                ORDER BY day
            """
            daily_result = db.execute(text(daily_query), params)
            daily = [{"date": str(row.day), "count": row.count} for row in daily_result]
            
            return {
                "total": total,
                "critical": critical,
                "warnings": warnings,
                "activeUsers": active_users,
                "byType": by_type,
                "daily": daily,
            }
        except Exception as e:
            print(f"[AuditLog] Error getting stats: {e}")
            return {}
    
    # Convenience methods for common actions
    
    def log_login(self, user_id: str, user_name: str, user_email: str, ip_address: str = None, success: bool = True):
        """Log user login"""
        return self.log(
            action="Signed in" if success else "Failed authentication attempt",
            action_type=ActionType.LOGIN,
            user_id=user_id,
            user_name=user_name,
            user_email=user_email,
            severity=Severity.SUCCESS if success else Severity.CRITICAL,
            status="success" if success else "failed",
            ip_address=ip_address,
        )
    
    def log_sandbox_run(
        self, 
        user_id: str, 
        user_name: str, 
        user_email: str,
        repository: str,
        run_id: str,
        passed: bool,
        team_id: str = None,
    ):
        """Log sandbox test run"""
        return self.log(
            action=f"Ran sandbox test - {'Passed' if passed else 'Failed'}",
            action_type=ActionType.SCAN,
            user_id=user_id,
            user_name=user_name,
            user_email=user_email,
            resource=repository,
            resource_type="Sandbox Run",
            resource_id=run_id,
            severity=Severity.SUCCESS if passed else Severity.WARNING,
            team_id=team_id,
            repository=repository,
        )
    
    def log_approval(
        self,
        user_id: str,
        user_name: str,
        user_email: str,
        change_id: str,
        approved: bool,
        repository: str = None,
        team_id: str = None,
    ):
        """Log change approval/rejection"""
        return self.log(
            action=f"{'Approved' if approved else 'Rejected'} change request",
            action_type=ActionType.APPROVE if approved else ActionType.REJECT,
            user_id=user_id,
            user_name=user_name,
            user_email=user_email,
            resource=f"Change {change_id[:8]}",
            resource_type="Change Request",
            resource_id=change_id,
            severity=Severity.SUCCESS if approved else Severity.WARNING,
            team_id=team_id,
            repository=repository,
            change_id=change_id,
        )
    
    def log_deployment(
        self,
        user_id: str,
        user_name: str,
        user_email: str,
        repository: str,
        success: bool,
        team_id: str = None,
    ):
        """Log deployment"""
        return self.log(
            action=f"Deployed changes - {'Success' if success else 'Failed'}",
            action_type=ActionType.DEPLOY,
            user_id=user_id,
            user_name=user_name,
            user_email=user_email,
            resource=repository,
            resource_type="Deployment",
            severity=Severity.SUCCESS if success else Severity.CRITICAL,
            team_id=team_id,
            repository=repository,
        )
    
    def log_team_action(
        self,
        user_id: str,
        user_name: str,
        user_email: str,
        team_id: str,
        team_name: str,
        action: str,
        action_type: ActionType,
    ):
        """Log team-related action"""
        return self.log(
            action=action,
            action_type=action_type,
            user_id=user_id,
            user_name=user_name,
            user_email=user_email,
            resource=team_name,
            resource_type="Team",
            resource_id=team_id,
            severity=Severity.INFO,
            team_id=team_id,
        )
    
    def log_policy_violation(
        self,
        user_id: str,
        user_name: str,
        user_email: str,
        policy_name: str,
        repository: str,
        team_id: str = None,
    ):
        """Log policy violation"""
        return self.log(
            action=f"Policy violation blocked: {policy_name}",
            action_type=ActionType.ALERT,
            user_id=user_id,
            user_name=user_name,
            user_email=user_email,
            resource=policy_name,
            resource_type="Security Policy",
            severity=Severity.CRITICAL,
            team_id=team_id,
            repository=repository,
        )
    
    def log_drift_detected(
        self,
        resource: str,
        resource_type: str,
        repository: str,
        team_id: str = None,
    ):
        """Log drift detection (system event)"""
        return self.log(
            action=f"Drift detected in {resource_type}",
            action_type=ActionType.ALERT,
            resource=resource,
            resource_type=resource_type,
            severity=Severity.WARNING,
            team_id=team_id,
            repository=repository,
        )


# Global instance
audit_log_service = AuditLogService()

