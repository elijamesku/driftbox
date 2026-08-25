"""
Cost tracking and budget alert endpoints.
Provides infrastructure cost estimation and budget monitoring.
"""
from fastapi import APIRouter, HTTPException
from typing import Optional
from pydantic import BaseModel
from app.services.cost_tracker import cost_tracker
from app.services.catalog import CATALOG
from app.integrations.slack import slack_notifier


router = APIRouter()


class BudgetAlertRequest(BaseModel):
    budget_limit: float
    current_cost: Optional[float] = None


class CostEstimateRequest(BaseModel):
    resource_type: str
    config: dict


@router.get("/costs/estimate")
def estimate_current_costs():
    """
    Estimate monthly costs for all resources in the current catalog.
    Requires the catalog to be indexed first via /index-repo.
    """
    if not CATALOG.get("resources"):
        raise HTTPException(
            status_code=400,
            detail={"error": "not_indexed", "message": "Run /index-repo first to index your infrastructure"}
        )
    
    cost_summary = cost_tracker.estimate_catalog_cost(CATALOG)
    
    return {
        "ok": True,
        "cost_summary": cost_summary,
    }


@router.post("/costs/estimate-resource")
def estimate_resource_cost(req: CostEstimateRequest):
    """
    Estimate monthly cost for a single resource.
    
    Body:
        resource_type: Terraform resource type (e.g., "aws_s3_bucket")
        config: Resource configuration dict
    """
    estimated_cost = cost_tracker.estimate_resource_cost(req.resource_type, req.config)
    
    if estimated_cost is None:
        return {
            "ok": True,
            "resource_type": req.resource_type,
            "estimated_monthly_cost": None,
            "currency": "USD",
            "message": "Cost estimation not available for this resource type",
        }
    
    return {
        "ok": True,
        "resource_type": req.resource_type,
        "estimated_monthly_cost": round(estimated_cost, 2),
        "currency": "USD",
    }


@router.post("/costs/estimate-change-impact")
def estimate_change_impact(proposed_changes: dict):
    """
    Estimate cost impact of proposed infrastructure changes.
    
    Body:
        A dict with "ops" key containing list of IR operations (same format as EditRepoRequest.ir)
    
    Returns:
        Cost delta analysis showing additions, removals, and net impact
    """
    if not CATALOG.get("resources"):
        raise HTTPException(
            status_code=400,
            detail={"error": "not_indexed", "message": "Run /index-repo first to index your infrastructure"}
        )
    
    ops = proposed_changes.get("ops", [])
    if not ops:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_request", "message": "No operations provided in 'ops' field"}
        )
    
    impact = cost_tracker.estimate_change_cost_impact(CATALOG, ops)
    
    return {
        "ok": True,
        "cost_impact": impact,
    }


@router.post("/costs/check-budget-alert")
def check_budget_alert(req: BudgetAlertRequest):
    """
    Check if current costs exceed budget alert threshold.
    
    Body:
        budget_limit: Monthly budget limit in USD
        current_cost: Optional. If not provided, estimates from current catalog.
    
    Returns:
        Alert information if threshold exceeded, otherwise None
    """
    # If current_cost not provided, estimate from catalog
    if req.current_cost is None:
        if not CATALOG.get("resources"):
            raise HTTPException(
                status_code=400,
                detail={"error": "not_indexed", "message": "Run /index-repo first or provide current_cost"}
            )
        cost_summary = cost_tracker.estimate_catalog_cost(CATALOG)
        current_cost = cost_summary["total_estimated_monthly_cost"]
    else:
        current_cost = req.current_cost
    
    alert = cost_tracker.check_budget_alert(current_cost, req.budget_limit)
    
    if alert:
        # Send Slack notification for budget alert
        try:
            percentage = (current_cost / req.budget_limit * 100) if req.budget_limit > 0 else 0
            slack_notifier.notify_cost_alert(
                current_cost=current_cost,
                budget_limit=req.budget_limit,
                percentage=percentage
            )
        except Exception as e:
            print(f"⚠️  Slack notification failed: {e}")
        
        return {
            "ok": True,
            "alert": alert,
            "message": alert["message"],
        }
    else:
        return {
            "ok": True,
            "alert": None,
            "message": f"Current cost (${current_cost:.2f}) is within budget threshold",
            "current_cost": round(current_cost, 2),
            "budget_limit": round(req.budget_limit, 2),
            "usage_percentage": round((current_cost / req.budget_limit * 100) if req.budget_limit > 0 else 0, 1),
        }


@router.get("/costs/breakdown")
def get_cost_breakdown():
    """
    Get detailed cost breakdown for all resources in catalog.
    Includes per-resource costs sorted by highest cost first.
    """
    if not CATALOG.get("resources"):
        raise HTTPException(
            status_code=400,
            detail={"error": "not_indexed", "message": "Run /index-repo first to index your infrastructure"}
        )
    
    cost_summary = cost_tracker.estimate_catalog_cost(CATALOG)
    
    # Calculate percentage of total for each resource
    total = cost_summary["total_estimated_monthly_cost"]
    for item in cost_summary["breakdown"]:
        cost = item.get("estimated_monthly_cost")
        if cost is not None and total > 0:
            item["percentage_of_total"] = round((cost / total) * 100, 1)
        else:
            item["percentage_of_total"] = 0
    
    return {
        "ok": True,
        "total_cost": cost_summary["total_estimated_monthly_cost"],
        "currency": "USD",
        "breakdown": cost_summary["breakdown"],
        "resource_count": cost_summary["resource_count"],
        "estimated_count": cost_summary["estimated_count"],
        "unknown_count": cost_summary["unknown_count"],
    }

