"""
Admin dashboard endpoints for platform overview metrics.
"""
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from app.services.auth import authentication_service, require_admin
from app.services.admin_analytics import AdminAnalyticsService
from app.database.models import UserAccount
from app.database.connection import (
    acquire_auth_session,
    primary_session_context
)
from app.models.responses import (
    DashboardMetricsResponse,
    UserAnalyticsResponse,
    RevenueAnalyticsResponse,
    TeamAnalyticsResponse,
    UsageAnalyticsResponse,
    ProductAnalyticsResponse,
    EngagementAnalyticsResponse
)
from app.utils.errors import sanitize_error_detail

router = APIRouter()


# ===== Admin Endpoints =====

@router.get("/dashboard", response_model=DashboardMetricsResponse, tags=["admin"])
def get_admin_dashboard(
    current_user: UserAccount = Depends(require_admin),
    auth_db: Session = Depends(acquire_auth_session)
):
    """
    Get admin dashboard overview metrics.
    
    Returns:
    - Total users
    - Active users (last 30 days)
    - Total teams
    - Total repositories
    - Total PRs created
    - Total revenue (MRR)
    - Total usage events
    
    Requires: Admin authentication
    """
    try:
        
        # Get primary database session for PRs
        with primary_session_context() as primary_db:
            analytics_service = AdminAnalyticsService(auth_db, primary_db)
            metrics = analytics_service.calculate_dashboard_metrics(primary_db)
        
        return DashboardMetricsResponse(**metrics)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to fetch admin dashboard metrics")
        )


@router.get("/analytics/users", response_model=UserAnalyticsResponse, tags=["admin"])
def get_user_analytics(
    current_user: UserAccount = Depends(require_admin),
    auth_db: Session = Depends(acquire_auth_session)
):
    """
    Get comprehensive user analytics.
    
    Returns:
    - Total users
    - New users (last 7, 30, 90 days)
    - Active users (DAU, MAU)
    - User growth chart data (daily signups)
    - User retention (cohort analysis)
    - Users by tier (free, pro, enterprise)
    - Users by signup method (email, GitHub)
    
    Requires: Admin authentication
    """
    try:
        
        analytics_service = AdminAnalyticsService(auth_db)
        analytics = analytics_service.calculate_user_analytics()
        
        return UserAnalyticsResponse(**analytics)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to fetch user analytics")
        )

@router.get("/analytics/revenue", response_model=RevenueAnalyticsResponse, tags=["admin"])
def get_revenue_analytics(
    current_user: UserAccount = Depends(require_admin),
    auth_db: Session = Depends(acquire_auth_session)
):
    """
    Get comprehensive revenue analytics.
    
    Returns:
    - MRR (Monthly Recurring Revenue)
    - ARR (Annual Recurring Revenue)
    - Revenue growth (MoM, YoY)
    - Revenue by tier
    - Revenue chart data (monthly)
    - Total revenue (lifetime)
    - Average revenue per user (ARPU)
    - Churn rate
    
    Requires: Admin authentication
    """
    try:
        
        analytics_service = AdminAnalyticsService(auth_db)
        analytics = analytics_service.calculate_revenue_analytics()
        
        return RevenueAnalyticsResponse(**analytics)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to fetch revenue analytics")
        )

@router.get("/analytics/teams", response_model=TeamAnalyticsResponse, tags=["admin"])
def get_team_analytics(
    current_user: UserAccount = Depends(require_admin),
    auth_db: Session = Depends(acquire_auth_session)
):
    """
    Get comprehensive team analytics.
    
    Returns:
    - Total teams
    - Teams created (last 7, 30, 90 days)
    - Average team size
    - Total team members
    - Teams by plan (Free, Team, Enterprise)
    - Team growth chart data (daily team creation)
    - Active teams (teams with activity in last 30 days)
    
    Requires: Admin authentication
    """
    try:
        
        analytics_service = AdminAnalyticsService(auth_db)
        analytics = analytics_service.calculate_team_analytics()
        
        return TeamAnalyticsResponse(**analytics)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to fetch team analytics")
        )

@router.get("/analytics/usage", response_model=UsageAnalyticsResponse, tags=["admin"])
def get_usage_analytics(
    current_user: UserAccount = Depends(require_admin),
    auth_db: Session = Depends(acquire_auth_session)
):
    """
    Get comprehensive usage analytics.
    
    Returns:
    - Total usage events (all time, last 30 days)
    - Usage by type (completions, chat, validations, etc.)
    - Usage by day (chart data for last 30 days)
    - Usage by user tier
    - Top users by usage
    - Average usage per user
    - Usage trends (growth)
    
    Requires: Admin authentication
    """
    try:
        
        analytics_service = AdminAnalyticsService(auth_db)
        analytics = analytics_service.calculate_usage_analytics()
        
        return UsageAnalyticsResponse(**analytics)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to fetch usage analytics")
        )

@router.get("/analytics/product", response_model=ProductAnalyticsResponse, tags=["admin"])
def get_product_analytics(
    current_user: UserAccount = Depends(require_admin),
    auth_db: Session = Depends(acquire_auth_session)
):
    """
    Get comprehensive product analytics.
    
    Returns:
    - Total PRs created (all time, last 30 days)
    - PRs by type (individual, team PRs)
    - Infrastructure resources generated
    - Conversations created
    - Queries executed
    - Features used (drift detection, security scanning, etc.)
    - Product usage chart data (daily for last 30 days)
    
    Requires: Admin authentication
    """
    try:
        
        # Get primary database session for PRs, conversations, queries, drift
        with primary_session_context() as primary_db:
            analytics_service = AdminAnalyticsService(auth_db, primary_db)
            analytics = analytics_service.calculate_product_analytics(primary_db)
        
        return ProductAnalyticsResponse(**analytics)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to fetch product analytics")
        )

@router.get("/analytics/engagement", response_model=EngagementAnalyticsResponse, tags=["admin"])
def get_engagement_analytics(
    current_user: UserAccount = Depends(require_admin),
    auth_db: Session = Depends(acquire_auth_session)
):
    """
    Get comprehensive engagement analytics.
    
    Returns:
    - DAU (Daily Active Users)
    - MAU (Monthly Active Users)
    - DAU/MAU ratio
    - User retention (Day 1, Day 7, Day 30)
    - Average session time (minutes)
    - Sessions per user
    - Engagement chart data (daily for last 30 days)
    
    Requires: Admin authentication
    """
    try:
        
        analytics_service = AdminAnalyticsService(auth_db)
        analytics = analytics_service.calculate_engagement_analytics()
        
        return EngagementAnalyticsResponse(**analytics)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=sanitize_error_detail(e, "Failed to fetch engagement analytics")
        )
    