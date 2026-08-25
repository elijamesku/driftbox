"""
Cost Estimator Service
Estimates infrastructure costs from Terraform code using Infracost
NO AWS credentials needed - pure code analysis
"""

from typing import Dict, List, Any, Optional
import subprocess
import json
import os
import tempfile
import shutil


class CostOptimization:
    """Represents a cost optimization opportunity"""
    
    def __init__(
        self,
        resource_type: str,
        resource_name: str,
        current_cost: float,
        optimized_cost: float,
        monthly_savings: float,
        recommendation: str,
        details: str,
        file: str = "",
        line: int = 0
    ):
        self.resource_type = resource_type
        self.resource_name = resource_name
        self.current_cost = current_cost
        self.optimized_cost = optimized_cost
        self.monthly_savings = monthly_savings
        self.recommendation = recommendation
        self.details = details
        self.file = file
        self.line = line
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "resource_type": self.resource_type,
            "resource_name": self.resource_name,
            "current_cost": round(self.current_cost, 2),
            "optimized_cost": round(self.optimized_cost, 2),
            "monthly_savings": round(self.monthly_savings, 2),
            "recommendation": self.recommendation,
            "details": self.details,
            "file": self.file,
            "line": self.line,
        }


class CostEstimator:
    """Estimates infrastructure costs from Terraform code"""
    
    # Simple pricing database (monthly costs in USD)
    # This is a fallback if Infracost is not available
    SIMPLE_PRICING = {
        # ===== AWS PRICING =====
        "aws_instance": {
            "t2.micro": 8.47,
            "t2.small": 16.79,
            "t2.medium": 33.58,
            "t2.large": 67.16,
            "t2.xlarge": 134.32,
            "t2.2xlarge": 268.64,
            "t3.micro": 7.59,
            "t3.small": 15.18,
            "t3.medium": 30.37,
            "t3.large": 60.74,
            "t3.xlarge": 121.47,
            "t3.2xlarge": 242.94,
            "m5.large": 70.08,
            "m5.xlarge": 140.16,
            "m5.2xlarge": 280.32,
            "m5.4xlarge": 560.64,
            "c5.large": 62.05,
            "c5.xlarge": 124.10,
            "c5.2xlarge": 248.21,
            "r5.large": 91.98,
            "r5.xlarge": 183.96,
        },
        "aws_db_instance": {
            "db.t3.micro": 11.52,
            "db.t3.small": 23.04,
            "db.t3.medium": 46.08,
            "db.t3.large": 92.16,
            "db.t3.xlarge": 184.32,
            "db.t3.2xlarge": 368.64,
            "db.m5.large": 131.40,
            "db.m5.xlarge": 262.80,
            "db.r5.large": 172.80,
            "db.r5.xlarge": 345.60,
        },
        "aws_s3_bucket": {
            "storage_per_gb": 0.023,
        },
        "aws_ebs_volume": {
            "gp3_per_gb": 0.08,
            "gp2_per_gb": 0.10,
            "io2_per_gb": 0.125,
        },
        "aws_nat_gateway": 32.85,
        "aws_lb": 16.43,
        "aws_lambda_function": {
            "base": 0.20,  # per 1M requests
            "compute_per_gb_second": 0.0000166667,
        },
        "aws_dynamodb_table": {
            "on_demand_base": 1.25,  # per million requests
        },
        
        # ===== DIGITALOCEAN PRICING =====
        "digitalocean_droplet": {
            "s-1vcpu-512mb-10gb": 4.00,
            "s-1vcpu-1gb": 6.00,
            "s-1vcpu-2gb": 12.00,
            "s-2vcpu-2gb": 18.00,
            "s-2vcpu-4gb": 24.00,
            "s-4vcpu-8gb": 48.00,
            "s-8vcpu-16gb": 96.00,
            "g-2vcpu-8gb": 63.00,
            "g-4vcpu-16gb": 126.00,
            "c-2": 42.00,
            "c-4": 84.00,
            "m-2vcpu-16gb": 84.00,
        },
        "digitalocean_database_cluster": {
            "db-s-1vcpu-1gb": 15.00,
            "db-s-1vcpu-2gb": 30.00,
            "db-s-2vcpu-4gb": 60.00,
            "db-s-4vcpu-8gb": 120.00,
            "db-s-6vcpu-16gb": 240.00,
        },
        "digitalocean_spaces_bucket": {
            "base": 5.00,
            "storage_per_gb": 0.02,
        },
        "digitalocean_loadbalancer": {
            "small": 12.00,
            "large": 60.00,
        },
        "digitalocean_volume": {
            "per_gb": 0.10,
        },
        "digitalocean_kubernetes_cluster": {
            "base": 0.00,  # Pay for nodes only
        },
        "digitalocean_vpc": 0.00,
        "digitalocean_firewall": 0.00,
        "digitalocean_domain": 0.00,
        "digitalocean_floating_ip": 5.00,  # When unassigned
        "digitalocean_app": {
            "basic": 5.00,
            "professional": 12.00,
        },
    }
    
    def __init__(self):
        self.infracost_available = self._check_infracost()
    
    def _check_infracost(self) -> bool:
        """Check if Infracost is installed"""
        try:
            result = subprocess.run(
                ["infracost", "--version"],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False
    
    def estimate_costs(self, repo_path: str, resources: List[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Estimate infrastructure costs
        
        Args:
            repo_path: Path to repository with Terraform files
            resources: Optional list of resources from catalog (for simple estimation)
        
        Returns:
            Dictionary with cost estimates and optimizations
        """
        if self.infracost_available:
            try:
                return self._estimate_with_infracost(repo_path)
            except Exception as e:
                print(f"⚠️ [CostEstimator] Infracost failed: {e}, falling back to simple estimation")
        
        # Fallback to simple estimation
        if resources:
            return self._estimate_simple(resources)
        else:
            return {
                "ok": False,
                "error": "infracost_not_available",
                "message": "Infracost is not installed. Install with: brew install infracost",
                "total_monthly_cost": 0,
                "resources": [],
                "optimizations": []
            }
    
    def _estimate_with_infracost(self, repo_path: str) -> Dict[str, Any]:
        """Estimate costs using Infracost"""
        try:
            # Run infracost breakdown
            result = subprocess.run(
                ["infracost", "breakdown", "--path", repo_path, "--format", "json"],
                capture_output=True,
                text=True,
                timeout=60,
                cwd=repo_path
            )
            
            if result.returncode != 0:
                raise Exception(f"Infracost failed: {result.stderr}")
            
            data = json.loads(result.stdout)
            
            # Parse Infracost output
            total_cost = float(data.get("totalMonthlyCost", "0") or "0")
            
            resources = []
            projects = data.get("projects", [])
            for project in projects:
                breakdown = project.get("breakdown", {})
                for resource in breakdown.get("resources", []):
                    cost_components = resource.get("costComponents", [])
                    monthly_cost = sum(
                        float(comp.get("monthlyCost", "0") or "0")
                        for comp in cost_components
                    )
                    
                    resources.append({
                        "name": resource.get("name", ""),
                        "type": resource.get("resourceType", ""),
                        "monthly_cost": round(monthly_cost, 2),
                        "cost_components": [
                            {
                                "name": comp.get("name", ""),
                                "unit": comp.get("unit", ""),
                                "monthly_quantity": comp.get("monthlyQuantity"),
                                "monthly_cost": round(float(comp.get("monthlyCost", "0") or "0"), 2)
                            }
                            for comp in cost_components
                        ]
                    })
            
            # Find optimization opportunities
            optimizations = self._find_optimizations(resources)
            
            return {
                "ok": True,
                "method": "infracost",
                "total_monthly_cost": round(total_cost, 2),
                "total_annual_cost": round(total_cost * 12, 2),
                "currency": "USD",
                "resources": sorted(resources, key=lambda x: x["monthly_cost"], reverse=True),
                "optimizations": [opt.to_dict() for opt in optimizations],
                "total_potential_savings": round(sum(opt.monthly_savings for opt in optimizations), 2)
            }
        
        except Exception as e:
            raise Exception(f"Infracost estimation failed: {str(e)}")
    
    def _estimate_simple(self, resources: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Simple cost estimation using static pricing database"""
        total_cost = 0
        cost_breakdown = []
        
        for resource in resources:
            resource_type = resource.get("type", "")
            attrs = resource.get("attrs", {})
            name = resource.get("name", "")
            
            cost = 0
            details = []
            
            # EC2 Instances
            if resource_type == "aws_instance":
                instance_type = attrs.get("instance_type", "")
                cost = self.SIMPLE_PRICING.get("aws_instance", {}).get(instance_type, 0)
                details.append(f"Instance type: {instance_type}")
            
            # RDS Instances
            elif resource_type == "aws_db_instance":
                instance_class = attrs.get("instance_class", "")
                storage_gb = attrs.get("allocated_storage", 0)
                cost = self.SIMPLE_PRICING.get("aws_db_instance", {}).get(instance_class, 0)
                cost += storage_gb * 0.115  # GP2 storage
                details.append(f"Instance class: {instance_class}")
                details.append(f"Storage: {storage_gb} GB")
            
            # S3 Buckets (estimated at 100 GB)
            elif resource_type == "aws_s3_bucket":
                estimated_gb = 100
                cost = estimated_gb * self.SIMPLE_PRICING["aws_s3_bucket"]["storage_per_gb"]
                details.append(f"Estimated storage: {estimated_gb} GB")
            
            # EBS Volumes
            elif resource_type == "aws_ebs_volume":
                size_gb = attrs.get("size", 0)
                volume_type = attrs.get("type", "gp3")
                price_key = f"{volume_type}_per_gb"
                cost = size_gb * self.SIMPLE_PRICING.get("aws_ebs_volume", {}).get(price_key, 0.08)
                details.append(f"Size: {size_gb} GB")
                details.append(f"Type: {volume_type}")
            
            # NAT Gateway
            elif resource_type == "aws_nat_gateway":
                cost = self.SIMPLE_PRICING["aws_nat_gateway"]
            
            # Load Balancer
            elif resource_type in ["aws_lb", "aws_alb", "aws_elb"]:
                cost = self.SIMPLE_PRICING["aws_lb"]
            
            # Lambda (base cost, actual cost depends on usage)
            elif resource_type == "aws_lambda_function":
                cost = self.SIMPLE_PRICING["aws_lambda_function"]["base"]
                details.append("Base cost (usage-dependent)")
            
            # DynamoDB (base cost, actual cost depends on usage)
            elif resource_type == "aws_dynamodb_table":
                cost = self.SIMPLE_PRICING["aws_dynamodb_table"]["on_demand_base"]
                details.append("Base cost (usage-dependent)")
            
            if cost > 0:
                cost_breakdown.append({
                    "name": name,
                    "type": resource_type,
                    "monthly_cost": round(cost, 2),
                    "details": details
                })
                total_cost += cost
        
        # Find optimization opportunities (simple version)
        optimizations = []
        for item in cost_breakdown:
            if item["type"] == "aws_instance":
                # Check for oversized instances
                name = item["name"]
                resource = next((r for r in resources if r.get("name") == name), None)
                if resource:
                    instance_type = resource.get("attrs", {}).get("instance_type", "")
                    if instance_type.endswith(".2xlarge"):
                        current_cost = item["monthly_cost"]
                        optimized_type = instance_type.replace(".2xlarge", ".xlarge")
                        optimized_cost = current_cost / 2
                        optimizations.append(CostOptimization(
                            resource_type="aws_instance",
                            resource_name=name,
                            current_cost=current_cost,
                            optimized_cost=optimized_cost,
                            monthly_savings=current_cost - optimized_cost,
                            recommendation=f"Consider using {optimized_type} instead of {instance_type}",
                            details="Downsize instance type if workload allows",
                            file=resource.get("file", ""),
                            line=resource.get("line", 0)
                        ))
        
        return {
            "ok": True,
            "method": "simple_estimation",
            "warning": "Costs are estimates based on static pricing. Install Infracost for accurate estimates.",
            "total_monthly_cost": round(total_cost, 2),
            "total_annual_cost": round(total_cost * 12, 2),
            "currency": "USD",
            "resources": sorted(cost_breakdown, key=lambda x: x["monthly_cost"], reverse=True),
            "optimizations": [opt.to_dict() for opt in optimizations],
            "total_potential_savings": round(sum(opt.monthly_savings for opt in optimizations), 2)
        }
    
    def _find_optimizations(self, resources: List[Dict[str, Any]]) -> List[CostOptimization]:
        """Find cost optimization opportunities"""
        optimizations = []
        
        for resource in resources:
            resource_type = resource.get("type", "")
            resource_name = resource.get("name", "")
            monthly_cost = resource.get("monthly_cost", 0)
            
            # EC2 instance optimizations
            if resource_type == "aws_instance" and monthly_cost > 100:
                # Suggest Reserved Instances
                ri_savings = monthly_cost * 0.30  # ~30% savings with 1-year RI
                optimizations.append(CostOptimization(
                    resource_type=resource_type,
                    resource_name=resource_name,
                    current_cost=monthly_cost,
                    optimized_cost=monthly_cost - ri_savings,
                    monthly_savings=ri_savings,
                    recommendation="Consider using Reserved Instances (1-year commitment)",
                    details=f"Save ~30% with Reserved Instances for stable workloads"
                ))
            
            # RDS optimizations
            if resource_type == "aws_db_instance":
                # Check if it's running 24/7 for dev/staging
                if "dev" in resource_name.lower() or "staging" in resource_name.lower():
                    # Suggest Aurora Serverless or scheduled shutdowns
                    savings = monthly_cost * 0.60  # ~60% if only running business hours
                    optimizations.append(CostOptimization(
                        resource_type=resource_type,
                        resource_name=resource_name,
                        current_cost=monthly_cost,
                        optimized_cost=monthly_cost - savings,
                        monthly_savings=savings,
                        recommendation="Use Aurora Serverless or schedule start/stop for dev/staging",
                        details="Non-production databases don't need to run 24/7"
                    ))
            
            # NAT Gateway optimizations
            if resource_type == "aws_nat_gateway" and monthly_cost > 30:
                savings = monthly_cost * 0.90  # NAT instance much cheaper
                optimizations.append(CostOptimization(
                    resource_type=resource_type,
                    resource_name=resource_name,
                    current_cost=monthly_cost,
                    optimized_cost=monthly_cost - savings,
                    monthly_savings=savings,
                    recommendation="Consider using NAT instance instead of NAT Gateway for non-production",
                    details="NAT instances are ~90% cheaper but require more management"
                ))
        
        return optimizations


# Global instance
cost_estimator = CostEstimator()

