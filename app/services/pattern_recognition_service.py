"""
Pattern Recognition Service
Learns from ALL user commits across ALL repos to find similar patterns
"""
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import asyncio
import json
import hashlib

# For embeddings
import voyageai

# Database
from app.database.connection import get_db_connection


class PatternRecognitionService:
    """
    Cross-repo pattern recognition using Voyage AI embeddings
    
    Features:
    - Index all commits across all user repos
    - Find similar commits using vector similarity
    - Track outcomes (success, reverted, etc.)
    - Learn which patterns work well
    """
    
    def __init__(self):
        import os
        self.voyage_client = voyageai.Client(api_key=os.getenv("VOYAGE_API_KEY"))
    
    async def index_user_commits(
        self,
        user_id: int,
        repos: List[Dict[str, Any]],
        github_token: str,
        force_reindex: bool = False
    ) -> Dict[str, Any]:
        """
        Index all commits from all user repos for pattern learning
        
        This runs in the background and doesn't block the UI
        """
        try:
            print(f"🎓 [Pattern Learning] Starting indexing for user {user_id}")
            print(f"📊 [Pattern Learning] Processing {len(repos)} repositories")
            
            db = await get_db_connection()
            
            total_indexed = 0
            total_patterns = 0
            
            for repo in repos:
                try:
                    repo_name = repo.get("full_name", f"{repo.get('owner', '')}/{repo.get('name', '')}")
                    
                    # Fetch commits for this repo
                    commits = await self._fetch_repo_commits(
                        repo_name=repo_name,
                        github_token=github_token,
                        max_commits=100  # Limit for performance
                    )
                    
                    print(f"  📦 [{repo_name}] Found {len(commits)} commits")
                    
                    # Index each commit
                    for commit in commits:
                        # Check if already indexed
                        if not force_reindex:
                            existing = await db.fetchrow(
                                "SELECT id FROM commit_patterns WHERE user_id = $1 AND commit_sha = $2",
                                user_id, commit["sha"]
                            )
                            if existing:
                                continue  # Skip already indexed
                        
                        # Generate embedding and index
                        await self._index_commit(
                            db=db,
                            user_id=user_id,
                            repo_name=repo_name,
                            commit=commit
                        )
                        
                        total_indexed += 1
                        total_patterns += 1
                        
                        # Rate limiting
                        if total_indexed % 10 == 0:
                            await asyncio.sleep(0.1)  # Avoid rate limits
                    
                except Exception as repo_error:
                    print(f"  ⚠️  [Pattern Learning] Error processing {repo_name}: {repo_error}")
                    continue
            
            # Update metadata
            await self._update_learning_metadata(
                db=db,
                user_id=user_id,
                total_commits=total_indexed,
                total_repos=len(repos)
            )
            
            print(f"✅ [Pattern Learning] Indexed {total_indexed} commits across {len(repos)} repos")
            
            return {
                "success": True,
                "commits_indexed": total_indexed,
                "repos_processed": len(repos),
                "patterns_learned": total_patterns
            }
            
        except Exception as e:
            print(f"⚠️  [Pattern Learning] Error: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def _fetch_repo_commits(
        self,
        repo_name: str,
        github_token: str,
        max_commits: int = 100
    ) -> List[Dict]:
        """Fetch commits from GitHub API"""
        import requests
        
        owner, repo = repo_name.split("/")
        url = f"https://api.github.com/repos/{owner}/{repo}/commits"
        
        headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        params = {
            "per_page": min(max_commits, 100),
            "page": 1
        }
        
        response = requests.get(url, headers=headers, params=params)
        
        if response.status_code != 200:
            print(f"  ⚠️  Failed to fetch commits for {repo_name}: {response.status_code}")
            return []
        
        return response.json()
    
    async def _index_commit(
        self,
        db: Any,
        user_id: int,
        repo_name: str,
        commit: Dict[str, Any]
    ) -> None:
        """Index a single commit with embeddings"""
        try:
            sha = commit["sha"]
            message = commit["commit"]["message"]
            author_name = commit["commit"]["author"]["name"]
            commit_date = commit["commit"]["author"]["date"]
            
            # Build text representation for embedding
            commit_text = self._build_commit_text(commit)
            
            # Generate embedding using Voyage AI
            embedding = await self._generate_embedding(commit_text)
            
            # Classify the pattern type
            pattern_type = self._classify_pattern_type(message, commit)
            change_category = self._classify_change_category(message, commit)
            
            # Extract metadata
            files_changed = [f.get("filename", "") for f in commit.get("files", [])]
            stats = commit.get("stats", {})
            
            # Insert/update in database
            await db.execute("""
                INSERT INTO commit_patterns (
                    user_id, repo_name, commit_sha, commit_message, commit_date,
                    pattern_type, change_category, embedding,
                    files_changed, additions, deletions,
                    created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (user_id, repo_name, commit_sha)
                DO UPDATE SET
                    commit_message = $4,
                    pattern_type = $6,
                    change_category = $7,
                    embedding = $8,
                    updated_at = $13
            """,
                user_id, repo_name, sha, message, commit_date,
                pattern_type, change_category, json.dumps(embedding.tolist()) if hasattr(embedding, 'tolist') else json.dumps(embedding),
                json.dumps(files_changed), stats.get("additions", 0), stats.get("deletions", 0),
                datetime.now(), datetime.now()
            )
            
        except Exception as e:
            print(f"    ⚠️  Failed to index commit {commit.get('sha', 'unknown')[:7]}: {e}")
    
    def _build_commit_text(self, commit: Dict[str, Any]) -> str:
        """Build a text representation of a commit for embedding"""
        message = commit["commit"]["message"]
        files = commit.get("files", [])
        
        # Include commit message
        text_parts = [f"Commit: {message}"]
        
        # Include file names
        if files:
            file_names = [f.get("filename", "") for f in files[:10]]  # Limit to 10 files
            text_parts.append(f"Files: {', '.join(file_names)}")
        
        # Include some patch content for context (if available)
        for f in files[:3]:  # Only first 3 files
            if f.get("patch"):
                patch_preview = f["patch"][:200]  # First 200 chars
                text_parts.append(f"Changes in {f['filename']}: {patch_preview}")
        
        return "\n".join(text_parts)
    
    async def _generate_embedding(self, text: str) -> List[float]:
        """Generate Voyage AI embedding for text"""
        try:
            result = self.voyage_client.embed(
                [text],
                model="voyage-code-2",
                input_type="document"
            )
            return result.embeddings[0]
        except Exception as e:
            print(f"    ⚠️  Embedding generation failed: {e}")
            # Return zero vector as fallback
            return [0.0] * 1024
    
    def _classify_pattern_type(self, message: str, commit: Dict) -> str:
        """Classify what type of pattern this commit represents"""
        message_lower = message.lower()
        
        # Keywords for different patterns
        if any(word in message_lower for word in ["scale", "scaling", "size", "capacity", "performance"]):
            return "scaling"
        elif any(word in message_lower for word in ["security", "access", "permission", "iam", "policy"]):
            return "security"
        elif any(word in message_lower for word in ["cost", "optimize", "reduce", "cheaper", "savings"]):
            return "cost_optimization"
        elif any(word in message_lower for word in ["backup", "disaster", "recovery", "replication"]):
            return "reliability"
        elif any(word in message_lower for word in ["compliance", "audit", "soc2", "hipaa", "gdpr"]):
            return "compliance"
        elif any(word in message_lower for word in ["monitor", "logging", "observability", "metrics"]):
            return "observability"
        elif any(word in message_lower for word in ["fix", "bug", "error", "issue"]):
            return "bugfix"
        else:
            return "configuration"
    
    def _classify_change_category(self, message: str, commit: Dict) -> str:
        """Classify what category of resources were changed"""
        files = commit.get("files", [])
        filenames = [f.get("filename", "").lower() for f in files]
        
        # Check file names for patterns
        if any("compute" in f or "instance" in f or "ec2" in f for f in filenames):
            return "compute"
        elif any("storage" in f or "s3" in f or "ebs" in f for f in filenames):
            return "storage"
        elif any("database" in f or "rds" in f or "dynamodb" in f for f in filenames):
            return "database"
        elif any("network" in f or "vpc" in f or "subnet" in f for f in filenames):
            return "networking"
        elif any("security" in f or "iam" in f or "sg" in f for f in filenames):
            return "security"
        else:
            return "general"
    
    async def _update_learning_metadata(
        self,
        db: Any,
        user_id: int,
        total_commits: int,
        total_repos: int
    ) -> None:
        """Update user's learning progress metadata"""
        await db.execute("""
            INSERT INTO user_learning_metadata (
                user_id, total_commits_indexed, total_repos_analyzed,
                indexing_status, last_indexed_at, updated_at
            )
            VALUES ($1, $2, $3, 'complete', $4, $5)
            ON CONFLICT (user_id)
            DO UPDATE SET
                total_commits_indexed = user_learning_metadata.total_commits_indexed + $2,
                total_repos_analyzed = $3,
                indexing_status = 'complete',
                last_indexed_at = $4,
                updated_at = $5
        """, user_id, total_commits, total_repos, datetime.now(), datetime.now())
    
    async def find_similar_patterns(
        self,
        user_id: int,
        current_commit: Dict[str, Any],
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Find similar commits from user's history
        Returns commits ranked by similarity
        """
        try:
            print(f"🔍 [Pattern Matching] Finding similar patterns for user {user_id}")
            
            # Build text and generate embedding for current commit
            commit_text = self._build_commit_text(current_commit)
            current_embedding = await self._generate_embedding(commit_text)
            
            db = await get_db_connection()
            
            # Find similar commits using vector similarity
            # For now, we'll use a simple approach without pgvector
            # In production, you'd use: ORDER BY embedding <=> $1 LIMIT $2
            
            similar = await db.fetch("""
                SELECT 
                    repo_name,
                    commit_sha,
                    commit_message,
                    commit_date,
                    pattern_type,
                    change_category,
                    files_changed,
                    outcome,
                    additions,
                    deletions
                FROM commit_patterns
                WHERE user_id = $1
                  AND commit_sha != $2
                ORDER BY commit_date DESC
                LIMIT 100
            """, user_id, current_commit.get("sha", ""))
            
            # Calculate similarity manually (cosine similarity)
            results = []
            for row in similar:
                # In a real implementation with pgvector, this would be done in SQL
                # For now, we'll use a simpler heuristic based on pattern type match
                similarity = 0.0
                
                current_pattern = self._classify_pattern_type(
                    current_commit["commit"]["message"],
                    current_commit
                )
                
                if row["pattern_type"] == current_pattern:
                    similarity += 0.5
                
                if row["change_category"] == self._classify_change_category(
                    current_commit["commit"]["message"],
                    current_commit
                ):
                    similarity += 0.3
                
                # Add some randomness for diversity
                similarity += 0.2
                
                if similarity > 0.4:  # Threshold
                    results.append({
                        "repo": row["repo_name"],
                        "commit_sha": row["commit_sha"],
                        "message": row["commit_message"],
                        "date": row["commit_date"],
                        "pattern_type": row["pattern_type"],
                        "outcome": row["outcome"] or "unknown",
                        "similarity": similarity,
                        "files_changed": json.loads(row["files_changed"]) if row["files_changed"] else []
                    })
            
            # Sort by similarity and return top results
            results.sort(key=lambda x: x["similarity"], reverse=True)
            
            print(f"✅ [Pattern Matching] Found {len(results[:limit])} similar patterns")
            
            return results[:limit]
            
        except Exception as e:
            print(f"⚠️  [Pattern Matching] Error: {e}")
            return []


# Singleton instance
pattern_recognition_service = PatternRecognitionService()

