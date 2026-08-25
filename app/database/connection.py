"""
Database connectivity layer with Supabase backend integration.
Manages dual-database architecture for application and authentication data.
"""
import os
from dotenv import load_dotenv
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager
from typing import Optional

# Load .env BEFORE reading any environment variables
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# Primary database configuration (stores conversation history, query logs, infrastructure state)
PRIMARY_DB_ENDPOINT = os.getenv("SUPABASE_URL")  # Example: https://xxx.supabase.co
PRIMARY_DB_API_KEY = os.getenv("SUPABASE_KEY")  # Anonymous or service role key
PRIMARY_DB_CONNECTION_STRING = os.getenv("SUPABASE_DB_URL")  # Direct PostgreSQL DSN

# Authentication database configuration (stores user accounts, API keys, billing data)
AUTH_DB_ENDPOINT = os.getenv("AUTH_SUPABASE_URL", PRIMARY_DB_ENDPOINT)  # Defaults to primary
AUTH_DB_API_KEY = os.getenv("AUTH_SUPABASE_KEY", PRIMARY_DB_API_KEY)
AUTH_DB_CONNECTION_STRING = os.getenv("AUTH_SUPABASE_DB_URL", PRIMARY_DB_CONNECTION_STRING)

# Determine primary database connection string
if PRIMARY_DB_CONNECTION_STRING:
    MAIN_DB_URL = PRIMARY_DB_CONNECTION_STRING
    print("✓ Configured with Supabase PostgreSQL backend (Primary)")
else:
    MAIN_DB_URL = os.getenv("DATABASE_URL", "sqlite:///./infrara.db")
    if "sqlite" in MAIN_DB_URL:
        print("⚠️  SQLite backend active (development only). Configure SUPABASE_DB_URL for production.")

# Determine authentication database connection string
if AUTH_DB_CONNECTION_STRING:
    AUTH_DB_URL = AUTH_DB_CONNECTION_STRING
    if AUTH_DB_URL != MAIN_DB_URL:
        print("✓ Configured with separate authentication database")
    else:
        print("✓ Configured with unified database for application and authentication")
else:
    AUTH_DB_URL = MAIN_DB_URL

# Normalize connection strings for SQLAlchemy 1.4+ compatibility
if MAIN_DB_URL.startswith("postgres://"):
    MAIN_DB_URL = MAIN_DB_URL.replace("postgres://", "postgresql://", 1)
if AUTH_DB_URL.startswith("postgres://"):
    AUTH_DB_URL = AUTH_DB_URL.replace("postgres://", "postgresql://", 1)

# Instantiate Supabase REST API clients
primary_supabase_client: Optional[any] = None
auth_supabase_client: Optional[any] = None

if PRIMARY_DB_ENDPOINT and PRIMARY_DB_API_KEY:
    try:
        from supabase import create_client, Client
        primary_supabase_client: Client = create_client(PRIMARY_DB_ENDPOINT, PRIMARY_DB_API_KEY)
        print("✓ Primary Supabase REST client instantiated")
    except ImportError:
        print("⚠️  supabase-py package missing. Install via: pip install supabase")
    except Exception as error:
        print(f"⚠️  Primary Supabase client initialization failed: {error}")

if AUTH_DB_ENDPOINT and AUTH_DB_API_KEY:
    try:
        from supabase import create_client, Client
        auth_supabase_client: Client = create_client(AUTH_DB_ENDPOINT, AUTH_DB_API_KEY)
        print("✓ Authentication Supabase REST client instantiated")
    except Exception as error:
        print(f"⚠️  Authentication Supabase client initialization failed: {error}")

# Initialize SQLAlchemy database engines with larger pool for production
primary_db_engine = create_engine(
    MAIN_DB_URL,
    pool_pre_ping=True,  # Health check connections before use
    pool_size=20,  # Base pool size
    max_overflow=30,  # Allow up to 50 total connections
    pool_timeout=10,  # Wait max 10s for a connection
    pool_recycle=300,  # Recycle connections every 5 minutes
    echo=False,  # Disable SQL query logging by default
)

