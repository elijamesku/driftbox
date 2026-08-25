-- Migration: Add DigitalOcean OAuth fields to users table
-- Date: 2026-01-22

-- Add DigitalOcean OAuth columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS digitalocean_id VARCHAR(100) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS digitalocean_access_token VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS digitalocean_refresh_token VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS digitalocean_token_expires_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS digitalocean_team_id VARCHAR(100);

-- Create index for DigitalOcean ID lookups
CREATE INDEX IF NOT EXISTS idx_users_digitalocean_id ON users(digitalocean_id);

