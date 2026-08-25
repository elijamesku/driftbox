"""
Payload size enforcement middleware for DoS attack prevention.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, HTTPException


class RequestSizeLimiter(BaseHTTPMiddleware):
    """
    Enforces maximum request payload size constraints.
    
    Protection against:
    - Memory exhaustion via oversized uploads
    - Denial of service through massive payloads
    """
    
    def __init__(
        self, 
        app,
        max_upload_size: int = 10_000_000  # Default: 10MB
    ):
        super().__init__(app)
        self.maximum_payload_bytes = max_upload_size
    
    async def dispatch(self, request: Request, call_next):
        # Inspect Content-Length header for payload size
        declared_content_length = request.headers.get("content-length")
        
        if declared_content_length:
            payload_size = int(declared_content_length)
            
            if payload_size > self.maximum_payload_bytes:
                raise HTTPException(
                    status_code=413,
                    detail={
                        "error": "payload_too_large",
                        "message": f"Request body exceeds maximum size. Limit: {self.maximum_payload_bytes} bytes ({self.maximum_payload_bytes // 1_000_000}MB)",
                        "max_size_bytes": self.maximum_payload_bytes,
                        "received_size_bytes": payload_size
                    }
                )
        
        response = await call_next(request)
        return response

