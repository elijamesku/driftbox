-- Migration: Add team_id column to sandbox_runs for team collaboration
-- Created: 2026-01-24
-- Purpose: Allow sandbox runs to be shared across team members

-- Add team_id column
ALTER TABLE sandbox_runs ADD COLUMN team_id VARCHAR(36);

-- Add index for team queries
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_team_id ON sandbox_runs(team_id);

-- Add user_name column to show who ran the test
ALTER TABLE sandbox_runs ADD COLUMN user_name VARCHAR(255);
