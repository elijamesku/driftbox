"""
DigitalOcean Version Service
Queries the DigitalOcean API for valid versions of various resources.
Provides caching and smart version selection.
"""

import os
import time
import httpx
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from functools import lru_cache


@dataclass
class KubernetesVersion:
    slug: str  # e.g., "1.31.1-do.5"
    kubernetes_version: str  # e.g., "1.31.1"
    supported_features: List[str]


@dataclass
class DatabaseVersion:
    engine: str  # e.g., "pg", "mysql", "redis", "mongodb"
    version: str  # e.g., "16", "8", "7"
    

@dataclass
class DropletSize:
    slug: str  # e.g., "s-1vcpu-1gb"
    memory: int  # MB
    vcpus: int
    disk: int  # GB
    price_monthly: float


@dataclass  
class Region:
    slug: str  # e.g., "nyc1", "nyc3", "sfo3"
    name: str  # e.g., "New York 1"
    available: bool


class DigitalOceanVersionService:
    """
    Service for querying DigitalOcean API for valid resource versions.
    Includes caching to avoid excessive API calls.
    """
    
    # Cache expiry in seconds (1 hour)
    CACHE_TTL = 3600
    
    def __init__(self):
        self._cache: Dict[str, Any] = {}
        self._cache_timestamps: Dict[str, float] = {}
    
    def _get_token(self) -> Optional[str]:
        """Get DigitalOcean API token from environment."""
        return os.environ.get('DIGITALOCEAN_TOKEN')
    
    def _is_cache_valid(self, key: str) -> bool:
        """Check if cached data is still valid."""
        if key not in self._cache_timestamps:
            return False
        return (time.time() - self._cache_timestamps[key]) < self.CACHE_TTL
    
    def _cache_set(self, key: str, value: Any):
        """Store value in cache."""
        self._cache[key] = value
        self._cache_timestamps[key] = time.time()
    
    def _cache_get(self, key: str) -> Optional[Any]:
        """Get value from cache if valid."""
        if self._is_cache_valid(key):
            return self._cache.get(key)
        return None
    
    async def _fetch_api(self, endpoint: str, token: Optional[str] = None) -> Optional[Dict]:
        """Fetch data from DigitalOcean API."""
        api_token = token or self._get_token()
        if not api_token:
            print("[DO Versions] No DigitalOcean token available")
            return None
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"https://api.digitalocean.com/v2/{endpoint}",
                    headers={"Authorization": f"Bearer {api_token}"}
                )
                if response.status_code == 200:
                    return response.json()
                else:
                    print(f"[DO Versions] API error {response.status_code}: {response.text[:200]}")
                    return None
        except Exception as e:
            print(f"[DO Versions] Error fetching {endpoint}: {e}")
            return None
    
    # =========================================================================
    # Kubernetes Versions
    # =========================================================================
    
    async def get_kubernetes_versions(self, token: Optional[str] = None) -> List[KubernetesVersion]:
        """
        Get available Kubernetes versions from DigitalOcean.
        Returns list ordered by newest first (DO's default ordering).
        """
        cache_key = "kubernetes_versions"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        
        data = await self._fetch_api("kubernetes/options", token)
        if not data:
            return []
        
        versions = []
        for v in data.get("options", {}).get("versions", []):
            versions.append(KubernetesVersion(
                slug=v.get("slug", ""),
                kubernetes_version=v.get("kubernetes_version", ""),
                supported_features=v.get("supported_features", [])
            ))
        
        self._cache_set(cache_key, versions)
        print(f"[DO Versions] Cached {len(versions)} Kubernetes versions")
        return versions
    
    async def get_default_kubernetes_version(self, token: Optional[str] = None) -> Optional[str]:
        """Get the default/recommended Kubernetes version slug."""
        versions = await self.get_kubernetes_versions(token)
        if versions:
            return versions[0].slug  # First is default/recommended
        return None
    
    async def get_kubernetes_version_for_prefix(
        self, 
        prefix: str, 
        token: Optional[str] = None
    ) -> Optional[str]:
        """
        Get the latest Kubernetes version matching a prefix.
        e.g., prefix="1.31" returns "1.31.1-do.5" (latest in 1.31 series)
        """
        versions = await self.get_kubernetes_versions(token)
        for v in versions:
            if v.kubernetes_version.startswith(prefix) or v.slug.startswith(prefix):
                return v.slug
        # Fall back to default if no match
        return versions[0].slug if versions else None
    
    async def get_kubernetes_versions_summary(self, token: Optional[str] = None) -> str:
        """Get a summary string of available versions for AI prompts."""
        versions = await self.get_kubernetes_versions(token)
        if not versions:
            return "Unable to fetch Kubernetes versions"
        
        slugs = [v.slug for v in versions[:5]]  # Top 5 versions
        return f"Valid DigitalOcean Kubernetes versions: {', '.join(slugs)}"
    
    # =========================================================================
    # Database Versions
    # =========================================================================
    
    async def get_database_options(self, token: Optional[str] = None) -> Dict[str, List[str]]:
        """
        Get available database engine versions.
        Returns dict like: {"pg": ["16", "15", "14"], "mysql": ["8"], ...}
        """
        cache_key = "database_options"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        
        data = await self._fetch_api("databases/options", token)
        if not data:
            return {}
        
        options = data.get("options", {})
        result = {}
        
        # Parse version layouts for each engine
        for engine_data in options.get("mongodb", {}).get("versions", []):
            result.setdefault("mongodb", []).append(engine_data)
        for engine_data in options.get("mysql", {}).get("versions", []):
            result.setdefault("mysql", []).append(engine_data)
        for engine_data in options.get("pg", {}).get("versions", []):
            result.setdefault("pg", []).append(engine_data)
        for engine_data in options.get("redis", {}).get("versions", []):
            result.setdefault("redis", []).append(engine_data)
        for engine_data in options.get("kafka", {}).get("versions", []):
            result.setdefault("kafka", []).append(engine_data)
        for engine_data in options.get("opensearch", {}).get("versions", []):
            result.setdefault("opensearch", []).append(engine_data)
        
        self._cache_set(cache_key, result)
        print(f"[DO Versions] Cached database options: {list(result.keys())}")
        return result
    
    async def get_default_database_version(
        self, 
        engine: str, 
        token: Optional[str] = None
    ) -> Optional[str]:
        """
        Get the default/latest version for a database engine.
        engine: "pg", "mysql", "redis", "mongodb", "kafka", "opensearch"
        """
        options = await self.get_database_options(token)
        versions = options.get(engine, [])
        if versions:
            return str(versions[0])  # First is typically latest
        return None
    
    async def get_database_versions_summary(self, token: Optional[str] = None) -> str:
        """Get a summary of database versions for AI prompts."""
        options = await self.get_database_options(token)
        if not options:
            return "Unable to fetch database versions"
        
        parts = []
        for engine, versions in options.items():
            if versions:
                parts.append(f"{engine}: {', '.join(str(v) for v in versions[:3])}")
        
        return "Valid DigitalOcean database versions - " + "; ".join(parts)
    
    # =========================================================================
    # Droplet Sizes
    # =========================================================================
    
    async def get_droplet_sizes(self, token: Optional[str] = None) -> List[DropletSize]:
        """Get available droplet sizes."""
        cache_key = "droplet_sizes"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        
        data = await self._fetch_api("sizes", token)
        if not data:
            return []
        
        sizes = []
        for s in data.get("sizes", []):
            if s.get("available", False):
                sizes.append(DropletSize(
                    slug=s.get("slug", ""),
                    memory=s.get("memory", 0),
                    vcpus=s.get("vcpus", 0),
                    disk=s.get("disk", 0),
                    price_monthly=s.get("price_monthly", 0)
                ))
        
        self._cache_set(cache_key, sizes)
        print(f"[DO Versions] Cached {len(sizes)} droplet sizes")
        return sizes
    
    async def get_common_droplet_sizes(self, token: Optional[str] = None) -> List[str]:
        """Get commonly used droplet size slugs for AI prompts."""
        sizes = await self.get_droplet_sizes(token)
        # Filter to common/useful sizes
        common_slugs = []
        for s in sizes:
            # Include standard sizes that are commonly used
            if s.slug.startswith(('s-', 'g-', 'gd-', 'c-', 'm-')) and s.vcpus <= 8:
                common_slugs.append(s.slug)
        return common_slugs[:15]  # Return top 15
    
    # =========================================================================
    # Regions
    # =========================================================================
    
    async def get_regions(self, token: Optional[str] = None) -> List[Region]:
        """Get available DigitalOcean regions."""
        cache_key = "regions"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        
        data = await self._fetch_api("regions", token)
        if not data:
            return []
        
        regions = []
        for r in data.get("regions", []):
            regions.append(Region(
                slug=r.get("slug", ""),
                name=r.get("name", ""),
                available=r.get("available", False)
            ))
        
        self._cache_set(cache_key, regions)
        print(f"[DO Versions] Cached {len(regions)} regions")
        return regions
    
    async def get_available_region_slugs(self, token: Optional[str] = None) -> List[str]:
        """Get list of available region slugs."""
        regions = await self.get_regions(token)
        return [r.slug for r in regions if r.available]
    
    # =========================================================================
    # Container Registry
    # =========================================================================
    
    async def get_registry_subscription_tiers(self) -> List[str]:
        """
        Get available container registry subscription tiers.
        Note: These are fixed tiers, not queried from API.
        """
        return ["starter", "basic", "professional"]
    
    # =========================================================================
    # Comprehensive Summary for Auto-Heal
    # =========================================================================
    
    async def get_all_versions_summary(self, token: Optional[str] = None) -> str:
        """
        Get a comprehensive summary of all available versions.
        Useful for including in auto-heal AI prompts.
        """
        parts = []
        
        # Kubernetes
        k8s_versions = await self.get_kubernetes_versions(token)
        if k8s_versions:
            k8s_slugs = [v.slug for v in k8s_versions[:5]]
            parts.append(f"**Kubernetes versions**: {', '.join(k8s_slugs)}")
        
        # Databases
        db_options = await self.get_database_options(token)
        if db_options:
            db_parts = []
            for engine, versions in db_options.items():
                if versions:
                    db_parts.append(f"{engine}=[{', '.join(str(v) for v in versions[:3])}]")
            if db_parts:
                parts.append(f"**Database versions**: {'; '.join(db_parts)}")
        
        # Droplet sizes
        sizes = await self.get_common_droplet_sizes(token)
        if sizes:
            parts.append(f"**Droplet sizes**: {', '.join(sizes[:10])}")
        
        # Regions
        regions = await self.get_available_region_slugs(token)
        if regions:
            parts.append(f"**Regions**: {', '.join(regions)}")
        
        # Registry tiers
        parts.append(f"**Container registry tiers**: starter, basic, professional")
        
        return "\n".join(parts) if parts else "Unable to fetch DigitalOcean options"
    
    async def get_fix_hint_for_error(
        self, 
        error_message: str, 
        token: Optional[str] = None
    ) -> Optional[str]:
        """
        Analyze an error message and return a helpful hint with valid options.
        Returns None if the error isn't version-related.
        """
        error_lower = error_message.lower()
        
        # Invalid Kubernetes version
        if "invalid version slug" in error_lower and "kubernetes" in error_lower:
            versions = await self.get_kubernetes_versions(token)
            if versions:
                slugs = [v.slug for v in versions[:5]]
                return f"VALID KUBERNETES VERSIONS: {', '.join(slugs)}. Use one of these exact slugs for the 'version' attribute."
        
        # Invalid database version
        if "invalid version" in error_lower and any(db in error_lower for db in ["database", "postgres", "mysql", "redis", "mongodb"]):
            options = await self.get_database_options(token)
            return f"VALID DATABASE VERSIONS: {options}"
        
        # Invalid droplet size
        if "invalid size" in error_lower or "size slug" in error_lower:
            sizes = await self.get_common_droplet_sizes(token)
            if sizes:
                return f"VALID DROPLET SIZES: {', '.join(sizes[:10])}"
        
        # Invalid region
        if "invalid region" in error_lower or "region slug" in error_lower:
            regions = await self.get_available_region_slugs(token)
            if regions:
                return f"VALID REGIONS: {', '.join(regions)}"
        
        return None


# Singleton instance
_service_instance: Optional[DigitalOceanVersionService] = None


def get_digitalocean_version_service() -> DigitalOceanVersionService:
    """Get the singleton instance of the version service."""
    global _service_instance
    if _service_instance is None:
        _service_instance = DigitalOceanVersionService()
    return _service_instance


# Convenience functions for common operations
async def get_valid_k8s_version(token: Optional[str] = None) -> Optional[str]:
    """Quick helper to get a valid Kubernetes version."""
    service = get_digitalocean_version_service()
    return await service.get_default_kubernetes_version(token)


async def get_valid_db_version(engine: str, token: Optional[str] = None) -> Optional[str]:
    """Quick helper to get a valid database version."""
    service = get_digitalocean_version_service()
    return await service.get_default_database_version(engine, token)


async def get_version_hints_for_autoheal(
    error_message: str, 
    token: Optional[str] = None
) -> Optional[str]:
    """Quick helper to get version hints for auto-heal."""
    service = get_digitalocean_version_service()
    return await service.get_fix_hint_for_error(error_message, token)
