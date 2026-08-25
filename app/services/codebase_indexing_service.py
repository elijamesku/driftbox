"""
Codebase Indexing Service - Handles per-user, per-repo codebase indexing with FAISS
"""
import os
import json
from typing import List, Dict, Any, Optional
from pathlib import Path
import faiss
import numpy as np
from app.rag.ingest import generate_vector_embeddings


class CodebaseIndexingService:
    """Service for indexing and searching codebase files"""
    
    def __init__(self):
        self.base_index_path = Path("app/data/index/codebase")
        self.base_index_path.mkdir(parents=True, exist_ok=True)
    
    def get_index_path(self, user_id: str, owner: str, repo: str) -> Path:
        """Get the index path for a specific user's repository"""
        return self.base_index_path / user_id / f"{owner}_{repo}"
    
    def get_metadata_path(self, user_id: str, owner: str, repo: str) -> Path:
        """Get the metadata file path"""
        return self.get_index_path(user_id, owner, repo) / "metadata.json"
    
    def _load_embeddings(self, index_path: Path) -> Optional[np.ndarray]:
        """
        Load embeddings from embeddings.npy file with backward compatibility.
        
        Args:
            index_path: Path to the index directory
            
        Returns:
            Numpy array of embeddings or None if not available
        """
        embeddings_file = index_path / "embeddings.npy"
        
        if embeddings_file.exists():
            try:
                return np.load(str(embeddings_file))
            except Exception as e:
                print(f"⚠️ [CodebaseIndexing] Failed to load embeddings.npy: {e}")
                return None
        
        # Backward compatibility: if embeddings.npy doesn't exist but FAISS index does,
        # we can't reconstruct embeddings from FAISS (IndexFlatIP doesn't support it)
        # So we return None and the caller will need to regenerate
        faiss_index_file = index_path / "faiss.index"
        if faiss_index_file.exists():
            print(f"⚠️ [CodebaseIndexing] embeddings.npy not found but FAISS index exists - will regenerate on next update")
        
        return None
    
    def store_codebase_index(
        self,
        user_id: str,
        owner: str,
        repo: str,
        chunks: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Store codebase chunks with embeddings in FAISS index
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            chunks: List of chunks with text and meta
            
        Returns:
            Result dictionary with success status and metadata
        """
        if not chunks:
            return {"success": False, "error": "No chunks provided"}
        
        index_path = self.get_index_path(user_id, owner, repo)
        index_path.mkdir(parents=True, exist_ok=True)
        
        # Extract text for embedding
        chunk_texts = [chunk["text"] for chunk in chunks]
        
        # Generate embeddings
        embeddings = generate_vector_embeddings(chunk_texts)
        if not embeddings:
            return {"success": False, "error": "Failed to generate embeddings"}
        
        embedding_vectors = np.array(embeddings, dtype=np.float32)
        
        # Normalize for cosine similarity
        faiss.normalize_L2(embedding_vectors)
        
        # Save embeddings to separate .npy file (binary format, size efficient)
        embeddings_file = index_path / "embeddings.npy"
        np.save(str(embeddings_file), embedding_vectors)
        
        # Build FAISS index
        vector_dimensionality = embedding_vectors.shape[1]
        faiss_index = faiss.IndexFlatIP(vector_dimensionality)
        faiss_index.add(embedding_vectors)
        
        # Save index
        faiss.write_index(faiss_index, str(index_path / "faiss.index"))
        
        # Save chunks WITHOUT embeddings (keep text + metadata only for size efficiency)
        chunks_file = index_path / "chunks.jsonl"
        with open(chunks_file, "w", encoding="utf-8") as f:
            for chunk in chunks:
                # Create a copy without embedding field if it exists
                chunk_to_save = {k: v for k, v in chunk.items() if k != "embedding"}
                f.write(json.dumps(chunk_to_save) + "\n")
        
        # Save metadata
        metadata = {
            "user_id": user_id,
            "owner": owner,
            "repo": repo,
            "chunk_count": len(chunks),
            "file_count": len(set(chunk["meta"]["file"] for chunk in chunks)),
            "last_updated": None  # Will be set by caller with timestamp
        }
        
        metadata_path = self.get_metadata_path(user_id, owner, repo)
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
        
        return {
            "success": True,
            "index_path": str(index_path),
            "chunk_count": len(chunks),
            "file_count": metadata["file_count"]
        }
    
    def incremental_update(
        self,
        user_id: str,
        owner: str,
        repo: str,
        changed_files: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Truly incremental update: only generates embeddings for changed files.
        Reuses embeddings from unchanged chunks for efficiency.
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            changed_files: List of file changes with path, type, and chunks
            
        Returns:
            Result dictionary with success status and stats
        """
        index_path = self.get_index_path(user_id, owner, repo)
        
        if not index_path.exists():
            # No existing index, create new one
            all_chunks = []
            for file_change in changed_files:
                if file_change.get("type") != "deleted":
                    all_chunks.extend(file_change.get("chunks", []))
            return self.store_codebase_index(user_id, owner, repo, all_chunks)
        
        # Load existing chunks and embeddings
        try:
            chunks_file = index_path / "chunks.jsonl"
            
            # Load existing chunks
            existing_chunks = []
            if chunks_file.exists():
                with open(chunks_file, "r", encoding="utf-8") as f:
                    existing_chunks = [json.loads(line) for line in f if line.strip()]
            
            # Load existing embeddings
            existing_embeddings = self._load_embeddings(index_path)
            
            # If embeddings.npy doesn't exist (backward compatibility), regenerate all
            if existing_embeddings is None:
                print(f"🔄 [CodebaseIndexing] embeddings.npy not found, regenerating all embeddings for backward compatibility")
                # Regenerate embeddings for all existing chunks
                if existing_chunks:
                    chunk_texts = [chunk["text"] for chunk in existing_chunks]
                    existing_embeddings = np.array(generate_vector_embeddings(chunk_texts), dtype=np.float32)
                    faiss.normalize_L2(existing_embeddings)
                    # Save for future use
                    np.save(str(index_path / "embeddings.npy"), existing_embeddings)
                else:
                    existing_embeddings = np.array([], dtype=np.float32).reshape(0, 1024)  # Empty array with correct shape
            
            # Build file-to-chunks map and track chunk indices
            file_to_chunk_indices = {}
            for i, chunk in enumerate(existing_chunks):
                file_path = chunk["meta"]["file"]
                if file_path not in file_to_chunk_indices:
                    file_to_chunk_indices[file_path] = []
                file_to_chunk_indices[file_path].append(i)
            
            # Determine which files changed
            files_to_remove = set()
            new_chunks = []
            
            for file_change in changed_files:
                file_path = file_change["path"]
                change_type = file_change["type"]
                
                if change_type == "deleted":
                    files_to_remove.add(file_path)
                elif change_type in ["added", "modified"]:
                    # Mark old chunks for removal
                    if file_path in file_to_chunk_indices:
                        files_to_remove.add(file_path)
                    # Add new chunks (these need embeddings)
                    new_chunks.extend(file_change.get("chunks", []))
            
            # Keep unchanged chunks (with their existing embeddings)
            unchanged_chunk_indices = []
            unchanged_chunks = []
            for i, chunk in enumerate(existing_chunks):
                if chunk["meta"]["file"] not in files_to_remove:
                    unchanged_chunk_indices.append(i)
                    unchanged_chunks.append(chunk)
            
            if not new_chunks and not files_to_remove:
                # No changes
                return {
                    "success": True,
                    "chunk_count": len(unchanged_chunks),
                    "file_count": len(set(c["meta"]["file"] for c in unchanged_chunks)),
                    "reused_embeddings": len(unchanged_chunks),
                    "new_embeddings": 0,
                    "message": "No changes to index"
                }
            
            # Extract embeddings for unchanged chunks
            if unchanged_chunk_indices and len(existing_embeddings) > 0:
                unchanged_embeddings = existing_embeddings[unchanged_chunk_indices]
            else:
                unchanged_embeddings = np.array([], dtype=np.float32).reshape(0, existing_embeddings.shape[1] if len(existing_embeddings) > 0 else 1024)
            
            # Generate embeddings ONLY for new/changed chunks
            new_embeddings_array = None
            if new_chunks:
                chunk_texts = [chunk["text"] for chunk in new_chunks]
                new_embeddings = generate_vector_embeddings(chunk_texts)
                
                if not new_embeddings:
                    return {"success": False, "error": "Failed to generate embeddings for new chunks"}
                
                new_embeddings_array = np.array(new_embeddings, dtype=np.float32)
                faiss.normalize_L2(new_embeddings_array)
            
            # Combine: unchanged embeddings + new embeddings
            if len(unchanged_embeddings) > 0 and new_embeddings_array is not None and len(new_embeddings_array) > 0:
                all_embeddings = np.vstack([unchanged_embeddings, new_embeddings_array])
            elif len(unchanged_embeddings) > 0:
                all_embeddings = unchanged_embeddings
            elif new_embeddings_array is not None and len(new_embeddings_array) > 0:
                all_embeddings = new_embeddings_array
            else:
                return {"success": False, "error": "No embeddings to save"}
            
            # Combine chunks: unchanged + new
            final_chunks = unchanged_chunks + new_chunks
            
            if not final_chunks:
                return {"success": False, "error": "No chunks remaining after update"}
            
            # Save updated embeddings
            np.save(str(index_path / "embeddings.npy"), all_embeddings)
            
            # Rebuild FAISS index with combined embeddings
            vector_dimensionality = all_embeddings.shape[1]
            faiss_index = faiss.IndexFlatIP(vector_dimensionality)
            faiss_index.add(all_embeddings)
            faiss.write_index(faiss_index, str(index_path / "faiss.index"))
            
            # Save updated chunks (without embeddings)
            with open(chunks_file, "w", encoding="utf-8") as f:
                for chunk in final_chunks:
                    # Remove embedding field if it exists
                    chunk_to_save = {k: v for k, v in chunk.items() if k != "embedding"}
                    f.write(json.dumps(chunk_to_save) + "\n")
            
            # Update metadata
            metadata_path = self.get_metadata_path(user_id, owner, repo)
            if metadata_path.exists():
                with open(metadata_path, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
            else:
                metadata = {}
            
            metadata.update({
                "user_id": user_id,
                "owner": owner,
                "repo": repo,
                "chunk_count": len(final_chunks),
                "file_count": len(set(c["meta"]["file"] for c in final_chunks))
            })
            
            with open(metadata_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
            
            return {
                "success": True,
                "chunk_count": len(final_chunks),
                "file_count": metadata["file_count"],
                "updated_files": len(files_to_remove) + len([f for f in changed_files if f.get("type") != "deleted"]),
                "reused_embeddings": len(unchanged_chunks),
                "new_embeddings": len(new_chunks)
            }
            
        except Exception as e:
            return {"success": False, "error": f"Failed to update index: {str(e)}"}
    
    def get_index_status(
        self,
        user_id: str,
        owner: str,
        repo: str
    ) -> Dict[str, Any]:
        """
        Check if index exists and get its status
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            
        Returns:
            Status dictionary with exists, chunk_count, file_count, last_updated
        """
        index_path = self.get_index_path(user_id, owner, repo)
        metadata_path = self.get_metadata_path(user_id, owner, repo)
        
        if not index_path.exists() or not (index_path / "faiss.index").exists():
            return {"exists": False}
        
        if metadata_path.exists():
            with open(metadata_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
                return {
                    "exists": True,
                    "chunk_count": metadata.get("chunk_count", 0),
                    "file_count": metadata.get("file_count", 0),
                    "last_updated": metadata.get("last_updated")
                }
        
        # Index exists but no metadata - try to count chunks
        chunks_file = index_path / "chunks.jsonl"
        chunk_count = 0
        if chunks_file.exists():
            with open(chunks_file, "r", encoding="utf-8") as f:
                chunk_count = sum(1 for line in f if line.strip())
        
        return {
            "exists": True,
            "chunk_count": chunk_count,
            "file_count": 0,
            "last_updated": None
        }
    
    def search_codebase(
        self,
        user_id: str,
        owner: str,
        repo: str,
        query: str,
        top_k: int = 8
    ) -> List[Dict[str, Any]]:
        """
        Semantic search in codebase index
        
        Args:
            user_id: User identifier
            owner: Repository owner
            repo: Repository name
            query: Search query
            top_k: Number of results to return
            
        Returns:
            List of relevant chunks with scores
        """
        from app.rag.retrieve import execute_semantic_search
        
        index_path = self.get_index_path(user_id, owner, repo)
        
        if not index_path.exists():
            return []
        
        try:
            return execute_semantic_search(
                user_query=query,
                index_directory_path=str(index_path),
                top_k_results=top_k
            )
        except Exception as e:
            print(f"Error searching codebase: {e}")
            return []


# Global codebase indexing service instance
codebase_indexing_service = CodebaseIndexingService()

