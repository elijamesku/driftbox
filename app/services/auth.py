"""
Authentication service with Supabase persistence layer.
Manages user accounts, API key generation, and JWT token operations.
"""
import os
import secrets
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Dict, List
import jwt
import bcrypt
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.database.connection import acquire_auth_session
from app.database.models import UserAccount, AuthenticationKey

# JWT configuration settings
TOKEN_SECRET_KEY = os.getenv("JWT_SECRET_KEY", secrets.token_urlsafe(32))
ENCODING_ALGORITHM = "HS256"
TOKEN_EXPIRATION_MINUTES = 60 * 24 * 30  # 30 days

http_bearer_security = HTTPBearer()


class AuthenticationService:
    """Manages user authentication and authorization with persistent database storage"""
    
    def __init__(self):
        self.jwt_secret_key = TOKEN_SECRET_KEY
        self.jwt_algorithm = ENCODING_ALGORITHM
    
    def generate_password_hash(self, plaintext_password: str) -> str:
        """Generate secure password hash for storage"""
        # bcrypt only supports passwords up to 72 bytes
        # Pre-hash with SHA256 to get fixed-length input
        intermediate_hash = hashlib.sha256(plaintext_password.encode('utf-8')).hexdigest()
        # Use bcrypt directly (no passlib wrapper to avoid initialization issues)
        password_salt = bcrypt.gensalt()
        secure_hash = bcrypt.hashpw(intermediate_hash.encode('utf-8'), password_salt)
        return secure_hash.decode('utf-8')
    
    def validate_password(self, submitted_password: str, stored_hash: str) -> bool:
        """Verify a plaintext password against stored hash"""
        # Pre-hash the submitted password before verifying
        intermediate_hash = hashlib.sha256(submitted_password.encode('utf-8')).hexdigest()
        # Use bcrypt directly
        return bcrypt.checkpw(intermediate_hash.encode('utf-8'), stored_hash.encode('utf-8'))
    
    def register_new_user(self, email: str, password: str, full_name: Optional[str] = None,
                   company: Optional[str] = None, subscription_tier: str = "free") -> UserAccount:
        """
        Create a new user account in the persistent database.
        
        Args:
            email: User email address (must be unique)
            password: Plain text password (will be securely hashed)
            full_name: Optional user full name
            company: Optional company affiliation
            subscription_tier: Subscription tier (free, pro, enterprise)
        
        Returns:
            Created UserAccount object
        
        Raises:
            HTTPException: If email address already registered
        """
        db_session = next(acquire_auth_session())
        
        # Verify email uniqueness
        existing_user = db_session.query(UserAccount).filter(UserAccount.email == email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Create new user account
        new_user = UserAccount(
            email=email,
            password_hash=self.generate_password_hash(password),
            full_name=full_name,
            company=company,
            tier=subscription_tier
        )
        
        db_session.add(new_user)
        db_session.commit()
        db_session.refresh(new_user)
        
        return new_user
    
    def fetch_user_by_email(self, email_address: str) -> Optional[UserAccount]:
        """Retrieve user account by email address"""
        db_session = next(acquire_auth_session())
        return db_session.query(UserAccount).filter(UserAccount.email == email_address).first()
    
    def fetch_user_by_identifier(self, account_id: str) -> Optional[UserAccount]:
        """Retrieve user account by unique identifier"""
        db_session = next(acquire_auth_session())
        return db_session.query(UserAccount).filter(UserAccount.id == account_id).first()
    
        
    def verify_user_credentials(self, email_address: str, submitted_password: str) -> Optional[UserAccount]:
        """
        Authenticate user with email/password credentials.
        
        Args:
            email_address: User email address
            submitted_password: Plain text password
        
        Returns:
            UserAccount object if credentials valid, None otherwise
        """
        user_account = self.fetch_user_by_email(email_address)
        
        if not user_account:
            return None
        
        if not user_account.password_hash:
            return None  # OAuth-only user without password
        
        if not self.validate_password(submitted_password, user_account.password_hash):
            return None
        
        if not user_account.is_active:
            return None
        
        # Update last login timestamp
        db_session = next(acquire_auth_session())
        user_account.last_login_at = datetime.utcnow()
        db_session.commit()
        
        return user_account
    
    def generate_access_token(self, token_payload: dict, custom_expiration: Optional[timedelta] = None) -> str:
        """
        Generate a JWT access token.
        
        Args:
            token_payload: Data to encode (usually {"sub": user_id, "email": email})
            custom_expiration: Optional custom expiration duration
        
        Returns:
            Encoded JWT token string
        """
        payload_copy = token_payload.copy()
        
        if custom_expiration:
            expiration_time = datetime.utcnow() + custom_expiration
        else:
            expiration_time = datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRATION_MINUTES)
        
        payload_copy.update({"exp": expiration_time})
        jwt_token = jwt.encode(payload_copy, self.jwt_secret_key, algorithm=self.jwt_algorithm)
        
        return jwt_token
    
    def parse_and_verify_token(self, encoded_token: str) -> Dict:
        """
        Decode and verify a JWT token.
        
        Args:
            encoded_token: JWT token string
        
        Returns:
            Decoded payload dictionary
        
        Raises:
            HTTPException: If token is invalid or expired
        """
        try:
            decoded_payload = jwt.decode(encoded_token, self.jwt_secret_key, algorithms=[self.jwt_algorithm])
            return decoded_payload
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token has expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Could not validate credentials")
    
    def generate_api_key(self, account_id: str, key_name: Optional[str] = None) -> tuple[str, AuthenticationKey]:
        """
        Generate a long-lived API key and persist in database.
        
        Args:
            account_id: User account ID to associate key with
            key_name: Optional descriptive name for the key
        
        Returns:
            Tuple of (full_key_string, AuthenticationKey_object)
            NOTE: full_key_string is only returned once and cannot be retrieved again
        """
        db_session = next(acquire_auth_session())
        
        # Generate cryptographically secure random key
        random_suffix = secrets.token_urlsafe(32)
        complete_key = f"ira_{random_suffix}"
        
        # Hash the key for secure storage
        key_secure_hash = hashlib.sha256(complete_key.encode()).hexdigest()
        
        # Store prefix for identification purposes (first 12 chars)
        key_display_prefix = complete_key[:12]
        
        # Create API key database record
        new_api_key = AuthenticationKey(
            user_id=account_id,
            key_prefix=key_display_prefix,
            key_hash=key_secure_hash,
            name=key_name or f"API Key {datetime.utcnow().strftime('%Y-%m-%d')}"
        )
        
        db_session.add(new_api_key)
        db_session.commit()
        db_session.refresh(new_api_key)
        
        return (complete_key, new_api_key)
    
    def authenticate_api_key(self, provided_key: str) -> Optional[UserAccount]:
        """
        Verify an API key and return associated user.
        
        Args:
            provided_key: Full API key string
        
        Returns:
            UserAccount object if key is valid, None otherwise
        """
        if not provided_key.startswith("ira_"):
            return None
        
        db_session = next(acquire_auth_session())
        
        # Hash the provided key for comparison
        key_secure_hash = hashlib.sha256(provided_key.encode()).hexdigest()
        
        # Lookup key record in database
        key_record = db_session.query(AuthenticationKey).filter(
            AuthenticationKey.key_hash == key_secure_hash,
            AuthenticationKey.is_active == True
        ).first()
        
        if not key_record:
            return None
        
        # Verify expiration
        if key_record.expires_at and key_record.expires_at < datetime.utcnow():
            return None
        
        # Update usage statistics
        key_record.last_used_at = datetime.utcnow()
        key_record.usage_count += 1
        db_session.commit()
        
        # Return associated user
        return key_record.user
    
    def fetch_user_api_keys(self, account_id: str) -> List[AuthenticationKey]:
        """Retrieve all active API keys for a user"""
        db_session = next(acquire_auth_session())
        return db_session.query(AuthenticationKey).filter(
            AuthenticationKey.user_id == account_id,
            AuthenticationKey.is_active == True
        ).order_by(AuthenticationKey.created_at.desc()).all()
    
    def deactivate_api_key(self, key_identifier: str, account_id: str) -> bool:
        """
        Revoke an API key.
        
        Args:
            key_identifier: API key unique ID
            account_id: User account ID (for authorization)
        
        Returns:
            True if revoked, False if not found
        """
        db_session = next(acquire_auth_session())
        key_to_revoke = db_session.query(AuthenticationKey).filter(
            AuthenticationKey.id == key_identifier,
            AuthenticationKey.user_id == account_id
        ).first()
        
        if not key_to_revoke:
            return False
        
        key_to_revoke.is_active = False
        db_session.commit()
        
        return True
    
    def extract_authenticated_user(self, auth_credentials: HTTPAuthorizationCredentials = Security(http_bearer_security)) -> UserAccount:
        """
        Dependency to extract user from JWT token.
        Use in FastAPI routes with Depends.
        """
        bearer_token = auth_credentials.credentials
        token_payload = self.parse_and_verify_token(bearer_token)
        
        extracted_user_id = token_payload.get("sub")
        if not extracted_user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        authenticated_user = self.fetch_user_by_identifier(extracted_user_id)
        if not authenticated_user:
            raise HTTPException(status_code=401, detail="User not found")
        
        if not authenticated_user.is_active:
            raise HTTPException(status_code=401, detail="User account is disabled")
        
        return authenticated_user


