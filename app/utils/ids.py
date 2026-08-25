"""
ID generation utilities
"""
import uuid


def create_unique_identifier() -> str:
    """
    Generate a unique identifier (UUID4)
    
    Returns:
        str: A unique identifier string
    """
    return str(uuid.uuid4())

