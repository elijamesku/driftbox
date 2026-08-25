"""
Security response header middleware for vulnerability mitigation.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request
import os


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Injects protective security headers into all HTTP responses.
    
    Mitigates:
    - Clickjacking attacks (X-Frame-Options)
    - Cross-site scripting (X-XSS-Protection, Content-Security-Policy)
    - MIME type confusion (X-Content-Type-Options)
    - Transport layer attacks (Strict-Transport-Security)
    """
    
    def __init__(self, app):
        super().__init__(app)
        self.production_mode = os.getenv("ENV", "development") == "production"
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        # Clickjacking protection
        response.headers["X-Frame-Options"] = "DENY"
        
        # XSS attack mitigation
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        
        # Content Security Policy configuration
        # Customize directives based on application requirements
        csp_directives = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",  # Inline scripts enabled for documentation
            "style-src 'self' 'unsafe-inline'",   # Inline styles enabled for documentation
            "img-src 'self' data: https:",
            "font-src 'self' data:",
            "connect-src 'self' https://api.anthropic.com https://api.openai.com",
            "frame-ancestors 'none'"
        ]
        response.headers["Content-Security-Policy"] = "; ".join(csp_directives)
        
        # Referrer information policy
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        
        # Server identification header
        response.headers["X-Powered-By"] = "Infrara"
        
        # HTTPS enforcement (production only)
        if self.production_mode:
            # Enforce HTTPS for one year including subdomains
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        
        # Browser feature restriction policy
        restricted_features = [
            "geolocation=()",
            "microphone=()",
            "camera=()",
            "payment=()",
            "usb=()",
            "magnetometer=()"
        ]
        response.headers["Permissions-Policy"] = ", ".join(restricted_features)
        
        return response

