"""
Policy Management API - Dynamic policy enforcement for infrastructure governance.
Handles CRUD operations for policies, violation tracking, and compliance checks.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from pydantic import BaseModel
import json
import uuid
import os
import subprocess
import tempfile

from app.database.connection import acquire_primary_session, acquire_auth_session
from app.services.auth import require_authentication
from app.database.models import UserAccount
from app.services.team_service import TeamService

router = APIRouter()


# Pydantic models
class PolicyCreate(BaseModel):
    name: str
    description: str
    category: str  # Security, Cost, Governance, Network, Compliance
    severity: str  # critical, high, medium, low
    enforcement: str  # block, warn, audit
    scope: List[str]  # aws, digitalocean, gcp, all
    auto_remediate: bool = False
    rego_code: Optional[str] = None  # OPA Rego policy code
    conditions: Optional[Dict[str, Any]] = None  # JSON conditions for simple policies
    team_id: Optional[str] = None  # If provided, create as team policy; otherwise personal


class PolicyUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    enforcement: Optional[str] = None
    scope: Optional[List[str]] = None
    auto_remediate: Optional[bool] = None
    status: Optional[str] = None
    rego_code: Optional[str] = None
    conditions: Optional[Dict[str, Any]] = None


class ViolationCreate(BaseModel):
    policy_id: str
    resource: str
    resource_type: str
    details: str
    severity: str


class PolicyResponse(BaseModel):
    id: str
    name: str
    description: str
    status: str
    severity: str
    category: str
    violations: int
    last_checked: Optional[str]
    created_at: str
    scope: List[str]
    auto_remediate: bool
    enforcement: str
    rego_code: Optional[str] = None
    conditions: Optional[Dict[str, Any]] = None


class ViolationResponse(BaseModel):
    id: str
    policy_id: str
    policy_name: str
    resource: str
    resource_type: str
    severity: str
    timestamp: str
    status: str
    details: str


class PoliciesListResponse(BaseModel):
    policies: List[PolicyResponse]
    total: int
    active: int
    violations_count: int
    compliance_rate: float


class ViolationsListResponse(BaseModel):
    violations: List[ViolationResponse]
    total: int
    open: int
    resolved: int
    suppressed: int


# Default policies to seed
DEFAULT_POLICIES = [
    {
        "name": "No Public S3 Buckets",
        "description": "Ensure S3 buckets are not publicly accessible to prevent data leaks",
        "category": "Security",
        "severity": "critical",
        "enforcement": "block",
        "scope": ["aws", "digitalocean"],
        "auto_remediate": False,
        "rego_code": """
package terraform.s3

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "aws_s3_bucket"
    resource.change.after.acl == "public-read"
    msg := sprintf("S3 bucket '%s' cannot be public", [resource.name])
}
"""
    },
    {
        "name": "Encryption at Rest Required",
        "description": "All storage resources must have encryption enabled",
        "category": "Security",
        "severity": "high",
        "enforcement": "block",
        "scope": ["aws", "digitalocean", "gcp"],
        "auto_remediate": True,
        "rego_code": """
package terraform.encryption

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "aws_ebs_volume"
    not resource.change.after.encrypted
    msg := sprintf("EBS volume '%s' must have encryption enabled", [resource.name])
}
"""
    },
    {
        "name": "Cost Threshold Alert",
        "description": "Alert when estimated monthly cost exceeds threshold",
        "category": "Cost",
        "severity": "medium",
        "enforcement": "warn",
        "scope": ["all"],
        "auto_remediate": False,
        "conditions": {"max_monthly_cost": 500}
    },
    {
        "name": "Tag Compliance",
        "description": "All resources must have required tags: environment, owner, project",
        "category": "Governance",
        "severity": "low",
        "enforcement": "audit",
        "scope": ["all"],
        "auto_remediate": False,
        "rego_code": """
package terraform.tags

required_tags := ["environment", "owner", "project"]

deny[msg] {
    resource := input.resource_changes[_]
    resource.change.after.tags
    missing := required_tags - object.keys(resource.change.after.tags)
    count(missing) > 0
    msg := sprintf("Resource '%s' missing required tags: %v", [resource.name, missing])
}
"""
    },
    {
        "name": "No Default VPC Usage",
        "description": "Resources should not be deployed in default VPCs",
        "category": "Network",
        "severity": "medium",
        "enforcement": "warn",
        "scope": ["aws"],
        "auto_remediate": False,
        "rego_code": """
