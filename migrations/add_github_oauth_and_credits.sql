-- Add GitHub OAuth and credits columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_username VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_access_token VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(50) DEFAULT 'email';

-- Add credits/tokens columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_credits INTEGER DEFAULT 100;
ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_reset_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_credits_used INTEGER DEFAULT 0;

-- Create index on github_id
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);

