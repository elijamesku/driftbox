"""
Team Staging Service - Server-side staging area for team collaboration.
Accumulates changes from team members before PR creation.
Integrates with Terraform validation and auto-heal.
"""
from typing import Dict, List, Optional, Set
from datetime import datetime
from collections import defaultdict
import json


class TeamStagingManager:
    """
    Manages staging area for team PRs.
    Changes accumulate here before being pushed to GitHub.
    """
    
    def __init__(self):
        # Staged changes: {team_id: {user_id: {files, metadata}}}
        self.staged_changes: Dict[str, Dict[str, Dict]] = defaultdict(dict)
        
        # Staging metadata: {team_id: {created_at, last_updated, ...}}
        self.staging_metadata: Dict[str, Dict] = defaultdict(dict)
        
        # File change history: {team_id: [{user, file, action, timestamp}]}
        self.change_history: Dict[str, List[Dict]] = defaultdict(list)
    
    # ========== Staging Operations ==========
    
    def clear_user_staging(self, team_id: str, user_id: str) -> Dict:
        """
        Clear only a specific user's staged files (not the whole team's).
        Used when starting a fresh generation.
        """
        if user_id in self.staged_changes.get(team_id, {}):
            cleared_count = len(self.staged_changes[team_id][user_id].get('files', []))
            del self.staged_changes[team_id][user_id]
            
            # Update metadata
            if team_id in self.staging_metadata:
                self.staging_metadata[team_id]['contributors'].discard(user_id)
                self.staging_metadata[team_id]['last_updated'] = datetime.utcnow().isoformat()
            
            print(f"[Staging] Cleared {cleared_count} files for user {user_id}")
            return {'success': True, 'cleared_count': cleared_count}
        
        return {'success': True, 'cleared_count': 0, 'message': 'No files to clear'}
    
    def stage_user_changes(
        self,
        team_id: str,
        user_id: str,
        user_name: str,
        repo_full_name: str,
        files: List[Dict],  # [{path, content, lines_added, lines_removed}]
        metadata: Optional[Dict] = None,
        clear_existing: bool = False
    ) -> Dict:
        """
        Stage changes for a user.
        
        Args:
            team_id: Team ID
            user_id: User ID
            user_name: User name
            repo_full_name: Full repo name (owner/repo)
            files: List of file changes
            metadata: Additional metadata (ai_assisted, etc.)
            clear_existing: If True, clear user's existing staged files before staging new ones
        
        Returns:
            {success: bool, staged_count: int, total_staged: int}
        """
        # Clear existing files if requested (for fresh generations)
        if clear_existing:
            self.clear_user_staging(team_id, user_id)
        
        # Initialize staging metadata if first time
        if not self.staging_metadata[team_id]:
            self.staging_metadata[team_id] = {
                'created_at': datetime.utcnow().isoformat(),
                'repo': repo_full_name,
                'contributors': set()
            }
        
        # Merge with existing staged changes (don't replace, update/add files)
        existing = self.staged_changes[team_id].get(user_id, {})
        existing_files = {f['path']: f for f in existing.get('files', [])}
        
        print(f"[Staging] User {user_id} staging {len(files)} file(s)")
        print(f"[Staging] Existing staged files: {list(existing_files.keys())}")
        
        # Update existing files or add new ones
        for new_file in files:
            file_path = new_file['path']
            if file_path in existing_files:
                print(f"[Staging] Updating existing file: {file_path}")
            else:
                print(f"[Staging] Adding new file: {file_path}")
            existing_files[file_path] = new_file
        
        merged_files = list(existing_files.values())
        print(f"[Staging] Total merged files: {len(merged_files)}")
        
        # Store merged staged changes
        self.staged_changes[team_id][user_id] = {
            'user_id': user_id,
            'user_name': user_name,
            'files': merged_files,
            'repo': repo_full_name,
            'staged_at': datetime.utcnow().isoformat(),
            'lines_added': sum(f.get('lines_added', 0) for f in merged_files),
            'lines_removed': sum(f.get('lines_removed', 0) for f in merged_files),
            'metadata': {**(existing.get('metadata') or {}), **(metadata or {})}
        }
        
        # Add to contributors
        self.staging_metadata[team_id]['contributors'].add(user_id)
        self.staging_metadata[team_id]['last_updated'] = datetime.utcnow().isoformat()
        
        # Record change history
        for file in files:
            self.change_history[team_id].append({
                'user_id': user_id,
                'user_name': user_name,
                'file_path': file['path'],
                'action': 'staged',
                'timestamp': datetime.utcnow().isoformat()
            })
        
        return {
            'success': True,
            'staged_count': len(files),
            'total_staged': sum(len(u['files']) for u in self.staged_changes[team_id].values())
        }
    
    def unstage_user_changes(self, team_id: str, user_id: str) -> Dict:
        """Remove user's staged changes"""
        if user_id in self.staged_changes.get(team_id, {}):
            del self.staged_changes[team_id][user_id]
            
            # Update metadata
            if team_id in self.staging_metadata:
                self.staging_metadata[team_id]['contributors'].discard(user_id)
                self.staging_metadata[team_id]['last_updated'] = datetime.utcnow().isoformat()
            
            return {'success': True, 'message': 'Changes unstaged'}
        
        return {'success': False, 'error': 'No staged changes found'}
    
    def get_staged_changes(self, team_id: str) -> Dict:
        """Get all staged changes for a team"""
        staged = self.staged_changes.get(team_id, {})
        metadata = self.staging_metadata.get(team_id, {})
        
        # Convert set to list for JSON serialization
        if 'contributors' in metadata:
            metadata = {**metadata, 'contributors': list(metadata['contributors'])}
        
        return {
            'staged_changes': staged,
            'metadata': metadata,
            'total_files': sum(len(u['files']) for u in staged.values()),
            'total_contributors': len(staged),
            'total_lines_added': sum(u['lines_added'] for u in staged.values()),
            'total_lines_removed': sum(u['lines_removed'] for u in staged.values())
        }
    
    def get_user_staged_changes(self, team_id: str, user_id: str) -> Optional[Dict]:
        """Get staged changes for a specific user"""
        return self.staged_changes.get(team_id, {}).get(user_id)
    
    # ========== PR Creation ==========
    
    def get_all_staged_files(self, team_id: str) -> Dict[str, str]:
        """
        Get all staged files as a flat dict {file_path: content}.
        Used for Terraform validation and PR creation.
        """
        all_files = {}
        
        for user_id, user_data in self.staged_changes.get(team_id, {}).items():
            for file_info in user_data['files']:
                # Latest change wins (last user to edit)
                all_files[file_info['path']] = file_info['content']
        
        return all_files
    
    def get_pr_metadata(self, team_id: str) -> Dict:
        """
        Get metadata for PR creation (co-authors, stats, etc.)
        """
        staged = self.staged_changes.get(team_id, {})
        
        contributors = []
        for user_id, user_data in staged.items():
            contributors.append({
                'user_id': user_id,
                'user_name': user_data['user_name'],
                'files_count': len(user_data['files']),
                'lines_added': user_data['lines_added'],
                'lines_removed': user_data['lines_removed'],
                'ai_assisted': user_data.get('metadata', {}).get('ai_assisted', False)
            })
        
        return {
            'contributors': contributors,
            'total_files': sum(c['files_count'] for c in contributors),
            'total_lines_added': sum(c['lines_added'] for c in contributors),
            'total_lines_removed': sum(c['lines_removed'] for c in contributors),
            'repo': self.staging_metadata.get(team_id, {}).get('repo')
        }
    
    def clear_staging(self, team_id: str) -> Dict:
        """Clear staging area after PR creation"""
        if team_id in self.staged_changes:
            del self.staged_changes[team_id]
        
        if team_id in self.staging_metadata:
            del self.staging_metadata[team_id]
        
        # Keep last 100 history items
        if team_id in self.change_history:
            self.change_history[team_id] = self.change_history[team_id][-100:]
        
        return {'success': True, 'message': 'Staging area cleared'}
    
    # ========== Conflict Detection ==========
    
    def detect_file_conflicts(self, team_id: str) -> List[Dict]:
        """
        Detect if multiple users edited the same files.
        Returns list of conflicts.
        """
        file_editors: Dict[str, List[str]] = defaultdict(list)
        
        # Track who edited what
        for user_id, user_data in self.staged_changes.get(team_id, {}).items():
            for file_info in user_data['files']:
                file_editors[file_info['path']].append({
                    'user_id': user_id,
                    'user_name': user_data['user_name']
                })
        
        # Find conflicts (multiple editors)
        conflicts = []
        for file_path, editors in file_editors.items():
            if len(editors) > 1:
                conflicts.append({
                    'file': file_path,
                    'editors': editors,
                    'count': len(editors)
                })
        
        return conflicts
    
    # ========== Stats ==========
    
    def get_staging_stats(self, team_id: str) -> Dict:
        """Get staging area statistics"""
        staged = self.staged_changes.get(team_id, {})
        
        return {
            'team_id': team_id,
            'contributors_count': len(staged),
            'total_files': sum(len(u['files']) for u in staged.values()),
            'total_lines_added': sum(u['lines_added'] for u in staged.values()),
            'total_lines_removed': sum(u['lines_removed'] for u in staged.values()),
            'conflicts': len(self.detect_file_conflicts(team_id)),
            'created_at': self.staging_metadata.get(team_id, {}).get('created_at'),
            'last_updated': self.staging_metadata.get(team_id, {}).get('last_updated')
        }


# Global staging manager instance
staging_manager = TeamStagingManager()

