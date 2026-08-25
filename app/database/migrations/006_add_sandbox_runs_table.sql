-- Migration: Add sandbox_runs table for tracking pre-deployment validation runs
-- Created: 2026-01-24

CREATE TABLE IF NOT EXISTS sandbox_runs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    repository VARCHAR(255) NOT NULL,
    branch VARCHAR(255),
    status VARCHAR(50) NOT NULL,
    duration_ms INTEGER DEFAULT 0,
    files_tested INTEGER DEFAULT 0,
    steps TEXT,  -- JSON array of step results
    resources_detected TEXT,  -- JSON array of detected resources
    errors TEXT,  -- JSON array of errors
    warnings TEXT,  -- JSON array of warnings
    available_cidr VARCHAR(50),
    cost_estimate REAL,
    risk_level VARCHAR(50) DEFAULT 'low',
    security_issues INTEGER DEFAULT 0,
    terraform_version VARCHAR(50),
    providers_used TEXT,  -- JSON array of provider names
    auto_healed BOOLEAN DEFAULT FALSE,
    fixes_applied TEXT,  -- JSON array of fixes applied
    attempts INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_user_id ON sandbox_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_repository ON sandbox_runs(repository);
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_status ON sandbox_runs(status);
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_created_at ON sandbox_runs(created_at);

