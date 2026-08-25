"""
Conversation Indexing Service - Handles chat history indexing (Cursor's "Memories" feature)
Indexes conversation messages into RAG for memory retrieval
"""
import os
import json
from typing import List, Dict, Any, Optional
from pathlib import Path
import faiss
import numpy as np
from datetime import datetime
from app.rag.ingest import generate_vector_embeddings


class ConversationIndexingService:
    """Service for indexing and searching conversation history"""
    
    def __init__(self):
        self.base_index_path = Path("app/data/index/conversations")
        self.base_index_path.mkdir(parents=True, exist_ok=True)
    
    def get_index_path(self, user_id: str) -> Path:
        """Get the conversation index path for a user"""
        return self.base_index_path / user_id
    
    def get_conversation_map_path(self, user_id: str) -> Path:
        """Get the conversation map file path"""
        return self.get_index_path(user_id) / "conversation_map.json"
    
    def _create_chunk_from_messages(
        self,
        conversation_id: str,
        messages: List[Dict[str, Any]],
        conversation_title: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Create chunks from conversation messages
        Strategy: Each user/assistant message pair = 1 chunk
        """
        chunks = []
        
        # Group messages into pairs (user + assistant)
        i = 0
        while i < len(messages):
            user_msg = None
            assistant_msg = None
            
            # Find user message
            if i < len(messages) and messages[i].get("role") == "user":
                user_msg = messages[i]
                i += 1
            
            # Find corresponding assistant message
            if i < len(messages) and messages[i].get("role") == "assistant":
                assistant_msg = messages[i]
                i += 1
            
            # Create chunk from pair
            if user_msg or assistant_msg:
                chunk_text_parts = []
                
                if conversation_title:
                    chunk_text_parts.append(f"Conversation: {conversation_title}")
                
                if user_msg:
                    chunk_text_parts.append(f"User: {user_msg.get('content', '')}")
                
                if assistant_msg:
                    chunk_text_parts.append(f"Assistant: {assistant_msg.get('content', '')}")
                
                # Add context from assistant message
                if assistant_msg:
                    files_changed = assistant_msg.get("files_changed")
                    if files_changed:
                        chunk_text_parts.append(f"Files changed: {', '.join(files_changed)}")
                
                chunk_text = "\n".join(chunk_text_parts)
                
                chunks.append({
                    "text": chunk_text,
                    "meta": {
                        "conversation_id": conversation_id,
                        "user_message_id": user_msg.get("id") if user_msg else None,
                        "assistant_message_id": assistant_msg.get("id") if assistant_msg else None,
                        "role": "user" if user_msg else "assistant",
                        "timestamp": user_msg.get("created_at") or assistant_msg.get("created_at") if assistant_msg else None,
                        "files_changed": assistant_msg.get("files_changed") if assistant_msg else None
                    }
                })
            else:
                i += 1
        
        return chunks
    
    def index_conversation_messages(
        self,
        user_id: str,
        conversation_id: str,
        messages: List[Dict[str, Any]],
        conversation_title: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Index conversation messages into RAG
        
        Args:
            user_id: User identifier
            conversation_id: Conversation ID
            messages: List of messages with role, content, etc.
            conversation_title: Optional conversation title
            
        Returns:
            Result dictionary with success status
        """
        if not messages:
            return {"success": False, "error": "No messages provided"}
        
        index_path = self.get_index_path(user_id)
        index_path.mkdir(parents=True, exist_ok=True)
        
        # Create chunks from messages
        new_chunks = self._create_chunk_from_messages(
            conversation_id=conversation_id,
            messages=messages,
            conversation_title=conversation_title
        )
        
        if not new_chunks:
            return {"success": False, "error": "No chunks created from messages"}
        
        # Load existing chunks and conversation map
        chunks_file = index_path / "chunks.jsonl"
        conversation_map_file = self.get_conversation_map_path(user_id)
        
        existing_chunks = []
        conversation_map = {}
        
        if chunks_file.exists():
            with open(chunks_file, "r", encoding="utf-8") as f:
                existing_chunks = [json.loads(line) for line in f if line.strip()]
        
        if conversation_map_file.exists():
            with open(conversation_map_file, "r", encoding="utf-8") as f:
                conversation_map = json.load(f)
        
        # Remove old chunks from this conversation (for incremental update)
        existing_chunks = [
            chunk for chunk in existing_chunks
            if chunk.get("meta", {}).get("conversation_id") != conversation_id
        ]
        
        # Add new chunks
        all_chunks = existing_chunks + new_chunks
        
        # Update conversation map
        for i, chunk in enumerate(new_chunks):
            chunk_id = len(existing_chunks) + i
            conversation_map[str(chunk_id)] = conversation_id
        
        # Generate embeddings
        chunk_texts = [chunk["text"] for chunk in all_chunks]
        embeddings = generate_vector_embeddings(chunk_texts)
        
        if not embeddings:
            return {"success": False, "error": "Failed to generate embeddings"}
        
        embedding_vectors = np.array(embeddings, dtype=np.float32)
        faiss.normalize_L2(embedding_vectors)
        
        # Build or update FAISS index
        if all_chunks:
            vector_dimensionality = embedding_vectors.shape[1]
            faiss_index = faiss.IndexFlatIP(vector_dimensionality)
            faiss_index.add(embedding_vectors)
            
            # Save index
            faiss.write_index(faiss_index, str(index_path / "faiss.index"))
        
        # Save chunks
        with open(chunks_file, "w", encoding="utf-8") as f:
            for chunk in all_chunks:
                f.write(json.dumps(chunk) + "\n")
        
        # Save conversation map
        with open(conversation_map_file, "w", encoding="utf-8") as f:
            json.dump(conversation_map, f, indent=2)
        
        return {
            "success": True,
            "index_path": str(index_path),
            "chunk_count": len(all_chunks),
            "new_chunks": len(new_chunks)
        }
    
    def update_conversation_index(
        self,
        user_id: str,
        conversation_id: str,
        new_messages: List[Dict[str, Any]],
        conversation_title: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Incrementally update conversation index with new messages
        
        Args:
            user_id: User identifier
            conversation_id: Conversation ID
            new_messages: List of new messages to add
            conversation_title: Optional conversation title
            
        Returns:
            Result dictionary with success status
        """
        # Load existing messages for this conversation
        index_path = self.get_index_path(user_id)
        chunks_file = index_path / "chunks.jsonl"
        
        existing_messages = []
        if chunks_file.exists():
            with open(chunks_file, "r", encoding="utf-8") as f:
                existing_chunks = [json.loads(line) for line in f if line.strip()]
                # Extract messages from chunks (simplified - in practice, you'd store message IDs)
                for chunk in existing_chunks:
                    if chunk.get("meta", {}).get("conversation_id") == conversation_id:
                        # Reconstruct message from chunk (simplified)
                        existing_messages.append({
                            "id": chunk.get("meta", {}).get("user_message_id") or chunk.get("meta", {}).get("assistant_message_id"),
                            "role": chunk.get("meta", {}).get("role"),
                            "content": chunk.get("text", "").split(": ", 1)[-1] if ":" in chunk.get("text", "") else chunk.get("text", "")
                        })
        
        # Combine existing and new messages
        all_messages = existing_messages + new_messages
        
        # Re-index entire conversation
        return self.index_conversation_messages(
            user_id=user_id,
            conversation_id=conversation_id,
            messages=all_messages,
            conversation_title=conversation_title
        )
    
    def search_conversation_history(
        self,
        user_id: str,
        query: str,
        conversation_id: Optional[str] = None,
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Search conversation history
        
        Args:
            user_id: User identifier
            query: Search query
            conversation_id: Optional conversation ID to prioritize
            top_k: Number of results to return
            
        Returns:
            List of relevant conversation chunks with scores
        """
        from app.rag.retrieve import execute_semantic_search
        
        index_path = self.get_index_path(user_id)
        
        if not index_path.exists() or not (index_path / "faiss.index").exists():
            return []
        
        try:
            results = execute_semantic_search(
                user_query=query,
                index_directory_path=str(index_path),
                top_k_results=top_k * 2  # Get more results to filter
            )
            
            # Filter and prioritize by conversation_id if provided
            if conversation_id:
                # Prioritize results from same conversation
                same_conversation = [
                    r for r in results
                    if r.get("meta", {}).get("conversation_id") == conversation_id
                ]
                other_conversations = [
                    r for r in results
                    if r.get("meta", {}).get("conversation_id") != conversation_id
                ]
                # Return same conversation first, then others
                results = same_conversation[:top_k] + other_conversations[:top_k - len(same_conversation)]
            else:
                results = results[:top_k]
            
            return results
        except Exception as e:
            print(f"Error searching conversation history: {e}")
            return []
    
    def get_conversation_memories(
        self,
        user_id: str,
        conversation_id: str,
        query: Optional[str] = None,
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Get relevant past context for current conversation
        
        Args:
            user_id: User identifier
            conversation_id: Current conversation ID
            query: Optional query (uses conversation title if not provided)
            top_k: Number of results to return
            
        Returns:
            List of relevant conversation chunks
        """
        if not query:
            # Use a generic query to get recent context
            query = "infrastructure changes terraform"
        
        # Search with conversation_id to prioritize same conversation
        return self.search_conversation_history(
            user_id=user_id,
            query=query,
            conversation_id=conversation_id,
            top_k=top_k
        )


# Global conversation indexing service instance
conversation_indexing_service = ConversationIndexingService()

