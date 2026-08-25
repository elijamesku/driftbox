"""
Workspace caching service for fast resource context retrieval.
Caches the results of workspace scanning to avoid re-reading all .tf files on every query.
"""
import time
from pathlib import Path
from typing import Dict, Set, Optional, Tuple
import re
from datetime import datetime, timedelta

class WorkspaceCacheService:
    def __init__(self, ttl_seconds: int = 300):  # 5 minute cache TTL
        self.cache: Dict[str, Dict] = {}  # {workspace_path: {data, timestamp, file_mtimes}}
        self.ttl_seconds = ttl_seconds
    
    def get_workspace_context(
        self, 
        workspace_path: str,
        force_refresh: bool = False
    ) -> Tuple[str, Dict[str, Dict]]:
        """
        Get workspace resources and file structure from cache or by scanning.
        
        Returns:
            - existing_resources_context (str): Formatted context string for AI
            - existing_file_structure (dict): File structure mapping
        """
        workspace = Path(workspace_path)
        if not workspace.exists():
            return "", {}
        
        cache_key = str(workspace.resolve())
        
        # Check if we have a valid cache entry
        if not force_refresh and cache_key in self.cache:
            cached_entry = self.cache[cache_key]
            
            # Check TTL
            age_seconds = time.time() - cached_entry['timestamp']
            if age_seconds < self.ttl_seconds:
                # Check if any .tf files have been modified
                current_mtimes = self._get_tf_file_mtimes(workspace)
                cached_mtimes = cached_entry.get('file_mtimes', {})
                
                if current_mtimes == cached_mtimes:
                    print(f"✅ [Cache] Workspace context cache HIT (age: {age_seconds:.1f}s)")
                    return cached_entry['context'], cached_entry['file_structure']
                else:
                    print(f"🔄 [Cache] Files modified, invalidating cache")
            else:
                print(f"⏰ [Cache] Cache expired (age: {age_seconds:.1f}s > {self.ttl_seconds}s)")
        
        # Cache miss or invalid - scan workspace
        print(f"🔍 [Cache] Scanning workspace: {workspace_path}")
        start_time = time.time()
        
        existing_resources_context, existing_file_structure = self._scan_workspace(workspace)
        
        scan_duration = time.time() - start_time
        print(f"✅ [Cache] Workspace scan completed in {scan_duration:.2f}s")
        
        # Update cache
        self.cache[cache_key] = {
            'context': existing_resources_context,
            'file_structure': existing_file_structure,
            'timestamp': time.time(),
            'file_mtimes': self._get_tf_file_mtimes(workspace)
        }
        
        return existing_resources_context, existing_file_structure
    
    def _get_tf_file_mtimes(self, workspace: Path) -> Dict[str, float]:
        """Get modification times for all .tf files in workspace."""
        mtimes = {}
        try:
            for tf_file in workspace.rglob('*.tf'):
                try:
                    relative_path = str(tf_file.relative_to(workspace))
                    mtimes[relative_path] = tf_file.stat().st_mtime
                except Exception:
                    continue
        except Exception:
            pass
        return mtimes
    
    def _scan_workspace(self, workspace: Path) -> Tuple[str, Dict[str, Dict]]:
        """
        Scan workspace for existing resources and file structure.
        This is the actual scanning logic extracted from chat.py.
        """
        existing_resources_context = ""
        existing_file_structure = {}
        
        try:
            tf_files = list(workspace.rglob('*.tf'))
            existing_resources = set()
            
            # Build comprehensive file structure map
            for tf_file in tf_files:
                try:
                    relative_path = str(tf_file.relative_to(workspace))
                    content = tf_file.read_text()
                    
                    # Extract resource declarations: resource "type" "name"
                    matches = re.findall(r'resource\s+"([^"]+)"\s+"([^"]+)"', content)
                    resources_in_file = []
                    for res_type, res_name in matches:
                        existing_resources.add(f"{res_type}.{res_name}")
                        resources_in_file.append(f"{res_type}.{res_name}")
                    
                    # Store file structure info
                    if resources_in_file:  # Only track files with resources
                        existing_file_structure[relative_path] = {
                            "resources": resources_in_file,
                            "size": len(content),
                            "lines": content.count('\n') + 1
                        }
                except Exception as file_error:
                    print(f"⚠️  [Context] Error reading {tf_file}: {file_error}")
                    continue
            
            # Build enhanced context for AI
            if existing_resources:
                existing_resources_context = f"\n\n**EXISTING RESOURCES:**\n{', '.join(sorted(existing_resources))}\n\n**CRITICAL - AVOID DUPLICATES:**\n- Reference existing resources with ${{resource_type.resource_name.id}}\n- If creating multiple resources of same type, use UNIQUE names (e.g., main, main_2, main_3)\n- NEVER create two resources with identical type + name combination\n- Check existing resources list BEFORE generating new ones"
            
            # Add file structure context for intelligent file placement
            if existing_file_structure:
                existing_resources_context += "\n\n**EXISTING FILE STRUCTURE:**\n"
                for file_path, info in sorted(existing_file_structure.items()):
                    resource_preview = ', '.join(info['resources'][:3])
                    if len(info['resources']) > 3:
                        resource_preview += f", +{len(info['resources']) - 3} more"
                    existing_resources_context += f"- {file_path}: {len(info['resources'])} resources ({resource_preview})\n"
                
                # Add intelligent file placement instructions
                existing_resources_context += "\n**FILE PLACEMENT RULES:**\n"
                existing_resources_context += "- Add RELATED resources to EXISTING files (e.g., new subnet → existing vpc.tf)\n"
                existing_resources_context += "- Create NEW files only for NEW logical groupings\n"
                existing_resources_context += "- Use existing folder patterns if present\n"
                existing_resources_context += "- Keep driftbox/docs/ for auto-generated dependency docs ONLY\n"
        
        except Exception as e:
            print(f"⚠️  [Context] Failed to scan workspace: {e}")
        
        return existing_resources_context, existing_file_structure
    
    def invalidate(self, workspace_path: str):
        """Manually invalidate cache for a workspace."""
        workspace = Path(workspace_path)
        cache_key = str(workspace.resolve())
        if cache_key in self.cache:
            del self.cache[cache_key]
            print(f"🗑️  [Cache] Invalidated cache for {workspace_path}")
    
    def clear_all(self):
        """Clear entire cache."""
        self.cache.clear()
        print("🗑️  [Cache] Cleared all workspace caches")


# Global singleton instance
workspace_cache_service = WorkspaceCacheService(ttl_seconds=300)  # 5 minute cache

