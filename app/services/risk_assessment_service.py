"""
Risk Assessment Service - Calculates change risk scores for smart approvals.
Integrates with existing diff_manager without modifying its core logic.

THE DIFFERENTIATOR: Intelligent automation that justifies enterprise pricing.
- Auto-approve low-risk changes (configurable threshold)
- Require approval for high-risk changes
- Visual risk badges in UI (green/yellow/red)
"""
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, asdict
from datetime import datetime
import json


@dataclass
class RiskFactor:
    """Individual risk factor contributing to overall score"""
    name: str
    weight: int  # 1-10 scale
    triggered: bool
    reason: str
    category: str  # resource, operation, environment, policy, scope


class RiskAssessmentService:
    """
    Calculates risk scores for infrastructure changes.
    
    Risk Scoring Algorithm:
    1. Base score from resource type (IAM = high, S3 = low)
    2. Operation multiplier (delete = high, create = low)
    3. Environment multiplier (prod = 2x, dev = 1x)
    4. Policy violations add fixed penalty
    5. Change scope (files/resources) adds incremental risk
    
    Final score: 0-100, mapped to risk levels
    """
    
    # Risk weights by resource type (higher = more risky)
    RESOURCE_RISK_WEIGHTS = {
        # AWS IAM (highest risk - security boundary)
        "aws_iam_role": 9,
        "aws_iam_policy": 9,
        "aws_iam_policy_document": 8,
        "aws_iam_user": 8,
        "aws_iam_group": 7,
        "aws_iam_role_policy": 9,
        "aws_iam_role_policy_attachment": 8,
        
        # AWS Network (high risk - security boundary)
        "aws_security_group": 8,
        "aws_security_group_rule": 8,
        "aws_vpc": 7,
        "aws_subnet": 6,
        "aws_internet_gateway": 7,
        "aws_nat_gateway": 6,
        "aws_route_table": 6,
        "aws_network_acl": 7,
        
        # AWS Data (medium-high risk - data exposure)
        "aws_db_instance": 7,
        "aws_rds_cluster": 7,
        "aws_elasticache_cluster": 6,
        "aws_dynamodb_table": 5,
        "aws_s3_bucket": 5,
        "aws_s3_bucket_policy": 7,
        "aws_s3_bucket_public_access_block": 8,
        
        # AWS Compute (medium risk)
        "aws_instance": 5,
        "aws_launch_template": 5,
        "aws_autoscaling_group": 5,
        "aws_lambda_function": 5,
        "aws_ecs_service": 5,
        "aws_ecs_task_definition": 4,
        
        # AWS Secrets (high risk)
        "aws_secretsmanager_secret": 8,
        "aws_kms_key": 8,
        "aws_kms_alias": 6,
        
        # DigitalOcean
        "digitalocean_droplet": 5,
        "digitalocean_database_cluster": 6,
        "digitalocean_firewall": 7,
        "digitalocean_loadbalancer": 5,
        "digitalocean_kubernetes_cluster": 6,
        "digitalocean_spaces_bucket": 5,
        "digitalocean_volume": 4,
        
        # Default for unknown resources
        "_default": 4,
    }
    
    # Risk weights by operation type
    OPERATION_RISK_WEIGHTS = {
        "delete": 10,
        "destroy": 10,
        "remove": 9,
        "replace": 8,  # Destroy + create
        "update": 5,
        "modify": 5,
        "change": 5,
        "create": 3,
        "add": 3,
        "read": 1,
        "plan": 1,
    }
    
    # Environment risk multipliers
    ENVIRONMENT_MULTIPLIERS = {
        "prod": 2.0,
        "production": 2.0,
        "prd": 2.0,
        "live": 2.0,
        "staging": 1.5,
        "stg": 1.5,
        "stage": 1.5,
        "uat": 1.3,
        "qa": 1.2,
        "test": 1.1,
        "dev": 1.0,
        "development": 1.0,
        "sandbox": 0.8,
        "local": 0.5,
    }
    
    # Auto-approve thresholds (configurable per team/org)
    # NOTE: auto_approve_max_score set to -1 means ALL changes require approval
    DEFAULT_THRESHOLDS = {
        "auto_approve_max_score": -1,  # DISABLED - all changes require approval
        "require_senior_min_score": 70,  # Require senior approval if score >= this
        "critical_min_score": 85,  # Block without explicit override if score >= this
    }
    
    def __init__(self, thresholds: Optional[Dict[str, int]] = None):
        self.thresholds = thresholds or self.DEFAULT_THRESHOLDS
    
    def calculate_risk(
        self,
        ir: Dict[str, Any],
        file_modifications: Dict[str, Dict[str, str]],
        policy_violations: Optional[List[Dict]] = None,
        security_issues: Optional[List[Dict]] = None,
        environment: str = "dev",
        team_settings: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Calculate comprehensive risk score for infrastructure changes.
        
        Args:
            ir: Infrastructure representation (from NLP/IR processor)
            file_modifications: Dict of file paths to {"old": content, "new": content}
            policy_violations: List of OPA/Conftest violations
            security_issues: List of security scanner findings
            environment: Target environment (prod, staging, dev, etc.)
            team_settings: Optional team-specific threshold overrides
        
        Returns:
            {
                "risk_score": 0-100,
                "risk_level": "low" | "medium" | "high" | "critical",
                "risk_color": "#22c55e" | "#eab308" | "#f97316" | "#ef4444",
                "factors": [RiskFactor...],
                "auto_approve": bool,
                "requires_approval_from": str | None,
                "approval_reason": str,
                "recommendations": [str...],
                "assessed_at": ISO timestamp,
            }
        """
        factors: List[RiskFactor] = []
        base_score = 0
        recommendations: List[str] = []
        
        # Apply team settings if provided
        thresholds = {**self.thresholds, **(team_settings or {})}
        
        # 1. Resource type risk assessment
        resource_type = ir.get("resource", ir.get("type", ""))
        resource_weight = self.RESOURCE_RISK_WEIGHTS.get(
            resource_type, 
            self.RESOURCE_RISK_WEIGHTS["_default"]
        )
        
        factors.append(RiskFactor(
            name="resource_type",
            weight=resource_weight,
            triggered=resource_weight >= 7,
            reason=f"Resource type '{resource_type}' has risk weight {resource_weight}/10",
            category="resource"
        ))
        base_score += resource_weight * 5  # Max 50 from resource type
        
        # Check for high-risk resource patterns
        if "iam" in resource_type.lower():
            recommendations.append("Review IAM permissions carefully - follows principle of least privilege")
        if "security_group" in resource_type.lower():
            recommendations.append("Verify no overly permissive ingress rules (0.0.0.0/0)")
        
        # 2. Operation type risk assessment
        actions = ir.get("actions", ["create"])
        if isinstance(actions, str):
            actions = [actions]
        
        max_op_weight = 0
        for action in actions:
            action_lower = action.lower()
            op_weight = self.OPERATION_RISK_WEIGHTS.get(action_lower, 3)
            max_op_weight = max(max_op_weight, op_weight)
            
            if op_weight >= 8:
                factors.append(RiskFactor(
                    name="operation_type",
                    weight=op_weight,
                    triggered=True,
                    reason=f"Operation '{action}' is destructive (weight {op_weight}/10)",
                    category="operation"
                ))
                if action_lower in ["delete", "destroy"]:
                    recommendations.append(f"Verify '{action}' is intentional - data loss may be irreversible")
        
        base_score += max_op_weight * 3  # Max 30 from operation
        
        # 3. Environment risk multiplier
        env_lower = environment.lower()
        env_multiplier = self.ENVIRONMENT_MULTIPLIERS.get(env_lower, 1.0)
        
        if env_multiplier > 1.0:
            factors.append(RiskFactor(
                name="environment",
                weight=int(env_multiplier * 5),
                triggered=True,
                reason=f"Target environment '{environment}' has {env_multiplier}x risk multiplier",
                category="environment"
            ))
            if env_multiplier >= 2.0:
                recommendations.append("Production change - consider deploying to staging first")
        
        # 4. Policy violations assessment
        policy_violations = policy_violations or []
        if policy_violations:
            violation_count = len(policy_violations)
            violation_score = min(30, violation_count * 10)  # Max 30 from violations
            
            factors.append(RiskFactor(
                name="policy_violations",
                weight=10,
                triggered=True,
                reason=f"{violation_count} policy violation(s) detected",
                category="policy"
            ))
            base_score += violation_score
            recommendations.append(f"Fix {violation_count} policy violation(s) before deployment")
        
        # 5. Security issues assessment
        security_issues = security_issues or []
        critical_issues = [i for i in security_issues if i.get("severity") in ["critical", "high"]]
        if critical_issues:
            issue_score = min(25, len(critical_issues) * 8)
            
            factors.append(RiskFactor(
                name="security_issues",
                weight=9,
                triggered=True,
                reason=f"{len(critical_issues)} critical/high security issue(s) found",
                category="policy"
            ))
            base_score += issue_score
            recommendations.append("Address critical security issues before deployment")
        
        # 6. Change scope assessment
        file_count = len(file_modifications)
        resource_count = len(ir.get("resources", [ir])) if "resources" not in ir else len(ir["resources"])
        
        if file_count > 5 or resource_count > 5:
            scope_weight = min(10, max(file_count, resource_count))
            factors.append(RiskFactor(
                name="change_scope",
                weight=scope_weight,
                triggered=True,
                reason=f"Large change scope: {file_count} files, {resource_count} resources",
                category="scope"
            ))
            base_score += scope_weight * 1.5
            recommendations.append("Consider breaking into smaller, incremental changes")
        
        # 7. Analyze file content for risky patterns
        content_risks = self._analyze_content_risks(file_modifications)
        for risk in content_risks:
            factors.append(risk)
            base_score += risk.weight * 2
        
        # Apply environment multiplier to final score
        final_score = min(100, int(base_score * env_multiplier))
        
        # Determine risk level and approval requirements
        risk_level, risk_color, auto_approve, requires_approval, approval_reason = \
            self._determine_approval_requirements(final_score, thresholds, factors)
        
        return {
            "risk_score": final_score,
            "risk_level": risk_level,
            "risk_color": risk_color,
            "factors": [asdict(f) for f in factors if f.triggered],
            "all_factors": [asdict(f) for f in factors],
            "auto_approve": auto_approve,
            "requires_approval_from": requires_approval,
            "approval_reason": approval_reason,
            "recommendations": recommendations,
            "environment": environment,
            "thresholds_used": thresholds,
            "assessed_at": datetime.utcnow().isoformat() + "Z",
        }
    
    def _analyze_content_risks(self, file_modifications: Dict[str, Dict[str, str]]) -> List[RiskFactor]:
        """Analyze file content for risky patterns"""
        risks = []
        
        risky_patterns = [
            (r'0\.0\.0\.0/0', "Overly permissive CIDR (0.0.0.0/0) allows access from anywhere", 8),
            (r'publicly_accessible\s*=\s*true', "Resource is publicly accessible", 9),
            (r'encrypted\s*=\s*false', "Encryption is disabled", 8),
            (r'deletion_protection\s*=\s*false', "Deletion protection is disabled", 6),
            (r'skip_final_snapshot\s*=\s*true', "Final snapshot will be skipped on deletion", 5),
            (r'password\s*=\s*["\'][^"\']+["\']', "Hardcoded password detected", 10),
            (r'secret\s*=\s*["\'][^"\']+["\']', "Hardcoded secret detected", 10),
            (r'api_key\s*=\s*["\'][^"\']+["\']', "Hardcoded API key detected", 10),
            (r'\*:\*', "Overly permissive IAM action (*:*)", 9),
            (r'"Effect"\s*:\s*"Allow".*"Action"\s*:\s*"\*"', "IAM policy allows all actions", 9),
        ]
        
        import re
        for file_path, modification in file_modifications.items():
            new_content = modification.get("new", "")
            
            for pattern, reason, weight in risky_patterns:
                if re.search(pattern, new_content, re.IGNORECASE):
                    risks.append(RiskFactor(
                        name=f"content_risk_{pattern[:20]}",
                        weight=weight,
                        triggered=True,
                        reason=f"{reason} in {file_path}",
                        category="content"
                    ))
        
        return risks
    
    def _determine_approval_requirements(
        self,
        score: int,
        thresholds: Dict[str, int],
        factors: List[RiskFactor]
    ) -> tuple:
        """Determine risk level and approval requirements based on score"""
        
        # Check for any critical security factors that override score
        has_critical_factor = any(
            f.triggered and f.weight >= 9 and f.category in ["policy", "content"]
            for f in factors
        )
        
        if score >= thresholds["critical_min_score"] or has_critical_factor:
            return (
                "critical",
                "#ef4444",  # Red
                False,
                "security_team",
                "Critical risk - requires security team approval and explicit override"
            )
        elif score >= thresholds["require_senior_min_score"]:
            return (
                "high",
                "#f97316",  # Orange
                False,
                "senior_engineer",
                "High risk - requires senior engineer or team lead approval"
            )
        elif score > thresholds["auto_approve_max_score"]:
            return (
                "medium",
                "#eab308",  # Yellow
                False,
                None,
                "Medium risk - requires team member approval"
            )
        else:
            return (
                "low",
                "#22c55e",  # Green
                True,
                None,
                "Low risk - eligible for auto-approval"
            )
    
    def get_risk_badge_html(self, risk_level: str, risk_score: int) -> str:
        """Generate HTML badge for risk level (for email notifications, etc.)"""
        colors = {
            "low": "#22c55e",
            "medium": "#eab308",
            "high": "#f97316",
            "critical": "#ef4444",
        }
        color = colors.get(risk_level, "#666666")
        return f'<span style="background-color: {color}15; color: {color}; padding: 2px 8px; border-radius: 4px; font-size: 12px;">{risk_level.upper()} ({risk_score})</span>'


# Global instance
risk_assessment_service = RiskAssessmentService()

