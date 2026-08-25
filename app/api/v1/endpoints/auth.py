"""
Authentication endpoints for signup, login, and API key management.
"""
from fastapi import APIRouter, HTTPException, Depends, Request, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
import os
import requests
import secrets
from urllib.parse import quote

from app.services.auth import authentication_service, require_authentication
from app.database.models import UserAccount, AuthenticationKey
from app.database.connection import get_auth_db
from app.utils.errors import sanitize_error_detail
from sqlalchemy.orm import Session

# Import audit log service for login tracking
try:
    from app.services.audit_log_service import audit_log_service, ActionType, Severity
    AUDIT_LOGGING_ENABLED = True
except ImportError:
    AUDIT_LOGGING_ENABLED = False
    audit_log_service = None


router = APIRouter()


# ===== Request/Response Models =====

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    company: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class CreateAPIKeyRequest(BaseModel):
    name: Optional[str] = None


class APIKeyResponse(BaseModel):
    id: str
    key_prefix: str
    name: str
    created_at: datetime
    last_used_at: Optional[datetime]
    usage_count: int


class CreateAPIKeyResponse(BaseModel):
    api_key: str  # Full key - only shown once!
    key_info: APIKeyResponse


# ===== Auth Endpoints =====

@router.post("/signup", response_model=AuthResponse, tags=["auth"])
def signup(req: SignupRequest):
    """
    Create a new user account.
    
    Returns JWT token for immediate login.
    """
    try:
        user = authentication_service.create_user(
            email=req.email,
            password=req.password,
            full_name=req.full_name,
            company=req.company
        )
        
        # Create access token
        token = authentication_service.generate_access_token(
            token_payload={"sub": user.id, "email": user.email}
        )
        
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "company": user.company,
                "tier": user.tier,
                "created_at": user.created_at.isoformat()
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Signup failed"))


@router.post("/login", response_model=AuthResponse, tags=["auth"])
def login(req: LoginRequest):
    """
    Login with email and password.
    
    Returns JWT token for authenticated requests.
    """
    user = authentication_service.verify_user_credentials(req.email, req.password)
    
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )
    
    # Create access token
    token = authentication_service.generate_access_token(
        token_payload={"sub": user.id, "email": user.email}
    )
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "company": user.company,
            "tier": user.tier,
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None
        }
    }


@router.post("/admin/login", response_model=AuthResponse, tags=["auth"])
def admin_login(req: AdminLoginRequest, db: Session = Depends(get_auth_db)):
    """
    Admin login using environment variable credentials.
    
    Credentials are validated against environment variables (ADMIN_USERNAME, ADMIN_PASSWORD),
    not the database. Creates/finds admin user record in database for JWT token generation.
    
    This is a separate login flow for admins only.
    """
    # Get admin credentials from environment
    admin_username = os.getenv("ADMIN_USERNAME")
    admin_password = os.getenv("ADMIN_PASSWORD")
    admin_email = os.getenv("ADMIN_EMAIL", f"{admin_username}@admin.local" if admin_username else None)
    
    if not admin_username or not admin_password:
        raise HTTPException(
            status_code=500,
            detail="Admin authentication not configured"
        )
    
    # Validate credentials against environment variables (NOT database)
    if req.username != admin_username or req.password != admin_password:
        raise HTTPException(
            status_code=401,
            detail="Invalid admin credentials"
        )
    
    # Find or create admin user record in database (for JWT token)
    # Note: password_hash is stored but NOT used for validation (env vars are used)
    admin_user = db.query(UserAccount).filter(
        UserAccount.email == admin_email
    ).first()
    
    if not admin_user:
        # Create minimal admin user record
        admin_user = UserAccount(
            email=admin_email,
            password_hash=authentication_service.generate_password_hash(admin_password),  # Stored but not validated
            full_name="Admin User",
            tier="admin",
            is_admin=True,
            is_active=True,
            email_verified=True,
            oauth_provider="admin"
        )
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)
    else:
        # Update existing admin user to ensure admin flags are set
        admin_user.tier = "admin"
        admin_user.is_admin = True
        admin_user.is_active = True
        admin_user.last_login_at = datetime.utcnow()
        db.commit()
        db.refresh(admin_user)
    
    # Generate JWT token (references admin_user.id from database)
    token = authentication_service.generate_access_token(
        token_payload={"sub": admin_user.id, "email": admin_user.email}
    )
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": admin_user.id,
            "email": admin_user.email,
            "full_name": admin_user.full_name,
            "company": admin_user.company,
            "tier": admin_user.tier,
            "is_admin": getattr(admin_user, 'is_admin', False),
            "last_login_at": admin_user.last_login_at.isoformat() if admin_user.last_login_at else None
        }
    }


