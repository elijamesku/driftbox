"""
Context Service - Abstracted service for managing codebase and conversation context
Provides unified interface for RAG operations
"""
from typing import Optional, Dict, Any, List
import os
import json
import re
from pathlib import Path


class ContextService:
    """Unified service for codebase and conversation context management"""
    
    def __init__(self):
        self.base_index_path = Path("app/data/index")
        self.codebase_index_path = self.base_index_path / "codebase"
        self.conversation_index_path = self.base_index_path / "conversations"
    
    def get_codebase_index_path(self, user_id: str, owner: str, repo: str) -> Path:
        """Get the index path for a specific user's repository"""
        return self.codebase_index_path / user_id / f"{owner}_{repo}"
    
    def get_conversation_index_path(self, user_id: str) -> Path:
        """Get the conversation index path for a user"""
        return self.conversation_index_path / user_id
    
    def list_tf_files_in_workspace(self, workspace_path: Optional[str]) -> List[str]:
        """
        List all .tf files in workspace (recursive)
        
        Args:
            workspace_path: Path to workspace directory
            
        Returns:
            List of relative file paths (e.g., ["main.tf", "compute.tf"])
        """
        if not workspace_path:
            return []
        
        try:
            workspace = Path(workspace_path)
            if not workspace.exists():
                return []
            
            # Find all .tf files recursively
            tf_files = list(workspace.glob('**/*.tf'))
            # Convert to relative paths
            relative_paths = [str(f.relative_to(workspace)) for f in tf_files if f.is_file()]
            return relative_paths
        except Exception as e:
            print(f"⚠️ [ContextService] Error listing files in workspace: {e}")
            return []
    
    async def determine_files_to_read_via_llm(
        self,
        query: str,
        available_files: List[str],
        workspace_path: Optional[str] = None
    ) -> List[str]:
        """
        Use LLM to determine which files to read based on user query
        
        Args:
            query: User's query
            available_files: List of available .tf file paths
            workspace_path: Optional workspace path for context
            
        Returns:
            List of file paths to read
        """
        # Fast path: If query contains specific filenames, extract them directly
        query_lower = query.lower()
        specific_files = []
        for file_path in available_files:
            file_name = file_path.split('/')[-1]  # Get just filename
            # Check if filename (with or without extension) is mentioned
            if file_name.lower() in query_lower or file_name.replace('.tf', '').lower() in query_lower:
                specific_files.append(file_path)
        
        if specific_files:
            print(f"📄 [ContextService] Detected specific files from query: {specific_files}")
            return specific_files
        
        # Check for vague requests that might mean "all files"
        vague_keywords = ["codebase", "existing files", "current files", "my files", "all files", "read my", "read the"]
        is_vague_request = any(keyword in query_lower for keyword in vague_keywords)
        
        if is_vague_request and available_files:
            # Use LLM to determine if user wants all files or specific subset
            try:
                from app.services.llm_failover import llm_failover_service
                
                files_list = "\n".join([f"- {f}" for f in available_files[:20]])  # Limit to 20 for prompt
                if len(available_files) > 20:
                    files_list += f"\n... and {len(available_files) - 20} more files"
                
                system_prompt = """You are a code assistant. The user wants to read files from their codebase.

Available files:
{files_list}

User query: "{query}"

Determine which files the user wants to read. Respond with ONLY a JSON object in this exact format:
{{
  "files_to_read": ["file1.tf", "file2.tf"],
  "reason": "brief explanation"
}}

Rules:
- If user says "read my codebase", "read existing files", "read all files", "read current files" → return ALL files
- If user mentions specific files → return only those files
- If user asks about a topic (e.g., "networking", "security") → return files likely related to that topic
- If unclear, default to ALL files for vague requests

Respond with ONLY the JSON, no other text.""".format(
                    files_list=files_list,
                    query=query
                )
                
                response = await llm_failover_service.create_completion(
                    messages=[{"role": "user", "content": query}],
                    system_prompt=system_prompt,
                    model="claude-sonnet-4-20250514",
                    max_tokens=500,
                    temperature=0.3
                )
                
                # Parse JSON response
                response = response.strip()
                # Remove markdown code blocks if present
                if response.startswith("```"):
                    lines = response.split("\n")
                    response = "\n".join(lines[1:-1]) if len(lines) > 2 else response
                    response = response.strip()
                
                result = json.loads(response)
                files_to_read = result.get("files_to_read", [])
                
                # Validate files exist in available_files
                valid_files = [f for f in files_to_read if f in available_files]
                
                if valid_files:
                    print(f"🤖 [ContextService] LLM determined files to read: {valid_files} (reason: {result.get('reason', 'N/A')})")
                    return valid_files
                else:
                    # Fallback: return all files for vague requests
                    print(f"⚠️ [ContextService] LLM returned invalid files, defaulting to all files")
                    return available_files
                    
            except Exception as e:
                print(f"⚠️ [ContextService] Error in LLM file determination: {e}")
                # Fallback: for vague requests, return all files
                if is_vague_request:
                    return available_files
        
        # No file read intent detected
        return []
    
    def detect_file_read_request(self, query: str) -> bool:
        """
        Detect if user query indicates a file read request (lightweight check)
        
        Returns:
            True if query likely contains file read intent
        """
        query_lower = query.lower()
        
        # Keywords that suggest file reading
        read_keywords = ["read", "show", "display", "view", "open", "see", "what's in", "what is in", "can you read"]
        file_keywords = ["file", "files", "codebase", "code", "existing", "current", "repo"]
        file_extensions = [".tf", ".hcl", ".py", ".js", ".ts", ".json", ".yaml", ".yml"]
        
        # Check for explicit file read patterns
        has_read_keyword = any(keyword in query_lower for keyword in read_keywords)
        has_file_keyword = any(keyword in query_lower for keyword in file_keywords)
        has_extension = any(ext in query_lower for ext in file_extensions)
        
        # Also check for "I have X, Y, Z" pattern
        has_file_list_pattern = bool(re.search(r'(?:i\s+have|my\s+files?|current\s+files?)\s+', query_lower))
        
        result = has_read_keyword or (has_file_keyword and has_extension) or has_file_list_pattern
        print(f"🔍 [detect_file_read_request] Query: '{query}', has_read: {has_read_keyword}, has_file: {has_file_keyword}, has_ext: {has_extension}, has_pattern: {has_file_list_pattern}, result: {result}")
        return result
    
    def read_and_index_file(
        self,
        user_id: str,
        owner: str,
        repo: str,
        file_path: str,
        workspace_path: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Read a file, parse it into chunks, index into RAG, and return content
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            file_path: Path to file
            workspace_path: Optional workspace path for local files
            
        Returns:
            File content dict or None if file not found
        """
        # Read file content
        file_content = self.read_file_directly(user_id, owner, repo, file_path, workspace_path)
        if not file_content:
            return None
        
        content = file_content.get("text", "")
        line_count = content.count('\n') + 1
        
        # For small files, return full content without chunking
        if line_count < 100:
            # Still index it, but return full content
            if file_path.endswith('.tf') and workspace_path:
                try:
                    from app.services.terraform_chunker import parse_terraform_file
                    from app.services.codebase_indexing_service import codebase_indexing_service
                    
                    # Parse file into chunks for indexing
                    chunks = parse_terraform_file(file_path, content)
                    print(f"📦 [ContextService] Parsed {file_path} into {len(chunks)} chunks for indexing")
                    
                    # Index chunks into RAG
                    if chunks:
                        result = codebase_indexing_service.incremental_update(
                            user_id=user_id,
                            owner=owner,
                            repo=repo,
                            changed_files=[{
                                "path": file_path,
                                "type": "modified",
                                "chunks": chunks
                            }]
                        )
                        if result.get("success"):
                            print(f"✅ [ContextService] Indexed {file_path} into RAG ({len(chunks)} chunks)")
                except Exception as e:
                    print(f"⚠️ [ContextService] Error parsing/indexing {file_path}: {e}")
            
            return file_content  # Return full file, skip chunking for small files
        
        # Parse file into chunks (only for .tf files)
        if file_path.endswith('.tf') and workspace_path:
            try:
                from app.services.terraform_chunker import parse_terraform_file
                from app.services.codebase_indexing_service import codebase_indexing_service
                
                # Parse file into chunks
                chunks = parse_terraform_file(file_path, content)
                print(f"📦 [ContextService] Parsed {file_path} into {len(chunks)} chunks")
                
                # Index chunks into RAG
                if chunks:
                    # Use incremental update to add/update this file
                    result = codebase_indexing_service.incremental_update(
                        user_id=user_id,
                        owner=owner,
                        repo=repo,
                        changed_files=[{
                            "path": file_path,
                            "type": "modified",  # Will be handled as add if new
                            "chunks": chunks
                        }]
                    )
                    if result.get("success"):
                        print(f"✅ [ContextService] Indexed {file_path} into RAG ({len(chunks)} chunks)")
                    else:
                        print(f"⚠️ [ContextService] Failed to index {file_path}: {result.get('error')}")
            except Exception as e:
                print(f"⚠️ [ContextService] Error parsing/indexing {file_path}: {e}")
                # Continue even if indexing fails - still return file content
        
        return file_content
    
    def read_file_directly(
        self,
        user_id: str,
        owner: str,
        repo: str,
        file_path: str,
        workspace_path: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Read a specific file directly (bypassing RAG)
        Does NOT auto-index - use read_and_index_file() for that
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            file_path: Path to file
            workspace_path: Optional workspace path for local files
            
        Returns:
            File content dict or None if file not found
        """
        from pathlib import Path
        
        # Try local filesystem first (if workspace_path provided)
        if workspace_path:
            try:
                repo_path = Path(workspace_path)
                file_full_path = repo_path / file_path
                if file_full_path.exists() and file_full_path.is_file():
                    with open(file_full_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    print(f"✅ [ContextService] Read {file_path} from local filesystem ({len(content)} chars)")
                    return {
                        "text": content,
                        "meta": {
                            "file": file_path,
                            "type": "file_content",
                            "source": "local_filesystem"
                        },
                        "score": 1.0  # Direct read gets max score
                    }
            except Exception as e:
                print(f"⚠️ [ContextService] Error reading local file {file_path}: {e}")
        
        # Fallback: Try to get from indexed chunks (if file was indexed)
        # Search RAG index for chunks from this specific file
        try:
            from app.services.codebase_indexing_service import codebase_indexing_service
            # Use a query that matches the filename to find chunks from that file
            chunks = codebase_indexing_service.search_codebase(
                user_id=user_id,
                owner=owner,
                repo=repo,
                query=file_path,  # Search for filename
                top_k=200  # Increase from 50 to 200 to get all chunks from large files
            )
            # Filter chunks that match this exact file
            file_chunks = [c for c in chunks if c.get('meta', {}).get('file') == file_path]
            if file_chunks:
                # Combine all chunks from this file
                combined_content = "\n".join([c.get('text', '') for c in file_chunks])
                print(f"✅ [ContextService] Reconstructed {file_path} from RAG index ({len(combined_content)} chars from {len(file_chunks)} chunks)")
                return {
                    "text": combined_content,
                    "meta": {
                        "file": file_path,
                        "type": "file_content",
                        "source": "rag_index"
                    },
                    "score": 0.9  # Slightly lower than direct read
                }
        except Exception as e:
            print(f"⚠️ [ContextService] Error reading from RAG index: {e}")
        
        return None
    
    async def get_codebase_context(
        self,
        user_id: str,
        owner: str,
        repo: str,
        query: str,
        top_k: int = 8,
        workspace_path: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Smart codebase context retrieval with LLM-based intent detection:
        - If file read intent detected, use LLM to determine which files to read
        - Read and auto-index those files
        - Otherwise, use RAG semantic search
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            query: Search query
            top_k: Number of results to return
            workspace_path: Optional workspace path for direct file reading
            
        Returns:
            List of relevant chunks with scores
        """
        from app.services.codebase_indexing_service import codebase_indexing_service
        
        # Check if user query indicates file read intent
        has_file_read_intent = self.detect_file_read_request(query)
        print(f"🔍 [ContextService] File read intent detected: {has_file_read_intent}, workspace_path: {workspace_path}")
        
        if has_file_read_intent and workspace_path:
            print(f"📄 [ContextService] Detected file read intent in query")
            
            # Get list of available .tf files
            available_files = self.list_tf_files_in_workspace(workspace_path)
            
            if available_files:
                print(f"📁 [ContextService] Found {len(available_files)} .tf files in workspace")
                
                # Use LLM to determine which files to read
                files_to_read = await self.determine_files_to_read_via_llm(
                    query=query,
                    available_files=available_files,
                    workspace_path=workspace_path
                )
                
                if files_to_read:
                    print(f"📖 [ContextService] Reading {len(files_to_read)} files: {files_to_read}")
                    
                    # For file read requests, return FULL file content, not chunks
                    file_contents = []
                    for file_path in files_to_read:
                        # Read full file directly (bypasses chunking for display)
                        file_content = self.read_file_directly(
                            user_id=user_id,
                            owner=owner,
                            repo=repo,
                            file_path=file_path,
                            workspace_path=workspace_path
                        )
                        if file_content:
                            # Also index the file for future RAG searches (but return full content now)
                            try:
                                self.read_and_index_file(
                                    user_id=user_id,
                                    owner=owner,
                                    repo=repo,
                                    file_path=file_path,
                                    workspace_path=workspace_path
                                )
                            except Exception as e:
                                print(f"⚠️ [ContextService] Failed to index {file_path} (non-fatal): {e}")
                            
                            # Return as single "chunk" with full file content
                            file_contents.append({
                                "text": file_content["text"],  # Full file content
                                "meta": {
                                    "file": file_path,
                                    "type": "full_file",  # Mark as full file
                                    "source": "direct_read"
                                },
                                "score": 1.0
                            })
                    
                    if file_contents:
                        print(f"✅ [ContextService] Read {len(file_contents)} full files for file read request")
                        return file_contents  # Return full files, not chunks
                    else:
                        print(f"⚠️ [ContextService] Could not read any of the requested files, falling back to RAG")
                else:
                    print(f"⚠️ [ContextService] LLM determined no files to read, falling back to RAG")
            else:
                print(f"⚠️ [ContextService] No .tf files found in workspace, falling back to RAG")
        
        # Use RAG semantic search for general queries or when file reading fails
        index_path = self.get_codebase_index_path(user_id, owner, repo)
        
        if not index_path.exists():
            return []
        
        return codebase_indexing_service.search_codebase(
            user_id=user_id,
            owner=owner,
            repo=repo,
            query=query,
            top_k=top_k
        )
    
    def get_conversation_context(
        self,
        user_id: str,
        conversation_id: Optional[str],
        query: str,
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Retrieve relevant conversation history for a query
        
        Args:
            user_id: User identifier
            conversation_id: Optional conversation ID to prioritize
            query: Search query
            top_k: Number of results to return
            
        Returns:
            List of relevant conversation chunks with scores
        """
        from app.services.conversation_indexing_service import conversation_indexing_service
        
        index_path = self.get_conversation_index_path(user_id)
        
        if not index_path.exists():
            return []
        
        return conversation_indexing_service.search_conversation_history(
            user_id=user_id,
            query=query,
            conversation_id=conversation_id,
            top_k=top_k
        )
    
    def get_combined_context(
        self,
        user_id: str,
        owner: str,
        repo: str,
        conversation_id: Optional[str],
        query: str,
        codebase_top_k: int = 8,
        conversation_top_k: int = 5,
        workspace_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get combined codebase and conversation context
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            conversation_id: Optional conversation ID
            query: Search query
            codebase_top_k: Number of codebase results
            conversation_top_k: Number of conversation results
            
        Returns:
            Dictionary with codebase_context and conversation_context
        """
        # Note: get_combined_context is synchronous, but get_codebase_context is async
        # For now, we'll need to make this async or use a sync wrapper
        # For backward compatibility, we'll use a sync approach here
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # If we're in an async context, we need to handle this differently
                # For now, create a task (but this won't work perfectly)
                # Better: make get_combined_context async too
                codebase_context = []
            else:
                codebase_context = loop.run_until_complete(
                    self.get_codebase_context(
                        user_id=user_id,
                        owner=owner,
                        repo=repo,
                        query=query,
                        top_k=codebase_top_k,
                        workspace_path=workspace_path
                    )
                )
        except RuntimeError:
            # No event loop - create one
            codebase_context = asyncio.run(
                self.get_codebase_context(
                    user_id=user_id,
                    owner=owner,
                    repo=repo,
                    query=query,
                    top_k=codebase_top_k,
                    workspace_path=workspace_path
                )
            )
        
        conversation_context = self.get_conversation_context(
            user_id=user_id,
            conversation_id=conversation_id,
            query=query,
            top_k=conversation_top_k
        )
        
        return {
            "codebase_context": codebase_context,
            "conversation_context": conversation_context,
            "combined_text": self._format_combined_context(
                codebase_context,
                conversation_context
            )
        }
    
    def _format_combined_context(
        self,
        codebase_context: List[Dict[str, Any]],
        conversation_context: List[Dict[str, Any]]
    ) -> str:
        """Format combined context for LLM injection"""
        parts = []
        
        if codebase_context:
            parts.append("=== Codebase Context ===")
            for i, chunk in enumerate(codebase_context, 1):
                meta = chunk.get("meta", {})
                file_path = meta.get("file", "unknown")
                chunk_type = meta.get("type", "unknown")
                text = chunk.get("text", "")
                parts.append(f"\n[{i}] From {file_path} ({chunk_type}):\n{text}\n")
        
        if conversation_context:
            parts.append("\n=== Previous Conversation Context ===")
            for i, chunk in enumerate(conversation_context, 1):
                meta = chunk.get("meta", {})
                conversation_id = meta.get("conversation_id", "unknown")
                role = meta.get("role", "unknown")
                timestamp = meta.get("timestamp", "")
                text = chunk.get("text", "")
                parts.append(f"\n[{i}] From conversation {conversation_id[:8]}... ({role}, {timestamp}):\n{text}\n")
        
        return "\n".join(parts) if parts else ""
    
    def update_codebase_index(
        self,
        user_id: str,
        owner: str,
        repo: str,
        chunks: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Update codebase index with new chunks
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            chunks: List of chunks to index
            
        Returns:
            Result dictionary with success status
        """
        from app.services.codebase_indexing_service import codebase_indexing_service
        
        return codebase_indexing_service.store_codebase_index(
            user_id=user_id,
            owner=owner,
            repo=repo,
            chunks=chunks
        )
    
    def update_conversation_index(
        self,
        user_id: str,
        conversation_id: str,
        messages: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Update conversation index with new messages
        
        Args:
            user_id: User identifier
            conversation_id: Conversation ID
            messages: List of messages to index
            
        Returns:
            Result dictionary with success status
        """
        from app.services.conversation_indexing_service import conversation_indexing_service
        
        return conversation_indexing_service.index_conversation_messages(
            user_id=user_id,
            conversation_id=conversation_id,
            messages=messages
        )


# Global context service instance
context_service = ContextService()