package terraform.network

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "aws_instance"
    not resource.change.after.vpc_security_group_ids
    msg := sprintf("Instance '%s' should not use default VPC", [resource.name])
}
"""
    },
    {
        "name": "MFA Required for IAM",
        "description": "All IAM users must have MFA enabled",
        "category": "Security",
        "severity": "critical",
        "enforcement": "block",
        "scope": ["aws"],
        "auto_remediate": False,
    },
    {
        "name": "No Wide Open Security Groups",
        "description": "Security groups cannot allow 0.0.0.0/0 ingress on sensitive ports",
        "category": "Security",
        "severity": "critical",
        "enforcement": "block",
        "scope": ["aws", "digitalocean"],
        "auto_remediate": False,
        "rego_code": """
package terraform.security_groups

sensitive_ports := [22, 3389, 3306, 5432, 27017]

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "aws_security_group_rule"
    resource.change.after.type == "ingress"
    resource.change.after.cidr_blocks[_] == "0.0.0.0/0"
    resource.change.after.from_port <= sensitive_ports[_]
    resource.change.after.to_port >= sensitive_ports[_]
    msg := sprintf("Security group rule '%s' allows public access to sensitive port", [resource.name])
}
"""
    },
    {
        "name": "Instance Size Limits",
        "description": "Prevent deployment of instances larger than t3.xlarge in non-prod",
        "category": "Cost",
        "severity": "medium",
        "enforcement": "block",
        "scope": ["aws"],
        "auto_remediate": False,
        "conditions": {"max_instance_type": "t3.xlarge", "environments": ["dev", "staging"]}
    },
]


def generate_id() -> str:
    return str(uuid.uuid4())[:8]


@router.get("/policies", response_model=PoliciesListResponse)
async def list_policies(
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
    category: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    team_id: Optional[str] = Query(default=None),
):
    """List policies with optional filtering. Always includes global policies (8 premade) plus user/team specific."""
    print(f"[Policies API] Listing policies for user: {current_user.id}, team_id: {team_id}")
    
    try:
        # Check if policies table exists and has global policies
        check_query = "SELECT COUNT(*) FROM public.policies WHERE user_id IS NULL AND team_id IS NULL"
        result = db.execute(text(check_query))
        global_count = result.fetchone()[0]
        
        if global_count == 0:
            # Seed default global policies (only once, not per-user)
            print("[Policies API] Seeding global policies...")
            for policy_data in DEFAULT_POLICIES:
                policy_id = generate_id()
                insert_query = """
                    INSERT INTO public.policies (id, name, description, status, severity, category, 
                        enforcement, scope, auto_remediate, rego_code, conditions, 
                        violations_count, user_id, team_id, created_at, updated_at)
                    VALUES (:id, :name, :description, 'active', :severity, :category,
                        :enforcement, :scope, :auto_remediate, :rego_code, :conditions,
                        0, NULL, NULL, NOW(), NOW())
                """
                db.execute(text(insert_query), {
                    "id": policy_id,
                    "name": policy_data["name"],
                    "description": policy_data["description"],
                    "severity": policy_data["severity"],
                    "category": policy_data["category"],
                    "enforcement": policy_data["enforcement"],
                    "scope": json.dumps(policy_data["scope"]),
                    "auto_remediate": policy_data.get("auto_remediate", False),
                    "rego_code": policy_data.get("rego_code"),
                    "conditions": json.dumps(policy_data.get("conditions")) if policy_data.get("conditions") else None,
                })
            db.commit()
        
        # Build query: Always include globals + user/team specific
        # Globals: user_id IS NULL AND team_id IS NULL
        # Personal: user_id = current_user AND team_id IS NULL (when no team_id param)
        # Team: team_id = param (when team_id provided)
        query = "SELECT * FROM public.policies WHERE ("
        params: Dict[str, Any] = {}
        
        # Always include global policies
        query += "(user_id IS NULL AND team_id IS NULL)"
        
        # Add scope-specific policies
        if team_id:
            # Verify user is member of team (team_members is in auth DB)
            auth_db = next(acquire_auth_session())
            try:
                team_service = TeamService(auth_db)
                user_teams = team_service.get_user_teams(current_user.id)
                team_ids = [t.id for t in user_teams]
                if team_id not in team_ids:
                    raise HTTPException(status_code=403, detail="Not a member of this team")
            finally:
                auth_db.close()
            
            # Include team policies
            query += " OR (team_id = :team_id)"
            params["team_id"] = team_id
        else:
            # Include user's personal policies
            query += " OR (user_id = :user_id AND team_id IS NULL)"
            params["user_id"] = current_user.id
        
        if category:
            query += " AND category = :category"
            params["category"] = category
        
        if status:
            query += " AND status = :status"
            params["status"] = status
        
        if severity:
            query += " AND severity = :severity"
            params["severity"] = severity
        
        if search:
            query += " AND (name ILIKE :search OR description ILIKE :search)"
            params["search"] = f"%{search}%"
        
        query += ") ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, created_at DESC"
        
        result = db.execute(text(query), params)
        rows = result.fetchall()
        
        policies = []
        total_violations = 0
        active_count = 0
        
        for row in rows:
            # Parse scope JSON
            scope = row.scope if isinstance(row.scope, list) else json.loads(row.scope) if row.scope else []
            conditions = row.conditions if isinstance(row.conditions, dict) else json.loads(row.conditions) if row.conditions else None
            
            policy = PolicyResponse(
                id=row.id,
                name=row.name,
                description=row.description,
                status=row.status,
                severity=row.severity,
                category=row.category,
                violations=row.violations_count or 0,
                last_checked=row.last_checked.isoformat() if row.last_checked else None,
                created_at=row.created_at.isoformat() if row.created_at else "",
                scope=scope,
                auto_remediate=row.auto_remediate or False,
                enforcement=row.enforcement,
                rego_code=row.rego_code,
                conditions=conditions,
            )
            policies.append(policy)
            total_violations += policy.violations
            if row.status == 'active':
                active_count += 1
        
        # Calculate compliance rate
        total_checks = len(policies) * 10  # Assume 10 resources per policy on average
        compliance_rate = ((total_checks - total_violations) / total_checks * 100) if total_checks > 0 else 100.0
        
        return PoliciesListResponse(
            policies=policies,
            total=len(policies),
            active=active_count,
            violations_count=total_violations,
            compliance_rate=round(compliance_rate, 1),
        )
        
    except Exception as e:
        print(f"[Policies API] Error listing policies: {e}")
        # Return empty response on error (table might not exist yet)
        return PoliciesListResponse(
            policies=[],
            total=0,
            active=0,
            violations_count=0,
            compliance_rate=100.0,
        )


@router.post("/policies", response_model=PolicyResponse)
async def create_policy(
    policy: PolicyCreate,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """Create a new policy. If team_id provided, creates team policy; otherwise personal policy."""
    print(f"[Policies API] Creating policy: {policy.name}, team_id: {policy.team_id}")
    
    try:
        # Validate team membership if team_id provided
        user_id = current_user.id
        team_id = policy.team_id
        
        if team_id:
            # Verify user is member of team (team_members is in auth DB)
            auth_db = next(acquire_auth_session())
            try:
                team_service = TeamService(auth_db)
                user_teams = team_service.get_user_teams(user_id)
                team_ids = [t.id for t in user_teams]
                if team_id not in team_ids:
                    raise HTTPException(status_code=403, detail="Not a member of this team")
            finally:
                auth_db.close()
        
        policy_id = generate_id()
        
        # Set user_id and team_id appropriately:
        # - If team_id: create team policy (user_id can be set as creator, team_id set)
        # - If no team_id: create personal policy (user_id set, team_id NULL)
        # Never create global policies (both NULL) - only the 8 premade are global
        insert_query = """
            INSERT INTO public.policies (id, name, description, status, severity, category,
                enforcement, scope, auto_remediate, rego_code, conditions,
                violations_count, user_id, team_id, created_at, updated_at)
            VALUES (:id, :name, :description, 'active', :severity, :category,
                :enforcement, :scope, :auto_remediate, :rego_code, :conditions,
                0, :user_id, :team_id, NOW(), NOW())
        """
        
        db.execute(text(insert_query), {
            "id": policy_id,
            "name": policy.name,
            "description": policy.description,
            "severity": policy.severity,
            "category": policy.category,
            "enforcement": policy.enforcement,
            "scope": json.dumps(policy.scope),
            "auto_remediate": policy.auto_remediate,
            "rego_code": policy.rego_code,
            "conditions": json.dumps(policy.conditions) if policy.conditions else None,
            "user_id": user_id,  # Always set creator
            "team_id": team_id,  # NULL for personal, set for team
        })
        db.commit()
        
        return PolicyResponse(
            id=policy_id,
            name=policy.name,
            description=policy.description,
            status="active",
            severity=policy.severity,
            category=policy.category,
            violations=0,
            last_checked=None,
            created_at=datetime.utcnow().isoformat(),
            scope=policy.scope,
            auto_remediate=policy.auto_remediate,
            enforcement=policy.enforcement,
            rego_code=policy.rego_code,
            conditions=policy.conditions,
        )
        
    except Exception as e:
        print(f"[Policies API] Error creating policy: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/policies/{policy_id}", response_model=PolicyResponse)
async def get_policy(
    policy_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """Get a single policy by ID."""
    try:
        result = db.execute(text("SELECT * FROM public.policies WHERE id = :id"), {"id": policy_id})
        row = result.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Policy not found")
        
        scope = row.scope if isinstance(row.scope, list) else json.loads(row.scope) if row.scope else []
        conditions = row.conditions if isinstance(row.conditions, dict) else json.loads(row.conditions) if row.conditions else None
        
        return PolicyResponse(
            id=row.id,
            name=row.name,
            description=row.description,
            status=row.status,
            severity=row.severity,
            category=row.category,
            violations=row.violations_count or 0,
            last_checked=row.last_checked.isoformat() if row.last_checked else None,
            created_at=row.created_at.isoformat() if row.created_at else "",
            scope=scope,
            auto_remediate=row.auto_remediate or False,
            enforcement=row.enforcement,
            rego_code=row.rego_code,
            conditions=conditions,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Policies API] Error getting policy: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/policies/{policy_id}", response_model=PolicyResponse)
async def update_policy(
    policy_id: str,
    policy: PolicyUpdate,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """Update a policy."""
    try:
        # Build update query dynamically
        updates = []
        params = {"id": policy_id}
        
        if policy.name is not None:
            updates.append("name = :name")
            params["name"] = policy.name
        if policy.description is not None:
            updates.append("description = :description")
            params["description"] = policy.description
        if policy.category is not None:
            updates.append("category = :category")
            params["category"] = policy.category
        if policy.severity is not None:
            updates.append("severity = :severity")
            params["severity"] = policy.severity
        if policy.enforcement is not None:
            updates.append("enforcement = :enforcement")
            params["enforcement"] = policy.enforcement
        if policy.scope is not None:
            updates.append("scope = :scope")
            params["scope"] = json.dumps(policy.scope)
        if policy.auto_remediate is not None:
            updates.append("auto_remediate = :auto_remediate")
            params["auto_remediate"] = policy.auto_remediate
        if policy.status is not None:
            updates.append("status = :status")
            params["status"] = policy.status
        if policy.rego_code is not None:
            updates.append("rego_code = :rego_code")
            params["rego_code"] = policy.rego_code
        if policy.conditions is not None:
            updates.append("conditions = :conditions")
            params["conditions"] = json.dumps(policy.conditions)
        
        updates.append("updated_at = NOW()")
        
        if updates:
            query = f"UPDATE public.policies SET {', '.join(updates)} WHERE id = :id"
            db.execute(text(query), params)
            db.commit()
        
        # Return updated policy
        return await get_policy(policy_id, current_user, db)
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Policies API] Error updating policy: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/policies/{policy_id}")
async def delete_policy(
    policy_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """Delete a policy."""
    try:
        # Delete violations first
        db.execute(text("DELETE FROM public.policy_violations WHERE policy_id = :id"), {"id": policy_id})
        # Delete policy
        db.execute(text("DELETE FROM public.policies WHERE id = :id"), {"id": policy_id})
        db.commit()
        
        return {"success": True, "message": "Policy deleted"}
        
    except Exception as e:
        print(f"[Policies API] Error deleting policy: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/policies/{policy_id}/violations", response_model=ViolationsListResponse)
async def get_policy_violations(
    policy_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
    status: Optional[str] = Query(default=None),
):
    """Get violations for a specific policy."""
    try:
        query = """
            SELECT v.*, p.name as policy_name 
            FROM public.policy_violations v 
            JOIN public.policies p ON v.policy_id = p.id 
            WHERE v.policy_id = :policy_id
        """
        params: Dict[str, Any] = {"policy_id": policy_id}
        
        if status:
            query += " AND v.status = :status"
            params["status"] = status
        
        query += " ORDER BY v.created_at DESC"
        
        result = db.execute(text(query), params)
        rows = result.fetchall()
        
        violations = []
        open_count = 0
        resolved_count = 0
        suppressed_count = 0
        
        for row in rows:
            violation = ViolationResponse(
                id=row.id,
                policy_id=row.policy_id,
                policy_name=row.policy_name,
                resource=row.resource,
                resource_type=row.resource_type,
                severity=row.severity,
                timestamp=row.created_at.isoformat() if row.created_at else "",
                status=row.status,
                details=row.details or "",
            )
            violations.append(violation)
            
            if row.status == 'open':
                open_count += 1
            elif row.status == 'resolved':
                resolved_count += 1
            elif row.status == 'suppressed':
                suppressed_count += 1
        
        return ViolationsListResponse(
            violations=violations,
            total=len(violations),
            open=open_count,
            resolved=resolved_count,
            suppressed=suppressed_count,
        )
        
    except Exception as e:
        print(f"[Policies API] Error getting violations: {e}")
        return ViolationsListResponse(
            violations=[],
            total=0,
            open=0,
            resolved=0,
            suppressed=0,
        )


@router.get("/violations", response_model=ViolationsListResponse)
async def list_all_violations(
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
    status: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    limit: int = Query(default=50, le=100),
):
    """List all violations across all policies."""
    try:
        query = """
            SELECT v.*, p.name as policy_name 
            FROM public.policy_violations v 
            JOIN public.policies p ON v.policy_id = p.id 
            WHERE 1=1
        """
        params: Dict[str, Any] = {}
        
        if status:
            query += " AND v.status = :status"
            params["status"] = status
        
        if severity:
            query += " AND v.severity = :severity"
            params["severity"] = severity
        
        query += f" ORDER BY v.created_at DESC LIMIT {limit}"
        
        result = db.execute(text(query), params)
        rows = result.fetchall()
        
        violations = []
        open_count = 0
        resolved_count = 0
        suppressed_count = 0
        
        for row in rows:
            violation = ViolationResponse(
                id=row.id,
                policy_id=row.policy_id,
                policy_name=row.policy_name,
                resource=row.resource,
                resource_type=row.resource_type,
                severity=row.severity,
                timestamp=row.created_at.isoformat() if row.created_at else "",
                status=row.status,
                details=row.details or "",
            )
            violations.append(violation)
            
            if row.status == 'open':
                open_count += 1
            elif row.status == 'resolved':
                resolved_count += 1
            elif row.status == 'suppressed':
                suppressed_count += 1
        
        return ViolationsListResponse(
            violations=violations,
            total=len(violations),
            open=open_count,
            resolved=resolved_count,
            suppressed=suppressed_count,
        )
        
    except Exception as e:
        print(f"[Policies API] Error listing violations: {e}")
        return ViolationsListResponse(
            violations=[],
            total=0,
            open=0,
            resolved=0,
            suppressed=0,
        )


@router.post("/policies/check")
async def run_policy_check(
    terraform_plan: Dict[str, Any],
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """
    Run policy checks against a Terraform plan.
    Returns violations for any policies that fail.
    """
    print(f"[Policies API] Running policy check for user: {current_user.id}")
    
    violations = []
    
    try:
        # Get all active policies
        result = db.execute(text("SELECT * FROM public.policies WHERE status = 'active'"))
        policies = result.fetchall()
        
        for policy in policies:
            policy_violations = []
            
            if policy.rego_code:
                # Run OPA evaluation
                policy_violations = await _evaluate_rego_policy(
                    policy.rego_code, 
                    terraform_plan,
                    policy.id,
                    policy.name,
                    policy.severity
                )
            elif policy.conditions:
                # Evaluate simple conditions
                conditions = json.loads(policy.conditions) if isinstance(policy.conditions, str) else policy.conditions
                policy_violations = _evaluate_conditions(
                    conditions,
                    terraform_plan,
                    policy.id,
                    policy.name,
                    policy.severity
                )
            
            violations.extend(policy_violations)
            
            # Update last_checked
            db.execute(
                text("UPDATE public.policies SET last_checked = NOW() WHERE id = :id"),
                {"id": policy.id}
            )
        
        # Save violations to database
        for v in violations:
            violation_id = generate_id()
            db.execute(text("""
                INSERT INTO public.policy_violations (id, policy_id, resource, resource_type, 
                    severity, status, details, created_at)
                VALUES (:id, :policy_id, :resource, :resource_type, 
                    :severity, 'open', :details, NOW())
            """), {
                "id": violation_id,
                "policy_id": v["policy_id"],
                "resource": v["resource"],
                "resource_type": v["resource_type"],
                "severity": v["severity"],
                "details": v["details"],
            })
            
            # Update violation count
            db.execute(text("""
                UPDATE public.policies 
                SET violations_count = violations_count + 1 
                WHERE id = :id
            """), {"id": v["policy_id"]})
        
        db.commit()
        
        return {
            "passed": len(violations) == 0,
            "violations": violations,
            "policies_checked": len(policies),
        }
        
    except Exception as e:
        print(f"[Policies API] Error running policy check: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/policies/{policy_id}/toggle")
async def toggle_policy(
    policy_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """Toggle policy active/inactive status."""
    try:
        # Get current status
        result = db.execute(text("SELECT status FROM public.policies WHERE id = :id"), {"id": policy_id})
        row = result.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Policy not found")
        
        new_status = "inactive" if row.status == "active" else "active"
        
        db.execute(
            text("UPDATE public.policies SET status = :status, updated_at = NOW() WHERE id = :id"),
            {"id": policy_id, "status": new_status}
        )
        db.commit()
        
        return {"success": True, "new_status": new_status}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Policies API] Error toggling policy: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/violations/{violation_id}/resolve")
async def resolve_violation(
    violation_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """Mark a violation as resolved."""
    try:
        # Get policy_id before updating
        result = db.execute(
            text("SELECT policy_id FROM public.policy_violations WHERE id = :id"),
            {"id": violation_id}
        )
        row = result.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Violation not found")
        
        # Update violation status
        db.execute(
            text("UPDATE public.policy_violations SET status = 'resolved', resolved_at = NOW() WHERE id = :id"),
            {"id": violation_id}
        )
        
        # Decrement violation count
        db.execute(
            text("UPDATE public.policies SET violations_count = GREATEST(0, violations_count - 1) WHERE id = :id"),
            {"id": row.policy_id}
        )
        
        db.commit()
        
        return {"success": True, "message": "Violation resolved"}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Policies API] Error resolving violation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/violations/{violation_id}/suppress")
async def suppress_violation(
    violation_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """Suppress a violation (acknowledge but don't fix)."""
    try:
        result = db.execute(
            text("SELECT policy_id FROM public.policy_violations WHERE id = :id"),
            {"id": violation_id}
        )
        row = result.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Violation not found")
        
        db.execute(
            text("UPDATE public.policy_violations SET status = 'suppressed', suppressed_at = NOW(), suppressed_by = :user_id WHERE id = :id"),
            {"id": violation_id, "user_id": current_user.id}
        )
        
        db.execute(
            text("UPDATE public.policies SET violations_count = GREATEST(0, violations_count - 1) WHERE id = :id"),
            {"id": row.policy_id}
        )
        
        db.commit()
        
        return {"success": True, "message": "Violation suppressed"}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Policies API] Error suppressing violation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/policies/stats/summary")