@router.get("/me", tags=["auth"])
def get_current_user_info(user: UserAccount = Depends(authentication_service.extract_authenticated_user)):
    """
    Get current authenticated user info including GitHub/DigitalOcean tokens.
    
    Requires: Bearer token in Authorization header
    """
    return {
        "ok": True,
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "company": user.company,
            "tier": user.tier,
            "email_verified": user.email_verified,
            "created_at": user.created_at.isoformat(),
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
            # GitHub
            "github_username": user.github_username,
            "github_id": user.github_id,
            "github_access_token": user.github_access_token,
            # DigitalOcean
            "digitalocean_id": getattr(user, 'digitalocean_id', None),
            "digitalocean_connected": bool(getattr(user, 'digitalocean_access_token', None)),
            "digitalocean_team_id": getattr(user, 'digitalocean_team_id', None),
            # OAuth provider
            "oauth_provider": user.oauth_provider,
        }
    }


# ===== API Key Management =====

@router.post("/api-keys", response_model=CreateAPIKeyResponse, tags=["auth"])
def create_api_key(
    req: CreateAPIKeyRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Create a new API key for programmatic access.
    
    ⚠️  WARNING: The full API key is only shown ONCE. Store it securely!
    
    Requires: Bearer token in Authorization header
    """
    try:
        full_key, api_key = authentication_service.create_api_key(user.id, req.name)
        
        return {
            "api_key": full_key,  # Only shown once!
            "key_info": {
                "id": api_key.id,
                "key_prefix": api_key.key_prefix,
                "name": api_key.name,
                "created_at": api_key.created_at,
                "last_used_at": api_key.last_used_at,
                "usage_count": api_key.usage_count
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to create API key"))


@router.get("/api-keys", response_model=List[APIKeyResponse], tags=["auth"])
def list_api_keys(user: UserAccount = Depends(authentication_service.extract_authenticated_user)):
    """
    List all active API keys for current user.
    
    Requires: Bearer token in Authorization header
    """
    keys = authentication_service.list_api_keys(user.id)
    
    return [
        {
            "id": key.id,
            "key_prefix": key.key_prefix,
            "name": key.name,
            "created_at": key.created_at,
            "last_used_at": key.last_used_at,
            "usage_count": key.usage_count
        }
        for key in keys
    ]


@router.delete("/api-keys/{key_id}", tags=["auth"])
def revoke_api_key(
    key_id: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Revoke an API key.
    
    Requires: Bearer token in Authorization header
    """
    success = authentication_service.revoke_api_key(key_id, user.id)
    
    if not success:
        raise HTTPException(status_code=404, detail="API key not found")
    
    return {
        "ok": True,
        "message": "API key revoked successfully"
    }


# ===== GitHub OAuth =====

# ===== GitLab OAuth ===== (DISABLED)

@router.get("/gitlab")
def gitlab_oauth_initiate():
    """
    GitLab OAuth is disabled - GitLab integration not supported.
    """
    raise HTTPException(status_code=501, detail="GitLab OAuth is not supported")


@router.get("/gitlab/callback")
def gitlab_oauth_callback(code: str, request: Request, db: Session = Depends(get_auth_db)):
    """
    GitLab OAuth is disabled - GitLab integration not supported.
    """
    raise HTTPException(status_code=501, detail="GitLab OAuth is not supported")

@router.get("/debug-env", tags=["auth"])
def debug_env():
    """Debug endpoint to check environment variables"""
    import os
    return {
        "GITHUB_CLIENT_ID": os.getenv("GITHUB_CLIENT_ID"),
        "GITHUB_REDIRECT_URI": os.getenv("GITHUB_REDIRECT_URI"),
        "all_github_vars": {k: v for k, v in os.environ.items() if "GITHUB" in k}
    }

@router.get("/github")
def github_oauth_initiate():
    """
    Start GitHub OAuth flow.
    Returns redirect URL for frontend to redirect user to.
    """
    GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
    REDIRECT_URI = os.getenv("GITHUB_REDIRECT_URI", "http://localhost:8000/auth/github/callback")
    
    # Debug logging
    print(f"DEBUG OAUTH: GITHUB_REDIRECT_URI from env: {REDIRECT_URI}")
    
    if not GITHUB_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GitHub OAuth not configured")
    
    # GitHub OAuth URL - encode redirect_uri properly
    github_url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={GITHUB_CLIENT_ID}"
        f"&redirect_uri={quote(REDIRECT_URI, safe='')}"
        f"&scope=repo%20workflow"  # Request repo access + workflow scope for .github/workflows
    )
    
    return {"redirect_url": github_url}


