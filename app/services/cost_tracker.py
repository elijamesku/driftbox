"""
Infrastructure cost tracking and budget management service.
Estimates resource costs, tracks budgets, and triggers alerts when thresholds exceeded.
"""
import json
from typing import Dict, List, Optional, Any
from pathlib import Path
from datetime import datetime
from app.core.providers.aws import aws_provider_instance
from app.config import BUDGET_ALERT_PERCENTAGE


class InfrastructureCostMonitor:
    """Monitors infrastructure costs and manages budget alert thresholds"""
    
    def __init__(self, cost_cache_directory: str = ".infrara_costs"):
        self.cost_storage_path = Path(cost_cache_directory)
        self.cost_storage_path.mkdir(exist_ok=True)
        self.budget_alert_threshold = BUDGET_ALERT_PERCENTAGE
    
    def calculate_resource_monthly_cost(self, resource_type: str, resource_config: Dict[str, Any]) -> Optional[float]:
        """
        Calculate estimated monthly cost for a single infrastructure resource.
        Returns monthly cost in USD or None if estimation unavailable.
        """
        # Currently supporting AWS resources
        if resource_type.startswith("aws_"):
            return aws_provider_instance.calculate_monthly_cost(resource_type, resource_config)
        
        # TODO: Add GCP and Azure provider support
        return None
    
    def compute_catalog_total_cost(self, infrastructure_catalog: Dict[str, Any]) -> Dict[str, Any]:
        """
        Estimate total cost for all resources in a catalog.
        Returns summary with per-resource breakdown.
        """
        catalog_resources = infrastructure_catalog.get("resources", [])
        aggregated_cost = 0.0
        cost_breakdown = []
        unestimated_resource_count = 0
        
        for resource_entry in catalog_resources:
            resource_type = resource_entry.get("type")
            resource_name = resource_entry.get("name")
            resource_configuration = resource_entry.get("config", {})
            
            resource_monthly_cost = self.calculate_resource_monthly_cost(resource_type, resource_configuration)
            
            if resource_monthly_cost is not None:
                aggregated_cost += resource_monthly_cost
                cost_breakdown.append({
                    "resource": f"{resource_type}.{resource_name}",
                    "type": resource_type,
                    "name": resource_name,
                    "estimated_monthly_cost": round(resource_monthly_cost, 2),
                    "address": resource_entry.get("address"),
                })
            else:
                unestimated_resource_count += 1
                cost_breakdown.append({
                    "resource": f"{resource_type}.{resource_name}",
                    "type": resource_type,
                    "name": resource_name,
                    "estimated_monthly_cost": None,
                    "address": resource_entry.get("address"),
                    "note": "Cost estimation unavailable for this resource type",
                })
        
        # Sort by monthly cost descending
        cost_breakdown.sort(key=lambda x: x["estimated_monthly_cost"] or 0, reverse=True)
        
        return {
            "total_estimated_monthly_cost": round(aggregated_cost, 2),
            "currency": "USD",
            "resource_count": len(catalog_resources),
            "estimated_count": len(catalog_resources) - unestimated_resource_count,
            "unknown_count": unestimated_resource_count,
            "breakdown": cost_breakdown,
            "generated_at": datetime.utcnow().isoformat() + "Z",
        }
    
    def analyze_infrastructure_change_cost_impact(
        self,
        existing_catalog: Dict[str, Any],
        planned_modifications: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Analyze cost impact of planned infrastructure modifications.
        Returns cost delta with detailed breakdown.
        """
        baseline_cost_analysis = self.compute_catalog_total_cost(existing_catalog)
        baseline_monthly_cost = baseline_cost_analysis["total_estimated_monthly_cost"]
        
        # Calculate cost changes from modifications
        added_costs = []
        removed_costs = []
        modified_resource_costs = []
        
        for modification in planned_modifications:
            modification_action = modification.get("action")
            resource_selector = modification.get("selector", {})
            target_resource_type = resource_selector.get("type")
            target_resource_name = resource_selector.get("name")
            
            if modification_action == "create":
                # New resource addition - calculate cost
                # Construct configuration from modification changes
                resource_config = self._extract_configuration_from_changes(modification.get("changes", []))
                estimated_addition_cost = self.calculate_resource_monthly_cost(target_resource_type, resource_config)
                if estimated_addition_cost is not None:
                    added_costs.append({
                        "resource": f"{target_resource_type}.{target_resource_name}",
                        "cost": round(estimated_addition_cost, 2),
                    })
            
            elif modification_action == "delete":
                # Resource removal - determine current cost
                for existing_resource in existing_catalog.get("resources", []):
                    if existing_resource.get("type") == target_resource_type and existing_resource.get("name") == target_resource_name:
                        estimated_removal_cost = self.calculate_resource_monthly_cost(target_resource_type, existing_resource.get("config", {}))
                        if estimated_removal_cost is not None:
                            removed_costs.append({
                                "resource": f"{target_resource_type}.{target_resource_name}",
                                "cost": round(estimated_removal_cost, 2),
                            })
                        break
            
            elif modification_action == "update":
                # Modified resource - cost may vary (e.g., instance type changes)
                # MVP simplification: note modification without recalculation
                modified_resource_costs.append({
                    "resource": f"{target_resource_type}.{target_resource_name}",
                    "note": "Cost may vary based on configuration changes",
                })
        
        total_added_cost = sum(entry["cost"] for entry in added_costs)
        total_removed_cost = sum(entry["cost"] for entry in removed_costs)
        projected_monthly_cost = baseline_monthly_cost + total_added_cost - total_removed_cost
        cost_delta = projected_monthly_cost - baseline_monthly_cost
        
        return {
            "current_monthly_cost": round(baseline_monthly_cost, 2),
            "new_monthly_cost": round(projected_monthly_cost, 2),
            "delta_monthly_cost": round(cost_delta, 2),
            "delta_percentage": round((cost_delta / baseline_monthly_cost * 100) if baseline_monthly_cost > 0 else 0, 1),
            "additions": added_costs,
            "removals": removed_costs,
            "modifications": modified_resource_costs,
            "currency": "USD",
        }
    
    def evaluate_budget_threshold_breach(self, active_monthly_cost: float, budget_ceiling: float) -> Optional[Dict[str, Any]]:
        """
        Evaluate if current cost breaches configured budget alert threshold.
        Returns alert details if threshold breached, None otherwise.
        """
        if budget_ceiling <= 0:
            return None
        
        budget_utilization_ratio = active_monthly_cost / budget_ceiling
        
        if budget_utilization_ratio >= self.budget_alert_threshold:
            return {
                "alert": True,
                "severity": "critical" if budget_utilization_ratio >= 0.95 else "warning",
                "current_cost": round(active_monthly_cost, 2),
                "budget_limit": round(budget_ceiling, 2),
                "usage_percentage": round(budget_utilization_ratio * 100, 1),
                "threshold_percentage": round(self.budget_alert_threshold * 100, 1),
                "message": f"Budget alert: {round(budget_utilization_ratio * 100, 1)}% of budget ceiling reached",
                "exceeded_by": round(active_monthly_cost - (budget_ceiling * self.budget_alert_threshold), 2),
            }
        
        return None
    
    def persist_cost_snapshot(self, snapshot_identifier: str, cost_analysis_data: Dict[str, Any]):
        """Persist cost analysis snapshot to storage"""
        snapshot_file_path = self.cost_storage_path / f"{snapshot_identifier}.json"
        snapshot_file_path.write_text(json.dumps(cost_analysis_data, indent=2))
    
    def retrieve_cost_snapshot(self, snapshot_identifier: str) -> Optional[Dict[str, Any]]:
        """Retrieve persisted cost snapshot from storage"""
        snapshot_file_path = self.cost_storage_path / f"{snapshot_identifier}.json"
        if snapshot_file_path.exists():
            return json.loads(snapshot_file_path.read_text())
        return None
    
    def _extract_configuration_from_changes(self, modification_changes: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Helper to construct configuration dictionary from IR changes"""
        configuration_dict = {}
        for change_entry in modification_changes:
            if change_entry.get("op") == "set":
                configuration_path = change_entry.get("path", "")
                configuration_value = change_entry.get("value")
                # Convert dot-notation path to nested dictionary
                path_segments = configuration_path.split(".")
                nested_dict = configuration_dict
                for segment in path_segments[:-1]:
                    nested_dict = nested_dict.setdefault(segment, {})
                nested_dict[path_segments[-1]] = configuration_value
        return configuration_dict


# Global cost monitoring instance
infrastructure_cost_monitor = InfrastructureCostMonitor()
cost_tracker = infrastructure_cost_monitor

