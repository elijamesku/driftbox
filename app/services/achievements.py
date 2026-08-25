"""
Achievement & Badge System
Gamification for infrastructure contributions
Track medals, badges, and achievements for team members
"""
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from collections import defaultdict
from enum import Enum


class AchievementType(str, Enum):
    """Types of achievements"""
    # Collaboration
    TEAM_PLAYER = "team_player"
    MVP = "mvp"
    HOT_STREAK = "hot_streak"
    MENTOR = "mentor"
    COLLABORATOR = "collaborator"
    
    # AI Excellence
    AI_WHISPERER = "ai_whisperer"
    PROMPT_MASTER = "prompt_master"
    AUTOMATION_KING = "automation_king"
    
    # Quality
    ZERO_ERRORS = "zero_errors"
    SECURITY_CHAMPION = "security_champion"
    COST_OPTIMIZER = "cost_optimizer"
    HEALTH_HERO = "health_hero"
    
    # Speed
    SPEED_DEMON = "speed_demon"
    SPRINT_KING = "sprint_king"
    QUICK_FIX = "quick_fix"
    
    # Milestones
    FIRST_PR = "first_pr"
    HUNDRED_PRS = "hundred_prs"
    THOUSAND_COMMITS = "thousand_commits"
    
    # Special
    EARLY_ADOPTER = "early_adopter"
    BETA_TESTER = "beta_tester"
    FOUNDING_MEMBER = "founding_member"


class AchievementTier(str, Enum):
    """Achievement tiers/levels"""
    BRONZE = "bronze"
    SILVER = "silver"
    GOLD = "gold"
    PLATINUM = "platinum"
    DIAMOND = "diamond"


