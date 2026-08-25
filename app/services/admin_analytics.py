"""
Admin analytics service for calculating dashboard metrics, user analytics, and revenue analytics.
"""
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from collections import defaultdict
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.models import UserAccount, ActivityLog, InvoicePeriod
from app.database.models import PullRequest, ConversationThread, QueryLog, ConfigurationDrift
from app.models.team import Team, TeamRepository, TeamMember 
from app.models.responses import (
    UserGrowthDataPoint,
    CohortRetentionData,
    UsersByTier,
    UsersBySignupMethod,
    MonthlyRevenueDataPoint,
    RevenueByTier,
    RevenueGrowth,
    TeamGrowthDataPoint,
    TeamsByPlan,
    UsageByDayDataPoint,
    UsageByType,
    UsageByTier,
    TopUserByUsage,
    UsageTrends,
    PRsByType,
    FeaturesUsed,
    ProductUsageDataPoint,
    UserRetention,
    EngagementDataPoint
)


class AdminAnalyticsService:
    """Service for calculating admin analytics metrics"""
    
    # Pricing constants (monthly)
    PRO_MONTHLY = 29.0
    ENTERPRISE_MONTHLY = 199.0
    TEAM_MONTHLY = 99.0
    TEAM_ENTERPRISE_MONTHLY = 299.0
    
    def __init__(self, auth_db: Session, primary_db: Optional[Session] = None):
        self.auth_db = auth_db
        self.primary_db = primary_db
    
    # ===== Dashboard Metrics =====
    
    def calculate_dashboard_metrics(
        self,
        primary_db: Optional[Session] = None
    ) -> Dict:
        """Calculate dashboard overview metrics"""
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        
        total_users = self.auth_db.query(UserAccount).count()
        
        active_users = self.auth_db.query(UserAccount).filter(
            UserAccount.last_login_at >= thirty_days_ago
        ).count()
        
        total_teams = self.auth_db.query(Team).filter(
            Team.deleted_at.is_(None)
        ).count()
        
        distinct_repos = self.auth_db.query(
            TeamRepository.repo_full_name
        ).distinct().all()
        total_repositories = len(distinct_repos)
        
        # Total PRs from primary database
        if primary_db:
            total_prs_created = primary_db.query(PullRequest).count()
        else:
            total_prs_created = 0
        
        # Calculate MRR
        mrr = self._calculate_current_mrr()
        
        total_usage_events = self.auth_db.query(ActivityLog).count()
        
        return {
            "total_users": total_users,
            "active_users": active_users,
            "total_teams": total_teams,
            "total_repositories": total_repositories,
            "total_prs_created": total_prs_created,
            "total_revenue_mrr": round(mrr, 2),
            "total_usage_events": total_usage_events
        }
    
    # ===== User Analytics =====
    
    def calculate_user_analytics(self) -> Dict:
        """Calculate comprehensive user analytics"""
        now = datetime.utcnow()
        seven_days_ago = now - timedelta(days=7)
        thirty_days_ago = now - timedelta(days=30)
        ninety_days_ago = now - timedelta(days=90)
        one_day_ago = now - timedelta(days=1)
        
        # Total users
        total_users = self.auth_db.query(UserAccount).count()
        
        # New users
        new_users_7d = self.auth_db.query(UserAccount).filter(
            UserAccount.created_at >= seven_days_ago
        ).count()
        
        new_users_30d = self.auth_db.query(UserAccount).filter(
            UserAccount.created_at >= thirty_days_ago
        ).count()
        
        new_users_90d = self.auth_db.query(UserAccount).filter(
            UserAccount.created_at >= ninety_days_ago
        ).count()
        
        # Active users (DAU, MAU)
        dau = self.auth_db.query(UserAccount).filter(
            UserAccount.last_login_at >= one_day_ago
        ).count()
        
        mau = self.auth_db.query(UserAccount).filter(
            UserAccount.last_login_at >= thirty_days_ago
        ).count()
        
        # Growth chart data
        growth_data = self._calculate_growth_chart_data(now)
        
        # Retention cohorts
        retention_cohorts = self._calculate_retention_cohorts()
        
        # Users by tier
        users_by_tier = self._calculate_users_by_tier()
        
        # Users by signup method
        users_by_signup_method = self._calculate_users_by_signup_method()
        
        return {
            "total_users": total_users,
            "new_users": {
                "7d": new_users_7d,
                "30d": new_users_30d,
                "90d": new_users_90d
            },
            "active_users": {
                "dau": dau,
                "mau": mau
            },
            "growth_chart_data": growth_data,
            "retention_cohorts": retention_cohorts,
            "users_by_tier": users_by_tier,
            "users_by_signup_method": users_by_signup_method
        }
    
    def _calculate_growth_chart_data(self, now: datetime) -> List[UserGrowthDataPoint]:
        """Calculate daily signup data for last 90 days"""
        growth_data = []
        for i in range(90):
            day_start = (now - timedelta(days=90-i)).replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)
            
            daily_signups = self.auth_db.query(UserAccount).filter(
                UserAccount.created_at >= day_start,
                UserAccount.created_at < day_end
            ).count()
            
            growth_data.append(UserGrowthDataPoint(
                date=day_start.date().isoformat(),
                signups=daily_signups
            ))
        
        return growth_data
    
    def _calculate_retention_cohorts(self) -> List[CohortRetentionData]:
        """Calculate cohort retention analysis"""
        retention_cohorts = []
        
        # Get all users and group by signup month
        all_users = self.auth_db.query(UserAccount).all()
        
        users_by_month = defaultdict(list)
        for user in all_users:
            if user.created_at:
                month_key = user.created_at.strftime("%Y-%m")
                users_by_month[month_key].append(user)
        
        # Process last 12 months
        sorted_months = sorted(users_by_month.keys())[-12:]
        
        for month_key in sorted_months:
            cohort_users = users_by_month[month_key]
            cohort_start = datetime.strptime(month_key + "-01", "%Y-%m-%d")
            cohort_end = (cohort_start + timedelta(days=32)).replace(day=1)
            
            cohort_total = len(cohort_users)
            if cohort_total == 0:
                continue
            
            # Calculate retention at day 7, 30, 90
            day_7_date = cohort_start + timedelta(days=7)
            day_30_date = cohort_start + timedelta(days=30)
            day_90_date = cohort_start + timedelta(days=90)
            
            retained_7d = sum(1 for user in cohort_users 
                            if user.last_login_at and user.last_login_at >= day_7_date)
            
            retained_30d = sum(1 for user in cohort_users 
                             if user.last_login_at and user.last_login_at >= day_30_date)
            
            retained_90d = sum(1 for user in cohort_users 
                             if user.last_login_at and user.last_login_at >= day_90_date)
            
            retention_cohorts.append(CohortRetentionData(
                cohort_month=cohort_start.strftime("%Y-%m"),
                total_users=cohort_total,
                retention_day_7=round((retained_7d / cohort_total * 100) if cohort_total > 0 else 0, 2),
                retention_day_30=round((retained_30d / cohort_total * 100) if cohort_total > 0 else 0, 2),
                retention_day_90=round((retained_90d / cohort_total * 100) if cohort_total > 0 else 0, 2)
            ))
        
        return retention_cohorts
    
    def _calculate_users_by_tier(self) -> UsersByTier:
        """Calculate users grouped by tier"""
        users_free = self.auth_db.query(UserAccount).filter(
            UserAccount.tier == 'free'
        ).count()
        
        users_pro = self.auth_db.query(UserAccount).filter(
            UserAccount.tier == 'pro'
        ).count()
        
        users_enterprise = self.auth_db.query(UserAccount).filter(
            UserAccount.tier == 'enterprise'
        ).count()
        
        return UsersByTier(
            free=users_free,
            pro=users_pro,
            enterprise=users_enterprise
        )
    
    def _calculate_users_by_signup_method(self) -> UsersBySignupMethod:
        """Calculate users grouped by signup method"""
        users_email = self.auth_db.query(UserAccount).filter(
            (UserAccount.oauth_provider == 'email') | 
            (UserAccount.github_id.is_(None))
        ).count()
        
        users_github = self.auth_db.query(UserAccount).filter(
            UserAccount.github_id.isnot(None)
        ).count()
        
        return UsersBySignupMethod(
            email=users_email,
            github=users_github
        )
    
    # ===== Revenue Analytics =====
    
    def calculate_revenue_analytics(self) -> Dict:
        """Calculate comprehensive revenue analytics"""
        now = datetime.utcnow()
        current_month = now.month
        current_year = now.year
        last_month = (now.replace(day=1) - timedelta(days=1))
        last_month_num = last_month.month
        last_month_year = last_month.year
        
        # Calculate MRR
        mrr = self._calculate_current_mrr()
        
        # Calculate ARR
        arr = mrr * 12
        
        # Revenue growth
        revenue_growth = self._calculate_revenue_growth(now, current_month, current_year)
        
        # Revenue by tier
        revenue_by_tier = self._calculate_revenue_by_tier()
        
        # Revenue chart data
        revenue_chart_data = self._calculate_revenue_chart_data(now)
        
        # Total lifetime revenue
        total_lifetime_revenue = self.auth_db.query(
            func.sum(InvoicePeriod.total_cost)
        ).filter(
            InvoicePeriod.status == 'paid'
        ).scalar() or 0.0
        
        # ARPU
        active_pro_users = self.auth_db.query(UserAccount).filter(
            UserAccount.tier == 'pro',
            UserAccount.subscription_status == 'active'
        ).count()
        
        active_enterprise_users = self.auth_db.query(UserAccount).filter(
            UserAccount.tier == 'enterprise',
            UserAccount.subscription_status == 'active'
        ).count()
        
        active_teams = self.auth_db.query(Team).filter(
            Team.plan.in_(['team', 'enterprise']),
            Team.deleted_at.is_(None)
        ).all()
        
        total_paying_users = active_pro_users + active_enterprise_users + len(active_teams)
        arpu = round((mrr / total_paying_users) if total_paying_users > 0 else 0.0, 2)
        
        # Churn rate
        churn_rate = self._calculate_churn_rate(last_month)
        
        return {
            "mrr": round(mrr, 2),
            "arr": round(arr, 2),
            "revenue_growth": revenue_growth,
            "revenue_by_tier": revenue_by_tier,
            "revenue_chart_data": revenue_chart_data,
            "total_revenue_lifetime": round(total_lifetime_revenue, 2),
            "arpu": arpu,
            "churn_rate": churn_rate
        }
    
    def _calculate_current_mrr(self) -> float:
        """Calculate current Monthly Recurring Revenue"""
        now = datetime.utcnow()
        current_month = now.month
        current_year = now.year
        
        # Individual subscriptions
        active_pro_users = self.auth_db.query(UserAccount).filter(
            UserAccount.tier == 'pro',
            UserAccount.subscription_status == 'active'
        ).count()
        
        active_enterprise_users = self.auth_db.query(UserAccount).filter(
            UserAccount.tier == 'enterprise',
            UserAccount.subscription_status == 'active'
        ).count()
        
        individual_mrr = (active_pro_users * self.PRO_MONTHLY) + (active_enterprise_users * self.ENTERPRISE_MONTHLY)
        
        # Team subscriptions
        team_mrr = 0.0
        active_teams = self.auth_db.query(Team).filter(
            Team.plan.in_(['team', 'enterprise']),
            Team.deleted_at.is_(None)
        ).all()
        
        for team in active_teams:
            if team.plan == 'team':
                team_mrr += self.TEAM_MONTHLY
            elif team.plan == 'enterprise':
                team_mrr += self.TEAM_ENTERPRISE_MONTHLY
        
        # Add revenue from paid billing cycles for current month
        current_month_revenue = self.auth_db.query(
            func.sum(InvoicePeriod.total_cost)
        ).filter(
            InvoicePeriod.month == current_month,
            InvoicePeriod.year == current_year,
            InvoicePeriod.status == 'paid'
        ).scalar() or 0.0
        
        return individual_mrr + team_mrr + current_month_revenue
    
    def _calculate_historical_mrr(self, month_end: datetime) -> float:
        """Calculate MRR for a specific historical month"""
        month_num = month_end.month
        month_year = month_end.year
        
        # Users active during that month
        month_pro = self.auth_db.query(UserAccount).filter(
            UserAccount.tier == 'pro',
            UserAccount.subscription_status == 'active',
            UserAccount.created_at < month_end
        ).count()
        
        month_enterprise = self.auth_db.query(UserAccount).filter(
            UserAccount.tier == 'enterprise',
            UserAccount.subscription_status == 'active',
            UserAccount.created_at < month_end
        ).count()
        
        month_individual_mrr = (month_pro * self.PRO_MONTHLY) + (month_enterprise * self.ENTERPRISE_MONTHLY)
        
        # Teams active during that month
        month_teams = self.auth_db.query(Team).filter(
            Team.plan.in_(['team', 'enterprise']),
            Team.deleted_at.is_(None),
            Team.created_at < month_end
        ).all()
        
        month_team_mrr = 0.0
        for team in month_teams:
            if team.plan == 'team':
                month_team_mrr += self.TEAM_MONTHLY
            elif team.plan == 'enterprise':
                month_team_mrr += self.TEAM_ENTERPRISE_MONTHLY
        
        # Paid invoices for that month
        month_revenue = self.auth_db.query(
            func.sum(InvoicePeriod.total_cost)
        ).filter(
            InvoicePeriod.month == month_num,
            InvoicePeriod.year == month_year,
            InvoicePeriod.status == 'paid'
        ).scalar() or 0.0
        
        return month_individual_mrr + month_team_mrr + month_revenue
    
    def _calculate_revenue_growth(
        self,
        now: datetime,
        current_month: int,
        current_year: int
    ) -> RevenueGrowth:
        """Calculate revenue growth (MoM, YoY)"""
        current_mrr = self._calculate_current_mrr()
        
        # Month-over-month
        last_month_end = now.replace(day=1)
        last_month_mrr = self._calculate_historical_mrr(last_month_end)
        
        mom_growth = None
        if last_month_mrr > 0:
            mom_growth = round(((current_mrr - last_month_mrr) / last_month_mrr * 100), 2)
        
        # Year-over-year
        last_year_end = datetime(current_year - 1, current_month + 1, 1) if current_month < 12 else datetime(current_year, 1, 1)
        last_year_mrr = self._calculate_historical_mrr(last_year_end)
        
        yoy_growth = None
        if last_year_mrr > 0:
            yoy_growth = round(((current_mrr - last_year_mrr) / last_year_mrr * 100), 2)
        
        return RevenueGrowth(mom=mom_growth, yoy=yoy_growth)
    
    def _calculate_revenue_by_tier(self) -> RevenueByTier:
        """Calculate revenue breakdown by tier"""
        active_pro_users = self.auth_db.query(UserAccount).filter(
            UserAccount.tier == 'pro',
            UserAccount.subscription_status == 'active'
        ).count()
        
        active_enterprise_users = self.auth_db.query(UserAccount).filter(
            UserAccount.tier == 'enterprise',
            UserAccount.subscription_status == 'active'
        ).count()
        
        active_teams = self.auth_db.query(Team).filter(
            Team.plan.in_(['team', 'enterprise']),
            Team.deleted_at.is_(None)
        ).all()
        
        team_mrr = 0.0
        for team in active_teams:
            if team.plan == 'team':
                team_mrr += self.TEAM_MONTHLY
            elif team.plan == 'enterprise':
                team_mrr += self.TEAM_ENTERPRISE_MONTHLY
        
        return RevenueByTier(
            free=0.0,
            pro=round(active_pro_users * self.PRO_MONTHLY, 2),
            enterprise=round(active_enterprise_users * self.ENTERPRISE_MONTHLY, 2),
            team=round(team_mrr, 2)
        )
    
    def _calculate_revenue_chart_data(self, now: datetime) -> List[MonthlyRevenueDataPoint]:
        """Calculate monthly revenue for last 12 months"""
        revenue_chart_data = []
        for i in range(12):
            month_date = (now.replace(day=1) - timedelta(days=32 * i))
            month_end = (month_date + timedelta(days=32)).replace(day=1)
            
            month_mrr = self._calculate_historical_mrr(month_end)
            
            revenue_chart_data.append(MonthlyRevenueDataPoint(
                month=month_date.strftime("%Y-%m"),
                revenue=round(month_mrr, 2)
            ))
        
        revenue_chart_data.reverse()  # Oldest to newest
        return revenue_chart_data
    
    def _calculate_churn_rate(self, last_month: datetime) -> float:
        """Calculate monthly churn rate"""
        last_month_start = last_month.replace(day=1)
        
        # Users who had a paid tier at start of last month
        users_at_start = self.auth_db.query(UserAccount).filter(
            UserAccount.tier.in_(['pro', 'enterprise']),
            UserAccount.created_at < last_month_start
        ).all()
        
        # Count churned users
        churned_users = 0
        for user in users_at_start:
            is_churned = (
                user.subscription_status in ['cancelled', 'past_due']
            ) or (
                user.tier == 'free' and 
                user.updated_at is not None and 
                user.updated_at >= last_month_start
            )
            if is_churned:
                churned_users += 1
        
        # Teams that were paying at start of last month
        teams_at_start = self.auth_db.query(Team).filter(
            Team.plan.in_(['team', 'enterprise']),
            Team.created_at < last_month_start
        ).all()
        
        # Filter to only teams that were NOT deleted at the start of last month
        teams_at_start = [t for t in teams_at_start if t.deleted_at is None or t.deleted_at >= last_month_start]
        
        # Count churned teams
        churned_teams = 0
        for team in teams_at_start:
            is_churned = (
                team.deleted_at is not None and 
                team.deleted_at >= last_month_start
            ) or (
                team.plan == 'free' and 
                team.updated_at is not None and 
                team.updated_at >= last_month_start
            )
            if is_churned:
                churned_teams += 1
        
        # Calculate churn rate
        total_subscribers_at_start = len(users_at_start) + len(teams_at_start)
        
        return round(
            ((churned_users + churned_teams) / total_subscribers_at_start * 100) 
            if total_subscribers_at_start > 0 else 0.0, 
            2
        )
    
    # ===== Team Analytics =====
    
    def calculate_team_analytics(self) -> Dict:
        """Calculate comprehensive team analytics"""
        now = datetime.utcnow()
        seven_days_ago = now - timedelta(days=7)
        thirty_days_ago = now - timedelta(days=30)
        ninety_days_ago = now - timedelta(days=90)
        
        # Total teams (excluding soft-deleted)
        total_teams = self.auth_db.query(Team).filter(
            Team.deleted_at.is_(None)
        ).count()
        
        # Teams created (last 7, 30, 90 days)
        teams_created_7d = self.auth_db.query(Team).filter(
            Team.created_at >= seven_days_ago,
            Team.deleted_at.is_(None)
        ).count()
        
        teams_created_30d = self.auth_db.query(Team).filter(
            Team.created_at >= thirty_days_ago,
            Team.deleted_at.is_(None)
        ).count()
        
        teams_created_90d = self.auth_db.query(Team).filter(
            Team.created_at >= ninety_days_ago,
            Team.deleted_at.is_(None)
        ).count()
        
        # Total team members (active members only)
        total_team_members = self.auth_db.query(TeamMember).filter(
            TeamMember.status == 'active'
        ).count()
        
        # Average team size
        all_teams = self.auth_db.query(Team).filter(
            Team.deleted_at.is_(None)
        ).all()
        
        team_sizes = []
        for team in all_teams:
            member_count = self.auth_db.query(TeamMember).filter(
                TeamMember.team_id == team.id,
                TeamMember.status == 'active'
            ).count()
            if member_count > 0:
                team_sizes.append(member_count)
        
        average_team_size = round(sum(team_sizes) / len(team_sizes), 2) if team_sizes else 0.0
        
        # Teams by plan
        teams_by_plan = self._calculate_teams_by_plan()
        
        # Team growth chart data
        growth_chart_data = self._calculate_team_growth_chart_data(now)
        
        # Active teams (teams with activity in last 30 days)
        active_teams = self._calculate_active_teams(thirty_days_ago)
        
        return {
            "total_teams": total_teams,
            "teams_created": {
                "7d": teams_created_7d,
                "30d": teams_created_30d,
                "90d": teams_created_90d
            },
            "average_team_size": average_team_size,
            "total_team_members": total_team_members,
            "teams_by_plan": teams_by_plan,
            "growth_chart_data": growth_chart_data,
            "active_teams": active_teams
        }
    
    def _calculate_teams_by_plan(self) -> TeamsByPlan:
        """Calculate teams grouped by plan"""
        teams_free = self.auth_db.query(Team).filter(
            Team.plan == 'free',
            Team.deleted_at.is_(None)
        ).count()
        
        teams_team = self.auth_db.query(Team).filter(
            Team.plan == 'team',
            Team.deleted_at.is_(None)
        ).count()
        
        teams_enterprise = self.auth_db.query(Team).filter(
            Team.plan == 'enterprise',
            Team.deleted_at.is_(None)
        ).count()
        
        return TeamsByPlan(
            free=teams_free,
            team=teams_team,
            enterprise=teams_enterprise
        )
    
    def _calculate_team_growth_chart_data(self, now: datetime) -> List[TeamGrowthDataPoint]:
        """Calculate daily team creation data for last 90 days"""
        growth_data = []
        for i in range(90):
            day_start = (now - timedelta(days=90-i)).replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)
            
            daily_teams = self.auth_db.query(Team).filter(
                Team.created_at >= day_start,
                Team.created_at < day_end,
                Team.deleted_at.is_(None)
            ).count()
            
            growth_data.append(TeamGrowthDataPoint(
                date=day_start.date().isoformat(),
                teams_created=daily_teams
            ))
        
        return growth_data
    
    def _calculate_active_teams(self, thirty_days_ago: datetime) -> int:
        """Calculate teams with activity in last 30 days"""
        # Get all teams
        all_teams = self.auth_db.query(Team).filter(
            Team.deleted_at.is_(None)
        ).all()
        
        active_team_count = 0
        
        for team in all_teams:
            # Check if team was updated in last 30 days
            if team.updated_at and team.updated_at >= thirty_days_ago:
                active_team_count += 1
                continue
            
            # Check if any team members have activity in last 30 days
            team_members = self.auth_db.query(TeamMember).filter(
                TeamMember.team_id == team.id,
                TeamMember.status == 'active'
            ).all()
            
            for member in team_members:
                # Check if member has activity logs in last 30 days
                has_activity = self.auth_db.query(ActivityLog).filter(
                    ActivityLog.user_id == member.user_id,
                    ActivityLog.timestamp >= thirty_days_ago
                ).first()
                
                if has_activity:
                    active_team_count += 1
                    break
        
        return active_team_count
    
    # ===== Usage Analytics =====
    
    def calculate_usage_analytics(self) -> Dict:
        """Calculate comprehensive usage analytics"""
        now = datetime.utcnow()
        thirty_days_ago = now - timedelta(days=30)
        seven_days_ago = now - timedelta(days=7)
        last_week_start = now - timedelta(days=14)
        last_month_start = now - timedelta(days=60)
        
        # Total usage events
        total_all_time = self.auth_db.query(ActivityLog).count()
        total_last_30_days = self.auth_db.query(ActivityLog).filter(
            ActivityLog.timestamp >= thirty_days_ago
        ).count()
        
        # Usage by type
        usage_by_type = self._calculate_usage_by_type(thirty_days_ago)
        
        # Usage by day (last 30 days)
        usage_by_day = self._calculate_usage_by_day(now, thirty_days_ago)
        
        # Usage by tier
        usage_by_tier = self._calculate_usage_by_tier(thirty_days_ago)
        
        # Top users by usage
        top_users = self._calculate_top_users_by_usage(thirty_days_ago)
        
        # Average usage per user
        active_users_count = self.auth_db.query(UserAccount).filter(
            UserAccount.last_login_at >= thirty_days_ago
        ).count()
        average_usage_per_user = round(
            (total_last_30_days / active_users_count) if active_users_count > 0 else 0.0,
            2
        )
        
        # Usage trends
        usage_trends = self._calculate_usage_trends(
            now, seven_days_ago, last_week_start, thirty_days_ago, last_month_start
        )
        
        return {
            "total_usage_events": {
                "all_time": total_all_time,
                "last_30_days": total_last_30_days
            },
            "usage_by_type": usage_by_type,
            "usage_by_day": usage_by_day,
            "usage_by_tier": usage_by_tier,
            "top_users_by_usage": top_users,
            "average_usage_per_user": average_usage_per_user,
            "usage_trends": usage_trends
        }
    
    def _calculate_usage_by_type(self, thirty_days_ago: datetime) -> UsageByType:
        """Calculate usage breakdown by event type"""
        # Common event types
        event_types = [
            'completion_request',
            'chat_message',
            'workspace_analysis',
            'resource_created',
            'validation',
            'cost_estimate',
            'api_request'
        ]
        
        usage_counts = {}
        for event_type in event_types:
            count = self.auth_db.query(ActivityLog).filter(
                ActivityLog.event_type == event_type,
                ActivityLog.timestamp >= thirty_days_ago
            ).count()
            usage_counts[event_type] = count
        
        # Count other event types
        all_events = self.auth_db.query(ActivityLog.event_type).filter(
            ActivityLog.timestamp >= thirty_days_ago
        ).all()
        
        other_count = 0
        for (event_type,) in all_events:
            if event_type not in event_types:
                other_count += 1
        
        return UsageByType(
            completion_request=usage_counts.get('completion_request', 0),
            chat_message=usage_counts.get('chat_message', 0),
            workspace_analysis=usage_counts.get('workspace_analysis', 0),
            resource_created=usage_counts.get('resource_created', 0),
            validation=usage_counts.get('validation', 0),
            cost_estimate=usage_counts.get('cost_estimate', 0),
            api_request=usage_counts.get('api_request', 0),
            other=other_count
        )
    
    def _calculate_usage_by_day(self, now: datetime, thirty_days_ago: datetime) -> List[UsageByDayDataPoint]:
        """Calculate daily usage for last 30 days"""
        usage_by_day = []
        for i in range(30):
            day_start = (now - timedelta(days=30-i)).replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)
            
            daily_events = self.auth_db.query(ActivityLog).filter(
                ActivityLog.timestamp >= day_start,
                ActivityLog.timestamp < day_end
            ).count()
            
            usage_by_day.append(UsageByDayDataPoint(
                date=day_start.date().isoformat(),
                events=daily_events
            ))
        
        return usage_by_day
    
    def _calculate_usage_by_tier(self, thirty_days_ago: datetime) -> UsageByTier:
        """Calculate usage breakdown by user tier"""
        # Get all usage events in last 30 days with user info
        usage_events = self.auth_db.query(ActivityLog).filter(
            ActivityLog.timestamp >= thirty_days_ago
        ).all()
        
        # Group by tier
        usage_by_tier = {'free': 0, 'pro': 0, 'enterprise': 0}
        
        # Get user tiers for all users who have activity
        user_ids = set(event.user_id for event in usage_events)
        
        # Query users in batches to get their tiers
        users = self.auth_db.query(UserAccount).filter(
            UserAccount.id.in_(list(user_ids))
        ).all()
        
        user_tier_map = {user.id: user.tier for user in users}
        
        # Count events by tier
        for event in usage_events:
            tier = user_tier_map.get(event.user_id, 'free')
            if tier in usage_by_tier:
                usage_by_tier[tier] += 1
        
        return UsageByTier(
            free=usage_by_tier['free'],
            pro=usage_by_tier['pro'],
            enterprise=usage_by_tier['enterprise']
        )
    
    def _calculate_top_users_by_usage(self, thirty_days_ago: datetime, limit: int = 10) -> List[TopUserByUsage]:
        """Calculate top users by usage in last 30 days"""
        from sqlalchemy import func
        
        # Get usage counts per user
        usage_counts = self.auth_db.query(
            ActivityLog.user_id,
            func.count(ActivityLog.id).label('event_count')
        ).filter(
            ActivityLog.timestamp >= thirty_days_ago
        ).group_by(ActivityLog.user_id).order_by(func.count(ActivityLog.id).desc()).limit(limit).all()
        
        # Get user details
        user_ids = [user_id for user_id, _ in usage_counts]
        users = self.auth_db.query(UserAccount).filter(
            UserAccount.id.in_(user_ids)
        ).all()
        
        user_map = {user.id: user for user in users}
        
        # Build top users list
        top_users = []
        for user_id, event_count in usage_counts:
            user = user_map.get(user_id)
            top_users.append(TopUserByUsage(
                user_id=user_id,
                email=user.email if user else None,
                tier=user.tier if user else 'free',
                total_events=event_count
            ))
        
        return top_users
    
    def _calculate_usage_trends(
        self,
        now: datetime,
        seven_days_ago: datetime,
        last_week_start: datetime,
        thirty_days_ago: datetime,
        last_month_start: datetime
    ) -> UsageTrends:
        """Calculate usage growth trends"""
        # Week-over-week: Compare last 7 days to previous 7 days
        current_week_events = self.auth_db.query(ActivityLog).filter(
            ActivityLog.timestamp >= seven_days_ago
        ).count()
        
        last_week_events = self.auth_db.query(ActivityLog).filter(
            ActivityLog.timestamp >= last_week_start,
            ActivityLog.timestamp < seven_days_ago
        ).count()
        
        week_over_week = None
        if last_week_events > 0:
            week_over_week = round(((current_week_events - last_week_events) / last_week_events * 100), 2)
        
        # Month-over-month: Compare last 30 days to previous 30 days
        current_month_events = self.auth_db.query(ActivityLog).filter(
            ActivityLog.timestamp >= thirty_days_ago
        ).count()
        
        last_month_events = self.auth_db.query(ActivityLog).filter(
            ActivityLog.timestamp >= last_month_start,
            ActivityLog.timestamp < thirty_days_ago
        ).count()
        
        month_over_month = None
        if last_month_events > 0:
            month_over_month = round(((current_month_events - last_month_events) / last_month_events * 100), 2)
        
        return UsageTrends(
            week_over_week=week_over_week,
            month_over_month=month_over_month
        )
    
    # ===== Product Analytics =====
    
    def calculate_product_analytics(self, primary_db: Session) -> Dict:
        """Calculate comprehensive product analytics"""
        now = datetime.utcnow()
        thirty_days_ago = now - timedelta(days=30)
        
        # Total PRs created
        total_prs_all_time = primary_db.query(PullRequest).count()
        total_prs_last_30_days = primary_db.query(PullRequest).filter(
            PullRequest.created_at >= thirty_days_ago
        ).count()
        
        # PRs by type (individual vs team)
        prs_by_type = self._calculate_prs_by_type(primary_db, thirty_days_ago)
        
        # Infrastructure resources generated (last 30 days)
        resources_generated = self.auth_db.query(ActivityLog).filter(
            ActivityLog.event_type == 'resource_created',
            ActivityLog.timestamp >= thirty_days_ago
        ).count()
        
        # Conversations created (last 30 days)
        conversations_created = primary_db.query(ConversationThread).filter(
            ConversationThread.created_at >= thirty_days_ago
        ).count()
        
        # Queries executed (last 30 days)
        queries_executed = primary_db.query(QueryLog).filter(
            QueryLog.created_at >= thirty_days_ago
        ).count()
        
        # Features used
        features_used = self._calculate_features_used(primary_db, thirty_days_ago)
        
        # Product usage chart data
        product_usage_chart_data = self._calculate_product_usage_chart_data(
            now, thirty_days_ago, primary_db
        )
        
        return {
            "total_prs_created": {
                "all_time": total_prs_all_time,
                "last_30_days": total_prs_last_30_days
            },
            "prs_by_type": prs_by_type,
            "infrastructure_resources_generated": resources_generated,
            "conversations_created": conversations_created,
            "queries_executed": queries_executed,
            "features_used": features_used,
            "product_usage_chart_data": product_usage_chart_data
        }
    
    def _calculate_prs_by_type(self, primary_db: Session, thirty_days_ago: datetime) -> PRsByType:
        """Calculate PRs grouped by individual vs team"""
        # Get all PRs in last 30 days
        prs = primary_db.query(PullRequest).filter(
            PullRequest.created_at >= thirty_days_ago
        ).all()
        
        # Get all team member user IDs
        team_member_user_ids = set()
        team_members = self.auth_db.query(TeamMember).filter(
            TeamMember.status == 'active'
        ).all()
        for member in team_members:
            team_member_user_ids.add(member.user_id)
        
        individual_count = 0
        team_count = 0
        
        for pr in prs:
            # If user is in a team, consider it a team PR
            if pr.user_id in team_member_user_ids:
                team_count += 1
            else:
                individual_count += 1
        
        return PRsByType(
            individual=individual_count,
            team=team_count
        )
    
    def _calculate_features_used(self, primary_db: Session, thirty_days_ago: datetime) -> FeaturesUsed:
        """Calculate usage of different product features"""
        # Drift detection - count drift events
        drift_detection = primary_db.query(ConfigurationDrift).filter(
            ConfigurationDrift.detected_at >= thirty_days_ago
        ).count()
        
        # Security scanning - count security-related events
        # This might be tracked in ActivityLog or as a specific event type
        security_scanning = self.auth_db.query(ActivityLog).filter(
            ActivityLog.event_type.like('%security%'),
            ActivityLog.timestamp >= thirty_days_ago
        ).count()
        
        # Cost estimation
        cost_estimation = self.auth_db.query(ActivityLog).filter(
            ActivityLog.event_type == 'cost_estimate',
            ActivityLog.timestamp >= thirty_days_ago
        ).count()
        
        # Validation
        validation = self.auth_db.query(ActivityLog).filter(
            ActivityLog.event_type == 'validation',
            ActivityLog.timestamp >= thirty_days_ago
        ).count()
        
        # Workspace analysis
        workspace_analysis = self.auth_db.query(ActivityLog).filter(
            ActivityLog.event_type == 'workspace_analysis',
            ActivityLog.timestamp >= thirty_days_ago
        ).count()
        
        # Other features (could include other event types not covered above)
        other = 0  # Can be expanded based on other feature event types
        
        return FeaturesUsed(
            drift_detection=drift_detection,
            security_scanning=security_scanning,
            cost_estimation=cost_estimation,
            validation=validation,
            workspace_analysis=workspace_analysis,
            other=other
        )
    
    def _calculate_product_usage_chart_data(
        self,
        now: datetime,
        thirty_days_ago: datetime,
        primary_db: Session
    ) -> List[ProductUsageDataPoint]:
        """Calculate daily product usage for last 30 days"""
        usage_data = []
        
        for i in range(30):
            day_start = (now - timedelta(days=30-i)).replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)
            
            # PRs created
            prs_created = primary_db.query(PullRequest).filter(
                PullRequest.created_at >= day_start,
                PullRequest.created_at < day_end
            ).count()
            
            # Resources generated
            resources_generated = self.auth_db.query(ActivityLog).filter(
                ActivityLog.event_type == 'resource_created',
                ActivityLog.timestamp >= day_start,
                ActivityLog.timestamp < day_end
            ).count()
            
            # Conversations created
            conversations_created = primary_db.query(ConversationThread).filter(
                ConversationThread.created_at >= day_start,
                ConversationThread.created_at < day_end
            ).count()
            
            # Queries executed
            queries_executed = primary_db.query(QueryLog).filter(
                QueryLog.created_at >= day_start,
                QueryLog.created_at < day_end
            ).count()
            
            usage_data.append(ProductUsageDataPoint(
                date=day_start.date().isoformat(),
                prs_created=prs_created,
                resources_generated=resources_generated,
                conversations_created=conversations_created,
                queries_executed=queries_executed
            ))
        
        return usage_data
    
    # ===== Engagement Analytics =====
    
    def calculate_engagement_analytics(self) -> Dict:
        """Calculate comprehensive engagement analytics"""
        now = datetime.utcnow()
        one_day_ago = now - timedelta(days=1)
        thirty_days_ago = now - timedelta(days=30)
        
        # DAU (Daily Active Users) - users with activity in last 24 hours
        dau = self.auth_db.query(UserAccount).filter(
            UserAccount.last_login_at >= one_day_ago
        ).count()
        
        # MAU (Monthly Active Users) - users with activity in last 30 days
        mau = self.auth_db.query(UserAccount).filter(
            UserAccount.last_login_at >= thirty_days_ago
        ).count()
        
        # DAU/MAU ratio
        dau_mau_ratio = round((dau / mau * 100) if mau > 0 else 0.0, 2)
        
        # User retention (Day 1, 7, 30)
        user_retention = self._calculate_user_retention()
        
        # Average session time and sessions per user
        session_metrics = self._calculate_session_metrics(thirty_days_ago)
        average_session_time_minutes = session_metrics['average_session_time']
        sessions_per_user = session_metrics['sessions_per_user']
        
        # Engagement chart data
        engagement_chart_data = self._calculate_engagement_chart_data(now, thirty_days_ago)
        
        return {
            "dau": dau,
            "mau": mau,
            "dau_mau_ratio": dau_mau_ratio,
            "user_retention": user_retention,
            "average_session_time_minutes": average_session_time_minutes,
            "sessions_per_user": sessions_per_user,
            "engagement_chart_data": engagement_chart_data
        }
    
    def _calculate_user_retention(self) -> UserRetention:
        """Calculate user retention at Day 1, 7, and 30"""
        # Get all users with signup dates
        all_users = self.auth_db.query(UserAccount).filter(
            UserAccount.created_at.isnot(None)
        ).all()
        
        retention_day_1 = 0
        retention_day_7 = 0
        retention_day_30 = 0
        total_users = 0
        
        for user in all_users:
            if not user.created_at:
                continue
            
            total_users += 1
            signup_date = user.created_at
            
            # Day 1 retention: logged in within 1-2 days after signup
            day_1_start = signup_date + timedelta(days=1)
            day_1_end = signup_date + timedelta(days=2)
            if user.last_login_at and day_1_start <= user.last_login_at < day_1_end:
                retention_day_1 += 1
            
            # Day 7 retention: logged in within 7-8 days after signup
            day_7_start = signup_date + timedelta(days=7)
            day_7_end = signup_date + timedelta(days=8)
            if user.last_login_at and day_7_start <= user.last_login_at < day_7_end:
                retention_day_7 += 1
            
            # Day 30 retention: logged in within 30-31 days after signup
            day_30_start = signup_date + timedelta(days=30)
            day_30_end = signup_date + timedelta(days=31)
            if user.last_login_at and day_30_start <= user.last_login_at < day_30_end:
                retention_day_30 += 1
        
        return UserRetention(
            day_1=round((retention_day_1 / total_users * 100) if total_users > 0 else 0.0, 2),
            day_7=round((retention_day_7 / total_users * 100) if total_users > 0 else 0.0, 2),
            day_30=round((retention_day_30 / total_users * 100) if total_users > 0 else 0.0, 2)
        )
    
    def _calculate_session_metrics(self, thirty_days_ago: datetime) -> Dict:
        """Calculate average session time and sessions per user"""
        # Get all activity logs in last 30 days
        all_activities = self.auth_db.query(ActivityLog).filter(
            ActivityLog.timestamp >= thirty_days_ago
        ).order_by(ActivityLog.user_id, ActivityLog.timestamp).all()
        
        # Group activities by user and identify sessions
        # A session is defined as activities with gaps no longer than 30 minutes
        SESSION_TIMEOUT_MINUTES = 30
        
        user_sessions = defaultdict(list)  # {user_id: [session_durations]}
        
        current_user = None
        current_session_start = None
        current_session_end = None
        
        for activity in all_activities:
            if current_user != activity.user_id:
                # New user - save previous session if exists
                if current_user and current_session_start and current_session_end:
                    duration = (current_session_end - current_session_start).total_seconds() / 60
                    user_sessions[current_user].append(duration)
                
                # Start new session
                current_user = activity.user_id
                current_session_start = activity.timestamp
                current_session_end = activity.timestamp
            else:
                # Same user - check if within session timeout
                time_since_last = (activity.timestamp - current_session_end).total_seconds() / 60
                
                if time_since_last <= SESSION_TIMEOUT_MINUTES:
                    # Continue current session
                    current_session_end = activity.timestamp
                else:
                    # Session ended - save it and start new one
                    if current_session_start and current_session_end:
                        duration = (current_session_end - current_session_start).total_seconds() / 60
                        user_sessions[current_user].append(duration)
                    
                    current_session_start = activity.timestamp
                    current_session_end = activity.timestamp
        
        # Save last session
        if current_user and current_session_start and current_session_end:
            duration = (current_session_end - current_session_start).total_seconds() / 60
            user_sessions[current_user].append(duration)
        
        # Calculate averages
        all_session_durations = []
        total_sessions = 0
        
        for user_id, sessions in user_sessions.items():
            all_session_durations.extend(sessions)
            total_sessions += len(sessions)
        
        average_session_time = round(
            sum(all_session_durations) / len(all_session_durations) if all_session_durations else 0.0,
            2
        )
        
        # Sessions per user (only count users with activity)
        active_users = len(user_sessions)
        sessions_per_user = round(
            (total_sessions / active_users) if active_users > 0 else 0.0,
            2
        )
        
        return {
            'average_session_time': average_session_time,
            'sessions_per_user': sessions_per_user
        }
    
    def _calculate_engagement_chart_data(
        self,
        now: datetime,
        thirty_days_ago: datetime
    ) -> List[EngagementDataPoint]:
        """Calculate daily engagement metrics for last 30 days"""
        engagement_data = []
        
        for i in range(30):
            day_start = (now - timedelta(days=30-i)).replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)
            
            # DAU for this day
            dau = self.auth_db.query(UserAccount).filter(
                UserAccount.last_login_at >= day_start,
                UserAccount.last_login_at < day_end
            ).count()
            
            # Get activities for this day
            day_activities = self.auth_db.query(ActivityLog).filter(
                ActivityLog.timestamp >= day_start,
                ActivityLog.timestamp < day_end
            ).order_by(ActivityLog.user_id, ActivityLog.timestamp).all()
            
            # Calculate sessions and average session time for this day
            SESSION_TIMEOUT_MINUTES = 30
            sessions = 0
            session_durations = []
            
            if day_activities:
                current_user = None
                current_session_start = None
                current_session_end = None
                
                for activity in day_activities:
                    if current_user != activity.user_id:
                        # New user - save previous session if exists
                        if current_user and current_session_start and current_session_end:
                            duration = (current_session_end - current_session_start).total_seconds() / 60
                            session_durations.append(duration)
                            sessions += 1
                        
                        # Start new session
                        current_user = activity.user_id
                        current_session_start = activity.timestamp
                        current_session_end = activity.timestamp
                    else:
                        # Same user - check if within session timeout
                        time_since_last = (activity.timestamp - current_session_end).total_seconds() / 60
                        
                        if time_since_last <= SESSION_TIMEOUT_MINUTES:
                            # Continue current session
                            current_session_end = activity.timestamp
                        else:
                            # Session ended - save it and start new one
                            if current_session_start and current_session_end:
                                duration = (current_session_end - current_session_start).total_seconds() / 60
                                session_durations.append(duration)
                                sessions += 1
                            
                            current_session_start = activity.timestamp
                            current_session_end = activity.timestamp
                
                # Save last session
                if current_user and current_session_start and current_session_end:
                    duration = (current_session_end - current_session_start).total_seconds() / 60
                    session_durations.append(duration)
                    sessions += 1
            
            average_session_time = round(
                sum(session_durations) / len(session_durations) if session_durations else 0.0,
                2
            )
            
            engagement_data.append(EngagementDataPoint(
                date=day_start.date().isoformat(),
                dau=dau,
                sessions=sessions,
                average_session_time_minutes=average_session_time
            ))
        
        return engagement_data