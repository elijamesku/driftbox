-- Team Management Schema
-- Enables team collaboration, RBAC, and team billing

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL, -- For URLs: /team/acme-corp
    
    -- Billing
    stripe_customer_id VARCHAR(255) UNIQUE,
    stripe_subscription_id VARCHAR(255) UNIQUE,
    plan VARCHAR(50) DEFAULT 'free', -- 'free', 'team', 'enterprise'
    billing_email VARCHAR(255),
    seats_limit INTEGER DEFAULT 1, -- Max team members allowed
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL -- Soft delete for billing continuity
);

-- Team members (users in teams)
CREATE TABLE IF NOT EXISTS team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    
    -- Role-based access control
    role VARCHAR(50) NOT NULL DEFAULT 'developer', -- 'admin', 'developer', 'viewer'
    
    -- Invitation tracking
    invited_by UUID REFERENCES user_accounts(id),
    invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    joined_at TIMESTAMP NULL, -- NULL if invitation pending
    
    -- Status
    status VARCHAR(50) DEFAULT 'active', -- 'active', 'invited', 'suspended'
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(team_id, user_id) -- User can only be in team once
);

-- Team repositories (shared repo access)
CREATE TABLE IF NOT EXISTS team_repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    
    -- Repository info
    repo_full_name VARCHAR(255) NOT NULL, -- "owner/repo"
    repo_owner VARCHAR(255) NOT NULL,
    repo_name VARCHAR(255) NOT NULL,
    
    -- Access control
    added_by UUID REFERENCES user_accounts(id),
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Repository-specific permissions (future)
    permissions JSONB DEFAULT '{"read": true, "write": true, "deploy": true}'::jsonb,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(team_id, repo_full_name)
);

-- Team invitations (pending team members)
CREATE TABLE IF NOT EXISTS team_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    
    -- Invitee info
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'developer',
    
    -- Invitation tracking
    invited_by UUID REFERENCES user_accounts(id),
    invitation_token VARCHAR(255) UNIQUE NOT NULL, -- For accepting invitation
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'accepted', 'expired', 'cancelled'
    expires_at TIMESTAMP NOT NULL, -- Invitations expire after 7 days
    accepted_at TIMESTAMP NULL,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(team_id, email) -- Can't invite same email twice to same team
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_role ON team_members(role);
CREATE INDEX IF NOT EXISTS idx_team_repositories_team_id ON team_repositories(team_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_team_id ON team_invitations(team_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_token ON team_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_team_invitations_email ON team_invitations(email);

-- Audit log for team actions
CREATE TABLE IF NOT EXISTS team_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES user_accounts(id),
    
    -- Action details
    action VARCHAR(100) NOT NULL, -- 'member_added', 'repo_added', 'role_changed', 'member_removed'
    resource_type VARCHAR(50), -- 'member', 'repository', 'team'
    resource_id UUID,
    
    -- Change details
    changes JSONB, -- {before: {role: 'developer'}, after: {role: 'admin'}}
    
    -- Metadata
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_audit_team_id ON team_audit_log(team_id);
CREATE INDEX IF NOT EXISTS idx_team_audit_created_at ON team_audit_log(created_at);

-- Comments
COMMENT ON TABLE teams IS 'Organizations/teams that can have multiple members and shared repositories';
COMMENT ON TABLE team_members IS 'Users that are part of teams with assigned roles';
COMMENT ON TABLE team_repositories IS 'Repositories accessible to all team members';
COMMENT ON TABLE team_invitations IS 'Pending invitations to join teams';
COMMENT ON TABLE team_audit_log IS 'Audit trail of all team-level actions';

COMMENT ON COLUMN team_members.role IS 'admin: full access, developer: can edit and create PRs, viewer: read-only';
COMMENT ON COLUMN teams.plan IS 'free: 1 user, team: 10 users, enterprise: unlimited + SSO';

