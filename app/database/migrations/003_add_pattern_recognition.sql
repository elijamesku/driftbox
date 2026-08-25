-- Migration: Add Pattern Recognition & Machine Learning Tables
-- Purpose: Enable cross-repo pattern recognition, best practices, and predictions
-- Safe: Creates new tables, doesn't modify existing schema

-- =====================================================
-- PATTERN RECOGNITION: Learn from all user commits
-- =====================================================

CREATE TABLE IF NOT EXISTS commit_patterns (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    repo_name VARCHAR(255) NOT NULL,
    commit_sha VARCHAR(40) NOT NULL,
    commit_message TEXT,
    commit_date TIMESTAMP NOT NULL,
    
    -- Pattern classification
    pattern_type VARCHAR(50),  -- e.g., "scaling", "security", "cost_optimization"
    change_category VARCHAR(50), -- e.g., "compute", "storage", "networking"
    
    -- Vector embedding for similarity search
    embedding VECTOR(1024),  -- Voyage AI embedding
    
    -- Metadata
    files_changed JSONB NOT NULL DEFAULT '[]',
    resources_affected JSONB NOT NULL DEFAULT '[]',
    attributes_changed JSONB NOT NULL DEFAULT '{}',
    
    -- Outcome tracking
    outcome VARCHAR(20) DEFAULT 'unknown',  -- "success", "reverted", "modified", "unknown"
    outcome_confidence FLOAT DEFAULT 0.0,
    
    -- Statistics
    additions INTEGER DEFAULT 0,
    deletions INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, repo_name, commit_sha)
);

-- Indexes for fast similarity search
CREATE INDEX idx_commit_patterns_user ON commit_patterns(user_id);
CREATE INDEX idx_commit_patterns_pattern_type ON commit_patterns(pattern_type);
CREATE INDEX idx_commit_patterns_date ON commit_patterns(commit_date DESC);

-- Vector similarity index (requires pgvector extension)
-- CREATE INDEX idx_commit_patterns_embedding ON commit_patterns USING ivfflat (embedding vector_cosine_ops);


-- =====================================================
-- BEST PRACTICES: Learn user-specific patterns
-- =====================================================

CREATE TABLE IF NOT EXISTS best_practices (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    
    -- Practice type
    practice_type VARCHAR(50) NOT NULL,  -- "required_tags", "naming_convention", "attribute_default"
    resource_type VARCHAR(100),  -- e.g., "aws_instance", "aws_s3_bucket", null for global
    
    -- The rule
    rule_name VARCHAR(100) NOT NULL,
    rule_value JSONB NOT NULL,  -- The actual pattern/requirement
    
    -- Statistics
    frequency_count INTEGER DEFAULT 0,  -- How many times this pattern appears
    total_resources INTEGER DEFAULT 0,  -- Total resources analyzed
    compliance_rate FLOAT DEFAULT 0.0,  -- frequency_count / total_resources
    
    -- Confidence
    confidence_score FLOAT DEFAULT 0.0,  -- How confident we are this is a "rule"
    last_validated TIMESTAMP,
    
    -- Examples
    example_commits JSONB DEFAULT '[]',  -- Array of commit SHAs showing this pattern
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, practice_type, resource_type, rule_name)
);

CREATE INDEX idx_best_practices_user ON best_practices(user_id);
CREATE INDEX idx_best_practices_type ON best_practices(practice_type);
CREATE INDEX idx_best_practices_confidence ON best_practices(confidence_score DESC);


-- =====================================================
-- COMMIT SEQUENCES: Learn what follows what
-- =====================================================

