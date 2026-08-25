"""
Request throttling middleware for API abuse prevention.
"""
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Dict, Optional
from datetime import datetime, timedelta
from collections import defaultdict


class RequestThrottler:
    """
    In-memory request throttling engine (recommend Redis for production scale).
    Monitors request frequency per client and enforces tier-based quotas.
    """
    
    def __init__(self):
        # Request tracking storage: {client_key: [(timestamp, request_count)]}
        self.request_history: Dict[str, list] = defaultdict(list)
        
        # Tier-based quota configuration
        self.tier_quotas = {
            "anonymous": {
                "requests_per_minute": 100,  # Increased from 10
                "requests_per_hour": 1000,   # Increased from 100
                "requests_per_day": 5000     # Increased from 500
            },
            "free": {
                "requests_per_minute": 200,  # Increased from 30
                "requests_per_hour": 2000,   # Increased from 500
                "requests_per_day": 10000    # Increased from 2000
            },
            "pro": {
                "requests_per_minute": 100,
                "requests_per_hour": 5000,
                "requests_per_day": 50000
            },
            "enterprise": {
                "requests_per_minute": 1000,
                "requests_per_hour": 50000,
                "requests_per_day": 1000000
            }
        }
    
    def verify_request_quota(
        self,
        client_key: str,
        subscription_tier: str = "anonymous"
    ) -> tuple[bool, Optional[Dict]]:
        """
        Verify whether request should be permitted based on quota.
        
        Args:
            client_key: Unique client identifier (user_id or IP address)
            subscription_tier: Client's subscription tier level
        
        Returns:
            (request_permitted: bool, quota_info: dict)
        """
        current_time = datetime.utcnow()
        
        # Purge expired request records
        self._purge_expired_records(client_key, current_time)
        
        # Retrieve quota limits for tier
        quota_limits = self.tier_quotas.get(subscription_tier, self.tier_quotas["anonymous"])
        
        # Calculate time window boundaries
        one_minute_ago = current_time - timedelta(minutes=1)
        one_hour_ago = current_time - timedelta(hours=1)
        one_day_ago = current_time - timedelta(days=1)
        
        client_request_history = self.request_history[client_key]
        
        # Aggregate requests within each time window
        minute_request_count = sum(1 for ts, _ in client_request_history if ts > one_minute_ago)
        hour_request_count = sum(1 for ts, _ in client_request_history if ts > one_hour_ago)
        day_request_count = sum(1 for ts, _ in client_request_history if ts > one_day_ago)
        
        # Enforce per-minute quota
        if minute_request_count >= quota_limits["requests_per_minute"]:
            return False, {
                "error": "rate_limit_exceeded",
                "limit": "requests_per_minute",
                "max": quota_limits["requests_per_minute"],
                "current": minute_request_count,
                "retry_after": 60
            }
        
        # Enforce per-hour quota
        if hour_request_count >= quota_limits["requests_per_hour"]:
            return False, {
                "error": "rate_limit_exceeded",
                "limit": "requests_per_hour",
                "max": quota_limits["requests_per_hour"],
                "current": hour_request_count,
                "retry_after": 3600
            }
        
        # Enforce per-day quota
        if day_request_count >= quota_limits["requests_per_day"]:
            return False, {
                "error": "rate_limit_exceeded",
                "limit": "requests_per_day",
                "max": quota_limits["requests_per_day"],
                "current": day_request_count,
                "retry_after": 86400
            }
        
        # Record this request
        self.request_history[client_key].append((current_time, 1))
        
        # Return success with current usage statistics
        return True, {
            "requests_last_minute": minute_request_count + 1,
            "requests_last_hour": hour_request_count + 1,
            "requests_last_day": day_request_count + 1,
            "limits": quota_limits
        }
    
    def _purge_expired_records(self, client_key: str, current_time: datetime):
        """Remove request records older than 24 hours"""
        cutoff_time = current_time - timedelta(days=1)
        self.request_history[client_key] = [
            (timestamp, count) for timestamp, count in self.request_history[client_key]
            if timestamp > cutoff_time
        ]


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    FastAPI middleware implementing request throttling.
    """
    
    def __init__(self, app, rate_limiter: RequestThrottler):
        super().__init__(app)
        self.throttler = rate_limiter
        
        # Endpoints exempted from rate limiting
        self.exempted_endpoints = [
            "/health",
            "/docs",
            "/openapi.json",
            "/redoc"
        ]
    
    async def dispatch(self, request: Request, call_next):
        # Bypass throttling for exempted endpoints
        if any(request.url.path.startswith(path) for path in self.exempted_endpoints):
            return await call_next(request)
        
        # Extract client identifier
        authenticated_user_id = None
        subscription_tier = "anonymous"
        
        # Attempt to extract user from authentication token
        authorization_header = request.headers.get("Authorization")
        if authorization_header and authorization_header.startswith("Bearer "):
            bearer_token = authorization_header.split(" ")[1]
            try:
                from app.services.auth import authentication_service
                token_payload = authentication_service.parse_and_verify_token(bearer_token)
                authenticated_user_id = token_payload.get("sub")
                subscription_tier = token_payload.get("tier", "free")
            except:
                pass
        
        # Use IP address as fallback identifier
        client_identifier = authenticated_user_id or request.client.host
        
        # Verify request against quota
        request_permitted, quota_info = self.throttler.verify_request_quota(client_identifier, subscription_tier)
        
        if not request_permitted:
            # Quota exceeded - reject request
            raise HTTPException(
                status_code=429,
                detail=quota_info,
                headers={
                    "X-RateLimit-Limit": str(quota_info["max"]),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(quota_info["retry_after"]),
                    "Retry-After": str(quota_info["retry_after"])
                }
            )
        
        # Process request and attach quota headers
        response = await call_next(request)
        
        if quota_info:
            response.headers["X-RateLimit-Limit-Minute"] = str(quota_info["limits"]["requests_per_minute"])
            response.headers["X-RateLimit-Limit-Hour"] = str(quota_info["limits"]["requests_per_hour"])
            response.headers["X-RateLimit-Limit-Day"] = str(quota_info["limits"]["requests_per_day"])
            response.headers["X-RateLimit-Remaining-Day"] = str(
                quota_info["limits"]["requests_per_day"] - quota_info["requests_last_day"]
            )
        
        return response


# Global throttler instance
rate_limiter = RequestThrottler()

