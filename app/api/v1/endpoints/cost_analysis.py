"""
Cost Analysis API Endpoint
Estimates infrastructure costs from Terraform code
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any, Optional
from app.services.cost_estimator import cost_estimator
from app.services.catalog import INFRASTRUCTURE_CATALOG
from app.utils.errors import sanitize_error_detail
import os

router = APIRouter()


@router.get("/estimate")
def estimate_costs(workspace_path: Optional[str] = None):
    """
    Estimate infrastructure costs from Terraform code
    
    Uses Infracost if available, falls back to simple estimation
    
    Returns:
    - Total monthly/annual costs
    - Per-resource cost breakdown
    - Cost optimization opportunities
    - Potential savings
    
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
        repo_dir = INFRASTRUCTURE_CATALOG.get("dir", ".")
        
        # Check if resources list is empty
        if not resources or len(resources) == 0:
            return {
                "ok": False,
                "error": "no_resources",
                "message": "No resources found in catalog. Please index a repository first.",
                "total_monthly_cost": 0,
                "total_annual_cost": 0,
                "currency": "USD",
                "method": "none",
                "resources": [],
                "optimizations": [],
                "total_potential_savings": 0,
                "repo": repo_dir,
                "sha": INFRASTRUCTURE_CATALOG.get("sha"),
                "scanned_at": INFRASTRUCTURE_CATALOG.get("indexed_at"),
                "total_resources": 0,
            }
        
        # Filter for AWS resources that can be cost-estimated
        costable_resource_types = {
            "aws_instance", "aws_db_instance", "aws_s3_bucket", "aws_ebs_volume",
            "aws_nat_gateway", "aws_lb", "aws_alb", "aws_elb", "aws_lambda_function",
            "aws_dynamodb_table", "aws_rds_cluster", "aws_elasticache_cluster"
        }
        
        aws_resources = [
            r for r in resources
            if isinstance(r, dict) and r.get("type", "").startswith("aws_")
        ]
        
        costable_resources = [
            r for r in aws_resources
            if isinstance(r, dict) and r.get("type") in costable_resource_types
        ]
        
        # Use provided workspace path or catalog directory
        if workspace_path and os.path.exists(workspace_path):
            repo_path = workspace_path
        else:
            repo_path = repo_dir
        
        # If no costable resources found, return informative response
        if not costable_resources:
            return {
                "ok": True,
                "method": "none",
                "message": f"Found {len(resources)} resources, but none are costable AWS resources. Cost estimation supports: {', '.join(sorted(costable_resource_types))}",
                "total_monthly_cost": 0,
                "total_annual_cost": 0,
                "currency": "USD",
                "resources": [],
                "optimizations": [],
                "total_potential_savings": 0,
                "repo": repo_dir,
                "sha": INFRASTRUCTURE_CATALOG.get("sha"),
                "scanned_at": INFRASTRUCTURE_CATALOG.get("indexed_at"),
                "total_resources": len(resources),
                "aws_resources_found": len(aws_resources),
                "costable_resources_found": 0,
            }
        
        # Run cost estimation with costable resources
        result = cost_estimator.estimate_costs(repo_path, costable_resources)
        
        # Check if estimation failed
        if not result.get("ok", True):
            # Return the error result with metadata
            result["repo"] = repo_dir
            result["sha"] = INFRASTRUCTURE_CATALOG.get("sha")
            result["scanned_at"] = INFRASTRUCTURE_CATALOG.get("indexed_at")
            result["total_resources"] = len(resources)
            result["aws_resources_found"] = len(aws_resources)
            result["costable_resources_found"] = len(costable_resources)
            return result
        
        # Add metadata
        result["repo"] = repo_dir
        result["sha"] = INFRASTRUCTURE_CATALOG.get("sha")
        result["scanned_at"] = INFRASTRUCTURE_CATALOG.get("indexed_at")
        result["total_resources"] = len(resources)
        result["aws_resources_found"] = len(aws_resources)
        result["costable_resources_found"] = len(costable_resources)
        
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "estimation_failed", "message": sanitize_error_detail(e, "Failed to estimate costs")}
        )


@router.get("/estimate/{resource_type}")
def estimate_resource_type_costs(resource_type: str):
    """
    Estimate costs for a specific resource type
    
    Args:
        resource_type: AWS resource type (e.g., aws_instance, aws_db_instance)
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
                "total_monthly_cost": 0,
                "resources": []
            }
        
        # Run simple estimation for filtered resources
        result = cost_estimator._estimate_simple(filtered_resources)
        result["resource_type"] = resource_type
        
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "estimation_failed", "message": sanitize_error_detail(e, "Failed to estimate costs")}
        )


@router.get("/optimizations")
def get_cost_optimizations(workspace_path: Optional[str] = None):
    """
    Get cost optimization opportunities
    
    Returns only the optimization recommendations without full cost breakdown
    """
    try:
        if not isinstance(INFRASTRUCTURE_CATALOG, dict):
            raise HTTPException(
                status_code=404,
                detail={"error": "not_indexed", "message": "Catalog not initialized"}
            )
        
        resources = INFRASTRUCTURE_CATALOG.get("resources", [])
        repo_dir = INFRASTRUCTURE_CATALOG.get("dir", ".")
        
        if workspace_path and os.path.exists(workspace_path):
            repo_path = workspace_path
        else:
            repo_path = repo_dir
        
        # Get full cost estimate
        result = cost_estimator.estimate_costs(repo_path, resources)
        
        # Return only optimizations
        return {
            "ok": True,
            "repo": repo_dir,
            "total_potential_savings": result.get("total_potential_savings", 0),
            "optimizations": result.get("optimizations", []),
            "current_monthly_cost": result.get("total_monthly_cost", 0),
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "optimization_failed", "message": sanitize_error_detail(e, "Failed to optimize costs")}
        )

