"""
ORM model definitions for query logging, conversation history, and infrastructure state tracking.
"""
from sqlalchemy import Column, String, Integer, Float, Boolean, Text, ForeignKey, JSON, DateTime, Numeric
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from app.database.connection import PrimaryBase, AuthBase


def create_unique_identifier():
    """Generate universally unique identifier for record primary keys"""
    return str(uuid.uuid4())


class QueryLog(PrimaryBase):
    """
    Audit trail for all user prompts and AI responses.
    Captures prompt text, intermediate representation, reasoning chain, and performance data.
    """
    __tablename__ = "queries"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    user_id = Column(String(255), nullable=True, index=True)
    prompt = Column(Text, nullable=False)
    ir = Column(JSON, nullable=True)  # Infrastructure representation
    reasoning_tree = Column(JSON, nullable=True)  # LLM decision path
    execution_time_ms = Column(Integer, nullable=True)  # Latency measurement
    llm_model = Column(String(100), nullable=True)  # Provider model identifier
    success = Column(Boolean, default=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    def __repr__(self):
        return f"<QueryLog {self.id}: {self.prompt[:50]}...>"


class ConversationThread(PrimaryBase):
    """
    Multi-turn conversation sessions for tracking user interactions.
    Maintains conversation context and links to infrastructure modifications.
    """
    __tablename__ = "conversations"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    user_id = Column(String(255), nullable=True, index=True)
    title = Column(String(500), nullable=True)
    repository_path = Column(String(500), nullable=True)  # Associated repository location
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    messages = relationship("ChatMessage", back_populates="conversation", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<ConversationThread {self.id}: {self.title}>"


class ChatMessage(PrimaryBase):
    """
    Individual chat turns within a conversation thread.
    Associates user requests and assistant responses with infrastructure changes and version control.
    """
    __tablename__ = "messages"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    conversation_id = Column(String(36), ForeignKey("conversations.id"), nullable=False, index=True)
    role = Column(String(50), nullable=False)  # Message author: 'user' or 'assistant'
    content = Column(Text, nullable=False)
    
    # Infrastructure modification tracking
    ir = Column(JSON, nullable=True)  # Infrastructure configuration representation
    diff_id = Column(String(36), nullable=True)  # Reference to diff approval session
    commit_sha = Column(String(40), nullable=True, index=True)  # Version control commit hash
    branch_name = Column(String(255), nullable=True)
    pr_url = Column(String(500), nullable=True)
    
    # Additional metadata
    reasoning = Column(JSON, nullable=True)
    cost_impact = Column(JSON, nullable=True)
    files_changed = Column(JSON, nullable=True)  # Modified file path list
    
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Relationships
    conversation = relationship("ConversationThread", back_populates="messages")
    
    def __repr__(self):
        return f"<ChatMessage {self.id}: {self.role}>"


class InfrastructureSnapshot(PrimaryBase):
    """
    Immutable snapshots capturing infrastructure state at specific points in time.
    Compares declared Terraform configuration against actual cloud provider state.
    """
    __tablename__ = "infra_snapshots"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    commit_sha = Column(String(40), nullable=True, index=True)
    branch_name = Column(String(255), nullable=True)
    
    # State captures
    terraform_state = Column(JSON, nullable=True)  # Declared infrastructure state
    cloud_state = Column(JSON, nullable=True)  # Live cloud provider state
    catalog = Column(JSON, nullable=True)  # Indexed resource inventory
    
    # Configuration drift tracking
    drift_detected = Column(Boolean, default=False, index=True)
    drift_summary = Column(JSON, nullable=True)
    
    # Financial projection
    estimated_monthly_cost = Column(Float, nullable=True)
    cost_breakdown = Column(JSON, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    def __repr__(self):
        return f"<InfrastructureSnapshot {self.id}: {self.commit_sha}>"


class PullRequest(PrimaryBase):
    """
    Tracks all Pull Requests created through the Infrara platform.
    Provides audit trail and analytics for infrastructure changes pushed to GitHub.
    """
    __tablename__ = "pull_requests"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    user_id = Column(String(255), nullable=False, index=True)
    
    # Repository information
    repo_owner = Column(String(255), nullable=False)
    repo_name = Column(String(255), nullable=False)
    repo_full_name = Column(String(511), nullable=False, index=True)  # owner/repo
    
    # PR details
    branch_name = Column(String(255), nullable=False)
    commit_sha = Column(String(40), nullable=True)
    commit_message = Column(Text, nullable=True)
    pr_url = Column(String(500), nullable=True)
    pr_number = Column(Integer, nullable=True)
    
    # Changes tracking
    files_changed = Column(JSON, nullable=True)  # List of file paths modified
    files_added = Column(JSON, nullable=True)    # New files created
    files_modified = Column(JSON, nullable=True) # Existing files changed
    files_deleted = Column(JSON, nullable=True)  # Files removed
    
    # Terraform validation results
    terraform_valid = Column(Boolean, default=True)
    terraform_errors = Column(JSON, nullable=True)
    
    # Status tracking
    status = Column(String(50), default="created", index=True)  # created, merged, closed, failed
    merged_at = Column(DateTime, nullable=True)
    closed_at = Column(DateTime, nullable=True)
    
    # Platform metadata
    created_via = Column(String(50), default="web")  # web, desktop, api
    conversation_id = Column(String(36), nullable=True)  # Link to chat conversation
    
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<PullRequest {self.repo_full_name}#{self.pr_number}: {self.branch_name}>"


class ConfigurationDrift(PrimaryBase):
    """
    Configuration drift detection events.
    Identifies discrepancies between intended and actual infrastructure state.
    """
    __tablename__ = "drift_events"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    snapshot_id = Column(String(36), nullable=True, index=True)  # Associated snapshot reference
    resource_address = Column(String(500), nullable=False, index=True)
    resource_type = Column(String(100), nullable=False)
    
    # Drift classification
    drift_type = Column(String(50), nullable=False)  # Types: 'created', 'modified', 'deleted'
    severity = Column(String(50), nullable=False)  # Levels: 'info', 'warning', 'critical'
    
    # State comparison data
    terraform_config = Column(JSON, nullable=True)
    actual_config = Column(JSON, nullable=True)
    differences = Column(JSON, nullable=True)  # Structured diff output
    
    # Resolution tracking
    resolved = Column(Boolean, default=False, index=True)
    resolved_at = Column(DateTime, nullable=True)
    resolution_notes = Column(Text, nullable=True)
    
    detected_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    def __repr__(self):
        return f"<ConfigurationDrift {self.id}: {self.resource_address} - {self.drift_type}>"


class PerformanceMetric(PrimaryBase):
    """
    Application performance telemetry data.
    Monitors operation latency to ensure sub-10-second validation targets.
    """
    __tablename__ = "performance_metrics"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    operation = Column(String(100), nullable=False, index=True)  # Operation types: 'prompt_to_ir', 'terraform_validate'
    
    # Timing measurements
    duration_ms = Column(Integer, nullable=False)
    started_at = Column(DateTime, nullable=False)
    completed_at = Column(DateTime, nullable=False)
    
    # Operational context
    prompt_length = Column(Integer, nullable=True)
    resource_count = Column(Integer, nullable=True)
    llm_model = Column(String(100), nullable=True)
    
    # Outcome tracking
    success = Column(Boolean, default=True)
    error_message = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    def __repr__(self):
        return f"<PerformanceMetric {self.operation}: {self.duration_ms}ms>"


class UserAccount(AuthBase):
    """
    Platform user account records for authentication and subscription management.
    Supports both email/password and OAuth authentication flows.
    Isolated in authentication database for security.
    """
    __tablename__ = "users"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=True)  # Optional for OAuth-only accounts
    
    # Profile information
    full_name = Column(String(255), nullable=True)
    company = Column(String(255), nullable=True)
    
    # GitHub OAuth integration
    github_id = Column(String(100), unique=True, index=True, nullable=True)
    github_username = Column(String(255), nullable=True)
    github_access_token = Column(String(500), nullable=True)  # Encrypted storage required
    
    # DigitalOcean OAuth integration
    digitalocean_id = Column(String(100), unique=True, index=True, nullable=True)
    digitalocean_access_token = Column(String(500), nullable=True)
    digitalocean_refresh_token = Column(String(500), nullable=True)
    digitalocean_token_expires_at = Column(DateTime, nullable=True)
    digitalocean_team_id = Column(String(100), nullable=True)  # For team/organization access
    
    # GitLab OAuth integration (disabled - columns not in database)
    # gitlab_id = Column(String(100), unique=True, index=True, nullable=True)
    # gitlab_username = Column(String(255), nullable=True)
    # gitlab_access_token = Column(String(500), nullable=True)
    
    oauth_provider = Column(String(50), default="email")
    
    # Subscription tier management
    tier = Column(String(50), default="free", index=True)  # Tiers: free, pro, enterprise
    is_admin = Column(Boolean, default=False, index=True)  # Admin access flag
    stripe_customer_id = Column(String(255), nullable=True, index=True)
    subscription_status = Column(String(50), default="active")  # States: active, cancelled, past_due
    
    # Credit-based usage system (Cursor-inspired)
    daily_credits = Column(Integer, default=100)  # Daily credit allocation
    credits_reset_at = Column(DateTime, nullable=True)  # Next credit refresh timestamp
    total_credits_used = Column(Integer, default=0)  # Cumulative lifetime usage
    
    # Budget controls
    monthly_budget_usd = Column(Float, nullable=True)  # User-defined spending limit
    
    # Account metadata
    email_verified = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True, index=True)
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    api_keys = relationship("AuthenticationKey", back_populates="user", cascade="all, delete-orphan")
    usage_events = relationship("ActivityLog", back_populates="user", cascade="all, delete-orphan")
    billing_cycles = relationship("InvoicePeriod", back_populates="user", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<UserAccount {self.email} ({self.tier})>"


class AuthenticationKey(AuthBase):
    """
    API authentication tokens for programmatic platform access.
    Implements secure key storage with cryptographic hashing and prefix-only identification.
    Isolated in authentication database for security.
    """
    __tablename__ = "api_keys"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    
    # Key identification and security
    key_prefix = Column(String(20), nullable=False, index=True)  # Example format: "ira_AbCd"
    key_hash = Column(String(255), nullable=False, unique=True)  # Cryptographic hash of full key
    name = Column(String(255), nullable=True)  # User-assigned key label
    
    # Usage analytics
    last_used_at = Column(DateTime, nullable=True)
    usage_count = Column(Integer, default=0)
    
    # Status management
    is_active = Column(Boolean, default=True, index=True)
    expires_at = Column(DateTime, nullable=True)  # Optional key expiration
    
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Relationships
    user = relationship("UserAccount", back_populates="api_keys")
    
    def __repr__(self):
        return f"<AuthenticationKey {self.key_prefix}... for {self.user_id}>"


class ActivityLog(AuthBase):
    """
    Granular usage event tracking for billing and analytics.
    Records each platform interaction: API calls, completions, chat messages, etc.
    Isolated in authentication database for security.
    """
    __tablename__ = "usage_events"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    
    # Event classification
    event_type = Column(String(100), nullable=False, index=True)  # Types: completion_request, chat_message
    event_category = Column(String(50), nullable=True, index=True)  # Categories: api, websocket, billing
    
    # Event payload
    event_metadata = Column(JSON, nullable=True)  # Additional structured event data
    
    # Financial tracking
    cost_usd = Column(Float, default=0.0)  # Event cost in USD
    billable = Column(Boolean, default=True, index=True)  # Billing flag
    
    # Request context
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    endpoint = Column(String(255), nullable=True)
    
    # Temporal tracking
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Relationships
    user = relationship("UserAccount", back_populates="usage_events")
    
    def __repr__(self):
        return f"<ActivityLog {self.event_type} by {self.user_id}>"


class SandboxRun(PrimaryBase):
    """
    Sandbox test run records for pre-deployment validation.
    Tracks all sandbox validation runs with their results.
    """
    __tablename__ = "sandbox_runs"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    user_id = Column(String(255), nullable=False, index=True)
    
    # Repository info
    repository = Column(String(255), nullable=False, index=True)
    branch = Column(String(255), nullable=True)
    
    # Run results
    status = Column(String(50), nullable=False, index=True)  # passed, failed, running
    duration_ms = Column(Integer, default=0)
    files_tested = Column(Integer, default=0)
    
    # Steps and results
    steps = Column(JSON, nullable=True)  # List of step results
    resources_detected = Column(JSON, nullable=True)  # List of resources found
    errors = Column(JSON, nullable=True)  # List of errors
    warnings = Column(JSON, nullable=True)  # List of warnings
    
    # Additional data
    available_cidr = Column(String(50), nullable=True)
    cost_estimate = Column(Float, nullable=True)
    risk_level = Column(String(50), default='low')  # low, medium, high, critical
    security_issues = Column(Integer, default=0)
    terraform_version = Column(String(50), nullable=True)
    providers_used = Column(JSON, nullable=True)
    
    # Auto-heal tracking
    auto_healed = Column(Boolean, default=False)
    fixes_applied = Column(JSON, nullable=True)
    attempts = Column(Integer, default=1)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    def __repr__(self):
        return f"<SandboxRun {self.id}: {self.repository} - {self.status}>"


class InvoicePeriod(AuthBase):
    """
    Monthly billing cycle aggregations and invoice generation.
    Consolidates usage events into periodic billing statements.
    Isolated in authentication database for security.
    """
    __tablename__ = "billing_cycles"
    
    id = Column(String(36), primary_key=True, default=create_unique_identifier)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    
    # Billing period definition
    month = Column(Integer, nullable=False, index=True)  # Month number: 1-12
    year = Column(Integer, nullable=False, index=True)  # Year: 2025, etc
    
    # Financial breakdown
    base_subscription_cost = Column(Float, default=0.0)  # Fixed monthly subscription fee
    usage_cost = Column(Float, default=0.0)  # Variable usage-based charges
    total_cost = Column(Float, nullable=False)  # Total invoice amount
    
    # Detailed itemization
    usage_breakdown = Column(JSON, nullable=True)  # Per-event-type cost breakdown
    event_count = Column(Integer, default=0)  # Total events in billing period
    
    # Payment processing
    status = Column(String(50), default="pending", index=True)  # States: pending, paid, failed, refunded
    stripe_invoice_id = Column(String(255), nullable=True, index=True)
    paid_at = Column(DateTime, nullable=True)
    
    # Period boundaries
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    generated_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    user = relationship("UserAccount", back_populates="billing_cycles")
    
    def __repr__(self):
        return f"<InvoicePeriod {self.year}-{self.month:02d} for {self.user_id}: ${self.total_cost}>"

