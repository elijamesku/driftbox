"""
Infrastructure Indexing Service - Extends codebase indexing to also index infrastructure resources
"""
import json
from typing import List, Dict, Any, Optional
from pathlib import Path
from app.services.codebase_indexing_service import CodebaseIndexingService


class InfrastructureIndexingService:
    """Service for indexing infrastructure resources alongside code chunks"""
    
    def __init__(self):
        self.codebase_service = CodebaseIndexingService()
    
    def get_resources_file_path(self, user_id: str, owner: str, repo: str) -> Path:
        """Get the path to the resources JSON file"""
        index_path = self.codebase_service.get_index_path(user_id, owner, repo)
        return index_path / "resources.json"
    
    def extract_resources_from_chunks(
        self,
        chunks: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Extract infrastructure resources from codebase chunks
        
        Resources are stored as chunks with metadata type="resource"
        """
        resources = []
        for chunk in chunks:
            meta = chunk.get("meta", {})
            if meta.get("type") == "resource":
                # This is a resource chunk, extract it
                resource_data = {
                    "type": meta.get("resource_type", ""),
                    "name": meta.get("resource_name", ""),
                    "tf_name": meta.get("tf_name", ""),
                    "file": meta.get("file", ""),
                    "line": meta.get("line"),
                    "attrs": meta.get("attrs", {}),
                    "address": meta.get("address", ""),
                }
                resources.append(resource_data)
        return resources
    
    def store_resources(
        self,
        user_id: str,
        owner: str,
        repo: str,
        resources: List[Dict[str, Any]],
        commit_sha: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Store infrastructure resources in a separate JSON file for fast access
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            resources: List of resource dictionaries
            commit_sha: Optional commit SHA for version tracking
            
        Returns:
            Result dictionary with success status
        """
        resources_file = self.get_resources_file_path(user_id, owner, repo)
        resources_file.parent.mkdir(parents=True, exist_ok=True)
        
        resources_data = {
            "commit_sha": commit_sha,
            "resources": resources,
            "resource_count": len(resources),
            "resource_types": list(set(r.get("type", "") for r in resources))
        }
        
        with open(resources_file, "w", encoding="utf-8") as f:
            json.dump(resources_data, f, indent=2)
        
        return {
            "success": True,
            "resource_count": len(resources),
            "file_path": str(resources_file)
        }
    
    def get_resources_from_index(
        self,
        user_id: str,
        owner: str,
        repo: str
    ) -> List[Dict[str, Any]]:
        """
        Retrieve all resources from the index
        
        Returns:
            List of resource dictionaries, or empty list if index doesn't exist
        """
        resources_file = self.get_resources_file_path(user_id, owner, repo)
        
        if not resources_file.exists():
            return []
        
        try:
            with open(resources_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("resources", [])
        except Exception as e:
            print(f"Error reading resources from index: {e}")
            return []
    
    def search_resources_by_type(
        self,
        user_id: str,
        owner: str,
        repo: str,
        resource_type: str
    ) -> List[Dict[str, Any]]:
        """
        Filter resources by type
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            resource_type: Resource type to filter (e.g., "aws_s3_bucket")
            
        Returns:
            List of resources matching the type
        """
        all_resources = self.get_resources_from_index(user_id, owner, repo)
        return [r for r in all_resources if r.get("type") == resource_type]
    
    def get_resource_relationships(
        self,
        user_id: str,
        owner: str,
        repo: str
    ) -> List[Dict[str, Any]]:
        """
        Extract relationships between resources from their attributes
        
        Returns:
            List of relationship dictionaries with source, target, and relationship type
        """
        resources = self.get_resources_from_index(user_id, owner, repo)
        relationships = []
        
        # Build resource lookup by address
        resource_map = {}
        for resource in resources:
            address = resource.get("address", "")
            if address:
                resource_map[address] = resource
        
        # Extract relationships from resource attributes
        for resource in resources:
            attrs = resource.get("attrs", {})
            resource_type = resource.get("type", "")
            resource_name = resource.get("name", "")
            
            # Common relationship patterns
            # 1. References to other resources (e.g., vpc_id = aws_vpc.main.id)
            for key, value in attrs.items():
                if isinstance(value, str):
                    # Check for resource references
                    if ".id" in value or ".arn" in value:
                        # Extract referenced resource
                        parts = value.split(".")
                        if len(parts) >= 2:
                            ref_type = parts[0].replace("aws_", "aws_")
                            ref_name = parts[1]
                            ref_address = f"{ref_type}.{ref_name}"
                            
                            if ref_address in resource_map:
                                relationships.append({
                                    "source": resource.get("address", ""),
                                    "target": ref_address,
                                    "relationship": key,
                                    "type": "reference"
                                })
            
            # 2. Security group associations
            if resource_type.startswith("aws_") and "security_group" in attrs:
                sg_refs = attrs.get("security_group", [])
                if not isinstance(sg_refs, list):
                    sg_refs = [sg_refs]
                
                for sg_ref in sg_refs:
                    if isinstance(sg_ref, str) and "aws_security_group" in sg_ref:
                        parts = sg_ref.split(".")
                        if len(parts) >= 2:
                            sg_address = f"aws_security_group.{parts[1]}"
                            if sg_address in resource_map:
                                relationships.append({
                                    "source": resource.get("address", ""),
                                    "target": sg_address,
                                    "relationship": "protected_by",
                                    "type": "security"
                                })
        
        return relationships


# Global infrastructure indexing service instance
infrastructure_indexing_service = InfrastructureIndexingService()