@router.get("/github/callback")
def github_oauth_callback(code: str, request: Request, db: Session = Depends(get_auth_db)):
    """
    GitHub OAuth callback.
    Exchange code for access token and create/login user.
    Users get 100 free credits per day.
    """
    from datetime import timedelta
    
    GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
    GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")
    
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="GitHub OAuth not configured")
    
    # Exchange code for access token
    token_url = "https://github.com/login/oauth/access_token"
    try:
        response = requests.post(
            token_url,
            headers={"Accept": "application/json"},
            data={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code
            },
            timeout=10  # 10 second timeout to prevent hanging
        )
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="GitHub API timeout - please try again")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=sanitize_error_detail(e, "Failed to connect to GitHub"))
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange code for token")
    
    token_data = response.json()
    access_token = token_data.get("access_token")
    
    if not access_token:
        raise HTTPException(status_code=400, detail="No access token received")
    
    # Get user info from GitHub
    try:
        user_response = requests.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10  # 10 second timeout to prevent hanging
        )
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="GitHub API timeout - please try again")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=sanitize_error_detail(e, "Failed to connect to GitHub"))
    
    if user_response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to get GitHub user info")
    
    github_user = user_response.json()
    
    # Create or update user in database
    user = db.query(UserAccount).filter(UserAccount.github_id == str(github_user["id"])).first()
    
    if not user:
        # Create new user with GitHub auth and free credits
        # Generate a secure random password since we need something
        random_password = secrets.token_urlsafe(16)
        tomorrow = datetime.utcnow() + timedelta(days=1)
        
        user = UserAccount(
            email=github_user.get("email") or f"{github_user['login']}@github.com",
            password_hash=authentication_service.generate_password_hash(random_password),
            github_id=str(github_user["id"]),
            github_username=github_user["login"],
            github_access_token=access_token,
            full_name=github_user.get("name"),
            company=None,
            tier="free",
            oauth_provider="github",
            daily_credits=100,  # Free tier: 100 credits/day
            credits_reset_at=tomorrow,
            email_verified=True  # GitHub emails are already verified
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        # Update existing user with latest GitHub token
        user.github_access_token = access_token
        user.github_username = github_user["login"]
        user.full_name = github_user.get("name") or user.full_name
        
        # Reset credits if it's a new day
        now = datetime.utcnow()
        if not user.credits_reset_at or user.credits_reset_at < now:
            user.daily_credits = 100
            user.credits_reset_at = now + timedelta(days=1)
        
        db.commit()
    
    # Create JWT token
    token = authentication_service.generate_access_token(
        token_payload={"sub": user.id, "email": user.email}
    )
    
    # Log successful login
    if AUDIT_LOGGING_ENABLED and audit_log_service:
        try:
            client_ip = request.client.host if request.client else None
            audit_log_service.log_login(
                user_id=user.id,
                user_name=user.github_username or user.full_name or user.email,
                user_email=user.email,
                ip_address=client_ip,
                success=True,
            )
        except Exception as audit_error:
            print(f"[Auth] Failed to log login audit event: {audit_error}")
    
    # Redirect to frontend with token
    # Detect if request came from Electron (localhost) or Vercel (production)
    # Check the Referer header to determine where to redirect
    referer = request.headers.get("referer", "")
    
    if "localhost" in referer or "127.0.0.1" in referer:
        # Electron dev mode
        FRONTEND_URL = "http://localhost:3000"
    else:
        # Production (Vercel)
        FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
    
    redirect_url = f"{FRONTEND_URL}/auth/callback?token={token}"
    
    return RedirectResponse(url=redirect_url)


@router.get("/credits", tags=["auth"])
def get_credits_status(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """
    Get current credits balance.
    Free tier: 100 credits/day, resets every 24 hours.
    """
    from app.services import credit_tracker
    
    return credit_tracker.get_credits_remaining(user, db)


@router.get("/github/repos", tags=["auth"])
def get_github_repositories(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Get list of GitHub repositories the user has access to.
    Requires GitHub OAuth authentication.
    """
    if not user.github_access_token:
        raise HTTPException(
            status_code=403,
            detail="GitHub authentication required. Please sign in with GitHub."
        )
    
    try:
        # Fetch user's repositories from GitHub
        response = requests.get(
            "https://api.github.com/user/repos",
            headers={
                "Authorization": f"Bearer {user.github_access_token}",
                "Accept": "application/vnd.github.v3+json"
            },
            params={
                "per_page": 100,  # Get up to 100 repos
                "sort": "updated",  # Most recently updated first
                "affiliation": "owner,collaborator,organization_member"
            },
            timeout=15  # 15 second timeout for fetching repos list
        )
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="GitHub API timeout - please try again")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=sanitize_error_detail(e, "Failed to connect to GitHub"))
    
    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail="Failed to fetch repositories from GitHub"
        )
    
    repos = response.json()
    
    # Return simplified repo data
    return [
        {
            "id": repo["id"],
            "name": repo["name"],
            "full_name": repo["full_name"],
            "private": repo["private"],
            "description": repo.get("description"),
            "html_url": repo["html_url"],
            "default_branch": repo.get("default_branch", "main"),
            "updated_at": repo["updated_at"],
        }
        for repo in repos
    ]


# ===== DigitalOcean OAuth =====

@router.get("/digitalocean")
def digitalocean_oauth_initiate():
    """
    Start DigitalOcean OAuth flow.
    Returns redirect URL for frontend to redirect user to.
    """
    DO_CLIENT_ID = os.getenv("DIGITALOCEAN_CLIENT_ID")
    REDIRECT_URI = os.getenv("DIGITALOCEAN_REDIRECT_URI", "http://localhost:8000/auth/digitalocean/callback")
    
    if not DO_CLIENT_ID:
        raise HTTPException(status_code=500, detail="DigitalOcean OAuth not configured. Set DIGITALOCEAN_CLIENT_ID.")
    
    # Generate state for CSRF protection
    state = secrets.token_urlsafe(32)
    
    # DigitalOcean OAuth URL
    # Scopes: read, write for full API access
    do_url = (
        f"https://cloud.digitalocean.com/v1/oauth/authorize"
        f"?client_id={DO_CLIENT_ID}"
        f"&redirect_uri={quote(REDIRECT_URI, safe='')}"
        f"&response_type=code"
        f"&scope=read%20write"
        f"&state={state}"
    )
    
    return {"redirect_url": do_url, "state": state}


@router.get("/digitalocean/callback")
def digitalocean_oauth_callback(
    code: str, 
    state: Optional[str] = None,
    request: Request = None, 
    db: Session = Depends(get_auth_db)
):
    """
    DigitalOcean OAuth callback.
    Exchange code for access token and store it for the user.
    """
    DO_CLIENT_ID = os.getenv("DIGITALOCEAN_CLIENT_ID")
    DO_CLIENT_SECRET = os.getenv("DIGITALOCEAN_CLIENT_SECRET")
    REDIRECT_URI = os.getenv("DIGITALOCEAN_REDIRECT_URI", "http://localhost:8000/auth/digitalocean/callback")
    
    if not DO_CLIENT_ID or not DO_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="DigitalOcean OAuth not configured")
    
    # Exchange code for access token
    token_url = "https://cloud.digitalocean.com/v1/oauth/token"
    try:
        response = requests.post(
            token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": DO_CLIENT_ID,
                "client_secret": DO_CLIENT_SECRET,
                "redirect_uri": REDIRECT_URI
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15
        )
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="DigitalOcean API timeout - please try again")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=sanitize_error_detail(e, "Failed to connect to DigitalOcean"))
    
    if response.status_code != 200:
        error_detail = response.json().get("error_description", "Failed to exchange code for token")
        raise HTTPException(status_code=400, detail=error_detail)
    
    token_data = response.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 2592000)  # Default 30 days
    
    if not access_token:
        raise HTTPException(status_code=400, detail="No access token received from DigitalOcean")
    
    # Get account info from DigitalOcean
    try:
        account_response = requests.get(
            "https://api.digitalocean.com/v2/account",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10
        )
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=sanitize_error_detail(e, "Failed to fetch DigitalOcean account"))
    
    if account_response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to get DigitalOcean account info")
    
    do_account = account_response.json().get("account", {})
    do_uuid = do_account.get("uuid")
    do_team_uuid = do_account.get("team", {}).get("uuid") if do_account.get("team") else None
    
    # Calculate token expiration
    from datetime import timedelta
    token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
    
    # Redirect to frontend with success
    # Check the Referer header to determine where to redirect
    referer = request.headers.get("referer", "") if request else ""
    
    if "localhost" in referer or "127.0.0.1" in referer:
        FRONTEND_URL = "http://localhost:3000"
    else:
        FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
    
    # Return token info to be stored - frontend will call /auth/digitalocean/connect
    redirect_url = f"{FRONTEND_URL}/auth/digitalocean/callback?access_token={access_token}&refresh_token={refresh_token}&expires_in={expires_in}&do_uuid={do_uuid}"
    
    return RedirectResponse(url=redirect_url)


@router.post("/digitalocean/connect")
def connect_digitalocean_account(
    access_token: str = Query(..., description="DigitalOcean access token"),
    refresh_token: Optional[str] = Query(None, description="DigitalOcean refresh token"),
    expires_in: Optional[int] = Query(2592000, description="Token expiry in seconds"),
    do_uuid: Optional[str] = Query(None, description="DigitalOcean user UUID"),
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """
    Connect DigitalOcean account to existing user.
    Called by frontend after OAuth callback.
    """
    from datetime import timedelta
    
    # Verify the token works
    try:
        verify_response = requests.get(
            "https://api.digitalocean.com/v2/account",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10
        )
        if verify_response.status_code != 200:
            raise HTTPException(status_code=400, detail="Invalid DigitalOcean access token")
        
        do_account = verify_response.json().get("account", {})
        do_uuid = do_account.get("uuid")
        do_team_uuid = do_account.get("team", {}).get("uuid") if do_account.get("team") else None
    except requests.exceptions.RequestException:
        raise HTTPException(status_code=502, detail="Failed to verify DigitalOcean token")
    
    # Re-fetch user in this session to ensure changes are tracked
    db_user = db.query(UserAccount).filter(UserAccount.id == user.id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update user with DigitalOcean credentials
    db_user.digitalocean_id = do_uuid
    db_user.digitalocean_access_token = access_token
    db_user.digitalocean_refresh_token = refresh_token
    db_user.digitalocean_token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
    db_user.digitalocean_team_id = do_team_uuid
    
    db.commit()
    db.refresh(db_user)
    
    return {
        "ok": True,
        "message": "DigitalOcean account connected successfully",
        "digitalocean_id": do_uuid,
        "team_id": do_team_uuid
    }


@router.delete("/digitalocean/disconnect")
def disconnect_digitalocean_account(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """
    Disconnect DigitalOcean account from user.
    """
    user.digitalocean_id = None
    user.digitalocean_access_token = None
    user.digitalocean_refresh_token = None
    user.digitalocean_token_expires_at = None
    user.digitalocean_team_id = None
    
    db.commit()
    
    return {"ok": True, "message": "DigitalOcean account disconnected"}


@router.post("/digitalocean/refresh")
def refresh_digitalocean_token(
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    db: Session = Depends(get_auth_db)
):
    """
    Refresh DigitalOcean access token using refresh token.
    """
    if not user.digitalocean_refresh_token:
        raise HTTPException(status_code=400, detail="No DigitalOcean refresh token available")
    
    DO_CLIENT_ID = os.getenv("DIGITALOCEAN_CLIENT_ID")
    DO_CLIENT_SECRET = os.getenv("DIGITALOCEAN_CLIENT_SECRET")
    
    if not DO_CLIENT_ID or not DO_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="DigitalOcean OAuth not configured")
    
    try:
        response = requests.post(
            "https://cloud.digitalocean.com/v1/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": user.digitalocean_refresh_token,
                "client_id": DO_CLIENT_ID,
                "client_secret": DO_CLIENT_SECRET
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15
        )
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=sanitize_error_detail(e, "Failed to refresh token"))
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to refresh DigitalOcean token")
    
    token_data = response.json()
    from datetime import timedelta
    
    user.digitalocean_access_token = token_data.get("access_token")
    user.digitalocean_refresh_token = token_data.get("refresh_token", user.digitalocean_refresh_token)
    user.digitalocean_token_expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 2592000))
    
    db.commit()
    
    return {"ok": True, "message": "Token refreshed successfully"}


class CreateRepoRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    private: bool = True

@router.post("/github/create-repo", tags=["auth"])
def create_github_repository(
    request: CreateRepoRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Create a new GitHub repository.
    Requires GitHub OAuth authentication.
    """
    if not user.github_access_token:
        raise HTTPException(
            status_code=403,
            detail="GitHub authentication required. Please sign in with GitHub."
        )
    
    name = request.name
    description = request.description or ""
    is_private = request.private
    
    if not name:
        raise HTTPException(status_code=400, detail="Repository name is required")
    
    try:
        # Create repository via GitHub API
        response = requests.post(
            "https://api.github.com/user/repos",
            headers={
                "Authorization": f"Bearer {user.github_access_token}",
                "Accept": "application/vnd.github.v3+json"
            },
            json={
                "name": name,
                "description": description,
                "private": is_private,
                "auto_init": True  # Initialize with README
            },
            timeout=15
        )
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="GitHub API timeout - please try again")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=sanitize_error_detail(e, "Failed to connect to GitHub"))
    
    if response.status_code not in [201, 200]:
        error_detail = response.json().get("message", "Failed to create repository")
        raise HTTPException(
            status_code=response.status_code,
            detail=error_detail
        )
    
    repo = response.json()
    
    # Return simplified repo data
    return {
        "id": repo["id"],
        "name": repo["name"],
        "full_name": repo["full_name"],
        "private": repo["private"],
        "description": repo.get("description"),
        "html_url": repo["html_url"],
        "default_branch": repo.get("default_branch", "main"),
        "updated_at": repo["updated_at"],
    }
