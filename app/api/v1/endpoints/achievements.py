"""
Achievement & Badge API endpoints
Track and display user achievements, medals, and leaderboards
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel

from app.database.connection import acquire_auth_session
from app.services.achievements import achievement_manager, AchievementType

router = APIRouter(prefix="/achievements", tags=["achievements"])


# ========== Request/Response Models ==========

class TrackActivityRequest(BaseModel):
    activity_type: str
    metadata: Optional[dict] = None


class AchievementResponse(BaseModel):
    type: str
    tier: str
    name: str
    icon: str
    description: str
    earned_at: str
    value: float


class UserStatsResponse(BaseModel):
    prs_created: int
    prs_merged: int
    ai_assisted_changes: int
    validations_passed: int
    security_fixes: int
    cost_saved_usd: float
    team_prs: int
    streak_days: int
    joined_at: str


# ========== Endpoints ==========

@router.post("/teams/{team_id}/users/{user_id}/track")
async def track_user_activity(
    team_id: str,
    user_id: str,
    request: TrackActivityRequest,
    db: Session = Depends(acquire_auth_session)
):
    """
    Track user activity and award achievements.
    
    Activity types:
    - pr_created
    - pr_merged
    - ai_code_generated
    - validation_passed
    - security_issue_fixed
    - cost_saved
    - team_pr_created
    - staging_contributed
    """
    achievement_manager.track_activity(
        team_id=team_id,
        user_id=user_id,
        activity_type=request.activity_type,
        metadata=request.metadata
    )
    
    return {
        "ok": True,
        "message": "Activity tracked successfully"
    }


@router.get("/teams/{team_id}/users/{user_id}/achievements")
async def get_user_achievements(
    team_id: str,
    user_id: str,
    db: Session = Depends(acquire_auth_session)
):
    """
    Get all achievements earned by a user.
    Returns list of medals, badges, and tiers.
    """
    achievements = achievement_manager.get_user_achievements(team_id, user_id)
    
    return {
        "ok": True,
        "user_id": user_id,
        "team_id": team_id,
        "achievements": achievements,
        "count": len(achievements)
    }


@router.get("/teams/{team_id}/users/{user_id}/stats")
async def get_user_stats(
    team_id: str,
    user_id: str,
    db: Session = Depends(acquire_auth_session)
):
    """
    Get detailed stats for a user.
    Shows PR count, AI usage, cost savings, etc.
    """
    stats = achievement_manager.get_user_stats(team_id, user_id)
    
    return {
        "ok": True,
        "user_id": user_id,
        "team_id": team_id,
        "stats": stats
    }


@router.get("/teams/{team_id}/leaderboard")
async def get_team_leaderboard(
    team_id: str,
    metric: str = Query("prs_created", description="Metric to rank by"),
    limit: int = Query(10, ge=1, le=100),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get team leaderboard for specific metric.
    
    Available metrics:
    - prs_created
    - team_prs
    - ai_assisted
    - cost_saved
    - streak
    """
    leaderboard = achievement_manager.get_leaderboard(team_id, metric, limit)
    
    return {
        "ok": True,
        "team_id": team_id,
        "metric": metric,
        "leaderboard": leaderboard
    }


@router.get("/teams/{team_id}/overview")
async def get_team_overview(
    team_id: str,
    db: Session = Depends(acquire_auth_session)
):
    """
    Get team-wide achievement overview.
    Shows total achievements, top contributors, stats.
    """
    overview = achievement_manager.get_team_overview(team_id)
    
    return {
        "ok": True,
        **overview
    }


@router.get("/teams/{team_id}/top-achievers")
async def get_top_achievers(
    team_id: str,
    limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get top achievers across all categories.
    Returns users with most achievements.
    """
    # Get all user achievements
    user_achievement_counts = []
    
    stats = achievement_manager.user_stats.get(team_id, {})
    for user_id in stats.keys():
        achievements = achievement_manager.get_user_achievements(team_id, user_id)
        user_stats = achievement_manager.get_user_stats(team_id, user_id)
        
        user_achievement_counts.append({
            'user_id': user_id,
            'achievement_count': len(achievements),
            'achievements': achievements,
            'prs_created': user_stats.get('prs_created', 0),
            'streak_days': user_stats.get('streak_days', 0)
        })
    
    # Sort by achievement count
    top_achievers = sorted(
        user_achievement_counts,
        key=lambda x: (x['achievement_count'], x['prs_created']),
        reverse=True
    )[:limit]
    
    return {
        "ok": True,
        "team_id": team_id,
        "top_achievers": top_achievers
    }


@router.get("/definitions")
async def get_achievement_definitions():
    """
    Get all achievement definitions.
    Shows what achievements are available and how to earn them.
    """
    from app.services.achievements import ACHIEVEMENT_DEFINITIONS
    
    # Convert to serializable format
    definitions = []
    for achievement_type, definition in ACHIEVEMENT_DEFINITIONS.items():
        definitions.append({
            'type': achievement_type,
            'name': definition['name'],
            'icon': definition['icon'],
            'description': definition['description'],
            'tiers': {
                tier: {
                    'threshold': config['threshold'],
                    'name': config['name']
                }
                for tier, config in definition['tiers'].items()
            }
        })
    
    return {
        "ok": True,
        "achievements": definitions,
        "count": len(definitions)
    }


@router.post("/teams/{team_id}/users/{user_id}/grant")
async def grant_achievement(
    team_id: str,
    user_id: str,
    achievement_type: str,
    tier: str,
    reason: Optional[str] = None,
    db: Session = Depends(acquire_auth_session)
):
    """
    Manually grant an achievement to a user.
    Admin-only endpoint for special awards.
    """
    # TODO: Verify admin permissions
    
    from app.services.achievements import ACHIEVEMENT_DEFINITIONS, AchievementType, AchievementTier
    
    try:
        ach_type = AchievementType(achievement_type)
        ach_tier = AchievementTier(tier)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid achievement type or tier")
    
    definition = ACHIEVEMENT_DEFINITIONS.get(ach_type)
    if not definition or ach_tier not in definition['tiers']:
        raise HTTPException(status_code=400, detail="Achievement configuration not found")
    
    # Grant achievement
    achievement = {
        'type': ach_type,
        'tier': ach_tier,
        'name': definition['tiers'][ach_tier]['name'],
        'icon': definition['icon'],
        'description': definition['description'],
        'earned_at': achievement_manager.datetime.utcnow().isoformat(),
        'value': 0,
        'manually_granted': True,
        'reason': reason
    }
    
    achievement_manager.user_achievements[team_id][user_id].append(achievement)
    
    return {
        "ok": True,
        "message": f"Granted {achievement['name']} to user",
        "achievement": achievement
    }

