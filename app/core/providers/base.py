from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any


class InfrastructureProvider(ABC):
    """Abstract base class defining cloud provider integration interface"""
    
    @abstractmethod
    def retrieve_provider_identifier(self) -> str:
        """Retrieve the cloud provider identifier string (aws, gcp, azure)"""
        pass
    
    @abstractmethod
    def verify_resource_configuration(self, resource_type: str, configuration: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        Verify that a resource configuration meets provider requirements.
        Returns tuple of (validation_passed, error_description)
        """
        pass
    
    @abstractmethod
    def list_supported_resource_types(self) -> List[str]:
        """Retrieve list of Terraform resource types supported by this provider"""
        pass
    
    @abstractmethod
    def calculate_monthly_cost(self, resource_type: str, configuration: Dict[str, Any]) -> Optional[float]:
        """
        Calculate estimated monthly cost for a resource configuration in USD.
        Returns None when cost estimation is not available.
        """
        pass
    
    @abstractmethod
    def get_documentation_url(self, resource_type: str) -> Optional[str]:
        """Retrieve official documentation URL for specified resource type"""
        pass
    
    def get_resource_type_prefix(self) -> str:
        """Generate Terraform resource type prefix (e.g., 'aws_' for AWS provider)"""
        return f"{self.retrieve_provider_identifier()}_"

