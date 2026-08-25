-- Policies table for storing policy definitions
CREATE TABLE IF NOT EXISTS policies (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',  -- active, inactive, draft
    severity VARCHAR(50) NOT NULL,  -- critical, high, medium, low
    category VARCHAR(100) NOT NULL,  -- Security, Cost, Governance, Network, Compliance
    enforcement VARCHAR(50) DEFAULT 'warn',  -- block, warn, audit
    scope TEXT,  -- JSON array: ["aws", "digitalocean", "gcp", "all"]
    auto_remediate BOOLEAN DEFAULT FALSE,
    rego_code TEXT,  -- OPA Rego policy code
    conditions TEXT,  -- JSON conditions for simple policies
    violations_count INTEGER DEFAULT 0,
    last_checked TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Policy violations table
CREATE TABLE IF NOT EXISTS policy_violations (
    id VARCHAR(36) PRIMARY KEY,
    policy_id VARCHAR(36) NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    resource VARCHAR(255) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'open',  -- open, resolved, suppressed
    details TEXT,
    resolved_at TIMESTAMPTZ,
    suppressed_at TIMESTAMPTZ,
    suppressed_by VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for policies
CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status);
CREATE INDEX IF NOT EXISTS idx_policies_category ON policies(category);
CREATE INDEX IF NOT EXISTS idx_policies_severity ON policies(severity);
CREATE INDEX IF NOT EXISTS idx_policies_created_at ON policies(created_at);

-- Indexes for violations
CREATE INDEX IF NOT EXISTS idx_policy_violations_policy_id ON policy_violations(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_violations_status ON policy_violations(status);
CREATE INDEX IF NOT EXISTS idx_policy_violations_severity ON policy_violations(severity);
CREATE INDEX IF NOT EXISTS idx_policy_violations_created_at ON policy_violations(created_at);

