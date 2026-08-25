# Application entry point and lifecycle management
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.requests import Request
from starlette.exceptions import HTTPException as StarletteHTTPException
from contextlib import asynccontextmanager
from app.config import RAG_SYSTEM_ACTIVE
from app.rag.pipeline import ensure_terraform_registry_documentation_crawled, ensure_vector_search_index_constructed
from app.api.v1.router import api_router

@asynccontextmanager
async def application_lifecycle(application: FastAPI):
    # Application startup sequence
    print("🚀 Backend service initialization starting...")
    
    # Setup database layer
    try:
        from app.database.connection import setup_database, setup_auth_database
        setup_database()
        setup_auth_database()
        print("✓ Database layer configured successfully")
    except Exception as error:
        print(f"⚠️  Database configuration error: {error}")
    
    # Setup RAG system when configured
    if RAG_SYSTEM_ACTIVE:
        try:
            ensure_terraform_registry_documentation_crawled()
            ensure_vector_search_index_constructed()
            print("✓ RAG system configured successfully")
        except Exception as error:
            print(f"⚠️  RAG system configuration error: {error}")
    
    yield
    
    # Application shutdown sequence
    try:
        from app.database.connection import teardown_database, teardown_auth_database
        teardown_database()
        teardown_auth_database()
        print("✓ Database connections terminated")
    except Exception:
        pass

# Application instance configuration
application = FastAPI(
    title="Infrara - AI Copilot for DevOps",
    version="1.0.0",
    description="Backend API for Cursor-like IDE for infrastructure engineers",
    lifespan=application_lifecycle
)

# Security middleware stack - order is critical for proper security
# Layer 1: HTTPS enforcement at entry point
from app.middleware.https_redirect import HTTPSRedirectMiddleware
application.add_middleware(HTTPSRedirectMiddleware)

# Layer 2: Apply security response headers
from app.middleware.security_headers import SecurityHeadersMiddleware
application.add_middleware(SecurityHeadersMiddleware)

# Layer 3: Enforce payload size constraints
from app.middleware.request_size_limiter import RequestSizeLimiter
application.add_middleware(RequestSizeLimiter, max_upload_size=10_000_000)  # 10MB limit

# Layer 4: IP-based access control
from app.middleware.ip_filter import IPFilterMiddleware
application.add_middleware(IPFilterMiddleware)

# Layer 5: Request rate limiting protection
from app.middleware.rate_limiter import RateLimitMiddleware, rate_limiter
application.add_middleware(RateLimitMiddleware, rate_limiter=rate_limiter)

# Layer 6: Request audit trail logging
from app.middleware.audit_logger import AuditLogger
application.add_middleware(AuditLogger, log_to_db=True)

# Layer 7: Cross-origin resource sharing - applied last
from fastapi.middleware.cors import CORSMiddleware
import os

# Parse allowed origin configuration
cors_origins_str = os.getenv(
    "CORS_ORIGINS",
    # Development environment defaults
    "http://localhost:3000,http://localhost:8080,http://127.0.0.1:3000,http://127.0.0.1:8080"
)

# Parse origins
all_origins = [origin.strip() for origin in cors_origins_str.split(",")]

# Separate exact origins from wildcards
permitted_origins = [origin for origin in all_origins if "*" not in origin]
has_vercel_wildcard = any("*vercel.app" in origin for origin in all_origins)

# Build regex pattern for Vercel if wildcard is present
vercel_regex = r"https://.*\.vercel\.app" if has_vercel_wildcard else None

application.add_middleware(
    CORSMiddleware,
    allow_origins=permitted_origins,
    allow_origin_regex=vercel_regex,  # Allows any *.vercel.app subdomain
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
    max_age=600,  # Preflight cache duration: 10 minutes
)

# Attach API route handlers
application.include_router(api_router)

# Global exception handling configuration
@application.exception_handler(StarletteHTTPException)
async def handle_http_exceptions(incoming_request: Request, error: StarletteHTTPException):
    return JSONResponse(status_code=error.status_code, content={"error": "http_exception", "detail": error.detail})

@application.exception_handler(Exception)
async def handle_unexpected_exceptions(incoming_request: Request, error: Exception):
    from app.utils.errors import sanitize_error_detail
    detail = sanitize_error_detail(error, "An internal server error occurred")
    return JSONResponse(status_code=500, content={"error": "internal_server_error", "detail": detail})

# Direct execution entry point
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(application, host="127.0.0.1", port=8000, reload=False)