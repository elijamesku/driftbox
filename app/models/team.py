"""
Team management models for collaborative infrastructure management.
Enables teams to share repositories, manage members, and collaborate on infrastructure.
"""
from datetime import datetime, timedelta
from typing import Optional, List
from sqlalchemy import Column, String, Integer, DateTime, Boolean, ForeignKey, JSON, Float
from sqlalchemy.orm import relationship
from app.database.connection import AuthBase
from app.utils.ids import create_unique_identifier
import secrets


class Team(AuthBase):
    """
    Organization/team that can have multiple members and shared repositories.
    Supports team billing and role-based access control.
    """
    __tablename__ = "teams"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    name = Column(String(255), nullable=False)
    slug = Column(String(255), unique=True, nullable=False, index=True)
    
    # Billing (Stripe integration)
    stripe_customer_id = Column(String(255), unique=True, nullable=True)
    stripe_subscription_id = Column(String(255), unique=True, nullable=True)
    plan = Column(String(50), default='free')  # 'free', 'team', 'enterprise'
    billing_email = Column(String(255), nullable=True)
    seats_limit = Column(Integer, default=2)  # Max team members (free: 2, team: 10, enterprise: unlimited)
    
    # Cloud provider credentials (shared across team)
    digitalocean_access_token = Column(String(500), nullable=True)  # Encrypted storage recommended
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)  # Soft delete
    
    # Relationships
    members = relationship("TeamMember", back_populates="team", cascade="all, delete-orphan")
    repositories = relationship("TeamRepository", back_populates="team", cascade="all, delete-orphan")
    invitations = relationship("TeamInvitation", back_populates="team", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Team {self.id}: {self.name}>"
    
    def to_dict(self):
        # Safely access relationships (they might not be loaded)
        try:
            member_count = len([m for m in self.members if m.status == 'active'])
        except:
            member_count = 0
        
        try:
            repo_count = len(self.repositories)
        except:
            repo_count = 0
        
        return {
            'id': self.id,
            'name': self.name,
            'slug': self.slug,
            'plan': self.plan,
            'seats_limit': self.seats_limit,
            'member_count': member_count,
            'repo_count': repo_count,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class TeamMember(AuthBase):
    """
    User membership in a team with role-based permissions.
    Tracks invitation and access status.
    """
    __tablename__ = "team_members"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    team_id = Column(String(36), ForeignKey('teams.id'), nullable=False, index=True)
    user_id = Column(String(36), nullable=False, index=True)  # FK removed - causes DB constraint issues
    
    # Role-based access control
    role = Column(String(50), default='developer', nullable=False, index=True)
    # Roles: 'admin', 'developer', 'viewer'
    
    # Invitation tracking
    invited_by = Column(String(36), nullable=True)  # FK removed - causes DB constraint issues
    invited_at = Column(DateTime, default=datetime.utcnow)
    joined_at = Column(DateTime, nullable=True)
    
    # Status
    status = Column(String(50), default='active')  # 'active', 'invited', 'suspended'
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    team = relationship("Team", back_populates="members")
    
    def __repr__(self):
        return f"<TeamMember {self.id}: {self.user_id} in {self.team_id}>"
    
    def to_dict(self):
        return {
            'id': self.id,
            'team_id': self.team_id,
            'user_id': self.user_id,
            'role': self.role,
            'status': self.status,
            'joined_at': self.joined_at.isoformat() if self.joined_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class TeamRepository(AuthBase):
    """
    Repository shared across team members.
    All team members get access based on their role.
    """
    __tablename__ = "team_repositories"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    team_id = Column(String(36), ForeignKey('teams.id'), nullable=False, index=True)
    
    # Repository info
    repo_full_name = Column(String(255), nullable=False, index=True)  # "owner/repo"
    repo_owner = Column(String(255), nullable=False)
    repo_name = Column(String(255), nullable=False)
    
    # Access control
    added_by = Column(String(36), nullable=True)  # FK removed - causes DB constraint issues
    added_at = Column(DateTime, default=datetime.utcnow)
    
    # Repository-specific permissions (for future granular control)
    permissions = Column(JSON, default={'read': True, 'write': True, 'deploy': True})
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    team = relationship("Team", back_populates="repositories")
    
    def __repr__(self):
        return f"<TeamRepository {self.id}: {self.repo_full_name}>"
    
    def to_dict(self):
        return {
            'id': self.id,
            'team_id': self.team_id,
            'repo_full_name': self.repo_full_name,
            'repo_owner': self.repo_owner,
            'repo_name': self.repo_name,
            'permissions': self.permissions,
            'added_at': self.added_at.isoformat() if self.added_at else None
        }


class TeamInvitation(AuthBase):
    """
    Pending team member invitations sent via email.
    Contains secure token for accepting invitation.
    """
    __tablename__ = "team_invitations"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    team_id = Column(String(36), ForeignKey('teams.id'), nullable=False, index=True)
    
    # Invitee info
    email = Column(String(255), nullable=False, index=True)
    role = Column(String(50), default='developer', nullable=False)
    
    # Invitation tracking
    invited_by = Column(String(36), nullable=True)  # FK removed - causes DB constraint issues
    invitation_token = Column(String(255), unique=True, nullable=False, index=True)
    
    # Status
    status = Column(String(50), default='pending')  # 'pending', 'accepted', 'expired', 'cancelled'
    expires_at = Column(DateTime, nullable=False)
    accepted_at = Column(DateTime, nullable=True)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    team = relationship("Team", back_populates="invitations")
    
    def __repr__(self):
        return f"<TeamInvitation {self.id}: {self.email} to {self.team_id}>"
    
    @staticmethod
    def generate_token():
        """Generate secure invitation token"""
        return secrets.token_urlsafe(32)
    
    @staticmethod
    def default_expiry():
        """Invitations expire after 7 days"""
        return datetime.utcnow() + timedelta(days=7)
    
    def is_expired(self):
        """Check if invitation has expired"""
        return datetime.utcnow() > self.expires_at
    
    def to_dict(self):
        return {
            'id': self.id,
            'team_id': self.team_id,
            'email': self.email,
            'role': self.role,
            'status': self.status,
            'invitation_token': self.invitation_token,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class TeamAuditLog(AuthBase):
    """
    Audit trail of all team-level actions.
    Required for compliance and security monitoring.
    """
    __tablename__ = "team_audit_log"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    team_id = Column(String(36), ForeignKey('teams.id'), nullable=False, index=True)
    user_id = Column(String(36), nullable=True)  # FK removed - causes DB constraint issues
    
    # Action details
    action = Column(String(100), nullable=False, index=True)
    # Actions: 'member_added', 'member_removed', 'role_changed', 'repo_added', 'repo_removed', 'plan_changed'
    resource_type = Column(String(50), nullable=True)  # 'member', 'repository', 'team', 'billing'
    resource_id = Column(String(36), nullable=True)
    
    # Change details (for audit trail)
    changes = Column(JSON, nullable=True)
    # Example: {"before": {"role": "developer"}, "after": {"role": "admin"}}
    
    # Request metadata
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    def __repr__(self):
        return f"<TeamAuditLog {self.id}: {self.action}>"
    
    def to_dict(self):
        return {
            'id': self.id,
            'team_id': self.team_id,
            'user_id': self.user_id,
            'action': self.action,
            'resource_type': self.resource_type,
            'changes': self.changes,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


# Role permissions mapping
ROLE_PERMISSIONS = {
    'admin': {
        'read': True,
        'write': True,
        'deploy': True,
        'manage_members': True,
        'manage_billing': True,
        'manage_team': True
    },
    'developer': {
        'read': True,
        'write': True,
        'deploy': True,  # Can create PRs
        'manage_members': False,
        'manage_billing': False,
        'manage_team': False
    },
    'viewer': {
        'read': True,
        'write': False,
        'deploy': False,
        'manage_members': False,
        'manage_billing': False,
        'manage_team': False
    }
}


def check_permission(role: str, permission: str) -> bool:
    """Check if a role has a specific permission"""
    return ROLE_PERMISSIONS.get(role, {}).get(permission, False)

