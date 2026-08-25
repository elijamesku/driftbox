-- ==============================================
-- Infrara Auth Database Schema
-- Run this in your separate Auth Supabase project
-- ==============================================

-- Users table (GitHub OAuth + Credits)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    
    -- Profile
    full_name VARCHAR(255),
    company VARCHAR(255),
    
    -- GitHub OAuth
    github_id VARCHAR(100) UNIQUE,
    github_username VARCHAR(255),
    github_access_token VARCHAR(500),
    oauth_provider VARCHAR(50) DEFAULT 'email',
    
    -- Subscription
    tier VARCHAR(50) DEFAULT 'free',
    stripe_customer_id VARCHAR(255),
    subscription_status VARCHAR(50) DEFAULT 'active',
    
    -- Credits/Tokens (Cursor-style billing)
    daily_credits INTEGER DEFAULT 100,
    credits_reset_at TIMESTAMP,
    total_credits_used INTEGER DEFAULT 0,
    
    -- Limits
    monthly_budget_usd DECIMAL,
    
    -- Metadata
    email_verified BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
    key_prefix VARCHAR(20) NOT NULL,
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    last_used_at TIMESTAMP,
    usage_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);

-- Usage Events table (for billing and tracking)
CREATE TABLE IF NOT EXISTS usage_events (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    event_category VARCHAR(50),
    event_metadata JSONB,
    cost_usd DECIMAL DEFAULT 0.0,
    billable BOOLEAN DEFAULT true,
    ip_address VARCHAR(50),
    user_agent VARCHAR(500),
    endpoint VARCHAR(255),
    timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_id ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_event_type ON usage_events(event_type);
CREATE INDEX IF NOT EXISTS idx_usage_events_timestamp ON usage_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_events_billable ON usage_events(billable);

-- Billing Cycles table (monthly invoices)
CREATE TABLE IF NOT EXISTS billing_cycles (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    base_subscription_cost DECIMAL DEFAULT 0.0,
    usage_cost DECIMAL DEFAULT 0.0,
    total_cost DECIMAL NOT NULL,
    usage_breakdown JSONB,
    event_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending',
    stripe_invoice_id VARCHAR(255),
    paid_at TIMESTAMP,
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    generated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_cycles_user_id ON billing_cycles(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_cycles_month_year ON billing_cycles(year, month);
CREATE INDEX IF NOT EXISTS idx_billing_cycles_status ON billing_cycles(status);

-- Composite index for faster lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_cycles_user_period 
    ON billing_cycles(user_id, year, month);

-- ==============================================
-- Done! Your auth database is ready.
-- 
-- Next steps:
-- 1. Set AUTH_SUPABASE_URL, AUTH_SUPABASE_KEY, AUTH_SUPABASE_DB_URL
-- 2. Run: python3 -c "from app.database.connection import init_auth_db; init_auth_db()"
-- 3. Test GitHub OAuth: http://YOUR_IP/auth/github
-- ==============================================

