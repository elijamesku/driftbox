"""
User activity tracking service with Supabase backend persistence.
Monitors API calls, completions, resources created, etc. for usage-based billing.
"""
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from collections import defaultdict
import json
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.connection import auth_session_context
from app.database.models import ActivityLog, InvoicePeriod, UserAccount


class UserActivityMonitor:
    """
    Monitor and track user activity events for billing analytics with database persistence.
    
    Monitored event types:
    - completion_request: Inline code completion requests
    - chat_message: Interactive chat messages
    - workspace_analysis: Comprehensive workspace analyses
    - resource_created: Infrastructure resource provisioning
    - validation: Terraform configuration validations
    - cost_estimate: Cost estimation operations
    """
    
    def __init__(self):
        # Subscription tier quotas (for rate limiting enforcement)
        self.tier_quota_limits = {
            "free": {
                "completions_per_day": 50,
                "chat_messages_per_day": 20,
                "workspace_analyses_per_day": 5,
            },
            "pro": {
                "completions_per_day": 1000,
                "chat_messages_per_day": 500,
                "workspace_analyses_per_day": 100,
            },
            "enterprise": {
                "completions_per_day": float('inf'),
                "chat_messages_per_day": float('inf'),
                "workspace_analyses_per_day": float('inf'),
            }
        }
        
        # Per-event pricing structure for billing calculations
        self.event_unit_pricing = {
            "completion_request": 0.001,
            "chat_message": 0.005,
            "workspace_analysis": 0.01,
            "resource_created": 0.002,
            "validation": 0.0005,
            "cost_estimate": 0.001,
        }
    
    def record_user_activity(
        self,
        account_id: str,
        activity_type: str,
        activity_metadata: Optional[Dict] = None,
        client_ip: Optional[str] = None,
        client_user_agent: Optional[str] = None,
        api_endpoint: Optional[str] = None
    ):
        """
        Record a user activity event and persist to database.
        
        Args:
            account_id: User account identifier
            activity_type: Activity type (completion_request, chat_message, etc.)
            activity_metadata: Additional event metadata
            client_ip: Client IP address
            client_user_agent: Client user agent string
            api_endpoint: API endpoint invoked
        """
        with auth_session_context() as auth_db_session:
            # Calculate billable cost for this activity
            activity_cost_usd = self.event_unit_pricing.get(activity_type, 0.001)
            
            # Classify activity category
            activity_category = "api"
            if activity_type in ["completion_request", "chat_message"]:
                activity_category = "websocket"
            elif activity_type in ["validation", "cost_estimate"]:
                activity_category = "analysis"
            
            # Instantiate activity log entry
            activity_entry = ActivityLog(
                user_id=account_id,
                event_type=activity_type,
                event_category=activity_category,
                event_metadata=activity_metadata or {},
                cost_usd=activity_cost_usd,
                billable=True,
                ip_address=client_ip,
                user_agent=client_user_agent,
                endpoint=api_endpoint
            )
            
            auth_db_session.add(activity_entry)
            auth_db_session.commit()
    
    def track_event(
        self,
        user_id: str,
        event_type: str,
        metadata: Optional[Dict] = None,
        client_ip: Optional[str] = None,
        client_user_agent: Optional[str] = None,
        api_endpoint: Optional[str] = None
    ):
        """
        Wrapper method for backward compatibility.
        Records a user activity event using record_user_activity.
        
        Args:
            user_id: User account identifier
            event_type: Event type (completion_request, chat_message, etc.)
            metadata: Additional event metadata
            client_ip: Client IP address (optional)
            client_user_agent: Client user agent string (optional)
            api_endpoint: API endpoint invoked (optional)
        """
        self.record_user_activity(
            account_id=user_id,
            activity_type=event_type,
            activity_metadata=metadata,
            client_ip=client_ip,
            client_user_agent=client_user_agent,
            api_endpoint=api_endpoint
        )
    
    def retrieve_activity_statistics(
        self,
        account_id: str,
        period_start_date: Optional[datetime] = None,
        period_end_date: Optional[datetime] = None
    ) -> Dict:
        """
        Retrieve comprehensive usage statistics for a user account from database.
        
        Args:
            account_id: User account identifier
            period_start_date: Beginning of reporting period (default: 30 days ago)
            period_end_date: End of reporting period (default: now)
        
        Returns:
            {
                "total_events": int,
                "by_type": {...},
                "by_day": {...},
                "estimated_cost": float
            }
        """
        if not period_start_date:
            period_start_date = datetime.utcnow() - timedelta(days=30)
        if not period_end_date:
            period_end_date = datetime.utcnow()
        
        with auth_session_context() as auth_db_session:
            # Query activity logs from database
            activity_records = auth_db_session.query(ActivityLog).filter(
                ActivityLog.user_id == account_id,
                ActivityLog.timestamp >= period_start_date,
                ActivityLog.timestamp <= period_end_date
            ).all()
            
            # Aggregate activities by event type
            activity_by_type = defaultdict(int)
            for activity_record in activity_records:
                activity_by_type[activity_record.event_type] += 1
            
            # Aggregate activities by calendar day
            activity_by_day = defaultdict(int)
            for activity_record in activity_records:
                activity_day = activity_record.timestamp.strftime("%Y-%m-%d")
                activity_by_day[activity_day] += 1
            
            # Calculate total billable cost
            aggregate_cost = sum(record.cost_usd for record in activity_records if record.billable)
            
            return {
                "user_id": account_id,
                "period_start": period_start_date.isoformat(),
                "period_end": period_end_date.isoformat(),
                "total_events": len(activity_records),
                "by_type": dict(activity_by_type),
                "by_day": dict(activity_by_day),
                "estimated_cost_usd": round(aggregate_cost, 2)
            }
    
    def verify_quota_availability(
        self,
        account_id: str,
        activity_type: str,
        subscription_tier: str = "free"
    ) -> Dict:
        """
        Verify if user account has remaining quota for activity type (query from database).
        
        Args:
            account_id: User account identifier
            activity_type: Activity type to validate
            subscription_tier: Account subscription tier (free, pro, enterprise)
        
        Returns:
            {
                "allowed": bool,
                "used": int,
                "limit": int,
                "reset_at": str
            }
        """
        with auth_session_context() as auth_db_session:
            # Retrieve today's activity records from database
            current_date = datetime.utcnow().date()
            day_start_timestamp = datetime.combine(current_date, datetime.min.time())
            day_end_timestamp = datetime.combine(current_date, datetime.max.time())
            
            activities_today = auth_db_session.query(func.count(ActivityLog.id)).filter(
                ActivityLog.user_id == account_id,
                ActivityLog.event_type == activity_type,
                ActivityLog.timestamp >= day_start_timestamp,
                ActivityLog.timestamp <= day_end_timestamp
            ).scalar()
            
            # Determine quota limit for subscription tier
            quota_limit_key = f"{activity_type}s_per_day"
            if activity_type == "completion_request":
                quota_limit_key = "completions_per_day"
            elif activity_type == "chat_message":
                quota_limit_key = "chat_messages_per_day"
            elif activity_type == "workspace_analysis":
                quota_limit_key = "workspace_analyses_per_day"
            
            quota_ceiling = self.tier_quota_limits.get(subscription_tier, {}).get(quota_limit_key, 0)
            
            # Determine quota reset timestamp (midnight UTC)
            next_day = current_date + timedelta(days=1)
            quota_reset_timestamp = datetime.combine(next_day, datetime.min.time())
            
            return {
                "allowed": activities_today < quota_ceiling,
                "used": activities_today,
                "limit": quota_ceiling,
                "remaining": max(0, quota_ceiling - activities_today),
                "reset_at": quota_reset_timestamp.isoformat()
            }
    
    def generate_monthly_invoice_report(
        self,
        account_id: str,
        billing_month: Optional[int] = None,
        billing_year: Optional[int] = None
    ) -> Dict:
        """
        Generate comprehensive monthly invoice report and persist to database.
        
        Args:
            account_id: User account identifier
            billing_month: Billing month (1-12), default: current month
            billing_year: Billing year, default: current year
        
        Returns:
            Detailed invoice report with itemized usage breakdown
        """
        current_timestamp = datetime.utcnow()
        if not billing_month:
            billing_month = current_timestamp.month
        if not billing_year:
            billing_year = current_timestamp.year
        
        # Calculate billing period boundaries
        period_start_timestamp = datetime(billing_year, billing_month, 1)
        if billing_month == 12:
            period_end_timestamp = datetime(billing_year + 1, 1, 1)
        else:
            period_end_timestamp = datetime(billing_year, billing_month + 1, 1)
        
        activity_statistics = self.retrieve_activity_statistics(account_id, period_start_timestamp, period_end_timestamp)
        
        # Construct itemized cost breakdown
        itemized_charges = {}
        for activity_type, occurrence_count in activity_statistics["by_type"].items():
            unit_rate = self.event_unit_pricing.get(activity_type, 0.001)
            
            itemized_charges[activity_type] = {
                "count": occurrence_count,
                "rate_per_unit": unit_rate,
                "total": round(unit_rate * occurrence_count, 2)
            }
        
        with auth_session_context() as auth_db_session:
            # Retrieve user account for subscription-level pricing
            user_account = auth_db_session.query(UserAccount).filter(UserAccount.id == account_id).first()
            monthly_subscription_charge = 0.0
            if user_account:
                if user_account.tier == "pro":
                    monthly_subscription_charge = 29.0  # $29/month professional tier
                elif user_account.tier == "enterprise":
                    monthly_subscription_charge = 199.0  # $199/month enterprise tier
            
            total_invoice_amount = monthly_subscription_charge + activity_statistics["estimated_cost_usd"]
            
            # Create or update invoice period record
            existing_invoice_period = auth_db_session.query(InvoicePeriod).filter(
                InvoicePeriod.user_id == account_id,
                InvoicePeriod.month == billing_month,
                InvoicePeriod.year == billing_year
            ).first()
            
            if existing_invoice_period:
                # Update existing invoice period
                existing_invoice_period.usage_cost = activity_statistics["estimated_cost_usd"]
                existing_invoice_period.base_subscription_cost = monthly_subscription_charge
                existing_invoice_period.total_cost = total_invoice_amount
                existing_invoice_period.usage_breakdown = itemized_charges
                existing_invoice_period.event_count = activity_statistics["total_events"]
            else:
                # Create new invoice period record
                new_invoice_period = InvoicePeriod(
                    user_id=account_id,
                    month=billing_month,
                    year=billing_year,
                    base_subscription_cost=monthly_subscription_charge,
                    usage_cost=activity_statistics["estimated_cost_usd"],
                    total_cost=total_invoice_amount,
                    usage_breakdown=itemized_charges,
                    event_count=activity_statistics["total_events"],
                    period_start=period_start_timestamp,
                    period_end=period_end_timestamp
                )
                auth_db_session.add(new_invoice_period)
            
            auth_db_session.commit()
            
            return {
                "user_id": account_id,
                "billing_period": f"{billing_year}-{billing_month:02d}",
                "base_subscription_cost": monthly_subscription_charge,
                "usage_cost": activity_statistics["estimated_cost_usd"],
                "total_cost_usd": total_invoice_amount,
                "itemized": itemized_charges,
                "total_events": activity_statistics["total_events"],
                "generated_at": datetime.utcnow().isoformat()
            }


# Global activity monitoring singleton
user_activity_monitor = UserActivityMonitor()
usage_tracker = user_activity_monitor

