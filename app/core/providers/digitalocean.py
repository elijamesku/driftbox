from typing import Dict, List, Optional, Any
from app.core.providers.base import InfrastructureProvider


class DigitalOceanProvider(InfrastructureProvider):
    """DigitalOcean cloud provider integration implementation"""
    
    # Monthly cost estimation data (USD) - DigitalOcean pricing
    # https://www.digitalocean.com/pricing
    MONTHLY_PRICING_DATA = {
        "digitalocean_droplet": {
            # Basic droplets
            "s-1vcpu-512mb-10gb": 4.00,
            "s-1vcpu-1gb": 6.00,
            "s-1vcpu-1gb-amd": 7.00,
            "s-1vcpu-1gb-intel": 7.00,
            "s-1vcpu-2gb": 12.00,
            "s-1vcpu-2gb-amd": 14.00,
            "s-1vcpu-2gb-intel": 14.00,
            "s-2vcpu-2gb": 18.00,
            "s-2vcpu-2gb-amd": 21.00,
            "s-2vcpu-2gb-intel": 21.00,
            "s-2vcpu-4gb": 24.00,
            "s-2vcpu-4gb-amd": 28.00,
            "s-2vcpu-4gb-intel": 28.00,
            "s-4vcpu-8gb": 48.00,
            "s-4vcpu-8gb-amd": 56.00,
            "s-4vcpu-8gb-intel": 56.00,
            "s-8vcpu-16gb": 96.00,
            # General purpose
            "g-2vcpu-8gb": 63.00,
            "g-4vcpu-16gb": 126.00,
            "g-8vcpu-32gb": 252.00,
            "g-16vcpu-64gb": 504.00,
            # CPU-optimized
            "c-2": 42.00,
            "c-4": 84.00,
            "c-8": 168.00,
            "c-16": 336.00,
            # Memory-optimized
            "m-2vcpu-16gb": 84.00,
            "m-4vcpu-32gb": 168.00,
            "m-8vcpu-64gb": 336.00,
        },
        "digitalocean_database_cluster": {
            # PostgreSQL, MySQL, Redis pricing
            "db-s-1vcpu-1gb": 15.00,
            "db-s-1vcpu-2gb": 30.00,
            "db-s-2vcpu-4gb": 60.00,
            "db-s-4vcpu-8gb": 120.00,
            "db-s-6vcpu-16gb": 240.00,
            "db-s-8vcpu-32gb": 480.00,
            "db-s-16vcpu-64gb": 960.00,
        },
        "digitalocean_kubernetes_cluster": {
            # DOKS - base cost is $0, you pay for nodes (droplets)
            "base": 0.00,
            # Node pool costs based on droplet sizes
        },
        "digitalocean_spaces_bucket": {
            # $5/month includes 250GB storage + 1TB transfer
            "base": 5.00,
            "storage_per_gb_over_250": 0.02,
            "transfer_per_gb_over_1tb": 0.01,
        },
        "digitalocean_loadbalancer": {
            # $12/month for small, $60 for large
            "small": 12.00,
            "large": 60.00,
        },
        "digitalocean_vpc": {
            "base": 0.00,  # VPCs are free
        },
        "digitalocean_firewall": {
            "base": 0.00,  # Firewalls are free
        },
        "digitalocean_domain": {
            "base": 0.00,  # DNS is free
        },
        "digitalocean_volume": {
            # Block storage: $0.10/GB/month
            "per_gb": 0.10,
        },
        "digitalocean_floating_ip": {
            # Free when assigned to a droplet, $5/month when unassigned
            "assigned": 0.00,
            "unassigned": 5.00,
        },
        "digitalocean_app": {
            # App Platform pricing
            "basic": 5.00,
            "professional": 12.00,
        },
        "digitalocean_cdn": {
            # CDN is included with Spaces
            "base": 0.00,
        },
        "digitalocean_container_registry": {
            # Starter: Free (500MB), Basic: $5 (5GB), Professional: $20 (unlimited)
            "starter": 0.00,
            "basic": 5.00,
            "professional": 20.00,
        },
    }
    
    AVAILABLE_RESOURCE_TYPES = [
        "digitalocean_droplet",
        "digitalocean_database_cluster",
        "digitalocean_kubernetes_cluster",
        "digitalocean_spaces_bucket",
        "digitalocean_loadbalancer",
        "digitalocean_vpc",
        "digitalocean_firewall",
        "digitalocean_domain",
        "digitalocean_record",
        "digitalocean_volume",
        "digitalocean_floating_ip",
        "digitalocean_app",
        "digitalocean_cdn",
        "digitalocean_container_registry",
        "digitalocean_project",
        "digitalocean_ssh_key",
        "digitalocean_tag",
    ]
    
    # Security rules for DigitalOcean
    SECURITY_RULES = [
        {
            "id": "DO001",
            "name": "Droplet without VPC",
            "description": "Droplet is not placed in a VPC, exposing it to the public internet",
            "severity": "MEDIUM",
            "resource_type": "digitalocean_droplet",
            "check": lambda config: "vpc_uuid" not in config,
        },
        {
            "id": "DO002", 
            "name": "Firewall allows all inbound",
            "description": "Firewall rule allows traffic from 0.0.0.0/0 on sensitive ports",
            "severity": "HIGH",
            "resource_type": "digitalocean_firewall",
            "check": lambda config: any(
                rule.get("source_addresses", []) == ["0.0.0.0/0", "::/0"] 
                and rule.get("port_range") in ["22", "3389", "3306", "5432"]
                for rule in config.get("inbound_rule", [])
            ),
        },
        {
            "id": "DO003",
            "name": "Spaces bucket is public",
            "description": "Spaces bucket has public access enabled",
            "severity": "HIGH",
            "resource_type": "digitalocean_spaces_bucket",
            "check": lambda config: config.get("acl") == "public-read",
        },
        {
            "id": "DO004",
            "name": "Database cluster publicly accessible",
            "description": "Database cluster is accessible from the public internet",
            "severity": "CRITICAL",
            "resource_type": "digitalocean_database_cluster",
            "check": lambda config: not config.get("private_network_uuid"),
        },
        {
            "id": "DO005",
            "name": "Droplet without backups",
            "description": "Droplet does not have automatic backups enabled",
            "severity": "LOW",
            "resource_type": "digitalocean_droplet",
            "check": lambda config: not config.get("backups"),
        },
        {
            "id": "DO006",
            "name": "Droplet without monitoring",
            "description": "Droplet does not have monitoring enabled",
            "severity": "LOW",
            "resource_type": "digitalocean_droplet",
            "check": lambda config: not config.get("monitoring"),
        },
        {
            "id": "DO007",
            "name": "Load balancer without HTTPS",
            "description": "Load balancer forwarding rule does not use HTTPS",
            "severity": "MEDIUM",
            "resource_type": "digitalocean_loadbalancer",
            "check": lambda config: any(
                rule.get("entry_protocol") == "http" and rule.get("entry_port") == 443
                for rule in config.get("forwarding_rule", [])
            ),
        },
        {
            "id": "DO008",
            "name": "Kubernetes cluster without auto-upgrade",
            "description": "Kubernetes cluster does not have auto-upgrade enabled",
            "severity": "MEDIUM",
            "resource_type": "digitalocean_kubernetes_cluster",
            "check": lambda config: not config.get("auto_upgrade"),
        },
        {
            "id": "DO009",
            "name": "Kubernetes cluster without surge upgrade",
            "description": "Kubernetes cluster does not have surge upgrade enabled for zero-downtime updates",
            "severity": "LOW",
            "resource_type": "digitalocean_kubernetes_cluster",
            "check": lambda config: not config.get("surge_upgrade"),
        },
        {
            "id": "DO010",
            "name": "Database without maintenance window",
            "description": "Database cluster does not have a maintenance window configured",
            "severity": "LOW",
            "resource_type": "digitalocean_database_cluster",
            "check": lambda config: not config.get("maintenance_window"),
        },
    ]
    
    def retrieve_provider_identifier(self) -> str:
        return "digitalocean"
    
    def verify_resource_configuration(self, resource_type: str, configuration: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """Validate DigitalOcean resource configuration"""
        
        if resource_type == "digitalocean_droplet":
            if "name" not in configuration:
                return False, "Droplet requires a name"
            if "size" not in configuration:
                return False, "Droplet requires a size (e.g., s-1vcpu-1gb)"
            if "image" not in configuration:
                return False, "Droplet requires an image (e.g., ubuntu-22-04-x64)"
            if "region" not in configuration:
                return False, "Droplet requires a region (e.g., nyc1)"
        
        elif resource_type == "digitalocean_database_cluster":
            if "name" not in configuration:
                return False, "Database cluster requires a name"
            if "engine" not in configuration:
                return False, "Database cluster requires an engine (pg, mysql, redis, mongodb)"
            if "size" not in configuration:
                return False, "Database cluster requires a size (e.g., db-s-1vcpu-1gb)"
            if "region" not in configuration:
                return False, "Database cluster requires a region"
            if "node_count" not in configuration:
                return False, "Database cluster requires node_count"
        
        elif resource_type == "digitalocean_kubernetes_cluster":
            if "name" not in configuration:
                return False, "Kubernetes cluster requires a name"
            if "region" not in configuration:
                return False, "Kubernetes cluster requires a region"
            if "version" not in configuration:
                return False, "Kubernetes cluster requires a version"
            if "node_pool" not in configuration:
                return False, "Kubernetes cluster requires at least one node_pool"
        
        elif resource_type == "digitalocean_spaces_bucket":
            if "name" not in configuration:
                return False, "Spaces bucket requires a name"
            if "region" not in configuration:
                return False, "Spaces bucket requires a region (nyc3, ams3, sgp1, sfo3)"
        
        elif resource_type == "digitalocean_loadbalancer":
            if "name" not in configuration:
                return False, "Load balancer requires a name"
            if "region" not in configuration:
                return False, "Load balancer requires a region"
            if "forwarding_rule" not in configuration:
                return False, "Load balancer requires at least one forwarding_rule"
        
        return True, None
    
    def list_supported_resource_types(self) -> List[str]:
        return self.AVAILABLE_RESOURCE_TYPES
    
    def calculate_monthly_cost(self, resource_type: str, configuration: Dict[str, Any]) -> Optional[float]:
        """
        Calculate estimated monthly cost for DigitalOcean resources.
        Returns cost in USD or None when estimation unavailable.
        """
        if resource_type not in self.MONTHLY_PRICING_DATA:
            return None
        
        pricing_info = self.MONTHLY_PRICING_DATA[resource_type]
        
        # Droplet cost based on size
        if resource_type == "digitalocean_droplet":
            size = configuration.get("size", "s-1vcpu-1gb")
            base_cost = pricing_info.get(size, 6.00)  # Default to $6 basic droplet
            
            # Add backup cost (+20% of droplet cost)
            if configuration.get("backups"):
                base_cost *= 1.20
            
            return base_cost
        
        # Database cluster cost
        elif resource_type == "digitalocean_database_cluster":
            size = configuration.get("size", "db-s-1vcpu-1gb")
            node_count = configuration.get("node_count", 1)
            base_cost = pricing_info.get(size, 15.00)
            return base_cost * node_count
        
        # Kubernetes cluster - cost is based on node pools
        elif resource_type == "digitalocean_kubernetes_cluster":
            total_cost = 0
            node_pools = configuration.get("node_pool", [])
            if isinstance(node_pools, dict):
                node_pools = [node_pools]
            
            for pool in node_pools:
                size = pool.get("size", "s-2vcpu-4gb")
                node_count = pool.get("node_count", 1)
                droplet_cost = self.MONTHLY_PRICING_DATA["digitalocean_droplet"].get(size, 24.00)
                total_cost += droplet_cost * node_count
            
            return total_cost
        
        # Spaces bucket
        elif resource_type == "digitalocean_spaces_bucket":
            return pricing_info["base"]  # $5/month base
        
        # Load balancer
        elif resource_type == "digitalocean_loadbalancer":
            size = configuration.get("size", "small")
            return pricing_info.get(size, 12.00)
        
        # Block storage volume
        elif resource_type == "digitalocean_volume":
            size_gb = configuration.get("size", 10)
            return pricing_info["per_gb"] * size_gb
        
        # Free resources
        elif resource_type in ["digitalocean_vpc", "digitalocean_firewall", "digitalocean_domain", "digitalocean_cdn"]:
            return 0.0
        
        # Floating IP
        elif resource_type == "digitalocean_floating_ip":
            # Assume assigned to droplet (free)
            return pricing_info["assigned"]
        
        # App Platform
        elif resource_type == "digitalocean_app":
            return pricing_info["professional"]  # Default to professional tier
        
        # Container Registry
        elif resource_type == "digitalocean_container_registry":
            tier = configuration.get("subscription_tier_slug", "starter")
            return pricing_info.get(tier, 0.00)
        
        return None
    
    def get_documentation_url(self, resource_type: str) -> Optional[str]:
        """Retrieve Terraform DigitalOcean provider documentation URL for resource type"""
        if not resource_type.startswith("digitalocean_"):
            return None
        
        resource_identifier = resource_type.replace("digitalocean_", "")
        return f"https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/{resource_identifier}"
    
    def get_security_rules(self) -> List[Dict[str, Any]]:
        """Get security rules for DigitalOcean resources"""
        return self.SECURITY_RULES
    
    def check_security(self, resource_type: str, configuration: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Check security rules for a resource"""
        findings = []
        
        for rule in self.SECURITY_RULES:
            if rule["resource_type"] == resource_type:
                try:
                    if rule["check"](configuration):
                        findings.append({
                            "rule_id": rule["id"],
                            "name": rule["name"],
                            "description": rule["description"],
                            "severity": rule["severity"],
                            "resource_type": resource_type,
                        })
                except Exception:
                    pass  # Skip rules that fail to evaluate
        
        return findings


# Singleton provider instance
digitalocean_provider_instance = DigitalOceanProvider()

