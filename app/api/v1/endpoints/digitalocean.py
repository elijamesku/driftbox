"""
DigitalOcean API endpoints for fetching and managing cloud resources.
Requires user to have connected their DigitalOcean account via OAuth.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, List, Dict, Any
from datetime import datetime
import requests

from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.database.connection import get_auth_db
from app.utils.errors import sanitize_error_detail
from sqlalchemy.orm import Session


router = APIRouter()

DO_API_BASE = "https://api.digitalocean.com/v2"


def get_do_token(user: UserAccount, db: Session) -> str:
    """
    Get valid DigitalOcean access token for user.
    Automatically refreshes if expired.
    """
    if not user.digitalocean_access_token:
        raise HTTPException(
            status_code=403,
            detail="DigitalOcean not connected. Please connect your DigitalOcean account in Settings."
        )
    
    # Check if token is expired and needs refresh
    if user.digitalocean_token_expires_at and user.digitalocean_token_expires_at < datetime.utcnow():
        # Token expired, try to refresh
        if user.digitalocean_refresh_token:
            import os
            DO_CLIENT_ID = os.getenv("DIGITALOCEAN_CLIENT_ID")
            DO_CLIENT_SECRET = os.getenv("DIGITALOCEAN_CLIENT_SECRET")
            
            if DO_CLIENT_ID and DO_CLIENT_SECRET:
                try:
                    response = requests.post(
                        "https://cloud.digitalocean.com/v1/oauth/token",
                        data={
                            "grant_type": "refresh_token",
                            "refresh_token": user.digitalocean_refresh_token,
                            "client_id": DO_CLIENT_ID,
                            "client_secret": DO_CLIENT_SECRET
                        },
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                        timeout=15
                    )
                    if response.status_code == 200:
                        from datetime import timedelta
                        token_data = response.json()
                        user.digitalocean_access_token = token_data.get("access_token")
                        user.digitalocean_refresh_token = token_data.get("refresh_token", user.digitalocean_refresh_token)
                        user.digitalocean_token_expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 2592000))
                        db.commit()
                except Exception:
                    pass  # Will fail below if token is truly invalid
    
    return user.digitalocean_access_token


def do_request(endpoint: str, token: str, method: str = "GET", json_data: dict = None, params: dict = None) -> dict:
    """Make authenticated request to DigitalOcean API."""
    url = f"{DO_API_BASE}{endpoint}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    try:
        if method == "GET":
            response = requests.get(url, headers=headers, params=params, timeout=30)
        elif method == "POST":
            response = requests.post(url, headers=headers, json=json_data, timeout=30)
        elif method == "DELETE":
            response = requests.delete(url, headers=headers, timeout=30)
        elif method == "PUT":
            response = requests.put(url, headers=headers, json=json_data, timeout=30)
        else:
            raise ValueError(f"Unsupported method: {method}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="DigitalOcean API timeout")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=sanitize_error_detail(e, "Failed to connect to DigitalOcean"))
    
    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="DigitalOcean token expired or invalid. Please reconnect.")
    
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Resource not found")
    
    if response.status_code >= 400:
        error_msg = response.json().get("message", "DigitalOcean API error")
        raise HTTPException(status_code=response.status_code, detail=error_msg)
    
    return response.json() if response.text else {}


# ===== Account & Billing =====

@router.get("/account", tags=["digitalocean"])
def get_account_info(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """Get DigitalOcean account information."""
    token = get_do_token(user, db)
    data = do_request("/account", token)
    return data.get("account", {})


@router.get("/balance", tags=["digitalocean"])
def get_account_balance(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """Get current account balance and usage."""
    token = get_do_token(user, db)
    data = do_request("/customers/my/balance", token)
    return data


# ===== Droplets =====

@router.get("/droplets", tags=["digitalocean"])
def list_droplets(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db),
    page: int = 1,
    per_page: int = 50
):
    """List all Droplets (virtual machines)."""
    token = get_do_token(user, db)
    data = do_request("/droplets", token, params={"page": page, "per_page": per_page})
    return {
        "droplets": data.get("droplets", []),
        "meta": data.get("meta", {}),
        "links": data.get("links", {})
    }


@router.get("/droplets/{droplet_id}", tags=["digitalocean"])
def get_droplet(
    droplet_id: int,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """Get details for a specific Droplet."""
    token = get_do_token(user, db)
    data = do_request(f"/droplets/{droplet_id}", token)
    return data.get("droplet", {})


# ===== Databases =====

@router.get("/databases", tags=["digitalocean"])
def list_databases(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """List all managed database clusters."""
    token = get_do_token(user, db)
    data = do_request("/databases", token)
    return {
        "databases": data.get("databases", [])
    }


@router.get("/databases/{database_id}", tags=["digitalocean"])
def get_database(
    database_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """Get details for a specific database cluster."""
    token = get_do_token(user, db)
    data = do_request(f"/databases/{database_id}", token)
    return data.get("database", {})


# ===== Kubernetes =====

@router.get("/kubernetes/clusters", tags=["digitalocean"])
def list_kubernetes_clusters(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """List all Kubernetes clusters."""
    token = get_do_token(user, db)
    data = do_request("/kubernetes/clusters", token)
    return {
        "kubernetes_clusters": data.get("kubernetes_clusters", [])
    }


@router.get("/kubernetes/clusters/{cluster_id}", tags=["digitalocean"])
def get_kubernetes_cluster(
    cluster_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """Get details for a specific Kubernetes cluster."""
    token = get_do_token(user, db)
    data = do_request(f"/kubernetes/clusters/{cluster_id}", token)
    return data.get("kubernetes_cluster", {})


# ===== Spaces (Object Storage) =====

@router.get("/spaces", tags=["digitalocean"])
def list_spaces(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """
    List all Spaces buckets.
    Note: This requires Spaces API access, which uses different endpoints.
    Returns regions where Spaces is available if direct listing fails.
    """
    token = get_do_token(user, db)
    # Spaces uses a different API - we list via regions that support it
    try:
        data = do_request("/regions", token)
        spaces_regions = [r for r in data.get("regions", []) if "storage" in r.get("features", [])]
        return {
            "spaces_regions": spaces_regions,
            "note": "Spaces buckets require region-specific Spaces API. Use DO console or s3cmd to list buckets."
        }
    except Exception:
        return {"spaces_regions": [], "note": "Could not fetch Spaces information"}


# ===== Load Balancers =====

@router.get("/load_balancers", tags=["digitalocean"])
def list_load_balancers(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """List all Load Balancers."""
    token = get_do_token(user, db)
    data = do_request("/load_balancers", token)
    return {
        "load_balancers": data.get("load_balancers", [])
    }


# ===== Volumes (Block Storage) =====

@router.get("/volumes", tags=["digitalocean"])
def list_volumes(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """List all Block Storage volumes."""
    token = get_do_token(user, db)
    data = do_request("/volumes", token)
    return {
        "volumes": data.get("volumes", [])
    }


# ===== VPCs =====

@router.get("/vpcs", tags=["digitalocean"])
def list_vpcs(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """List all VPCs."""
    token = get_do_token(user, db)
    data = do_request("/vpcs", token)
    return {
        "vpcs": data.get("vpcs", [])
    }


# ===== Firewalls =====

@router.get("/firewalls", tags=["digitalocean"])
def list_firewalls(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """List all Cloud Firewalls."""
    token = get_do_token(user, db)
    data = do_request("/firewalls", token)
    return {
        "firewalls": data.get("firewalls", [])
    }


# ===== Domains (DNS) =====

@router.get("/domains", tags=["digitalocean"])
def list_domains(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """List all DNS domains."""
    token = get_do_token(user, db)
    data = do_request("/domains", token)
    return {
        "domains": data.get("domains", [])
    }


# ===== Apps (App Platform) =====

@router.get("/apps", tags=["digitalocean"])
def list_apps(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """List all App Platform apps."""
    token = get_do_token(user, db)
    data = do_request("/apps", token)
    return {
        "apps": data.get("apps", [])
    }


@router.get("/apps/{app_id}", tags=["digitalocean"])
def get_app(
    app_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """Get details for a specific app."""
    token = get_do_token(user, db)
    data = do_request(f"/apps/{app_id}", token)
    return data.get("app", {})


# ===== Projects =====

@router.get("/projects", tags=["digitalocean"])
def list_projects(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """List all projects."""
    token = get_do_token(user, db)
    data = do_request("/projects", token)
    return {
        "projects": data.get("projects", [])
    }


# ===== Container Registry =====

@router.get("/registry", tags=["digitalocean"])
def get_registry(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """Get container registry info."""
    token = get_do_token(user, db)
    try:
        data = do_request("/registry", token)
        return data.get("registry", {})
    except HTTPException as e:
        if e.status_code == 404:
            return {"registry": None, "message": "No container registry configured"}
        raise


# ===== Monitoring & Alerts =====

@router.get("/monitoring/alerts", tags=["digitalocean"])
def list_alerts(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """List all monitoring alert policies."""
    token = get_do_token(user, db)
    data = do_request("/monitoring/alerts", token)
    return {
        "policies": data.get("policies", [])
    }


# ===== Summary Dashboard =====

@router.get("/summary", tags=["digitalocean"])
def get_infrastructure_summary(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """
    Get a summary of all DigitalOcean infrastructure.
    Aggregates counts from all resource types for the dashboard.
    """
    token = get_do_token(user, db)
    
    summary = {
        "account": None,
        "balance": None,
        "droplets": {"count": 0, "items": []},
        "databases": {"count": 0, "items": []},
        "kubernetes_clusters": {"count": 0, "items": []},
        "load_balancers": {"count": 0, "items": []},
        "volumes": {"count": 0, "items": []},
        "vpcs": {"count": 0, "items": []},
        "firewalls": {"count": 0, "items": []},
        "domains": {"count": 0, "items": []},
        "apps": {"count": 0, "items": []},
        "projects": {"count": 0, "items": []},
        "total_resources": 0,
        "estimated_monthly_cost": 0.0
    }
    
    # Fetch all resources in parallel-ish (sequential for simplicity)
    try:
        # Account
        account_data = do_request("/account", token)
        summary["account"] = account_data.get("account", {})
    except Exception:
        pass
    
    try:
        # Balance
        balance_data = do_request("/customers/my/balance", token)
        summary["balance"] = balance_data
    except Exception:
        pass
    
    try:
        # Droplets
        droplets_data = do_request("/droplets", token, params={"per_page": 200})
        droplets = droplets_data.get("droplets", [])
        summary["droplets"]["count"] = len(droplets)
        summary["droplets"]["items"] = [
            {"id": d["id"], "name": d["name"], "status": d["status"], "size_slug": d.get("size_slug"), "region": d.get("region", {}).get("slug")}
            for d in droplets
        ]
        summary["total_resources"] += len(droplets)
    except Exception:
        pass
    
    try:
        # Databases
        db_data = do_request("/databases", token)
        databases = db_data.get("databases", [])
        summary["databases"]["count"] = len(databases)
        summary["databases"]["items"] = [
            {"id": d["id"], "name": d["name"], "engine": d["engine"], "status": d["status"], "size": d.get("size")}
            for d in databases
        ]
        summary["total_resources"] += len(databases)
    except Exception:
        pass
    
    try:
        # Kubernetes
        k8s_data = do_request("/kubernetes/clusters", token)
        clusters = k8s_data.get("kubernetes_clusters", [])
        summary["kubernetes_clusters"]["count"] = len(clusters)
        summary["kubernetes_clusters"]["items"] = [
            {"id": c["id"], "name": c["name"], "status": c.get("status", {}).get("state"), "version": c.get("version")}
            for c in clusters
        ]
        summary["total_resources"] += len(clusters)
    except Exception:
        pass
    
    try:
        # Load Balancers
        lb_data = do_request("/load_balancers", token)
        lbs = lb_data.get("load_balancers", [])
        summary["load_balancers"]["count"] = len(lbs)
        summary["load_balancers"]["items"] = [
            {"id": lb["id"], "name": lb["name"], "status": lb["status"], "ip": lb.get("ip")}
            for lb in lbs
        ]
        summary["total_resources"] += len(lbs)
    except Exception:
        pass
    
    try:
        # Volumes
        vol_data = do_request("/volumes", token)
        volumes = vol_data.get("volumes", [])
        summary["volumes"]["count"] = len(volumes)
        summary["volumes"]["items"] = [
            {"id": v["id"], "name": v["name"], "size_gigabytes": v.get("size_gigabytes"), "region": v.get("region", {}).get("slug")}
            for v in volumes
        ]
        summary["total_resources"] += len(volumes)
    except Exception:
        pass
    
    try:
        # VPCs
        vpc_data = do_request("/vpcs", token)
        vpcs = vpc_data.get("vpcs", [])
        summary["vpcs"]["count"] = len(vpcs)
        summary["vpcs"]["items"] = [
            {"id": v["id"], "name": v["name"], "region": v.get("region")}
            for v in vpcs
        ]
        summary["total_resources"] += len(vpcs)
    except Exception:
        pass
    
    try:
        # Firewalls
        fw_data = do_request("/firewalls", token)
        firewalls = fw_data.get("firewalls", [])
        summary["firewalls"]["count"] = len(firewalls)
        summary["firewalls"]["items"] = [
            {"id": f["id"], "name": f["name"], "status": f.get("status")}
            for f in firewalls
        ]
        summary["total_resources"] += len(firewalls)
    except Exception:
        pass
    
    try:
        # Domains
        domain_data = do_request("/domains", token)
        domains = domain_data.get("domains", [])
        summary["domains"]["count"] = len(domains)
        summary["domains"]["items"] = [
            {"name": d["name"], "ttl": d.get("ttl")}
            for d in domains
        ]
        summary["total_resources"] += len(domains)
    except Exception:
        pass
    
    try:
        # Apps
        app_data = do_request("/apps", token)
        apps = app_data.get("apps", [])
        summary["apps"]["count"] = len(apps)
        summary["apps"]["items"] = [
            {"id": a["id"], "name": a.get("spec", {}).get("name"), "live_url": a.get("live_url")}
            for a in apps
        ]
        summary["total_resources"] += len(apps)
    except Exception:
        pass
    
    try:
        # Projects
        proj_data = do_request("/projects", token)
        projects = proj_data.get("projects", [])
        summary["projects"]["count"] = len(projects)
        summary["projects"]["items"] = [
            {"id": p["id"], "name": p["name"], "is_default": p.get("is_default")}
            for p in projects
        ]
    except Exception:
        pass
    
    # Calculate estimated monthly cost using the DigitalOcean provider
    from app.core.providers.digitalocean import digitalocean_provider_instance as do_provider
    
    estimated_cost = 0.0
    
    # Droplets cost
    for droplet in summary["droplets"]["items"]:
        size = droplet.get("size_slug", "s-1vcpu-1gb")
        cost = do_provider.MONTHLY_PRICING_DATA["digitalocean_droplet"].get(size, 6.00)
        estimated_cost += cost
    
    # Databases cost
    for db in summary["databases"]["items"]:
        size = db.get("size", "db-s-1vcpu-1gb")
        cost = do_provider.MONTHLY_PRICING_DATA["digitalocean_database_cluster"].get(size, 15.00)
        estimated_cost += cost
    
    # Load balancers ($12/month each)
    estimated_cost += summary["load_balancers"]["count"] * 12.00
    
    # Volumes ($0.10/GB)
    for vol in summary["volumes"]["items"]:
        size_gb = vol.get("size_gigabytes", 0)
        estimated_cost += size_gb * 0.10
    
    summary["estimated_monthly_cost"] = round(estimated_cost, 2)
    
    return summary


# ===== Detailed Cost Breakdown =====

@router.get("/costs", tags=["digitalocean"])
def get_detailed_cost_breakdown(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """
    Get detailed cost breakdown for all DigitalOcean resources.
    Returns itemized costs per resource with pricing details.
    """
    token = get_do_token(user, db)
    from app.core.providers.digitalocean import digitalocean_provider_instance as do_provider
    
    from datetime import datetime, timedelta
    
    # Calculate days in current billing period
    now = datetime.utcnow()
    if now.month == 12:
        next_month_start = datetime(now.year + 1, 1, 1)
    else:
        next_month_start = datetime(now.year, now.month + 1, 1)
    days_in_month = (next_month_start - datetime(now.year, now.month, 1)).days
    days_elapsed = now.day
    days_remaining = days_in_month - days_elapsed
    
    costs = {
        "summary": {
            "total_monthly": 0.0,
            "total_hourly": 0.0,
            "resource_count": 0
        },
        "by_category": [],
        "by_resource": [],
        "billing": None,
        "balance": None,
        "invoices": [],
        "subscription": None,
        "upcoming": {
            "projected_total": 0.0,
            "days_remaining": days_remaining,
            "days_elapsed": days_elapsed,
            "days_in_month": days_in_month,
            "daily_rate": 0.0,
            "next_billing_date": None
        }
    }
    
    # Get account balance (includes month-to-date usage from subscription)
    try:
        balance_data = do_request("/customers/my/balance", token)
        costs["balance"] = {
            "month_to_date_balance": balance_data.get("month_to_date_balance", "0.00"),
            "account_balance": balance_data.get("account_balance", "0.00"),
            "month_to_date_usage": balance_data.get("month_to_date_usage", "0.00"),
            "generated_at": balance_data.get("generated_at")
        }
    except Exception:
        pass
    
    # Get billing history (invoices, payments, credits)
    billing_history = []
    try:
        billing_data = do_request("/customers/my/billing_history", token, params={"per_page": 24})
        billing_history = billing_data.get("billing_history", [])
        print(f"[DO Costs] Billing history fetched: {len(billing_history)} items")
    except Exception as e:
        print(f"[DO Costs] Billing history error: {e}")
    
    costs["billing"] = billing_history
    
    # Extract subscription info from billing history
    if billing_history:
        invoices = [b for b in billing_history if b.get("type") == "Invoice"]
        payments = [b for b in billing_history if b.get("type") == "Payment"]
        
        if invoices:
            latest_invoice = invoices[0]
            costs["subscription"] = {
                "last_invoice_amount": latest_invoice.get("amount"),
                "last_invoice_date": latest_invoice.get("date"),
                "description": latest_invoice.get("description"),
                "invoice_id": latest_invoice.get("invoice_id"),
                "invoice_uuid": latest_invoice.get("invoice_uuid")
            }
    
    # Get detailed invoices with line items (actual subscription charges)
    detailed_invoices = []
    try:
        invoices_data = do_request("/customers/my/invoices", token, params={"per_page": 6})
        invoice_list = invoices_data.get("invoices", [])
        print(f"[DO Costs] Invoices fetched: {len(invoice_list)} items")
        
        for inv in invoice_list[:3]:  # Get details for last 3 invoices
            inv_detail = {
                "invoice_uuid": inv.get("invoice_uuid"),
                "invoice_period": inv.get("invoice_period"),
                "amount": inv.get("amount")
            }
            
            # Try to get detailed breakdown
            try:
                inv_uuid = inv.get("invoice_uuid")
                if inv_uuid:
                    summary = do_request(f"/customers/my/invoices/{inv_uuid}/summary", token)
                    inv_detail["product_charges"] = summary.get("product_charges", {})
                    inv_detail["overages"] = summary.get("overages", {})
                    inv_detail["taxes"] = summary.get("taxes")
                    inv_detail["credits_and_adjustments"] = summary.get("credits_and_adjustments", {})
            except Exception as e:
                print(f"[DO Costs] Invoice summary error for {inv.get('invoice_uuid')}: {e}")
            
            detailed_invoices.append(inv_detail)
    except Exception as e:
        print(f"[DO Costs] Invoices fetch error: {e}")
    
    costs["invoices"] = detailed_invoices
    
    # If no billing history, try to build it from invoices
    if not billing_history and detailed_invoices:
        costs["billing"] = [
            {
                "type": "Invoice",
                "date": inv.get("invoice_period", "").split(" to ")[0] if inv.get("invoice_period") else None,
                "description": f"Invoice for {inv.get('invoice_period', 'billing period')}",
                "amount": inv.get("amount"),
                "invoice_uuid": inv.get("invoice_uuid")
            }
            for inv in detailed_invoices
        ]
    
    category_costs = {}
    resource_costs = []
    
    # Droplets
    try:
        droplets_data = do_request("/droplets", token, params={"per_page": 200})
        droplets = droplets_data.get("droplets", [])
        droplet_total = 0.0
        
        for d in droplets:
            size = d.get("size_slug", "s-1vcpu-1gb")
            monthly = do_provider.MONTHLY_PRICING_DATA["digitalocean_droplet"].get(size, 6.00)
            hourly = monthly / 730  # Approx hours per month
            droplet_total += monthly
            
            resource_costs.append({
                "id": d["id"],
                "name": d["name"],
                "type": "Droplet",
                "category": "Compute",
                "size": size,
                "region": d.get("region", {}).get("slug", "unknown"),
                "status": d.get("status"),
                "monthly_cost": round(monthly, 2),
                "hourly_cost": round(hourly, 4),
                "created_at": d.get("created_at"),
                "specs": {
                    "vcpus": d.get("vcpus"),
                    "memory": d.get("memory"),
                    "disk": d.get("disk")
                }
            })
        
        if droplet_total > 0:
            category_costs["Droplets"] = {"total": droplet_total, "count": len(droplets), "color": "#0080FF"}
    except Exception:
        pass
    
    # Databases
    try:
        db_data = do_request("/databases", token)
        databases = db_data.get("databases", [])
        db_total = 0.0
        
        for d in databases:
            size = d.get("size", "db-s-1vcpu-1gb")
            monthly = do_provider.MONTHLY_PRICING_DATA["digitalocean_database_cluster"].get(size, 15.00)
            hourly = monthly / 730
            db_total += monthly
            
            resource_costs.append({
                "id": d["id"],
                "name": d["name"],
                "type": "Database",
                "category": "Database",
                "size": size,
                "engine": d.get("engine"),
                "region": d.get("region"),
                "status": d.get("status"),
                "monthly_cost": round(monthly, 2),
                "hourly_cost": round(hourly, 4),
                "created_at": d.get("created_at"),
                "specs": {
                    "num_nodes": d.get("num_nodes"),
                    "version": d.get("version")
                }
            })
        
        if db_total > 0:
            category_costs["Databases"] = {"total": db_total, "count": len(databases), "color": "#22c55e"}
    except Exception:
        pass
    
    # Kubernetes
    try:
        k8s_data = do_request("/kubernetes/clusters", token)
        clusters = k8s_data.get("kubernetes_clusters", [])
        k8s_total = 0.0
        
        for c in clusters:
            # K8s pricing based on node pools
            node_pools = c.get("node_pools", [])
            cluster_cost = 0.0
            for pool in node_pools:
                size = pool.get("size", "s-2vcpu-4gb")
                count = pool.get("count", 1)
                monthly = do_provider.MONTHLY_PRICING_DATA["digitalocean_droplet"].get(size, 24.00) * count
                cluster_cost += monthly
            
            # Add control plane cost ($0 for basic, estimate $12 for HA)
            k8s_total += cluster_cost
            
            resource_costs.append({
                "id": c["id"],
                "name": c["name"],
                "type": "Kubernetes",
                "category": "Compute",
                "region": c.get("region"),
                "status": c.get("status", {}).get("state"),
                "monthly_cost": round(cluster_cost, 2),
                "hourly_cost": round(cluster_cost / 730, 4),
                "created_at": c.get("created_at"),
                "specs": {
                    "version": c.get("version"),
                    "node_pools": len(node_pools)
                }
            })
        
        if k8s_total > 0:
            category_costs["Kubernetes"] = {"total": k8s_total, "count": len(clusters), "color": "#3b82f6"}
    except Exception:
        pass
    
    # Load Balancers ($12/month each)
    try:
        lb_data = do_request("/load_balancers", token)
        lbs = lb_data.get("load_balancers", [])
        lb_total = len(lbs) * 12.00
        
        for lb in lbs:
            resource_costs.append({
                "id": lb["id"],
                "name": lb["name"],
                "type": "Load Balancer",
                "category": "Networking",
                "region": lb.get("region", {}).get("slug") if isinstance(lb.get("region"), dict) else lb.get("region"),
                "status": lb.get("status"),
                "monthly_cost": 12.00,
                "hourly_cost": round(12.00 / 730, 4),
                "created_at": lb.get("created_at"),
                "specs": {
                    "ip": lb.get("ip"),
                    "algorithm": lb.get("algorithm")
                }
            })
        
        if lb_total > 0:
            category_costs["Load Balancers"] = {"total": lb_total, "count": len(lbs), "color": "#8b5cf6"}
    except Exception:
        pass
    
    # Volumes ($0.10/GB/month)
    try:
        vol_data = do_request("/volumes", token)
        volumes = vol_data.get("volumes", [])
        vol_total = 0.0
        
        for v in volumes:
            size_gb = v.get("size_gigabytes", 0)
            monthly = size_gb * 0.10
            vol_total += monthly
            
            resource_costs.append({
                "id": v["id"],
                "name": v["name"],
                "type": "Volume",
                "category": "Storage",
                "size": f"{size_gb} GB",
                "region": v.get("region", {}).get("slug") if isinstance(v.get("region"), dict) else v.get("region"),
                "monthly_cost": round(monthly, 2),
                "hourly_cost": round(monthly / 730, 4),
                "created_at": v.get("created_at"),
                "specs": {
                    "size_gigabytes": size_gb,
                    "filesystem_type": v.get("filesystem_type")
                }
            })
        
        if vol_total > 0:
            category_costs["Volumes"] = {"total": vol_total, "count": len(volumes), "color": "#f97316"}
    except Exception:
        pass
    
    # Spaces (if available) - estimate $5/month base
    try:
        # Spaces API requires separate endpoints, approximate with $5/space
        pass
    except Exception:
        pass
    
    # Apps (App Platform)
    try:
        app_data = do_request("/apps", token)
        apps = app_data.get("apps", [])
        app_total = 0.0
        
        for a in apps:
            # Basic app estimate - actual pricing varies by spec
            monthly = 5.00  # Minimum app platform cost
            app_total += monthly
            
            resource_costs.append({
                "id": a["id"],
                "name": a.get("spec", {}).get("name", "Unnamed App"),
                "type": "App",
                "category": "App Platform",
                "monthly_cost": round(monthly, 2),
                "hourly_cost": round(monthly / 730, 4),
                "created_at": a.get("created_at"),
                "specs": {
                    "live_url": a.get("live_url")
                }
            })
        
        if app_total > 0:
            category_costs["Apps"] = {"total": app_total, "count": len(apps), "color": "#ec4899"}
    except Exception:
        pass
    
    # Build category breakdown
    for name, data in category_costs.items():
        costs["by_category"].append({
            "name": name,
            "total": round(data["total"], 2),
            "count": data["count"],
            "color": data["color"]
        })
    
    # Sort by cost descending
    costs["by_category"].sort(key=lambda x: x["total"], reverse=True)
    costs["by_resource"] = sorted(resource_costs, key=lambda x: x["monthly_cost"], reverse=True)
    
    # Calculate totals
    total_monthly = sum(c["total"] for c in costs["by_category"])
    costs["summary"]["total_monthly"] = round(total_monthly, 2)
    costs["summary"]["total_hourly"] = round(total_monthly / 730, 4)
    costs["summary"]["resource_count"] = len(resource_costs)
    
    # Calculate upcoming/projected bill
    daily_rate = total_monthly / days_in_month if days_in_month > 0 else 0
    
    # If we have month-to-date usage from balance, use that for more accurate projection
    mtd_usage = 0.0
    if costs["balance"] and costs["balance"].get("month_to_date_usage"):
        try:
            mtd_usage = float(costs["balance"]["month_to_date_usage"])
            # Calculate daily rate based on actual usage
            if days_elapsed > 0:
                daily_rate = mtd_usage / days_elapsed
        except (ValueError, TypeError):
            pass
    
    # Project remaining charges
    projected_remaining = daily_rate * days_remaining
    projected_total = mtd_usage + projected_remaining if mtd_usage > 0 else total_monthly
    
    # Calculate next billing date (1st of next month)
    if now.month == 12:
        next_billing = datetime(now.year + 1, 1, 1)
    else:
        next_billing = datetime(now.year, now.month + 1, 1)
    
    costs["upcoming"] = {
        "projected_total": round(projected_total, 2),
        "projected_remaining": round(projected_remaining, 2),
        "days_remaining": days_remaining,
        "days_elapsed": days_elapsed,
        "days_in_month": days_in_month,
        "daily_rate": round(daily_rate, 2),
        "next_billing_date": next_billing.strftime("%Y-%m-%d"),
        "month_to_date_actual": round(mtd_usage, 2) if mtd_usage > 0 else None
    }
    
    return costs