auth_db_engine = create_engine(
    AUTH_DB_URL,
    pool_pre_ping=True,
    pool_size=20,
    max_overflow=30,
    pool_timeout=10,
    pool_recycle=300,
    echo=False,
)

# Create session factory instances
PrimarySessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=primary_db_engine)
AuthSessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=auth_db_engine)

# Declarative base classes for ORM models
PrimaryBase = declarative_base()
AuthBase = declarative_base()


def acquire_primary_session() -> Session:
    """
    FastAPI dependency for acquiring primary database sessions.
    Usage: session: Session = Depends(acquire_primary_session)
    """
    session = PrimarySessionFactory()
    try:
        yield session
    finally:
        session.close()


def acquire_auth_session() -> Session:
    """
    FastAPI dependency for acquiring authentication database sessions.
    Usage: auth_session: Session = Depends(acquire_auth_session)
    """
    session = AuthSessionFactory()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def primary_session_context():
    """
    Context manager for primary database sessions in non-FastAPI code.
    Usage: with primary_session_context() as session: ...
    """
    session = PrimarySessionFactory()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def auth_session_context():
    """
    Context manager for authentication database sessions in non-FastAPI code.
    Usage: with auth_session_context() as session: ...
    """
    session = AuthSessionFactory()
    try:
        yield session
    finally:
        session.close()


def get_auth_db():
    """Provides authentication DB session for FastAPI dependency injection (legacy alias).
    Usage: session = Depends(get_auth_db)
    """
    session = AuthSessionFactory()
    try:
        yield session
    finally:
        session.close()

def acquire_authentication_session():
    """Legacy alias for acquire_auth_session (for codebase fallback)."""
    session = AuthSessionFactory()
    try:
        yield session
    finally:
        session.close()


def setup_database():
    """Create all primary database tables - safe for production startup"""
    from app.database.models import QueryLog, ConversationThread, ChatMessage, InfrastructureSnapshot, ConfigurationDrift
    PrimaryBase.metadata.create_all(bind=primary_db_engine)
    print("✓ Primary database schema initialized")


def setup_auth_database():
    """Create all authentication database tables - safe for production startup"""
    from app.database.models import UserAccount, AuthenticationKey, ActivityLog, InvoicePeriod
    AuthBase.metadata.create_all(bind=auth_db_engine)
    print("✓ Authentication database schema initialized")


def teardown_database():
    """Gracefully close all primary database connections"""
    primary_db_engine.dispose()
    print("✓ Primary database connections closed")


def teardown_auth_database():
    """Gracefully close all authentication database connections"""
    auth_db_engine.dispose()
    print("✓ Authentication database connections closed")


def rebuild_primary_schema():
    """Destructively reset primary database schema - DANGEROUS IN PRODUCTION"""
    PrimaryBase.metadata.drop_all(bind=primary_db_engine)
    PrimaryBase.metadata.create_all(bind=primary_db_engine)


def rebuild_auth_schema():
    """Destructively reset authentication database schema - DANGEROUS IN PRODUCTION"""
    AuthBase.metadata.drop_all(bind=auth_db_engine)
    AuthBase.metadata.create_all(bind=auth_db_engine)


# Supabase REST API convenience functions (alternative to ORM for simple operations)
def insert_via_supabase_api(table_name: str, record_data: dict):
    """
    Insert record using Supabase REST client.
    Returns API response or None if Supabase unavailable.
    """
    if primary_supabase_client:
        return primary_supabase_client.table(table_name).insert(record_data).execute()
    return None


def query_via_supabase_api(table_name: str, criteria: dict = None):
    """
    Query records using Supabase REST client.
    Returns API response or None if Supabase unavailable.
    """
    if primary_supabase_client:
        query_builder = primary_supabase_client.table(table_name).select("*")
        if criteria:
            for column, value in criteria.items():
                query_builder = query_builder.eq(column, value)
        return query_builder.execute()
    return None


def update_via_supabase_api(table_name: str, record_data: dict, criteria: dict):
    """Update records using Supabase REST client"""
    if primary_supabase_client:
        query_builder = primary_supabase_client.table(table_name).update(record_data)
        for column, value in criteria.items():
            query_builder = query_builder.eq(column, value)
        return query_builder.execute()
    return None

