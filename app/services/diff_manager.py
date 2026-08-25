"""
Infrastructure change diff manager service for approval workflow.
Creates, persists, and manages diff sessions with granular approve/reject functionality.

Enhanced with risk assessment for smart approvals (MVP Feature #1).
"""
import json
import uuid
import difflib
from typing import Dict, List, Optional, Any
from pathlib import Path
from datetime import datetime
from app.config import DIFF_STORAGE_DIRECTORY

# Import risk assessment service for smart approvals
try:
    from app.services.risk_assessment_service import risk_assessment_service
    RISK_ASSESSMENT_ENABLED = True
except ImportError:
    RISK_ASSESSMENT_ENABLED = False
    risk_assessment_service = None

# Import lifecycle audit service for governance trail
try:
    from app.services.lifecycle_audit_service import lifecycle_audit_service, LifecycleEventType
    AUDIT_ENABLED = True
except ImportError:
    AUDIT_ENABLED = False
    lifecycle_audit_service = None


class InfrastructureChangeApprovalManager:
    """Manages infrastructure change diff sessions for approval workflows"""
    
    def __init__(self, storage_directory: str = None):
        self.session_storage_path = Path(storage_directory or DIFF_STORAGE_DIRECTORY)
        self.session_storage_path.mkdir(exist_ok=True)
    
    def initialize_diff_session(
        self,
        user_prompt: str,
        infrastructure_changes: Dict[str, Any],
        file_modifications: Dict[str, Dict[str, str]],
        user_id: Optional[str] = None,
        cost_impact_data: Optional[Dict[str, Any]] = None,
        change_explanation: Optional[str] = None,
        validation_results: Optional[Dict[str, Any]] = None,
        environment: str = "dev",
        team_settings: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Initialize a new infrastructure change diff session for approval.
        
        Args:
            user_prompt: Original user infrastructure request
            infrastructure_changes: Intermediate representation of infrastructure modifications
            file_modifications: Dictionary mapping file paths to {"old": content, "new": content}
            user_id: User account ID that owns this diff session (for authorization)
            cost_impact_data: Optional infrastructure cost impact analysis
            change_explanation: Optional AI-generated explanation
            validation_results: Optional Terraform validation output (fmt + validate)
            environment: Target environment (prod, staging, dev) for risk assessment
            team_settings: Optional team-specific approval threshold overrides
        
        Returns:
            Diff session containing ID, unified diffs, risk assessment, and metadata
        """
        session_identifier = str(uuid.uuid4())
        session_creation_timestamp = datetime.utcnow().isoformat() + "Z"
        
        # Generate unified diffs for each modified file
        file_diff_records = []
        for file_path, modification in file_modifications.items():
            original_content = modification.get("old", "")
            modified_content = modification.get("new", "")
            
            # Generate standard unified diff format
            original_lines = original_content.splitlines(keepends=True)
            modified_lines = modified_content.splitlines(keepends=True)
            
            unified_diff_output = list(difflib.unified_diff(
                original_lines,
                modified_lines,
                fromfile=f"a/{file_path}",
                tofile=f"b/{file_path}",
                lineterm=""
            ))
            
            # Parse diff into granular hunks for line-level approval
            parsed_hunks = self._parse_diff_into_hunks(unified_diff_output)
            
            file_diff_records.append({
                "file": file_path,
                "old_content": original_content,
                "new_content": modified_content,
                "unified_diff": "".join(unified_diff_output),
                "hunks": parsed_hunks,
                "status": "pending",  # pending, approved, rejected
            })
        
        diff_session_data = {
            "diff_id": session_identifier,
            "user_id": user_id,  # Store user_id for authorization
            "prompt": user_prompt,
            "ir": infrastructure_changes,
            "diffs": file_diff_records,
            "cost_impact": cost_impact_data,
            "explanation": change_explanation,
            "validation": validation_results,
            "status": "pending",  # pending, approved, rejected, committed, auto_approved
            "created_at": session_creation_timestamp,
            "updated_at": session_creation_timestamp,
            "environment": environment,
        }
        
        # Perform risk assessment for smart approvals (MVP Feature #1)
        if RISK_ASSESSMENT_ENABLED and risk_assessment_service:
            try:
                # Extract policy violations from validation results
                policy_violations = []
                security_issues = []
                if validation_results:
                    policy_violations = validation_results.get("policy_violations", [])
                    security_issues = validation_results.get("security_issues", [])
                
                risk_assessment = risk_assessment_service.calculate_risk(
                    ir=infrastructure_changes,
                    file_modifications=file_modifications,
                    policy_violations=policy_violations,
                    security_issues=security_issues,
                    environment=environment,
                    team_settings=team_settings,
                )
                diff_session_data["risk_assessment"] = risk_assessment
                
                # Auto-approve if risk is low enough and auto_approve is enabled
                if risk_assessment.get("auto_approve", False):
                    diff_session_data["status"] = "auto_approved"
                    diff_session_data["auto_approved_at"] = session_creation_timestamp
                    diff_session_data["auto_approved_reason"] = risk_assessment.get("approval_reason", "Low risk change")
                    # Also mark all diffs as approved
                    for file_diff in diff_session_data["diffs"]:
                        file_diff["status"] = "approved"
                        for hunk in file_diff.get("hunks", []):
                            hunk["status"] = "approved"
            except Exception as e:
                # Don't fail the session if risk assessment fails
                diff_session_data["risk_assessment"] = {
                    "error": str(e),
                    "risk_score": 50,  # Default to medium risk
                    "risk_level": "medium",
                    "risk_color": "#eab308",
                    "auto_approve": False,
                }
        
        # Persist session to storage
        self._persist_session_data(session_identifier, diff_session_data)
        
        # Record lifecycle audit events (MVP Feature #2)
        if AUDIT_ENABLED and lifecycle_audit_service:
            try:
                # Record change proposed event
                lifecycle_audit_service.record_change_proposed(
                    change_id=session_identifier,
                    user_id=user_id or "unknown",
                    prompt=user_prompt,
                    file_count=len(file_modifications),
                    resource_type=infrastructure_changes.get("resource"),
                )
                
                # Record risk assessment event if we have one
                if "risk_assessment" in diff_session_data and "error" not in diff_session_data["risk_assessment"]:
                    risk = diff_session_data["risk_assessment"]
                    lifecycle_audit_service.record_risk_assessment(
                        change_id=session_identifier,
                        risk_score=risk.get("risk_score", 0),
                        risk_level=risk.get("risk_level", "unknown"),
                        auto_approved=risk.get("auto_approve", False),
                        factors=risk.get("factors", []),
                    )
                
                # Record auto-approval if it happened
                if diff_session_data.get("status") == "auto_approved":
                    lifecycle_audit_service.record_approval(
                        change_id=session_identifier,
                        user_id=user_id or "system",
                        approved=True,
                        reason=diff_session_data.get("auto_approved_reason"),
                        auto_approved=True,
                    )
            except Exception as e:
                # Don't fail the session if audit logging fails
                print(f"⚠️  Audit logging failed: {e}")
        
        return diff_session_data
    
    def retrieve_diff_session(self, session_identifier: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Retrieve persisted diff session by unique identifier.
        
        Args:
            session_identifier: Diff session unique ID
            user_id: Optional user ID to verify ownership (security check)
        
        Returns:
            Session data if found and user_id matches (if provided), None otherwise
        """
        session_file_path = self.session_storage_path / f"{session_identifier}.json"
        if session_file_path.exists():
            session_data = json.loads(session_file_path.read_text())
            
            # Security: If user_id provided, verify ownership
            if user_id is not None:
                if session_data.get("user_id") != user_id:
                    return None  # User doesn't own this session
            
            return session_data
        return None
    
    def approve_infrastructure_changes(self, session_identifier: str, target_file_path: Optional[str] = None, hunk_index: Optional[int] = None) -> Dict[str, Any]:
        """
        Approve infrastructure changes in diff session (all, file-specific, or hunk-specific).
        
        Args:
            session_identifier: Diff session unique ID
            target_file_path: If provided, approve only this file. If None, approve all.
            hunk_index: If provided (with target_file_path), approve only specific hunk.
        
        Returns:
            Updated diff session data
        """
        session_data = self.retrieve_diff_session(session_identifier)
        if not session_data:
            raise ValueError(f"Diff session {session_identifier} not found")
        
        if session_data["status"] == "committed":
            raise ValueError("Cannot modify already committed diff session")
        
        # Approve all changes
        if target_file_path is None:
            for file_diff in session_data["diffs"]:
                file_diff["status"] = "approved"
                for hunk in file_diff.get("hunks", []):
                    hunk["status"] = "approved"
            session_data["status"] = "approved"
        
        # Approve specific file or hunk
        else:
            for file_diff in session_data["diffs"]:
                if file_diff["file"] == target_file_path:
                    if hunk_index is None:
                        # Approve entire file
                        file_diff["status"] = "approved"
                        for hunk in file_diff.get("hunks", []):
                            hunk["status"] = "approved"
                    else:
                        # Approve specific hunk
                        if 0 <= hunk_index < len(file_diff.get("hunks", [])):
                            file_diff["hunks"][hunk_index]["status"] = "approved"
                        else:
                            raise ValueError(f"Invalid hunk index: {hunk_index}")
                    break
            
            # Recompute overall session status
            session_data["status"] = self._calculate_aggregate_approval_status(session_data)
        
        session_data["updated_at"] = datetime.utcnow().isoformat() + "Z"
        self._persist_session_data(session_identifier, session_data)
        
        # Record audit event for approval
        if AUDIT_ENABLED and lifecycle_audit_service and session_data["status"] == "approved":
            try:
                lifecycle_audit_service.record_approval(
                    change_id=session_identifier,
                    user_id=session_data.get("user_id", "unknown"),
                    approved=True,
                    reason=f"All changes approved" if target_file_path is None else f"File {target_file_path} approved",
                    auto_approved=False,
                )
            except Exception as e:
                print(f"⚠️  Audit logging failed: {e}")
        
        return session_data
    
    def reject_infrastructure_changes(self, session_identifier: str, target_file_path: Optional[str] = None, hunk_index: Optional[int] = None) -> Dict[str, Any]:
        """
        Reject infrastructure changes in diff session (all, file-specific, or hunk-specific).
        Similar to approve_infrastructure_changes but marks as rejected.
        """
        session_data = self.retrieve_diff_session(session_identifier)
        if not session_data:
            raise ValueError(f"Diff session {session_identifier} not found")
        
        if session_data["status"] == "committed":
            raise ValueError("Cannot modify already committed diff session")
        
        # Reject all changes
        if target_file_path is None:
            for file_diff in session_data["diffs"]:
                file_diff["status"] = "rejected"
                for hunk in file_diff.get("hunks", []):
                    hunk["status"] = "rejected"
            session_data["status"] = "rejected"
        
        # Reject specific file or hunk
        else:
            for file_diff in session_data["diffs"]:
                if file_diff["file"] == target_file_path:
                    if hunk_index is None:
                        # Reject entire file
                        file_diff["status"] = "rejected"
                        for hunk in file_diff.get("hunks", []):
                            hunk["status"] = "rejected"
                    else:
                        # Reject specific hunk
                        if 0 <= hunk_index < len(file_diff.get("hunks", [])):
                            file_diff["hunks"][hunk_index]["status"] = "rejected"
                        else:
                            raise ValueError(f"Invalid hunk index: {hunk_index}")
                    break
            
            # Recompute overall session status
            session_data["status"] = self._calculate_aggregate_approval_status(session_data)
        
        session_data["updated_at"] = datetime.utcnow().isoformat() + "Z"
        self._persist_session_data(session_identifier, session_data)
        
        # Record audit event for rejection
        if AUDIT_ENABLED and lifecycle_audit_service and session_data["status"] == "rejected":
            try:
                lifecycle_audit_service.record_approval(
                    change_id=session_identifier,
                    user_id=session_data.get("user_id", "unknown"),
                    approved=False,
                    reason=f"All changes rejected" if target_file_path is None else f"File {target_file_path} rejected",
                    auto_approved=False,
                )
            except Exception as e:
                print(f"⚠️  Audit logging failed: {e}")
        
        return session_data
    
    def extract_approved_modifications(self, session_identifier: str) -> Dict[str, str]:
        """
        Extract only approved infrastructure changes from diff session.
        Returns dictionary mapping file paths to new content for approved changes.
        """
        session_data = self.retrieve_diff_session(session_identifier)
        if not session_data:
            raise ValueError(f"Diff session {session_identifier} not found")
        
        approved_file_contents = {}
        for file_diff in session_data["diffs"]:
            if file_diff["status"] == "approved":
                approved_file_contents[file_diff["file"]] = file_diff["new_content"]
            elif file_diff["status"] == "pending":
                # Verify if all hunks within file are approved
                file_hunks = file_diff.get("hunks", [])
                if file_hunks and all(hunk.get("status") == "approved" for hunk in file_hunks):
                    approved_file_contents[file_diff["file"]] = file_diff["new_content"]
        
        return approved_file_contents
    
    def finalize_session_as_committed(self, session_identifier: str, git_branch: str, pull_request_url: Optional[str] = None):
        """Mark diff session as committed to git repository"""
        session_data = self.retrieve_diff_session(session_identifier)
        if not session_data:
            raise ValueError(f"Diff session {session_identifier} not found")
        
        session_data["status"] = "committed"
        session_data["branch"] = git_branch
        session_data["pr_url"] = pull_request_url
        session_data["committed_at"] = datetime.utcnow().isoformat() + "Z"
        session_data["updated_at"] = session_data["committed_at"]
        
        self._persist_session_data(session_identifier, session_data)
    
    def enumerate_diff_sessions(self, filter_status: Optional[str] = None, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Enumerate diff sessions, optionally filtered by approval status and user.
        
        Args:
            filter_status: Optional status filter (pending, approved, rejected, committed)
            user_id: Optional user ID to filter sessions by owner
        """
        session_summaries = []
        for session_file_path in self.session_storage_path.glob("*.json"):
            try:
                session_data = json.loads(session_file_path.read_text())
                
                # Filter by user_id if provided
                if user_id is not None and session_data.get("user_id") != user_id:
                    continue
                
                # Filter by status if provided
                if filter_status is None or session_data.get("status") == filter_status:
                    # Return summary information only
                    session_summaries.append({
                        "diff_id": session_data["diff_id"],
                        "prompt": session_data["prompt"],
                        "status": session_data["status"],
                        "file_count": len(session_data["diffs"]),
                        "created_at": session_data["created_at"],
                        "updated_at": session_data["updated_at"],
                    })
            except Exception:
                continue
        
        # Sort by creation time descending
        session_summaries.sort(key=lambda x: x["created_at"], reverse=True)
        return session_summaries
    
    def _parse_diff_into_hunks(self, unified_diff_lines: List[str]) -> List[Dict[str, Any]]:
        """Parse unified diff output into granular hunks for line-level approval"""
        parsed_hunks = []
        active_hunk = None
        
        for diff_line in unified_diff_lines:
            if diff_line.startswith("@@"):
                # Beginning of new hunk
                if active_hunk:
                    parsed_hunks.append(active_hunk)
                active_hunk = {
                    "header": diff_line,
                    "lines": [],
                    "status": "pending",
                }
            elif active_hunk is not None:
                active_hunk["lines"].append(diff_line)
        
        if active_hunk:
            parsed_hunks.append(active_hunk)
        
        return parsed_hunks
    
    def _calculate_aggregate_approval_status(self, session_data: Dict[str, Any]) -> str:
        """Calculate overall session approval status from individual file/hunk statuses"""
        file_diffs = session_data["diffs"]
        if not file_diffs:
            return "pending"
        
        file_statuses = [diff["status"] for diff in file_diffs]
        
        if all(status == "approved" for status in file_statuses):
            return "approved"
        elif all(status == "rejected" for status in file_statuses):
            return "rejected"
        elif any(status in ["approved", "rejected"] for status in file_statuses):
            return "partial"
        else:
            return "pending"
    
    def _persist_session_data(self, session_identifier: str, session_data: Dict[str, Any]):
        """Persist diff session data to storage"""
        session_file_path = self.session_storage_path / f"{session_identifier}.json"
        session_file_path.write_text(json.dumps(session_data, indent=2))
    
    # Method aliases for backward compatibility with endpoint code
    def approve_changes(self, diff_id: str, file_path: Optional[str] = None, hunk_index: Optional[int] = None):
        """Alias for approve_infrastructure_changes"""
        return self.approve_infrastructure_changes(diff_id, file_path, hunk_index)
    
    def reject_changes(self, diff_id: str, file_path: Optional[str] = None, hunk_index: Optional[int] = None):
        """Alias for reject_infrastructure_changes"""
        return self.reject_infrastructure_changes(diff_id, file_path, hunk_index)
    
    def get_approved_changes(self, diff_id: str):
        """Alias for extract_approved_modifications"""
        return self.extract_approved_modifications(diff_id)
    
    def mark_as_committed(self, diff_id: str, branch: str, pr_url: Optional[str] = None):
        """Alias for finalize_session_as_committed"""
        return self.finalize_session_as_committed(diff_id, branch, pr_url)
    
    def list_sessions(self, status: Optional[str] = None, user_id: Optional[str] = None):
        """Alias for enumerate_diff_sessions"""
        return self.enumerate_diff_sessions(filter_status=status, user_id=user_id)


# Global diff manager instance
infrastructure_change_approval_manager = InfrastructureChangeApprovalManager()
# Alias for backward compatibility
diff_manager = infrastructure_change_approval_manager

