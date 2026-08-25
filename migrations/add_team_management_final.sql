-- Team Management Schema (Fixed for VARCHAR user IDs)
-- Enables team collaboration, RBAC, and team billing

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    
    -- Billing
    stripe_customer_id VARCHAR(255) UNIQUE,
    stripe_subscription_id VARCHAR(255) UNIQUE,
    plan VARCHAR(50) DEFAULT 'free',
    billing_email VARCHAR(255),
    seats_limit INTEGER DEFAULT 1,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL
);

-- Team members (users in teams)
CREATE TABLE IF NOT EXISTS team_members (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    team_id VARCHAR(36) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Role-based access control
    role VARCHAR(50) NOT NULL DEFAULT 'developer',
    
    -- Invitation tracking
    invited_by VARCHAR(255) REFERENCES users(id),
    invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    joined_at TIMESTAMP NULL,
    
    -- Status
    status VARCHAR(50) DEFAULT 'active',
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(team_id, user_id)
);

-- Team repositories (shared repo access)
CREATE TABLE IF NOT EXISTS team_repositories (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    team_id VARCHAR(36) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    
    -- Repository info
    repo_full_name VARCHAR(255) NOT NULL,
    repo_owner VARCHAR(255) NOT NULL,
    repo_name VARCHAR(255) NOT NULL,
    
    -- Access control
    added_by VARCHAR(255) REFERENCES users(id),
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Repository-specific permissions
    permissions JSONB DEFAULT '{"read": true, "write": true, "deploy": true}'::jsonb,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(team_id, repo_full_name)
);

-- Team invitations (pending team members)
CREATE TABLE IF NOT EXISTS team_invitations (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    team_id VARCHAR(36) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    
    -- Invitee info
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'developer',
    
    -- Invitation tracking
    invited_by VARCHAR(255) REFERENCES users(id),
    invitation_token VARCHAR(255) UNIQUE NOT NULL,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending',
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP NULL,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(team_id, email)
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
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    team_id VARCHAR(36) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id VARCHAR(255) REFERENCES users(id),
    
    -- Action details
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(36),
    
    -- Change details
    changes JSONB,
    
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

