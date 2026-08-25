"""
Team management service layer.
Handles team creation, member management, invitations, and RBAC.
"""
from typing import Optional, List, Dict, Any
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from app.models.team import (
    Team, TeamMember, TeamRepository, TeamInvitation,  # TeamAuditLog disabled due to DB constraint issue
    check_permission, ROLE_PERMISSIONS
)
from app.database.models import UserAccount
from app.services.email_service import send_team_invitation_email
import secrets
import re


class TeamService:
    """Service for managing teams, members, and permissions"""
    
    def __init__(self, db: Session):
        self.db = db
    
    # ========== Team Management ==========
    
    def create_team(
        self, 
        name: str, 
        creator_id: str,
        plan: str = 'free',
        billing_email: Optional[str] = None
    ) -> Team:
        """
        Create a new team and add creator as admin.
        """
        # Generate URL-safe slug
        slug = self._generate_slug(name)
        
        # Create team
        team = Team(
            name=name,
            slug=slug,
            plan=plan,
            billing_email=billing_email,
            seats_limit=2 if plan == 'free' else (10 if plan == 'team' else 999)
        )
        self.db.add(team)
        self.db.flush()
        
        # Add creator as admin
        member = TeamMember(
            team_id=team.id,
            user_id=creator_id,
            role='admin',
            status='active',
            joined_at=datetime.utcnow()
        )
        self.db.add(member)
        
        # Audit log
        self._log_action(
            team_id=team.id,
            user_id=creator_id,
            action='team_created',
            resource_type='team',
            resource_id=team.id
        )
        
        self.db.commit()
        self.db.refresh(team)
        return team
    
    def get_team(self, team_id: str) -> Optional[Team]:
        """Get team by ID"""
        return self.db.query(Team).filter(
            Team.id == team_id,
            Team.deleted_at.is_(None)
        ).first()
    
    def get_team_by_slug(self, slug: str) -> Optional[Team]:
        """Get team by slug"""
        return self.db.query(Team).filter(
            Team.slug == slug,
            Team.deleted_at.is_(None)
        ).first()
    
    def get_user_teams(self, user_id: str) -> List[Team]:
        """Get all teams user is a member of"""
        memberships = self.db.query(TeamMember).filter(
            TeamMember.user_id == user_id,
            TeamMember.status == 'active'
        ).all()
        
        team_ids = [m.team_id for m in memberships]
        teams = self.db.query(Team).filter(
            Team.id.in_(team_ids),
            Team.deleted_at.is_(None)
        ).all()
        
        return teams
    
    def update_team(
        self, 
        team_id: str, 
        user_id: str,
        **updates
    ) -> Team:
        """Update team details (admin only)"""
        # Check permission
        if not self.check_user_permission(team_id, user_id, 'manage_team'):
            raise PermissionError("Only admins can update team")
        
        team = self.get_team(team_id)
        if not team:
            raise ValueError("Team not found")
        
        # Prevent credential updates through this method - use set_team_credentials instead
        restricted_fields = ['digitalocean_access_token']
        for field in restricted_fields:
            if field in updates:
                raise ValueError(f"Cannot update {field} through this method. Use the dedicated credentials endpoint.")
        
        # Track changes for audit
        changes = {}
        for key, value in updates.items():
            if hasattr(team, key) and getattr(team, key) != value:
                changes[key] = {'before': getattr(team, key), 'after': value}
                setattr(team, key, value)
        
        team.updated_at = datetime.utcnow()
        
        # Audit log
        if changes:
            self._log_action(
                team_id=team_id,
                user_id=user_id,
                action='team_updated',
                resource_type='team',
                resource_id=team_id,
                changes=changes
            )
        
        self.db.commit()
        self.db.refresh(team)
        return team
    
    def delete_team(self, team_id: str, user_id: str) -> bool:
        """
        Delete a team and all associated data.
        Only the team creator/admin can delete.
        """
        # Check permission - must be admin
        if not self.check_user_permission(team_id, user_id, 'manage_team'):
            raise PermissionError("Only admins can delete team")
        
        team = self.get_team(team_id)
        if not team:
            raise ValueError("Team not found")
        
        # Delete all related data (cascade should handle most, but be explicit)
        # Delete invitations
        self.db.query(TeamInvitation).filter(TeamInvitation.team_id == team_id).delete()
        
        # Delete repositories
        self.db.query(TeamRepository).filter(TeamRepository.team_id == team_id).delete()
        
        # Delete members
        self.db.query(TeamMember).filter(TeamMember.team_id == team_id).delete()
        
        # Delete team
        self.db.delete(team)
        self.db.commit()
        
        return True
    
    # ========== Member Management ==========
    
    def get_team_members(self, team_id: str) -> List[Dict[str, Any]]:
        """Get all team members with user details"""
        members = self.db.query(TeamMember, UserAccount).join(
            UserAccount, TeamMember.user_id == UserAccount.id
        ).filter(
            TeamMember.team_id == team_id,
            TeamMember.status == 'active'
        ).all()
        
        return [
            {
                **member.to_dict(),
                'user': {
                    'id': user.id,
                    'email': user.email,
                    'full_name': user.full_name,
                    'github_username': user.github_username
                }
            }
            for member, user in members
        ]
    
    def get_team_member(
        self, 
        team_id: str, 
        user_id: str
    ) -> Optional[TeamMember]:
        """Get specific team member"""
        return self.db.query(TeamMember).filter(
            TeamMember.team_id == team_id,
            TeamMember.user_id == user_id,
            TeamMember.status == 'active'
        ).first()
    
    def add_team_member(
        self,
        team_id: str,
        user_id: str,
        role: str,
        added_by: str
    ) -> TeamMember:
        """Add user to team (direct add, not invitation)"""
        # Check permission
        if not self.check_user_permission(team_id, added_by, 'manage_members'):
            raise PermissionError("Only admins can add members")
        
        # Check if user already in team
        existing = self.get_team_member(team_id, user_id)
        if existing:
            raise ValueError("User already in team")
        
        # Check seats limit
        team = self.get_team(team_id)
        if not self._has_available_seats(team):
            raise ValueError("Team has reached maximum seats")
        
        # Add member
        member = TeamMember(
            team_id=team_id,
            user_id=user_id,
            role=role,
            invited_by=added_by,
            status='active',
            joined_at=datetime.utcnow()
        )
        self.db.add(member)
        
        # Audit log
        self._log_action(
            team_id=team_id,
            user_id=added_by,
            action='member_added',
            resource_type='member',
            resource_id=member.id,
            changes={'user_id': user_id, 'role': role}
        )
        
        self.db.commit()
        self.db.refresh(member)
        return member
    
    def remove_team_member(
        self,
        team_id: str,
        user_id: str,
        removed_by: str
    ) -> bool:
        """Remove user from team"""
        # Check permission (can remove self or admin can remove others)
        if user_id != removed_by:
            if not self.check_user_permission(team_id, removed_by, 'manage_members'):
                raise PermissionError("Only admins can remove other members")
        
        member = self.get_team_member(team_id, user_id)
        if not member:
            raise ValueError("Member not found")
        
        # Can't remove last admin
        if member.role == 'admin':
            admin_count = self.db.query(TeamMember).filter(
                TeamMember.team_id == team_id,
                TeamMember.role == 'admin',
                TeamMember.status == 'active'
            ).count()
            
            if admin_count <= 1:
                raise ValueError("Cannot remove last admin")
        
        # Soft delete (keep for audit)
        member.status = 'removed'
        member.updated_at = datetime.utcnow()
        
        # Audit log
        self._log_action(
            team_id=team_id,
            user_id=removed_by,
            action='member_removed',
            resource_type='member',
            resource_id=member.id,
            changes={'user_id': user_id, 'role': member.role}
        )
        
        self.db.commit()
        return True
    
    def update_member_role(
        self,
        team_id: str,
        user_id: str,
        new_role: str,
        updated_by: str
    ) -> TeamMember:
        """Change team member's role"""
        # Check permission
        if not self.check_user_permission(team_id, updated_by, 'manage_members'):
            raise PermissionError("Only admins can change roles")
        
        # Can't change own role if last admin
        member = self.get_team_member(team_id, user_id)
        if not member:
            raise ValueError("Member not found")
        
        if member.role == 'admin' and new_role != 'admin':
            admin_count = self.db.query(TeamMember).filter(
                TeamMember.team_id == team_id,
                TeamMember.role == 'admin',
                TeamMember.status == 'active'
            ).count()
            
            if admin_count <= 1:
                raise ValueError("Cannot demote last admin")
        
        old_role = member.role
        member.role = new_role
        member.updated_at = datetime.utcnow()
        
        # Audit log
        self._log_action(
            team_id=team_id,
            user_id=updated_by,
            action='role_changed',
            resource_type='member',
            resource_id=member.id,
            changes={'before': {'role': old_role}, 'after': {'role': new_role}}
        )
        
        self.db.commit()
        self.db.refresh(member)
        return member
    
    # ========== Invitations ==========
    
    def create_invitation(
        self,
        team_id: str,
        email: str,
        role: str,
        invited_by: str
    ) -> TeamInvitation:
        """Send team invitation via email"""
        # Check permission
        if not self.check_user_permission(team_id, invited_by, 'manage_members'):
            raise PermissionError("Only admins can invite members")
        
        # Check if already invited
        existing = self.db.query(TeamInvitation).filter(
            TeamInvitation.team_id == team_id,
            TeamInvitation.email == email,
            TeamInvitation.status == 'pending'
        ).first()
        
        if existing:
            raise ValueError("User already invited")
        
        # Check if already member
        user = self.db.query(UserAccount).filter(UserAccount.email == email).first()
        if user:
            existing_member = self.get_team_member(team_id, user.id)
            if existing_member:
                raise ValueError("User already in team")
        
        # Check seats limit
        team = self.get_team(team_id)
        if not self._has_available_seats(team):
            raise ValueError("Team has reached maximum seats")
        
        # Create invitation
        invitation = TeamInvitation(
            team_id=team_id,
            email=email,
            role=role,
            invited_by=invited_by,
            invitation_token=TeamInvitation.generate_token(),
            expires_at=TeamInvitation.default_expiry(),
            status='pending'
        )
        self.db.add(invitation)
        
        # Audit log
        self._log_action(
            team_id=team_id,
            user_id=invited_by,
            action='invitation_sent',
            resource_type='invitation',
            resource_id=invitation.id,
            changes={'email': email, 'role': role}
        )
        
        self.db.commit()
        self.db.refresh(invitation)
        
        # Send email
        try:
            send_team_invitation_email(
                email=email,
                team_name=team.name,
                inviter_name=self._get_user_name(invited_by),
                invitation_url=f"driftbox://invite/{invitation.invitation_token}",
                role=role
            )
        except Exception as e:
            print(f"Failed to send invitation email: {e}")
            # Don't fail the invitation creation
        
        return invitation
    
    def accept_invitation(
        self,
        token: str,
        user_id: str
    ) -> TeamMember:
        """Accept team invitation and add user to team"""
        invitation = self.db.query(TeamInvitation).filter(
            TeamInvitation.invitation_token == token,
            TeamInvitation.status == 'pending'
        ).first()
        
        if not invitation:
            raise ValueError("Invalid invitation token")
        
        if invitation.is_expired():
            invitation.status = 'expired'
            self.db.commit()
            raise ValueError("Invitation has expired")
        
        # Check if user already a member
        existing = self.db.query(TeamMember).filter(
            TeamMember.team_id == invitation.team_id,
            TeamMember.user_id == user_id
        ).first()
        if existing:
            raise ValueError("Already a member of this team")
        
        # Add to team
        member = TeamMember(
            team_id=invitation.team_id,
            user_id=user_id,
            role=invitation.role,
            invited_by=invitation.invited_by,
            invited_at=invitation.created_at,
            status='active',
            joined_at=datetime.utcnow()
        )
        self.db.add(member)
        
        # Mark invitation as accepted
        invitation.status = 'accepted'
        invitation.accepted_at = datetime.utcnow()
        
        # Audit log
        self._log_action(
            team_id=invitation.team_id,
            user_id=user_id,
            action='invitation_accepted',
            resource_type='member',
            resource_id=member.id,
            changes={'email': invitation.email, 'role': invitation.role}
        )
        
        self.db.commit()
        self.db.refresh(member)
        return member
    
    def cancel_invitation(
        self,
        invitation_id: str,
        cancelled_by: str
    ) -> bool:
        """Cancel pending invitation"""
        invitation = self.db.query(TeamInvitation).filter(
            TeamInvitation.id == invitation_id
        ).first()
        
        if not invitation:
            raise ValueError("Invitation not found")
        
        # Check permission
        if not self.check_user_permission(invitation.team_id, cancelled_by, 'manage_members'):
            raise PermissionError("Only admins can cancel invitations")
        
        invitation.status = 'cancelled'
        invitation.updated_at = datetime.utcnow()
        
        # Audit log
        self._log_action(
            team_id=invitation.team_id,
            user_id=cancelled_by,
            action='invitation_cancelled',
            resource_type='invitation',
            resource_id=invitation_id
        )
        
        self.db.commit()
        return True
    
    def get_team_invitations(self, team_id: str) -> List[TeamInvitation]:
        """Get all pending invitations for team"""
        return self.db.query(TeamInvitation).filter(
            TeamInvitation.team_id == team_id,
            TeamInvitation.status == 'pending'
        ).all()
    
    # ========== Repository Management ==========
    
    def add_repository(
        self,
        team_id: str,
        repo_full_name: str,
        added_by: str
    ) -> TeamRepository:
        """Add repository to team"""
        # Check permission
        if not self.check_user_permission(team_id, added_by, 'write'):
            raise PermissionError("Insufficient permissions to add repository")
        
        # Parse repo name
        parts = repo_full_name.split('/')
        if len(parts) != 2:
            raise ValueError("Invalid repository format. Use 'owner/repo'")
        
        repo_owner, repo_name = parts
        
        # Check if already added
        existing = self.db.query(TeamRepository).filter(
            TeamRepository.team_id == team_id,
            TeamRepository.repo_full_name == repo_full_name
        ).first()
        
        if existing:
            raise ValueError("Repository already added to team")
        
        # Add repository
        repo = TeamRepository(
            team_id=team_id,
            repo_full_name=repo_full_name,
            repo_owner=repo_owner,
            repo_name=repo_name,
            added_by=added_by
        )
        self.db.add(repo)
        
        # Audit log
        self._log_action(
            team_id=team_id,
            user_id=added_by,
            action='repository_added',
            resource_type='repository',
            resource_id=repo.id,
            changes={'repo': repo_full_name}
        )
        
        self.db.commit()
        self.db.refresh(repo)
        return repo
    
    def remove_repository(
        self,
        team_id: str,
        repo_id: str,
        removed_by: str
    ) -> bool:
        """Remove repository from team"""
        # Check permission
        if not self.check_user_permission(team_id, removed_by, 'manage_team'):
            raise PermissionError("Only admins can remove repositories")
        
        repo = self.db.query(TeamRepository).filter(
            TeamRepository.id == repo_id,
            TeamRepository.team_id == team_id
        ).first()
        
        if not repo:
            raise ValueError("Repository not found")
        
        repo_name = repo.repo_full_name
        
        # Audit log
        self._log_action(
            team_id=team_id,
            user_id=removed_by,
            action='repository_removed',
            resource_type='repository',
            resource_id=repo_id,
            changes={'repo': repo_name}
        )
        
        self.db.delete(repo)
        self.db.commit()
        return True
    
    def get_team_repositories(self, team_id: str) -> List[TeamRepository]:
        """Get all repositories for team"""
        return self.db.query(TeamRepository).filter(
            TeamRepository.team_id == team_id
        ).all()
    
    def user_can_access_repo(
        self,
        user_id: str,
        repo_full_name: str
    ) -> bool:
        """Check if user has access to repository through any team"""
        member_teams = self.db.query(TeamMember.team_id).filter(
            TeamMember.user_id == user_id,
            TeamMember.status == 'active'
        ).all()
        
        team_ids = [t[0] for t in member_teams]
        
        repo = self.db.query(TeamRepository).filter(
            TeamRepository.team_id.in_(team_ids),
            TeamRepository.repo_full_name == repo_full_name
        ).first()
        
        return repo is not None
    
    # ========== Permissions & RBAC ==========
    
    def check_user_permission(
        self,
        team_id: str,
        user_id: str,
        permission: str
    ) -> bool:
        """Check if user has specific permission in team"""
        member = self.get_team_member(team_id, user_id)
        if not member:
            return False
        
        return check_permission(member.role, permission)
    
    def get_user_role(
        self,
        team_id: str,
        user_id: str
    ) -> Optional[str]:
        """Get user's role in team"""
        member = self.get_team_member(team_id, user_id)
        return member.role if member else None
    
    # ========== Audit & Logging ==========
    
    def get_team_audit_log(
        self,
        team_id: str,
        limit: int = 100
    ) -> List[Dict]:
        """Get audit log for team (DISABLED: returns empty due to DB constraint issue)"""
        # TeamAuditLog model disabled due to foreign key constraint error
        print(f"⚠️  Audit log disabled (DB constraint issue)")
        return []
    
    def _log_action(
        self,
        team_id: str,
        user_id: str,
        action: str,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        changes: Optional[Dict] = None
    ):
        """Create audit log entry (DISABLED due to DB constraint issue)"""
        # TeamAuditLog model disabled - just log to console for now
        pass  # Silently skip audit logging
    
    # ========== Helper Methods ==========
    
    def _generate_slug(self, name: str) -> str:
        """Generate URL-safe slug from team name"""
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        
        # Ensure uniqueness
        base_slug = slug
        counter = 1
        while self.db.query(Team).filter(Team.slug == slug).first():
            slug = f"{base_slug}-{counter}"
            counter += 1
        
        return slug
    
    def _has_available_seats(self, team: Team) -> bool:
        """Check if team has available seats"""
        active_members = self.db.query(TeamMember).filter(
            TeamMember.team_id == team.id,
            TeamMember.status == 'active'
        ).count()
        
        pending_invitations = self.db.query(TeamInvitation).filter(
            TeamInvitation.team_id == team.id,
            TeamInvitation.status == 'pending'
        ).count()
        
        return (active_members + pending_invitations) < team.seats_limit
    
    def _get_user_name(self, user_id: str) -> str:
        """Get user's display name"""
        user = self.db.query(UserAccount).filter(UserAccount.id == user_id).first()
        if not user:
            return "Unknown"
        return user.full_name or user.github_username or user.email
    
    def get_digitalocean_token(self, team_id: Optional[str], user: UserAccount) -> Optional[str]:
        """
        Get DigitalOcean token with fallback priority:
        1. Team credentials (if team_id provided)
        2. User credentials
        3. Environment variable
        
        Returns the token or None if not found.
        """
        import os
        
        # 1. Try team credentials first
        if team_id:
            team = self.get_team(team_id)
            if team:
                if team.digitalocean_access_token:
                    print(f"[TeamService] Found DO token for team: {team.name} ({team_id})")
                    return team.digitalocean_access_token
                else:
                    print(f"[TeamService] Team {team.name} ({team_id}) has no DO token configured")
            else:
                print(f"[TeamService] Team {team_id} not found")
        
        # 2. Try user credentials
        if user and user.digitalocean_access_token:
            print(f"[TeamService] Using DO token from user: {user.id}")
            return user.digitalocean_access_token
        
        # 3. Try environment variable
        env_token = os.environ.get('DIGITALOCEAN_TOKEN')
        if env_token:
            print(f"[TeamService] Using DO token from environment variable")
        return env_token

