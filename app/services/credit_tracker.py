"""
User credit management service for daily usage quotas.
Users receive daily credit allocations, deducted per action like chat interactions.
"""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.database.models import UserAccount, ActivityLog
from fastapi import HTTPException, status


# Per-action credit cost configuration
ACTION_CREDIT_COSTS = {
    "chat_message": 1,
    "completion_request": 2,
    "terraform_generate": 3,
    "terraform_validate": 1,
    "cost_estimate": 1,
    "diff_approval": 1,
}

# Daily credit allocation by subscription tier
FREE_SUBSCRIPTION_DAILY_CREDITS = 100
PROFESSIONAL_SUBSCRIPTION_DAILY_CREDITS = 500


def refresh_daily_credits_if_expired(account: UserAccount, db_session: Session) -> UserAccount:
    """
    Verify if credits require daily reset (new calendar day).
    Returns refreshed user account object.
    """
    current_timestamp = datetime.utcnow()
    
    # Initial account setup - configure credit allocation
    if account.credits_reset_at is None:
        account.daily_credits = FREE_SUBSCRIPTION_DAILY_CREDITS if account.tier == "free" else PROFESSIONAL_SUBSCRIPTION_DAILY_CREDITS
        account.credits_reset_at = current_timestamp + timedelta(days=1)
        db_session.commit()
        db_session.refresh(account)
        return account
    
    # Verify if 24-hour reset period elapsed
    if current_timestamp >= account.credits_reset_at:
        # Reset credit allocation based on subscription tier
        if account.tier == "free":
            account.daily_credits = FREE_SUBSCRIPTION_DAILY_CREDITS
        elif account.tier == "pro":
            account.daily_credits = PROFESSIONAL_SUBSCRIPTION_DAILY_CREDITS
        else:
            account.daily_credits = FREE_SUBSCRIPTION_DAILY_CREDITS
        
        # Schedule next credit reset timestamp
        account.credits_reset_at = current_timestamp + timedelta(days=1)
        db_session.commit()
        db_session.refresh(account)
    
    return account


def validate_and_deduct_action_credits(account: UserAccount, user_action: str, db_session: Session) -> UserAccount:
    """
    Validate sufficient credit balance and deduct for action.
    Raises HTTPException if insufficient credits available.
    """
    # Refresh daily credits if reset period expired
    account = refresh_daily_credits_if_expired(account, db_session)
    
    # Determine credit cost for requested action
    action_credit_cost = ACTION_CREDIT_COSTS.get(user_action, 1)
    
    # Validate sufficient credit balance
    if account.daily_credits < action_credit_cost:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "insufficient_credits",
                "message": f"Insufficient credits. Available: {account.daily_credits}, Required: {action_credit_cost}.",
                "required": action_credit_cost,
                "available": account.daily_credits,
                "reset_at": account.credits_reset_at.isoformat() if account.credits_reset_at else None,
            }
        )
    
    # Deduct action cost from daily credit balance
    account.daily_credits -= action_credit_cost
    account.total_credits_used += action_credit_cost
    
    # Log credit deduction event
    credit_usage_log = ActivityLog(
        user_id=account.id,
        event_type=user_action,
        event_category="credit_deduction",
        event_metadata={"credits_deducted": action_credit_cost, "credits_remaining": account.daily_credits},
        cost_usd=0.0,  # Free tier uses credits, not USD billing
        billable=False,
    )
    db_session.add(credit_usage_log)
    db_session.commit()
    
    # Ensure account object reflects latest database state
    db_session.expire(account)
    db_session.refresh(account)
    
    return account


def retrieve_available_credit_balance(account: UserAccount, db_session: Session) -> dict:
    """
    Retrieve user's current credit balance and reset schedule.
    """
    # Refresh credits if daily reset period elapsed
    account = refresh_daily_credits_if_expired(account, db_session)
    
    return {
        "credits_remaining": account.daily_credits,
        "credits_reset_at": account.credits_reset_at.isoformat() if account.credits_reset_at else None,
        "tier": account.tier,
        "total_credits_used": account.total_credits_used,
    }
