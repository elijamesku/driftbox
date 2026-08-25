"""
Infrastructure Query Service - Query indexed infrastructure resources
"""
from typing import List, Dict, Any, Optional
from app.services.infrastructure_indexing_service import infrastructure_indexing_service
from app.services.codebase_indexing_service import codebase_indexing_service


class InfrastructureQueryService:
    """Service to query indexed infrastructure resources with fallback to parsing"""
    
    def __init__(self):
        self.indexing_service = infrastructure_indexing_service
    
    def get_all_resources(
        self,
        user_id: str,
        owner: str,
        repo: str,
        fallback_to_parse: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Get all resources from index
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            fallback_to_parse: Not used here - endpoints handle fallback
            
        Returns:
            List of resource dictionaries, empty list if index doesn't exist
        """
        return self.indexing_service.get_resources_from_index(user_id, owner, repo)
    
    def get_resources_by_type(
        self,
        user_id: str,
        owner: str,
        repo: str,
        resource_type: str,
        fallback_to_parse: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Get resources filtered by type
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            resource_type: Resource type to filter (e.g., "aws_s3_bucket")
            fallback_to_parse: If True, parse and index if index doesn't exist
            
        Returns:
            List of resources matching the type
        """
        if fallback_to_parse:
            all_resources = self.get_all_resources(user_id, owner, repo, fallback_to_parse)
        else:
            all_resources = self.indexing_service.get_resources_from_index(user_id, owner, repo)
        
        return [r for r in all_resources if r.get("type") == resource_type]
    
    def get_resource_relationships(
        self,
        user_id: str,
        owner: str,
        repo: str
    ) -> List[Dict[str, Any]]:
        """
        Get relationships between resources
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            
        Returns:
            List of relationship dictionaries
        """
        return self.indexing_service.get_resource_relationships(user_id, owner, repo)
    
    def search_resources_semantically(
        self,
        user_id: str,
        owner: str,
        repo: str,
        query: str,
        top_k: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Semantic search for resources using natural language queries
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            query: Natural language query (e.g., "all databases", "S3 buckets with encryption")
            top_k: Number of results to return
            
        Returns:
            List of relevant resources with scores
        """
        # Use codebase search to find relevant chunks
        search_results = codebase_indexing_service.search_codebase(
            user_id=user_id,
            owner=owner,
            repo=repo,
            query=query,
            top_k=top_k * 2  # Get more results to filter
        )
        
        # Filter to only resource chunks and extract resources
        resources = []
        seen_addresses = set()
        
        for result in search_results:
            meta = result.get("meta", {})
            if meta.get("type") == "resource":
                address = meta.get("address", "")
                if address and address not in seen_addresses:
                    seen_addresses.add(address)
                    resource = {
                        "type": meta.get("resource_type", ""),
                        "name": meta.get("resource_name", ""),
                        "tf_name": meta.get("tf_name", ""),
                        "file": meta.get("file", ""),
                        "line": meta.get("line"),
                        "attrs": meta.get("attrs", {}),
                        "address": address,
                        "score": result.get("score", 0.0)
                    }
                    resources.append(resource)
        
        # Return top_k results
        return resources[:top_k]
    
    def ensure_indexed(
        self,
        user_id: str,
        owner: str,
        repo: str,
        branch: str = "main",
        user_account = None
    ) -> bool:
        """
        Ensure repository is indexed. If not, trigger indexing.
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            branch: Branch to index
            user_account: UserAccount object for parsing
            
        Returns:
            True if index exists or was created, False otherwise
        """
        # Check if index exists
        status = codebase_indexing_service.get_index_status(user_id, owner, repo)
        if status.get("exists"):
            return True
        
        # Index doesn't exist, but we can't trigger indexing here without user_account
        # The endpoint should handle this
        return False


# Global infrastructure query service instance
infrastructure_query_service = InfrastructureQueryService()