# Global authentication service instance
authentication_service = AuthenticationService()


def require_authentication(auth_credentials: HTTPAuthorizationCredentials = Security(http_bearer_security)) -> Dict:
    """
    FastAPI dependency for routes requiring authentication.
    
    Usage:
    @router.get("/protected")
    def protected_route(user = Depends(require_authentication)):
        return {"user_id": user["sub"]}
    """
    return authentication_service.extract_authenticated_user(auth_credentials)


def require_admin(
    auth_credentials: HTTPAuthorizationCredentials = Security(http_bearer_security)
) -> UserAccount:
    """
    FastAPI dependency for routes requiring admin authentication.
    
    Checks if the authenticated user has admin privileges (is_admin field or tier == "admin").
    Returns 403 Forbidden if not admin.
    
    Usage:
    @router.get("/admin/endpoint")
    def admin_endpoint(admin_user = Depends(require_admin)):
        return {"message": "Admin only"}
    """
    # Extract authenticated user
    authenticated_user = authentication_service.extract_authenticated_user(auth_credentials)
    
    # Check admin status - support both is_admin field and tier == "admin" for backward compatibility
    is_admin_user = (
        getattr(authenticated_user, 'is_admin', False) or 
        authenticated_user.tier == "admin"
    )
    
    if not is_admin_user:
        raise HTTPException(
            status_code=403, 
            detail="Admin access required"
        )
    
    return authenticated_user

