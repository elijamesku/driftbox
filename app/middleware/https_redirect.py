"""
Secure connection enforcement middleware for transport layer security.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request
from fastapi.responses import RedirectResponse
import os


class HTTPSRedirectMiddleware(BaseHTTPMiddleware):
    """
    Enforces HTTPS connections in production environments.
    
    Security benefits:
    - Prevents man-in-the-middle interception
    - Protects credential transmission
    - Prevents session token hijacking
    """
    
    def __init__(self, app, force_https: bool = None):
        super().__init__(app)
        
        # Determine HTTPS enforcement from environment
        if force_https is None:
            environment = os.getenv("ENV", "development")
            self.enforce_https = environment == "production"
        else:
            self.enforce_https = force_https
    
    async def dispatch(self, request: Request, call_next):
        # Allow HTTP in development environments
        if not self.enforce_https:
            return await call_next(request)
        
        # Verify connection security
        connection_is_secure = request.url.scheme == "https"
        
        # Handle load balancer proxy headers
        forwarded_protocol = request.headers.get("x-forwarded-proto", "").lower()
        if forwarded_protocol == "https":
            connection_is_secure = True
        
        # Redirect insecure connections to HTTPS
        if not connection_is_secure:
            secure_url = request.url.replace(scheme="https")
            return RedirectResponse(url=str(secure_url), status_code=301)
        
        return await call_next(request)