ACHIEVEMENT_DEFINITIONS = {
    # Collaboration Achievements
    AchievementType.TEAM_PLAYER: {
        "name": "Team Player",
        "icon": "🤝",
        "description": "Created multiple team PRs",
        "tiers": {
            AchievementTier.BRONZE: {"threshold": 5, "name": "Team Player"},
            AchievementTier.SILVER: {"threshold": 25, "name": "Team Veteran"},
            AchievementTier.GOLD: {"threshold": 100, "name": "Team Champion"},
            AchievementTier.PLATINUM: {"threshold": 500, "name": "Team Legend"},
        }
    },
    
    AchievementType.MVP: {
        "name": "MVP",
        "icon": "🌟",
        "description": "Most contributions this month",
        "tiers": {
            AchievementTier.GOLD: {"threshold": 1, "name": "Monthly MVP"},
            AchievementTier.PLATINUM: {"threshold": 3, "name": "Quarter MVP"},
            AchievementTier.DIAMOND: {"threshold": 6, "name": "Yearly MVP"},
        }
    },
    
    AchievementType.HOT_STREAK: {
        "name": "Hot Streak",
        "icon": "🔥",
        "description": "Consecutive days of contributions",
        "tiers": {
            AchievementTier.BRONZE: {"threshold": 3, "name": "3-Day Streak"},
            AchievementTier.SILVER: {"threshold": 7, "name": "Week Warrior"},
            AchievementTier.GOLD: {"threshold": 30, "name": "Month Master"},
            AchievementTier.PLATINUM: {"threshold": 100, "name": "Centurion"},
        }
    },
    
    # AI Excellence
    AchievementType.AI_WHISPERER: {
        "name": "AI Whisperer",
        "icon": "🤖",
        "description": "AI-assisted changes mastery",
        "tiers": {
            AchievementTier.BRONZE: {"threshold": 10, "name": "AI Novice"},
            AchievementTier.SILVER: {"threshold": 50, "name": "AI Practitioner"},
            AchievementTier.GOLD: {"threshold": 200, "name": "AI Expert"},
            AchievementTier.PLATINUM: {"threshold": 1000, "name": "AI Master"},
        }
    },
    
    AchievementType.PROMPT_MASTER: {
        "name": "Prompt Master",
        "icon": "🎯",
        "description": "High AI code acceptance rate",
        "tiers": {
            AchievementTier.SILVER: {"threshold": 80, "name": "Good Prompts (80%)"},
            AchievementTier.GOLD: {"threshold": 90, "name": "Great Prompts (90%)"},
            AchievementTier.PLATINUM: {"threshold": 95, "name": "Perfect Prompts (95%)"},
        }
    },
    
    # Quality
    AchievementType.ZERO_ERRORS: {
        "name": "Zero Errors",
        "icon": "✅",
        "description": "PRs with perfect validation",
        "tiers": {
            AchievementTier.BRONZE: {"threshold": 5, "name": "Clean Coder"},
            AchievementTier.SILVER: {"threshold": 20, "name": "Quality Expert"},
            AchievementTier.GOLD: {"threshold": 50, "name": "Perfection Master"},
            AchievementTier.PLATINUM: {"threshold": 200, "name": "Flawless Legend"},
        }
    },
    
    AchievementType.SECURITY_CHAMPION: {
        "name": "Security Champion",
        "icon": "🛡️",
        "description": "Fixed security issues",
        "tiers": {
            AchievementTier.BRONZE: {"threshold": 10, "name": "Security Aware"},
            AchievementTier.SILVER: {"threshold": 50, "name": "Security Guardian"},
            AchievementTier.GOLD: {"threshold": 200, "name": "Security Expert"},
            AchievementTier.PLATINUM: {"threshold": 1000, "name": "Security God"},
        }
    },
    
    AchievementType.COST_OPTIMIZER: {
        "name": "Cost Optimizer",
        "icon": "💰",
        "description": "Saved infrastructure costs",
        "tiers": {
            AchievementTier.BRONZE: {"threshold": 1000, "name": "Budget Saver ($1k)"},
            AchievementTier.SILVER: {"threshold": 10000, "name": "Cost Cutter ($10k)"},
            AchievementTier.GOLD: {"threshold": 50000, "name": "Money Master ($50k)"},
            AchievementTier.PLATINUM: {"threshold": 200000, "name": "Finance Hero ($200k)"},
        }
    },
    
    # Speed
    AchievementType.SPEED_DEMON: {
        "name": "Speed Demon",
        "icon": "⚡",
        "description": "Fastest PR creation",
        "tiers": {
            AchievementTier.GOLD: {"threshold": 5, "name": "Sub-5-Minute PR"},
            AchievementTier.PLATINUM: {"threshold": 2, "name": "Sub-2-Minute PR"},
            AchievementTier.DIAMOND: {"threshold": 1, "name": "Lightning Fast (< 1 min)"},
        }
    },
    
    AchievementType.SPRINT_KING: {
        "name": "Sprint King",
        "icon": "🏃",
        "description": "Most PRs in a week",
        "tiers": {
            AchievementTier.BRONZE: {"threshold": 10, "name": "Sprinter"},
            AchievementTier.SILVER: {"threshold": 25, "name": "Marathon Runner"},
            AchievementTier.GOLD: {"threshold": 50, "name": "Ultra Runner"},
        }
    },
    
    # Milestones
    AchievementType.FIRST_PR: {
        "name": "First PR",
        "icon": "🎉",
        "description": "Created your first pull request",
        "tiers": {
            AchievementTier.BRONZE: {"threshold": 1, "name": "First Steps"},
        }
    },
    
    AchievementType.HUNDRED_PRS: {
        "name": "Century",
        "icon": "💯",
        "description": "100 pull requests created",
        "tiers": {
            AchievementTier.GOLD: {"threshold": 100, "name": "Centurion"},
        }
    },
    
    # Special
    AchievementType.EARLY_ADOPTER: {
        "name": "Early Adopter",
        "icon": "🌅",
        "description": "Joined in the first month",
        "tiers": {
            AchievementTier.PLATINUM: {"threshold": 1, "name": "Pioneer"},
        }
    },
}