async def get_policy_stats(
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_primary_session),
):
    """Get summary statistics for policies."""
    try:
        # Total policies by status
        result = db.execute(text("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'active') as active,
                COUNT(*) FILTER (WHERE status = 'inactive') as inactive,
                COUNT(*) FILTER (WHERE status = 'draft') as draft,
                COALESCE(SUM(violations_count), 0) as total_violations
            FROM public.policies
        """))
        row = result.fetchone()
        
        # Violations by severity
        viol_result = db.execute(text("""
            SELECT 
                severity,
                COUNT(*) as count
            FROM public.policy_violations
            WHERE status = 'open'
            GROUP BY severity
        """))
        violations_by_severity = {r.severity: r.count for r in viol_result.fetchall()}
        
        # Policies by category
        cat_result = db.execute(text("""
            SELECT 
                category,
                COUNT(*) as count
            FROM public.policies
            GROUP BY category
        """))
        policies_by_category = {r.category: r.count for r in cat_result.fetchall()}
        
        # Calculate compliance rate
        total_policies = row.total if row else 0
        total_violations = row.total_violations if row else 0
        compliance_rate = ((total_policies * 10 - total_violations) / (total_policies * 10) * 100) if total_policies > 0 else 100.0
        
        return {
            "total_policies": row.total if row else 0,
            "active_policies": row.active if row else 0,
            "inactive_policies": row.inactive if row else 0,
            "draft_policies": row.draft if row else 0,
            "total_violations": total_violations,
            "violations_by_severity": violations_by_severity,
            "policies_by_category": policies_by_category,
            "compliance_rate": round(compliance_rate, 1),
            "last_scan": datetime.utcnow().isoformat(),
        }
        
    except Exception as e:
        print(f"[Policies API] Error getting stats: {e}")
        return {
            "total_policies": 0,
            "active_policies": 0,
            "inactive_policies": 0,
            "draft_policies": 0,
            "total_violations": 0,
            "violations_by_severity": {},
            "policies_by_category": {},
            "compliance_rate": 100.0,
            "last_scan": None,
        }


async def _evaluate_rego_policy(
    rego_code: str,
    terraform_plan: Dict[str, Any],
    policy_id: str,
    policy_name: str,
    severity: str
) -> List[Dict[str, Any]]:
    """Evaluate a Rego policy against a Terraform plan using OPA."""
    violations = []
    
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            # Write policy file
            policy_path = os.path.join(tmpdir, "policy.rego")
            with open(policy_path, "w") as f:
                f.write(rego_code)
            
            # Write input file
            input_path = os.path.join(tmpdir, "input.json")
            with open(input_path, "w") as f:
                json.dump(terraform_plan, f)
            
            # Run OPA eval
            result = subprocess.run(
                ["opa", "eval", "-i", input_path, "-d", policy_path, "data.terraform"],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                output = json.loads(result.stdout)
                # Parse OPA output for deny messages
                if "result" in output and output["result"]:
                    for r in output["result"]:
                        if "expressions" in r:
                            for expr in r["expressions"]:
                                if "value" in expr and isinstance(expr["value"], dict):
                                    for key, msgs in expr["value"].items():
                                        if key == "deny" and msgs:
                                            for msg in msgs:
                                                violations.append({
                                                    "policy_id": policy_id,
                                                    "policy_name": policy_name,
                                                    "resource": "unknown",
                                                    "resource_type": "unknown",
                                                    "severity": severity,
                                                    "details": msg if isinstance(msg, str) else str(msg),
                                                })
    except subprocess.TimeoutExpired:
        print(f"[Policies API] OPA evaluation timed out for policy {policy_id}")
    except FileNotFoundError:
        print("[Policies API] OPA not installed - skipping Rego evaluation")
    except Exception as e:
        print(f"[Policies API] Error evaluating Rego policy: {e}")
    
    return violations


def _evaluate_conditions(
    conditions: Dict[str, Any],
    terraform_plan: Dict[str, Any],
    policy_id: str,
    policy_name: str,
    severity: str
) -> List[Dict[str, Any]]:
    """Evaluate simple conditions against a Terraform plan."""
    violations = []
    
    # Cost threshold check
    if "max_monthly_cost" in conditions:
        # This would integrate with cost estimation
        pass
    
    # Instance size check
    if "max_instance_type" in conditions:
        allowed_types = ["t3.micro", "t3.small", "t3.medium", "t3.large", "t3.xlarge"]
        max_type = conditions["max_instance_type"]
        max_index = allowed_types.index(max_type) if max_type in allowed_types else len(allowed_types)
        
        for rc in terraform_plan.get("resource_changes", []):
            if rc.get("type") == "aws_instance":
                instance_type = rc.get("change", {}).get("after", {}).get("instance_type", "")
                if instance_type in allowed_types:
                    type_index = allowed_types.index(instance_type)
                    if type_index > max_index:
                        violations.append({
                            "policy_id": policy_id,
                            "policy_name": policy_name,
                            "resource": rc.get("name", "unknown"),
                            "resource_type": "aws_instance",
                            "severity": severity,
                            "details": f"Instance type {instance_type} exceeds maximum allowed {max_type}",
                        })
    
    return violations

