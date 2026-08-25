"""
Security Scanning API Endpoint
Analyzes Terraform code for security vulnerabilities
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from app.services.security_scanner import security_scanner
from app.services.catalog import INFRASTRUCTURE_CATALOG
from app.utils.errors import sanitize_error_detail

router = APIRouter()


@router.get("/scan")
def scan_security():
    """
    Scan infrastructure for security vulnerabilities
    
    Returns comprehensive security analysis including:
    - Critical/High/Medium/Low severity issues
    - Compliance impact (SOC2, HIPAA, PCI-DSS)
    - Remediation steps
    - Security score
    
    NO AWS credentials needed - pure code analysis
    """
    try:
        # Check if catalog exists
        if not isinstance(INFRASTRUCTURE_CATALOG, dict):
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "not_indexed",
                    "message": "Catalog not initialized. Select a repository first."
                }
            )
        
        resources = INFRASTRUCTURE_CATALOG.get("resources", [])
        if not resources or not isinstance(resources, list):
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "not_indexed",
                    "message": "No resources found. Select a repository with Terraform code."
                }
            )
        
        # Run security scan
        issues = security_scanner.scan_resources(resources)
        summary = security_scanner.generate_summary(issues)
        
        # Group issues by severity
        issues_by_severity = {
            "critical": [],
            "high": [],
            "medium": [],
            "low": []
        }
        
        for issue in issues:
            issues_by_severity[issue.severity].append(issue.to_dict())
        
        # Group issues by category
        issues_by_category = {}
        for issue in issues:
            category = issue.category
            if category not in issues_by_category:
                issues_by_category[category] = []
            issues_by_category[category].append(issue.to_dict())
        
        return {
            "ok": True,
            "repo": INFRASTRUCTURE_CATALOG.get("dir", "."),
            "sha": INFRASTRUCTURE_CATALOG.get("sha"),
            "scanned_at": INFRASTRUCTURE_CATALOG.get("indexed_at"),
            "summary": summary,
            "issues": [issue.to_dict() for issue in issues],
            "issues_by_severity": issues_by_severity,
            "issues_by_category": issues_by_category,
            "total_resources_scanned": len(resources),
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "scan_failed", "message": sanitize_error_detail(e, "Failed to scan security")}
        )


@router.get("/scan/{resource_type}")
def scan_resource_type(resource_type: str):
    """
    Scan a specific resource type for security issues
    
    Args:
        resource_type: AWS resource type (e.g., aws_s3_bucket)
    """
    try:
        if not isinstance(INFRASTRUCTURE_CATALOG, dict):
            raise HTTPException(status_code=404, detail={"error": "not_indexed"})
        
        resources = INFRASTRUCTURE_CATALOG.get("resources", [])
        
        # Filter to specific resource type
        filtered_resources = [
            r for r in resources 
            if isinstance(r, dict) and r.get("type") == resource_type
        ]
        
        if not filtered_resources:
            return {
                "ok": True,
                "resource_type": resource_type,
                "message": f"No {resource_type} resources found",
                "issues": [],
                "summary": {
                    "total_issues": 0,
                    "by_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0},
                    "security_score": 100,
                    "status": "pass"
                }
            }
        
        # Run security scan
        issues = security_scanner.scan_resources(filtered_resources)
        summary = security_scanner.generate_summary(issues)
        
        return {
            "ok": True,
            "resource_type": resource_type,
            "total_resources": len(filtered_resources),
            "summary": summary,
            "issues": [issue.to_dict() for issue in issues],
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "scan_failed", "message": sanitize_error_detail(e, "Failed to scan security")}
        )