class AchievementManager:
    """
    Manages achievements, badges, and medals for users.
    Tracks progress and awards achievements based on activity.
    """
    
    def __init__(self):
        # User achievements: {team_id: {user_id: [achievements]}}
        self.user_achievements: Dict[str, Dict[str, List[Dict]]] = defaultdict(lambda: defaultdict(list))
        
        # User stats: {team_id: {user_id: stats}}
        self.user_stats: Dict[str, Dict[str, Dict]] = defaultdict(lambda: defaultdict(dict))
        
        # Leaderboards: {team_id: {metric: [(user_id, value)]}}
        self.leaderboards: Dict[str, Dict[str, List]] = defaultdict(lambda: defaultdict(list))
    
    # ========== Achievement Tracking ==========
    
    def track_activity(
        self,
        team_id: str,
        user_id: str,
        activity_type: str,
        metadata: Optional[Dict] = None
    ):
        """
        Track user activity and check for new achievements.
        
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
        # Initialize user stats if needed
        if user_id not in self.user_stats[team_id]:
            self.user_stats[team_id][user_id] = {
                'prs_created': 0,
                'prs_merged': 0,
                'ai_assisted_changes': 0,
                'validations_passed': 0,
                'security_fixes': 0,
                'cost_saved_usd': 0,
                'team_prs': 0,
                'staging_contributions': 0,
                'streak_days': 0,
                'last_activity': None,
                'joined_at': datetime.utcnow().isoformat(),
            }
        
        stats = self.user_stats[team_id][user_id]
        
        # Update stats based on activity
        if activity_type == 'pr_created':
            stats['prs_created'] += 1
            self._check_achievement(team_id, user_id, AchievementType.FIRST_PR, stats['prs_created'])
            self._check_achievement(team_id, user_id, AchievementType.HUNDRED_PRS, stats['prs_created'])
            
            # Check PR creation speed
            if metadata and 'time_taken_minutes' in metadata:
                self._check_achievement(team_id, user_id, AchievementType.SPEED_DEMON, metadata['time_taken_minutes'])
        
        elif activity_type == 'team_pr_created':
            stats['team_prs'] += 1
            self._check_achievement(team_id, user_id, AchievementType.TEAM_PLAYER, stats['team_prs'])
        
        elif activity_type == 'ai_code_generated':
            stats['ai_assisted_changes'] += 1
            self._check_achievement(team_id, user_id, AchievementType.AI_WHISPERER, stats['ai_assisted_changes'])
        
        elif activity_type == 'validation_passed':
            stats['validations_passed'] += 1
            self._check_achievement(team_id, user_id, AchievementType.ZERO_ERRORS, stats['validations_passed'])
        
        elif activity_type == 'security_issue_fixed':
            count = metadata.get('count', 1) if metadata else 1
            stats['security_fixes'] += count
            self._check_achievement(team_id, user_id, AchievementType.SECURITY_CHAMPION, stats['security_fixes'])
        
        elif activity_type == 'cost_saved':
            amount = metadata.get('amount_usd', 0) if metadata else 0
            stats['cost_saved_usd'] += amount
            self._check_achievement(team_id, user_id, AchievementType.COST_OPTIMIZER, stats['cost_saved_usd'])
        
        # Update streak
        self._update_streak(team_id, user_id)
        stats['last_activity'] = datetime.utcnow().isoformat()
        
        # Update leaderboards
        self._update_leaderboards(team_id)
    
    def _check_achievement(
        self,
        team_id: str,
        user_id: str,
        achievement_type: AchievementType,
        current_value: float
    ):
        """Check if user earned a new achievement tier"""
        definition = ACHIEVEMENT_DEFINITIONS.get(achievement_type)
        if not definition:
            return
        
        # Find highest tier achieved
        earned_tier = None
        for tier, config in definition['tiers'].items():
            if current_value >= config['threshold']:
                earned_tier = tier
        
        if not earned_tier:
            return
        
        # Check if user already has this achievement at this tier
        existing = self._get_user_achievement(team_id, user_id, achievement_type)
        if existing and existing.get('tier') == earned_tier:
            return  # Already has this tier
        
        # Award achievement
        achievement = {
            'type': achievement_type,
            'tier': earned_tier,
            'name': definition['tiers'][earned_tier]['name'],
            'icon': definition['icon'],
            'description': definition['description'],
            'earned_at': datetime.utcnow().isoformat(),
            'value': current_value
        }
        
        # Remove old tier if exists
        if existing:
            self.user_achievements[team_id][user_id] = [
                a for a in self.user_achievements[team_id][user_id]
                if a['type'] != achievement_type
            ]
        
        self.user_achievements[team_id][user_id].append(achievement)
        print(f"🏆 {user_id} earned: {achievement['name']} ({achievement['tier']})")
    
    def _get_user_achievement(
        self,
        team_id: str,
        user_id: str,
        achievement_type: AchievementType
    ) -> Optional[Dict]:
        """Get user's achievement of specific type"""
        for achievement in self.user_achievements[team_id][user_id]:
            if achievement['type'] == achievement_type:
                return achievement
        return None
    
    def _update_streak(self, team_id: str, user_id: str):
        """Update user's activity streak"""
        stats = self.user_stats[team_id][user_id]
        last_activity = stats.get('last_activity')
        
        if not last_activity:
            stats['streak_days'] = 1
            return
        
        last_date = datetime.fromisoformat(last_activity).date()
        today = datetime.utcnow().date()
        
        if (today - last_date).days == 1:
            # Consecutive day
            stats['streak_days'] += 1
            self._check_achievement(team_id, user_id, AchievementType.HOT_STREAK, stats['streak_days'])
        elif (today - last_date).days > 1:
            # Streak broken
            stats['streak_days'] = 1
    
    def _update_leaderboards(self, team_id: str):
        """Update team leaderboards"""
        stats = self.user_stats[team_id]
        
        # Sort by different metrics
        leaderboards = {
            'prs_created': sorted(stats.items(), key=lambda x: x[1].get('prs_created', 0), reverse=True),
            'team_prs': sorted(stats.items(), key=lambda x: x[1].get('team_prs', 0), reverse=True),
            'ai_assisted': sorted(stats.items(), key=lambda x: x[1].get('ai_assisted_changes', 0), reverse=True),
            'cost_saved': sorted(stats.items(), key=lambda x: x[1].get('cost_saved_usd', 0), reverse=True),
            'streak': sorted(stats.items(), key=lambda x: x[1].get('streak_days', 0), reverse=True),
        }
        
        self.leaderboards[team_id] = leaderboards
    
    # ========== Queries ==========
    
    def get_user_achievements(self, team_id: str, user_id: str) -> List[Dict]:
        """Get all achievements for a user"""
        return self.user_achievements[team_id][user_id]
    
    def get_user_stats(self, team_id: str, user_id: str) -> Dict:
        """Get stats for a user"""
        return self.user_stats[team_id][user_id]
    
    def get_leaderboard(self, team_id: str, metric: str = 'prs_created', limit: int = 10) -> List[Dict]:
        """Get team leaderboard for specific metric"""
        leaderboard = self.leaderboards[team_id].get(metric, [])
        
        result = []
        for idx, (user_id, stats) in enumerate(leaderboard[:limit]):
            result.append({
                'rank': idx + 1,
                'user_id': user_id,
                'value': stats.get(metric, 0),
                'achievements_count': len(self.user_achievements[team_id][user_id])
            })
        
        return result
    
    def get_team_overview(self, team_id: str) -> Dict:
        """Get team-wide achievement overview"""
        stats = self.user_stats[team_id]
        
        total_prs = sum(s.get('prs_created', 0) for s in stats.values())
        total_ai_changes = sum(s.get('ai_assisted_changes', 0) for s in stats.values())
        total_cost_saved = sum(s.get('cost_saved_usd', 0) for s in stats.values())
        
        return {
            'team_id': team_id,
            'total_members': len(stats),
            'total_prs': total_prs,
            'total_ai_changes': total_ai_changes,
            'total_cost_saved_usd': total_cost_saved,
            'top_contributor': self.leaderboards[team_id].get('prs_created', [[None]])[0][0] if self.leaderboards[team_id].get('prs_created') else None,
        }


# Global achievement manager instance
achievement_manager = AchievementManager()

