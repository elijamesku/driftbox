from pydantic import BaseModel
from typing import Optional, List, Literal, Dict

class FileProposal(BaseModel):
    """Represents a proposed file change for user approval"""
    action: Literal["create", "edit", "delete"]
    path: str
    old_content: Optional[str] = None
    new_content: str
    description: Optional[str] = None

class FileProposalResponse(BaseModel):
    """Response containing file proposals for user approval"""
    proposals: List[FileProposal]
    summary: str


# ===== Admin Dashboard Models =====

class DashboardMetricsResponse(BaseModel):
    """Admin dashboard overview metrics"""
    total_users: int
    active_users: int  # Last 30 days
    total_teams: int
    total_repositories: int
    total_prs_created: int
    total_revenue_mrr: float  # Monthly Recurring Revenue
    total_usage_events: int


# ===== User Analytics Models =====

class UserGrowthDataPoint(BaseModel):
    """Daily signup data point"""
    date: str  # ISO format date
    signups: int


class CohortRetentionData(BaseModel):
    """Cohort retention data"""
    cohort_month: str  # YYYY-MM format
    total_users: int
    retention_day_7: float  # Percentage
    retention_day_30: float  # Percentage
    retention_day_90: float  # Percentage


class UsersByTier(BaseModel):
    """Users grouped by subscription tier"""
    free: int
    pro: int
    enterprise: int


class UsersBySignupMethod(BaseModel):
    """Users grouped by signup method"""
    email: int
    github: int


class UserAnalyticsResponse(BaseModel):
    """User analytics response"""
    total_users: int
    new_users: Dict[str, int]  # {"7d": int, "30d": int, "90d": int}
    active_users: Dict[str, int]  # {"dau": int, "mau": int}
    growth_chart_data: List[UserGrowthDataPoint]  # Daily signups for chart
    retention_cohorts: List[CohortRetentionData]  # Cohort analysis
    users_by_tier: UsersByTier
    users_by_signup_method: UsersBySignupMethod


# ===== Revenue Analytics Models =====

class MonthlyRevenueDataPoint(BaseModel):
    """Monthly revenue data point"""
    month: str  # YYYY-MM format
    revenue: float


class RevenueByTier(BaseModel):
    """Revenue breakdown by tier"""
    free: float
    pro: float
    enterprise: float
    team: float  # Team subscriptions


class RevenueGrowth(BaseModel):
    """Revenue growth metrics"""
    mom: Optional[float]  # Month-over-month percentage change
    yoy: Optional[float]  # Year-over-year percentage change


class RevenueAnalyticsResponse(BaseModel):
    """Revenue analytics response"""
    mrr: float  # Monthly Recurring Revenue
    arr: float  # Annual Recurring Revenue (MRR * 12)
    revenue_growth: RevenueGrowth
    revenue_by_tier: RevenueByTier
    revenue_chart_data: List[MonthlyRevenueDataPoint]  # Monthly revenue for chart
    total_revenue_lifetime: float  # Total revenue ever collected
    arpu: float  # Average Revenue Per User
    churn_rate: float  # Monthly churn rate percentage


# ===== Team Analytics Models =====

class TeamGrowthDataPoint(BaseModel):
    """Daily team creation data point"""
    date: str  # ISO format date
    teams_created: int


class TeamsByPlan(BaseModel):
    """Teams grouped by subscription plan"""
    free: int
    team: int
    enterprise: int


class TeamAnalyticsResponse(BaseModel):
    """Team analytics response"""
    total_teams: int
    teams_created: Dict[str, int]  # {"7d": int, "30d": int, "90d": int}
    average_team_size: float
    total_team_members: int
    teams_by_plan: TeamsByPlan
    growth_chart_data: List[TeamGrowthDataPoint]  # Daily team creation for chart
    active_teams: int  # Teams with activity in last 30 days


# ===== Usage Analytics Models =====

class UsageByDayDataPoint(BaseModel):
    """Daily usage data point"""
    date: str  # ISO format date
    events: int


class UsageByType(BaseModel):
    """Usage breakdown by event type"""
    completion_request: int
    chat_message: int
    workspace_analysis: int
    resource_created: int
    validation: int
    cost_estimate: int
    api_request: int
    other: int  # Any other event types


class UsageByTier(BaseModel):
    """Usage breakdown by user tier"""
    free: int
    pro: int
    enterprise: int


class TopUserByUsage(BaseModel):
    """Top user by usage"""
    user_id: str
    email: Optional[str]
    tier: str
    total_events: int


class UsageTrends(BaseModel):
    """Usage growth trends"""
    week_over_week: Optional[float]  # Percentage change
    month_over_month: Optional[float]  # Percentage change


class UsageAnalyticsResponse(BaseModel):
    """Usage analytics response"""
    total_usage_events: Dict[str, int]  # {"all_time": int, "last_30_days": int}
    usage_by_type: UsageByType
    usage_by_day: List[UsageByDayDataPoint]  # Daily usage for chart (last 30 days)
    usage_by_tier: UsageByTier
    top_users_by_usage: List[TopUserByUsage]  # Top 10 users
    average_usage_per_user: float
    usage_trends: UsageTrends


# ===== Product Analytics Models =====

class PRsByType(BaseModel):
    """PRs grouped by type"""
    individual: int
    team: int


class FeaturesUsed(BaseModel):
    """Product features usage"""
    drift_detection: int
    security_scanning: int
    cost_estimation: int
    validation: int
    workspace_analysis: int
    other: int


class ProductUsageDataPoint(BaseModel):
    """Daily product usage data point"""
    date: str  # ISO format date
    prs_created: int
    resources_generated: int
    conversations_created: int
    queries_executed: int


class ProductAnalyticsResponse(BaseModel):
    """Product analytics response"""
    total_prs_created: Dict[str, int]  # {"all_time": int, "last_30_days": int}
    prs_by_type: PRsByType
    infrastructure_resources_generated: int  # Last 30 days
    conversations_created: int  # Last 30 days
    queries_executed: int  # Last 30 days
    features_used: FeaturesUsed
    product_usage_chart_data: List[ProductUsageDataPoint]  # Daily usage for chart (last 30 days)


# ===== Engagement Analytics Models =====

class UserRetention(BaseModel):
    """User retention metrics"""
    day_1: float  # Percentage
    day_7: float  # Percentage
    day_30: float  # Percentage


class EngagementDataPoint(BaseModel):
    """Daily engagement data point"""
    date: str  # ISO format date
    dau: int
    sessions: int
    average_session_time_minutes: float


class EngagementAnalyticsResponse(BaseModel):
    """Engagement analytics response"""
    dau: int  # Daily Active Users
    mau: int  # Monthly Active Users
    dau_mau_ratio: float  # DAU/MAU ratio
    user_retention: UserRetention
    average_session_time_minutes: float
    sessions_per_user: float
    engagement_chart_data: List[EngagementDataPoint]  # Daily engagement for chart (last 30 days)

