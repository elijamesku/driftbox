"""
Request audit trail middleware for security monitoring and analytics.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request
from datetime import datetime
import time
import json
from typing import Optional


class AuditLogger(BaseHTTPMiddleware):
    """
    Captures comprehensive audit trail for all API interactions.
    
    Monitored attributes:
    - Request originator (authenticated user or IP address)
    - Accessed endpoint path
    - Request timestamp
    - HTTP response status
    - Execution latency
    """
    
    def __init__(self, app, log_to_db: bool = True):
        super().__init__(app)
        self.enable_database_logging = log_to_db
        
        # Endpoint paths excluded from audit logging (reduce noise)
        self.excluded_paths = [
            "/health",
            "/docs",
            "/openapi.json",
            "/redoc",
            "/favicon.ico"
        ]
    
    async def dispatch(self, request: Request, call_next):
        # Bypass audit logging for excluded paths
        if any(request.url.path.startswith(path) for path in self.excluded_paths):
            return await call_next(request)
        
        request_start_timestamp = time.time()
        
        # Capture request metadata
        authenticated_user = self._extract_user_identifier(request)
        client_ip_address = self._extract_client_ip(request)
        
        audit_record = {
            "timestamp": datetime.utcnow(),
            "user_id": authenticated_user,
            "ip_address": client_ip_address,
            "method": request.method,
            "path": request.url.path,
            "query_params": str(request.url.query) if request.url.query else None,
            "user_agent": request.headers.get("user-agent"),
            "referer": request.headers.get("referer")
        }
        
        # Execute request and capture response
        try:
            response = await call_next(request)
            
            # Append response metadata
            audit_record["status_code"] = response.status_code
            audit_record["duration_ms"] = int((time.time() - request_start_timestamp) * 1000)
            audit_record["success"] = 200 <= response.status_code < 400
            
        except Exception as error:
            # Capture exception details
            audit_record["status_code"] = 500
            audit_record["duration_ms"] = int((time.time() - request_start_timestamp) * 1000)
            audit_record["success"] = False
            audit_record["error"] = str(error)
            raise
        
        finally:
            # Persist audit record
            await self._persist_audit_record(audit_record)
        
        return response
    
    def _extract_user_identifier(self, request: Request) -> Optional[str]:
        """Extract authenticated user ID from authorization token"""
        authorization_header = request.headers.get("authorization")
        if not authorization_header or not authorization_header.startswith("Bearer "):
            return None
        
        try:
            bearer_token = authorization_header.split(" ")[1]
            from app.services.auth import authentication_service
            token_payload = authentication_service.parse_and_verify_token(bearer_token)
            return token_payload.get("sub")
        except:
            return None
    
    def _extract_client_ip(self, request: Request) -> str:
        """Extract client IP address, handling proxy configurations"""
        # Check proxy forwarding headers
        forwarded_for_header = request.headers.get("x-forwarded-for")
        if forwarded_for_header:
            # Extract first IP from forwarded chain (original client)
            return forwarded_for_header.split(",")[0].strip()
        
        real_ip_header = request.headers.get("x-real-ip")
        if real_ip_header:
            return real_ip_header
        
        # Default to direct connection IP
        return request.client.host if request.client else "unknown"
    
    async def _persist_audit_record(self, audit_record: dict):
        """Persist audit record to console and optionally database"""
        # Console logging (always enabled)
        user_identifier = f"user={audit_record['user_id']}" if audit_record['user_id'] else f"ip={audit_record['ip_address']}"
        status_indicator = "✅" if audit_record['success'] else "❌"
        
        print(
            f"[AUDIT] {status_indicator} {audit_record['method']} {audit_record['path']} "
            f"- {audit_record['status_code']} - {audit_record['duration_ms']}ms - {user_identifier}"
        )
        
        # Database persistence (optional for long-term retention)
        if self.enable_database_logging:
            try:
                from app.database.connection import acquire_auth_session
                from app.database.models import ActivityLog
                
                # Store in authentication database where usage tracking resides
                database_session = next(acquire_auth_session())
                
                # Only persist authenticated user requests (skip anonymous)
                if audit_record['user_id']:
                    activity_event = ActivityLog(
                        user_id=audit_record['user_id'],
                        event_type="api_request",
                        event_category="audit",
                        event_metadata={
                            "method": audit_record['method'],
                            "path": audit_record['path'],
                            "status_code": audit_record['status_code'],
                            "duration_ms": audit_record['duration_ms']
                        },
                        cost_usd=0.0,
                        billable=False,
                        ip_address=audit_record['ip_address'],
                        user_agent=audit_record['user_agent'],
                        endpoint=audit_record['path']
                    )
                    
                    database_session.add(activity_event)
                    database_session.commit()
            except Exception as error:
                # Graceful degradation - don't fail request on logging failure
                print(f"[AUDIT] Database logging failure: {error}")

