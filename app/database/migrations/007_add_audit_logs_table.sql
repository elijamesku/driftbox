-- Comprehensive Audit Log Table
-- Tracks ALL user activity across the platform for compliance and monitoring

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(255),
    user_name VARCHAR(255),
    user_email VARCHAR(255),
    
    -- Action details
    action VARCHAR(255) NOT NULL,
    action_type VARCHAR(50) NOT NULL,  -- create, update, delete, approve, deploy, scan, alert, login, system
    resource VARCHAR(255),
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    
    -- Severity and status
    severity VARCHAR(20) DEFAULT 'info',  -- info, warning, critical, success
    status VARCHAR(50) DEFAULT 'completed',
    
    -- Context
    ip_address VARCHAR(50),
    user_agent TEXT,
    location VARCHAR(255),
    
    -- Additional metadata
    details TEXT,  -- JSON string with additional context
    metadata TEXT,  -- JSON string with extra key-value pairs
    
    -- Related entities
    team_id VARCHAR(36),
    repository VARCHAR(255),
    change_id VARCHAR(36),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON public.audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON public.audit_logs(severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_team_id ON public.audit_logs(team_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON public.audit_logs(resource_type);

