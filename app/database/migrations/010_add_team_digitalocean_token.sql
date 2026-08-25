-- Add DigitalOcean access token column to teams table
-- Enables team-level credential sharing for sandbox validation

ALTER TABLE teams 
ADD COLUMN IF NOT EXISTS digitalocean_access_token VARCHAR(500) NULL;

COMMENT ON COLUMN teams.digitalocean_access_token IS 'Shared DigitalOcean API token for team infrastructure validation';

