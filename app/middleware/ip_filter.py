"""
IP-based access control middleware for request filtering.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, HTTPException
from typing import List, Set
import os


class IPFilterMiddleware(BaseHTTPMiddleware):
    """
    IP-based request filtering with deny/allow list support.
    
    Features:
    - Deny list (block malicious IP addresses)
    - Allow list (restrict access to authorized IPs only)
    - Environment variable configuration
    """
    
    def __init__(
        self,
        app,
        blacklist: List[str] = None,
        whitelist: List[str] = None,
        enable_whitelist: bool = False
    ):
        super().__init__(app)
        
        # Initialize deny list from environment or parameter
        if blacklist is None:
            deny_list_env = os.getenv("IP_BLACKLIST", "")
            self.denied_ips = set(deny_list_env.split(",")) if deny_list_env else set()
        else:
            self.denied_ips = set(blacklist)
        
        # Initialize allow list from environment or parameter
        if whitelist is None:
            allow_list_env = os.getenv("IP_WHITELIST", "")
            self.allowed_ips = set(allow_list_env.split(",")) if allow_list_env else set()
        else:
            self.allowed_ips = set(whitelist)
        
        # Allow list enforcement (opt-in for safety)
        self.enforce_allow_list = enable_whitelist or os.getenv("ENABLE_IP_WHITELIST", "false").lower() == "true"
        
        # Paths exempted from IP filtering
        self.exempted_paths = [
            "/health",
            "/docs",
            "/openapi.json"
        ]
    
    async def dispatch(self, request: Request, call_next):
        # Bypass IP filtering for exempted endpoints
        if any(request.url.path.startswith(path) for path in self.exempted_paths):
            return await call_next(request)
        
        # Extract client IP address
        requesting_ip = self._extract_client_ip(request)
        
        # Enforce deny list (always active)
        if requesting_ip in self.denied_ips:
            print(f"[SECURITY] Blocked denied IP address: {requesting_ip}")
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "access_denied",
                    "message": "Your IP address has been blocked",
                    "ip": requesting_ip
                }
            )
        
        # Enforce allow list (when enabled)
        if self.enforce_allow_list and self.allowed_ips:
            if requesting_ip not in self.allowed_ips:
                print(f"[SECURITY] Blocked unauthorized IP address: {requesting_ip}")
                raise HTTPException(
                    status_code=403,
                    detail={
                        "error": "access_denied",
                        "message": "Your IP address is not authorized",
                        "ip": requesting_ip
                    }
                )
        
        return await call_next(request)
    
    def _extract_client_ip(self, request: Request) -> str:
        """Extract client IP address, handling proxy configurations"""
        # Check proxy forwarding header
        forwarded_for_header = request.headers.get("x-forwarded-for")
        if forwarded_for_header:
            # Extract original client IP (first in chain)
            return forwarded_for_header.split(",")[0].strip()
        
        # Check alternative proxy header
        real_ip_header = request.headers.get("x-real-ip")
        if real_ip_header:
            return real_ip_header
        
        # Default to direct connection IP
        return request.client.host if request.client else "unknown"
    
    def add_to_deny_list(self, ip_address: str):
        """Dynamically append IP address to deny list"""
        self.denied_ips.add(ip_address)
        print(f"[SECURITY] Added {ip_address} to deny list")
    
    def remove_from_deny_list(self, ip_address: str):
        """Remove IP address from deny list"""
        self.denied_ips.discard(ip_address)
        print(f"[SECURITY] Removed {ip_address} from deny list")
    
    def add_to_allow_list(self, ip_address: str):
        """Dynamically append IP address to allow list"""
        self.allowed_ips.add(ip_address)
        print(f"[SECURITY] Added {ip_address} to allow list")
    
    def get_deny_list(self) -> Set[str]:
        """Retrieve current deny list snapshot"""
        return self.denied_ips.copy()
    
    def get_allow_list(self) -> Set[str]:
        """Retrieve current allow list snapshot"""
        return self.allowed_ips.copy()

