"""
Billing and usage tracking endpoints for monetization.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional
from datetime import datetime
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.services.auth import require_authentication
from app.services.usage_tracker import usage_tracker
from app.database.connection import acquire_auth_session
from app.database.models import UserAccount
from app.models.team import Team
from app.services.team_service import TeamService
import stripe
import os

router = APIRouter()

# Stripe configuration
stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
STRIPE_WEBHOOK_SECRET = os.getenv('STRIPE_WEBHOOK_SECRET')


class UsageResponse(BaseModel):
    user_id: str
    period_start: str
    period_end: str
    total_events: int
    by_type: dict
    by_day: dict
    estimated_cost_usd: float


@router.get("/usage")
def get_usage(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user = Depends(require_authentication)
):
    """
    Get usage statistics for current user.
    
    Query params:
        start_date: ISO format (YYYY-MM-DD), default: 30 days ago
        end_date: ISO format (YYYY-MM-DD), default: now
    """
    user_id = user.get("sub")
    
    start = datetime.fromisoformat(start_date) if start_date else None
    end = datetime.fromisoformat(end_date) if end_date else None
    
    usage = usage_tracker.get_usage(user_id, start, end)
    
    return {
        "ok": True,
        "usage": usage
    }


@router.get("/usage/{user_id}")
def get_user_usage(
    user_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    admin_user = Depends(require_authentication)
):
    """
    Get usage for specific user (admin only).
    
    Args:
        user_id: Target user ID
        start_date: Start date
        end_date: End date
    """
    # TODO: Check if admin_user has admin privileges
    # For now, allow any authenticated user
    
    start = datetime.fromisoformat(start_date) if start_date else None
    end = datetime.fromisoformat(end_date) if end_date else None
    
    usage = usage_tracker.get_usage(user_id, start, end)
    
    return {
        "ok": True,
        "usage": usage
    }


@router.get("/billing/report")
def get_billing_report(
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2020, le=2100),
    user = Depends(require_authentication)
):
    """
    Get monthly billing report.
    
    Query params:
        month: Month (1-12), default: current month
        year: Year, default: current year
    """
    user_id = user.get("sub")
    
    report = usage_tracker.get_billing_report(user_id, month, year)
    
    return {
        "ok": True,
        "report": report
    }


@router.get("/usage/limits")
def check_usage_limits(
    user = Depends(require_authentication)
):
    """
    Check current usage against limits.
    
    Returns current usage and remaining quota for each event type.
    """
    user_id = user.get("sub")
    tier = user.get("tier", "free")
    
    # Check limits for each event type
    event_types = [
        "completion_request",
        "chat_message",
        "workspace_analysis"
    ]
    
    limits = {}
    for event_type in event_types:
        limit_info = usage_tracker.check_limit(user_id, event_type, tier)
        limits[event_type] = limit_info
    
    return {
        "ok": True,
        "user_id": user_id,
        "tier": tier,
        "limits": limits
    }


@router.post("/usage/track")
def track_usage_event(
    event_type: str,
    metadata: Optional[dict] = None,
    user = Depends(require_authentication)
):
    """
    Manually track a usage event (usually done automatically).
    
    Body:
        event_type: Type of event
        metadata: Optional event data
    """
    user_id = user.get("sub")
    
    usage_tracker.track_event(user_id, event_type, metadata)
    
    return {
        "ok": True,
        "message": "Event tracked",
        "event_type": event_type
    }


@router.get("/pricing")
def get_pricing():
    """
    Get current pricing information (public endpoint).
    """
    return {
        "ok": True,
        "pricing": {
            "free": {
                "price_usd": 0,
                "limits": {
                    "completions_per_day": 50,
                    "chat_messages_per_day": 20,
                    "workspace_analyses_per_day": 5
                }
            },
            "pro": {
                "price_usd": 29,
                "limits": {
                    "completions_per_day": 1000,
                    "chat_messages_per_day": 500,
                    "workspace_analyses_per_day": 100
                },
                "overage_pricing": {
                    "completion_request": 0.001,
                    "chat_message": 0.005,
                    "workspace_analysis": 0.01
                }
            },
            "enterprise": {
                "price_usd": "custom",
                "limits": "unlimited",
                "features": [
                    "Dedicated support",
                    "SSO integration",
                    "Custom deployment",
                    "SLA guarantee"
                ]
            }
        }
    }


@router.get("/billing/invoice/{month}/{year}")
def get_invoice(
    month: int,
    year: int,
    user = Depends(require_authentication)
):
    """
    Get detailed invoice for a specific month.
    
    Args:
        month: Month (1-12)
        year: Year
    """
    user_id = user.get("sub")
    
    report = usage_tracker.get_billing_report(user_id, month, year)
    
    # Format as invoice
    invoice = {
        "invoice_number": f"{user_id}-{year}{month:02d}",
        "user_id": user_id,
        "billing_period": report["billing_period"],
        "issued_date": datetime.utcnow().isoformat(),
        "due_date": (datetime.utcnow()).isoformat(),  # Immediate
        "line_items": report["itemized"],
        "subtotal": report["total_cost_usd"],
        "tax": 0,  # TODO: Calculate tax based on location
        "total": report["total_cost_usd"],
        "currency": "USD",
        "status": "pending"
    }
    
    return {
        "ok": True,
        "invoice": invoice
    }


# ========== Team Billing Endpoints ==========

@router.post("/teams/{team_id}/subscribe")
async def create_team_subscription(
    team_id: str,
    plan: str,  # 'team' or 'enterprise'
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Create or upgrade team subscription via Stripe.
    Requires admin role.
    """
    service = TeamService(db)
    
    # Check permission
    if not service.check_user_permission(team_id, current_user.id, 'manage_billing'):
        raise HTTPException(
            status_code=403,
            detail="Only admins can manage billing"
        )
    
    team = service.get_team(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    
    # Pricing
    prices = {
        'team': {
            'price_id': os.getenv('STRIPE_TEAM_PRICE_ID', 'price_team'),
            'amount': 999,  # $999/mo
            'seats': 10
        },
        'enterprise': {
            'price_id': os.getenv('STRIPE_ENTERPRISE_PRICE_ID', 'price_enterprise'),
            'amount': 2999,  # $2999/mo
            'seats': 999
        }
    }
    
    if plan not in prices:
        raise HTTPException(status_code=400, detail="Invalid plan")
    
    try:
        # Create or get Stripe customer
        if not team.stripe_customer_id:
            customer = stripe.Customer.create(
                email=team.billing_email or current_user.email,
                name=team.name,
                metadata={
                    'team_id': team.id,
                    'team_name': team.name
                }
            )
            team.stripe_customer_id = customer.id
            db.commit()
        
        # Create checkout session
        checkout_session = stripe.checkout.Session.create(
            customer=team.stripe_customer_id,
            payment_method_types=['card'],
            line_items=[{
                'price': prices[plan]['price_id'],
                'quantity': 1,
            }],
            mode='subscription',
            success_url=f"https://driftbox.io/teams/{team_id}?billing=success",
            cancel_url=f"https://driftbox.io/teams/{team_id}?billing=cancelled",
            metadata={
                'team_id': team.id,
                'plan': plan
            }
        )
        
        return {
            "ok": True,
            "checkout_url": checkout_session.url,
            "session_id": checkout_session.id
        }
        
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/teams/{team_id}/billing")
async def get_team_billing(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get team billing information.
    Requires admin role.
    """
    service = TeamService(db)
    
    # Check permission
    if not service.check_user_permission(team_id, current_user.id, 'manage_billing'):
        raise HTTPException(
            status_code=403,
            detail="Only admins can view billing"
        )
    
    team = service.get_team(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    
    billing_info = {
        'team_id': team.id,
        'plan': team.plan,
        'seats_limit': team.seats_limit,
        'billing_email': team.billing_email,
        'has_payment_method': bool(team.stripe_customer_id)
    }
    
    # Get Stripe subscription details if exists
    if team.stripe_subscription_id:
        try:
            subscription = stripe.Subscription.retrieve(team.stripe_subscription_id)
            billing_info.update({
                'subscription_status': subscription.status,
                'current_period_end': subscription.current_period_end,
                'cancel_at_period_end': subscription.cancel_at_period_end,
                'amount': subscription.plan.amount / 100,
                'currency': subscription.plan.currency
            })
        except stripe.error.StripeError as e:
            billing_info['error'] = str(e)
    
    return billing_info


@router.post("/teams/{team_id}/cancel-subscription")
async def cancel_team_subscription(
    team_id: str,
    immediate: bool = False,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Cancel team subscription.
    Requires admin role.
    
    Args:
        immediate: If True, cancel immediately. If False, cancel at period end.
    """
    service = TeamService(db)
    
    # Check permission
    if not service.check_user_permission(team_id, current_user.id, 'manage_billing'):
        raise HTTPException(
            status_code=403,
            detail="Only admins can manage billing"
        )
    
    team = service.get_team(team_id)
    if not team or not team.stripe_subscription_id:
        raise HTTPException(status_code=404, detail="No active subscription")
    
    try:
        if immediate:
            subscription = stripe.Subscription.delete(team.stripe_subscription_id)
        else:
            subscription = stripe.Subscription.modify(
                team.stripe_subscription_id,
                cancel_at_period_end=True
            )
        
        return {
            "ok": True,
            "message": "Subscription cancelled" if immediate else "Subscription will cancel at period end",
            "subscription_status": subscription.status
        }
        
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request, db: Session = Depends(acquire_auth_session)):
    """
    Handle Stripe webhooks for subscription events.
    """
    payload = await request.body()
    sig_header = request.headers.get('stripe-signature')
    
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, STRIPE_WEBHOOK_SECRET
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    # Handle subscription events
    if event['type'] == 'checkout.session.completed':
        session = event['data']['object']
        team_id = session['metadata'].get('team_id')
        plan = session['metadata'].get('plan')
        
        if team_id:
            team = db.query(Team).filter(Team.id == team_id).first()
            if team:
                team.plan = plan
                team.stripe_subscription_id = session.get('subscription')
                team.seats_limit = 10 if plan == 'team' else 999
                db.commit()
    
    elif event['type'] == 'customer.subscription.deleted':
        subscription = event['data']['object']
        team = db.query(Team).filter(
            Team.stripe_subscription_id == subscription['id']
        ).first()
        
        if team:
            team.plan = 'free'
            team.seats_limit = 2
            team.stripe_subscription_id = None
            db.commit()
    
    elif event['type'] == 'customer.subscription.updated':
        subscription = event['data']['object']
        team = db.query(Team).filter(
            Team.stripe_subscription_id == subscription['id']
        ).first()
        
        if team and subscription['status'] != 'active':
            # Subscription is no longer active (cancelled, unpaid, etc.)
            if subscription['status'] in ['canceled', 'unpaid']:
                team.plan = 'free'
                team.seats_limit = 2
                db.commit()
    
    return {"ok": True}

