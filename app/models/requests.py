 
from pydantic import BaseModel
from typing import Optional

# Request payload schemas for API endpoints
class NaturalLanguagePrompt(BaseModel):
    """Natural language infrastructure generation request"""
    prompt: str

class NaturalLanguageEdit(BaseModel):
    """Natural language infrastructure modification request"""
    prompt: str

class RepositoryEditRequest(BaseModel):
    """Repository modification request with optional IR specification"""
    prompt: Optional[str] = None
    ir: Optional[dict] = None

class GitRepositoryConnection(BaseModel):
    """Git remote repository URL"""
    url: str

class RepositoryIndexRequest(BaseModel):
    """Request to index repository contents for search"""
    dir: Optional[str] = "."   # Path relative to repository root

class RAGSearchQuery(BaseModel):
    """Retrieval-augmented generation search request"""
    prompt: str
    k: int = 8  # Number of results to retrieve

class RAGInfrastructurePlan(BaseModel):
    """RAG-based infrastructure planning request"""
    prompt: str
    region_default: Optional[str] = "us-east-1"

class RAGInfrastructureExecution(BaseModel):
    """RAG-based infrastructure execution request"""
    prompt: str
    region_default: Optional[str] = "us-east-1"
    validate_run: bool = True
