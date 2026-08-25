-- Migration 005: Add is_admin column to users table
-- This column is used for admin access control

-- Add is_admin column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'is_admin'
    ) THEN
        ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
        CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);
    END IF;
END $$;

-- Update: Set existing admin users (if any based on tier)
UPDATE users SET is_admin = TRUE WHERE tier = 'admin' AND is_admin IS NOT TRUE;