CREATE TABLE IF NOT EXISTS commit_sequences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    
    -- The sequence
    trigger_pattern VARCHAR(100) NOT NULL,  -- What triggers the sequence
    follow_up_pattern VARCHAR(100) NOT NULL,  -- What typically follows
    
    -- Timing
    avg_time_gap INTERVAL,  -- Average time between trigger and follow-up
    min_time_gap INTERVAL,
    max_time_gap INTERVAL,
    
    -- Statistics
    occurrence_count INTEGER DEFAULT 0,  -- How many times this sequence happened
    total_opportunities INTEGER DEFAULT 0,  -- How many times trigger happened
    probability FLOAT DEFAULT 0.0,  -- occurrence_count / total_opportunities
    
    -- Examples
    example_sequences JSONB DEFAULT '[]',  -- Array of {trigger_sha, follow_up_sha, time_gap}
    
    -- Confidence
    confidence_score FLOAT DEFAULT 0.0,
    last_seen TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, trigger_pattern, follow_up_pattern)
);

CREATE INDEX idx_commit_sequences_user ON commit_sequences(user_id);
CREATE INDEX idx_commit_sequences_probability ON commit_sequences(probability DESC);


-- =====================================================
-- PATTERN PREDICTIONS: Store predictions for analytics
-- =====================================================

CREATE TABLE IF NOT EXISTS pattern_predictions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    repo_name VARCHAR(255) NOT NULL,
    
    -- What triggered the prediction
    trigger_commit_sha VARCHAR(40) NOT NULL,
    trigger_pattern VARCHAR(100),
    
    -- The prediction
    predicted_pattern VARCHAR(100) NOT NULL,
    predicted_changes JSONB NOT NULL DEFAULT '{}',
    confidence_score FLOAT NOT NULL,
    
    -- Outcome tracking
    was_correct BOOLEAN DEFAULT NULL,  -- NULL = not yet known, TRUE/FALSE after validation
    actual_commit_sha VARCHAR(40),  -- The commit that actually happened
    time_to_occurrence INTERVAL,  -- How long it took for prediction to come true
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    validated_at TIMESTAMP
);

CREATE INDEX idx_pattern_predictions_user ON pattern_predictions(user_id);
CREATE INDEX idx_pattern_predictions_trigger ON pattern_predictions(trigger_commit_sha);
CREATE INDEX idx_pattern_predictions_accuracy ON pattern_predictions(was_correct) WHERE was_correct IS NOT NULL;


-- =====================================================
-- LEARNING METADATA: Track learning progress per user
-- =====================================================

CREATE TABLE IF NOT EXISTS user_learning_metadata (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    
    -- Progress tracking
    total_commits_indexed INTEGER DEFAULT 0,
    total_repos_analyzed INTEGER DEFAULT 0,
    total_patterns_learned INTEGER DEFAULT 0,
    total_practices_identified INTEGER DEFAULT 0,
    total_sequences_found INTEGER DEFAULT 0,
    
    -- Quality metrics
    avg_pattern_confidence FLOAT DEFAULT 0.0,
    avg_prediction_accuracy FLOAT DEFAULT 0.0,
    
    -- Status
    indexing_status VARCHAR(20) DEFAULT 'pending',  -- "pending", "indexing", "complete", "error"
    last_indexed_at TIMESTAMP,
    next_index_scheduled TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_learning_metadata_status ON user_learning_metadata(indexing_status);


-- =====================================================
-- FEATURE FLAGS: Enable/disable features per user
-- =====================================================

CREATE TABLE IF NOT EXISTS user_feature_flags (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    feature_name VARCHAR(100) NOT NULL,
    enabled BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    enabled_at TIMESTAMP,
    enabled_by VARCHAR(255),  -- Who enabled it (admin email)
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, feature_name)
);

CREATE INDEX idx_user_feature_flags_user ON user_feature_flags(user_id);


-- =====================================================
-- GRANTS: Ensure permissions (if needed)
-- =====================================================

-- Grant permissions to your application user
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;


-- =====================================================
-- NOTES FOR DEPLOYMENT
-- =====================================================

-- 1. This migration is SAFE - only adds new tables
-- 2. pgvector extension needed for vector similarity (optional, will fallback)
-- 3. Feature flags let you enable features per user for beta testing
-- 4. All tables include created_at/updated_at for audit trails
-- 5. Indexes optimized for common queries

