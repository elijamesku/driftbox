"""
Real-time team collaboration service.
Enables Figma-style live collaboration for infrastructure editing.
"""
from typing import Dict, Set, Optional, Any
from datetime import datetime
import asyncio
import json
from collections import defaultdict


class TeamCollaborationManager:
    """
    Manages real-time collaboration for teams.
    Tracks presence, file locks, dependencies, and broadcasts changes.
    """
    
    def __init__(self):
        # Team rooms: {team_id: {user_id: websocket}}
        self.team_connections: Dict[str, Dict[str, Any]] = defaultdict(dict)
        
        # User presence: {team_id: {user_id: {name, email, avatar, pr_intent, last_seen}}}
        self.team_presence: Dict[str, Dict[str, Dict]] = defaultdict(dict)
        
        # PR intent: {team_id: {user_id: 'work-in-progress' | 'ready-for-pr'}}
        self.pr_intents: Dict[str, Dict[str, str]] = defaultdict(dict)
        
        # File activity: {team_id: {file_path: {user_id, started_at, last_activity}}}
        self.file_activity: Dict[str, Dict[str, Dict]] = defaultdict(dict)
        
        # Recent changes: {team_id: [{user, file, action, timestamp}]}
        self.recent_changes: Dict[str, list] = defaultdict(list)
        
        # Cursor positions: {team_id: {user_id: {file, line, column}}}
        self.cursor_positions: Dict[str, Dict[str, Dict]] = defaultdict(dict)
        
        # Chat messages: {team_id: [{user_id, user_name, message, timestamp}]}
        self.chat_messages: Dict[str, list] = defaultdict(list)
        
        # Typing indicators: {team_id: {user_id: timestamp}}
        self.typing_users: Dict[str, Dict[str, str]] = defaultdict(dict)
        
        # ========== NEW: Hard File Locks ==========
        # File locks: {team_id: {file_key: {user_id, user_name, locked_at, lock_type}}}
        # lock_type: 'exclusive' (no one else can edit) or 'soft' (warning only)
        self.file_locks: Dict[str, Dict[str, Dict]] = defaultdict(dict)
        
        # Lock requests: {team_id: {file_key: [{user_id, user_name, requested_at}]}}
        self.lock_requests: Dict[str, Dict[str, list]] = defaultdict(lambda: defaultdict(list))
        
        # ========== NEW: Activity Status ==========
        # User activity status: {team_id: {user_id: 'idle' | 'editing' | 'generating' | 'creating_pr'}}
        self.activity_status: Dict[str, Dict[str, str]] = defaultdict(dict)
        
        # PR-locked files: {team_id: {user_id: [file_paths]}}
        self.pr_locked_files: Dict[str, Dict[str, list]] = defaultdict(dict)
        
        # ========== NEW: Dependency Graph ==========
        # Resource dependencies: {team_id: {repo: {resource_address: [dependent_addresses]}}}
        self.resource_dependencies: Dict[str, Dict[str, Dict[str, list]]] = defaultdict(lambda: defaultdict(dict))
        
        # Resource to file mapping: {team_id: {repo: {resource_address: file_path}}}
        self.resource_files: Dict[str, Dict[str, Dict[str, str]]] = defaultdict(lambda: defaultdict(dict))
    
    # ========== Connection Management ==========
    
    async def connect_user(
        self, 
        team_id: str, 
        user_id: str, 
        websocket: Any,
        user_info: Dict
    ):
        """User connects to team collaboration room"""
        # Store connection
        self.team_connections[team_id][user_id] = websocket
        
        # Update presence
        self.team_presence[team_id][user_id] = {
            'user_id': user_id,
            'name': user_info.get('name', user_info.get('email')),
            'email': user_info.get('email'),
            'avatar': user_info.get('avatar'),
            'status': 'online',
            'connected_at': datetime.utcnow().isoformat(),
            'last_seen': datetime.utcnow().isoformat()
        }
        
        # Notify team of new user
        await self.broadcast_to_team(team_id, {
            'type': 'user_joined',
            'user_id': user_id,
            'user': self.team_presence[team_id][user_id],
            'timestamp': datetime.utcnow().isoformat()
        }, exclude_user=user_id)
        
        # Send current state to new user (including chat history)
        await self.send_to_user(team_id, user_id, {
            'type': 'initial_state',
            'online_users': list(self.team_presence[team_id].values()),
            'file_activity': self.file_activity[team_id],
            'recent_changes': self.recent_changes[team_id][-20:],  # Last 20 changes
            'cursor_positions': self.cursor_positions[team_id],
            'chat_messages': self.chat_messages[team_id][-100:],  # Last 100 messages
            'typing_users': list(self.typing_users.get(team_id, {}).values())
        })
    
    async def disconnect_user(self, team_id: str, user_id: str):
        """User disconnects from team room"""
        # Remove connection
        if user_id in self.team_connections.get(team_id, {}):
            del self.team_connections[team_id][user_id]
        
        # Completely remove presence (not just mark offline) so reconnect gets fresh state
        if user_id in self.team_presence.get(team_id, {}):
            del self.team_presence[team_id][user_id]
        
        # Clear file activity
        files_to_clear = []
        for file_path, activity in self.file_activity.get(team_id, {}).items():
            if activity.get('user_id') == user_id:
                files_to_clear.append(file_path)
        
        for file_path in files_to_clear:
            del self.file_activity[team_id][file_path]
        
        # Clear cursor position
        if user_id in self.cursor_positions.get(team_id, {}):
            del self.cursor_positions[team_id][user_id]
        
        # Notify team
        await self.broadcast_to_team(team_id, {
            'type': 'user_left',
            'user_id': user_id,
            'timestamp': datetime.utcnow().isoformat()
        })
    
    async def update_last_seen(self, team_id: str, user_id: str):
        """Update user's last_seen timestamp (called on heartbeat)"""
        if user_id in self.team_presence.get(team_id, {}):
            self.team_presence[team_id][user_id]['last_seen'] = datetime.utcnow().isoformat()
    
    # ========== File Activity Tracking ==========
    
    async def start_editing_file(
        self,
        team_id: str,
        user_id: str,
        repo_full_name: str,
        file_path: str,
        user_info: Dict
    ):
        """User starts editing a file"""
        file_key = f"{repo_full_name}:{file_path}"
        
        # Check if someone else is editing
        existing_editor = self.file_activity.get(team_id, {}).get(file_key)
        conflict_warning = None
        
        if existing_editor and existing_editor['user_id'] != user_id:
            conflict_warning = {
                'type': 'warning',
                'message': f"{existing_editor['user_name']} is also editing this file!",
                'user': existing_editor
            }
        
        # Record activity
        self.file_activity[team_id][file_key] = {
            'user_id': user_id,
            'user_name': user_info.get('name', user_info.get('email')),
            'repo': repo_full_name,
            'file_path': file_path,
            'started_at': datetime.utcnow().isoformat(),
            'last_activity': datetime.utcnow().isoformat()
        }
        
        # Broadcast to team
        await self.broadcast_to_team(team_id, {
            'type': 'file_editing_started',
            'user_id': user_id,
            'user_name': user_info.get('name'),
            'repo': repo_full_name,
            'file_path': file_path,
            'timestamp': datetime.utcnow().isoformat()
        }, exclude_user=user_id)
        
        return conflict_warning
    
    async def stop_editing_file(
        self,
        team_id: str,
        user_id: str,
        repo_full_name: str,
        file_path: str
    ):
        """User stops editing a file"""
        file_key = f"{repo_full_name}:{file_path}"
        
        if file_key in self.file_activity.get(team_id, {}):
            if self.file_activity[team_id][file_key]['user_id'] == user_id:
                del self.file_activity[team_id][file_key]
                
                # Broadcast to team
                await self.broadcast_to_team(team_id, {
                    'type': 'file_editing_stopped',
                    'user_id': user_id,
                    'repo': repo_full_name,
                    'file_path': file_path,
                    'timestamp': datetime.utcnow().isoformat()
                })
    
    # ========== Live Changes ==========
    
    async def broadcast_file_change(
        self,
        team_id: str,
        user_id: str,
        repo_full_name: str,
        file_path: str,
        change_data: Dict,
        user_info: Dict
    ):
        """Broadcast file change to all team members in real-time"""
        # Record change
        change_record = {
            'user_id': user_id,
            'user_name': user_info.get('name', user_info.get('email')),
            'repo': repo_full_name,
            'file_path': file_path,
            'action': change_data.get('action', 'modified'),
            'lines_changed': change_data.get('lines_changed'),
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Keep last 100 changes
        self.recent_changes[team_id].append(change_record)
        if len(self.recent_changes[team_id]) > 100:
            self.recent_changes[team_id] = self.recent_changes[team_id][-100:]
        
        # Update file activity timestamp
        file_key = f"{repo_full_name}:{file_path}"
        if file_key in self.file_activity.get(team_id, {}):
            self.file_activity[team_id][file_key]['last_activity'] = datetime.utcnow().isoformat()
        
        # Broadcast to team
        await self.broadcast_to_team(team_id, {
            'type': 'file_changed',
            'user_id': user_id,
            'user_name': user_info.get('name'),
            'repo': repo_full_name,
            'file_path': file_path,
            'change': change_data,
            'timestamp': datetime.utcnow().isoformat()
        }, exclude_user=user_id)
    
    # ========== Cursor Tracking ==========
    
    async def update_cursor_position(
        self,
        team_id: str,
        user_id: str,
        file_path: str,
        line: int,
        column: int,
        repo: str = None,
        user_info: Dict = None
    ):
        """Update and broadcast cursor position"""
        user_info = user_info or {}
        self.cursor_positions[team_id][user_id] = {
            'file_path': file_path,
            'line': line,
            'column': column,
            'repo': repo,
            'user_name': user_info.get('name'),
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Broadcast to team (throttled on client side)
        await self.broadcast_to_team(team_id, {
            'type': 'cursor_moved',
            'user_id': user_id,
            'user_name': user_info.get('name'),
            'file_path': file_path,
            'line': line,
            'column': column,
            'repo': repo
        }, exclude_user=user_id)
    
    async def broadcast_text_change(
        self,
        team_id: str,
        user_id: str,
        repo: str,
        file_path: str,
        full_content: str,
        user_info: Dict
    ):
        """Broadcast full file content to team members for real-time sync"""
        await self.broadcast_to_team(team_id, {
            'type': 'text_changed',
            'user_id': user_id,
            'user_name': user_info.get('name'),
            'repo': repo,
            'file_path': file_path,
            'full_content': full_content
        }, exclude_user=user_id)
    
    async def broadcast_files_updated(
        self,
        team_id: str,
        user_id: str,
        repo: str,
        files: list,  # Array of { path, content, action }
        user_info: Dict
    ):
        """Broadcast that files were created/updated WITH CONTENT so teammates can write locally"""
        file_paths = [f.get('path') for f in files]
        print(f"📢 [Collab] Broadcasting files_updated to team {team_id}: {file_paths}")
        await self.broadcast_to_team(team_id, {
            'type': 'files_updated',
            'user_id': user_id,
            'user_name': user_info.get('name'),
            'repo': repo,
            'files': files,  # Send full file content so teammates can write locally
            'timestamp': datetime.utcnow().isoformat()
        }, exclude_user=user_id)
        print(f"📢 [Collab] files_updated broadcast sent")
    
    async def broadcast_files_discarded(
        self,
        team_id: str,
        user_id: str,
        repo: str,
        files: list,  # Array of { path, action }
        user_info: Dict
    ):
        """Broadcast that files were discarded - teammates should delete new files and revert existing"""
        file_paths = [f.get('path') for f in files]
        print(f"🗑️ [Collab] Broadcasting files_discarded to team {team_id}: {file_paths}")
        await self.broadcast_to_team(team_id, {
            'type': 'files_discarded',
            'user_id': user_id,
            'user_name': user_info.get('name'),
            'repo': repo,
            'files': files,
            'timestamp': datetime.utcnow().isoformat()
        }, exclude_user=user_id)
        print(f"🗑️ [Collab] files_discarded broadcast sent")
    
    # ========== Messaging ==========
    
    async def send_to_user(self, team_id: str, user_id: str, message: Dict):
        """Send message to specific user"""
        websocket = self.team_connections.get(team_id, {}).get(user_id)
        if websocket:
            try:
                await websocket.send_json(message)
            except Exception as e:
                print(f"Failed to send to user {user_id}: {e}")
                # Connection dead, clean up
                await self.disconnect_user(team_id, user_id)
    
    async def broadcast_to_team(
        self,
        team_id: str,
        message: Dict,
        exclude_user: Optional[str] = None
    ):
        """Broadcast message to all team members"""
        connections = self.team_connections.get(team_id, {})
        
        for user_id, websocket in list(connections.items()):
            if exclude_user and user_id == exclude_user:
                continue
            
            try:
                await websocket.send_json(message)
            except Exception as e:
                print(f"Failed to broadcast to user {user_id}: {e}")
                # Connection dead, clean up
                await self.disconnect_user(team_id, user_id)
    
    # ========== PR Intent Management ==========
    
    async def update_pr_intent(
        self,
        team_id: str,
        user_id: str,
        pr_intent: str,
        user_info: Dict
    ):
        """Update user's PR intent (work-in-progress or ready-for-pr)"""
        # Store intent
        self.pr_intents[team_id][user_id] = pr_intent
        
        # Update presence with intent
        if user_id in self.team_presence.get(team_id, {}):
            self.team_presence[team_id][user_id]['pr_intent'] = pr_intent
        
        # Broadcast to team
        await self.broadcast_to_team(team_id, {
            'type': 'pr_intent_changed',
            'user_id': user_id,
            'user_name': user_info.get('name'),
            'pr_intent': pr_intent,
            'timestamp': datetime.utcnow().isoformat()
        })
    
    async def create_team_pr(
        self,
        team_id: str,
        user_id: str,
        contributors: list,
        title: str,
        description: str,
        user_info: Dict
    ):
        """Create a team PR with multiple contributors"""
        # Broadcast PR creation event to team
        await self.broadcast_to_team(team_id, {
            'type': 'team_pr_created',
            'created_by': user_id,
            'creator_name': user_info.get('name'),
            'contributors': contributors,
            'title': title,
            'description': description,
            'timestamp': datetime.utcnow().isoformat()
        })
        
        # Reset PR intents for included contributors
        for contributor_id in contributors:
            self.pr_intents[team_id][contributor_id] = 'work-in-progress'
            if contributor_id in self.team_presence.get(team_id, {}):
                self.team_presence[team_id][contributor_id]['pr_intent'] = 'work-in-progress'
    
    # ========== Team Chat ==========
    
    async def send_chat_message(
        self,
        team_id: str,
        user_id: str,
        user_name: str,
        message: str,
        repo_full_name: Optional[str] = None,
        code_ref: Optional[dict] = None
    ):
        """Send a chat message to the team"""
        chat_message = {
            'id': f"{team_id}_{user_id}_{datetime.utcnow().timestamp()}",
            'user_id': user_id,
            'user_name': user_name,
            'message': message,
            'repo': repo_full_name,
            'timestamp': datetime.utcnow().isoformat(),
            'code_ref': code_ref
        }
        
        # Store message (keep last 100)
        self.chat_messages[team_id].append(chat_message)
        if len(self.chat_messages[team_id]) > 100:
            self.chat_messages[team_id] = self.chat_messages[team_id][-100:]
        
        # Clear typing indicator
        if user_id in self.typing_users.get(team_id, {}):
            del self.typing_users[team_id][user_id]
        
        # Broadcast to team
        await self.broadcast_to_team(team_id, {
            'type': 'chat_message',
            'message': chat_message
        })
    
    async def set_typing(self, team_id: str, user_id: str, user_name: str, is_typing: bool):
        """Set typing indicator for user"""
        if is_typing:
            self.typing_users[team_id][user_id] = {
                'user_name': user_name,
                'timestamp': datetime.utcnow().isoformat()
            }
        elif user_id in self.typing_users.get(team_id, {}):
            del self.typing_users[team_id][user_id]
        
        # Broadcast typing status
        await self.broadcast_to_team(team_id, {
            'type': 'typing_indicator',
            'user_id': user_id,
            'user_name': user_name,
            'is_typing': is_typing
        }, exclude_user=user_id)
    
    # ========== Activity Status ==========
    
    async def broadcast_activity_status(self, team_id: str, user_id: str, user_name: str, activity_status: str):
        """Broadcast user's activity status change to team"""
        self.activity_status[team_id][user_id] = activity_status
        
        await self.broadcast_to_team(team_id, {
            'type': 'activity_status_changed',
            'user_id': user_id,
            'user_name': user_name,
            'activity_status': activity_status
        })
    
    async def lock_files_for_pr(self, team_id: str, user_id: str, user_name: str, files: list):
        """Lock files when a user starts creating a PR"""
        # Store the locked files
        self.pr_locked_files[team_id][user_id] = files
        self.activity_status[team_id][user_id] = 'creating_pr'
        
        # Broadcast to team so they know files are locked
        await self.broadcast_to_team(team_id, {
            'type': 'files_locked_for_pr',
            'user_id': user_id,
            'user_name': user_name,
            'files': files
        })
    
    async def unlock_files_from_pr(self, team_id: str, user_id: str, user_name: str):
        """Unlock files after PR is complete"""
        # Clear locked files
        if user_id in self.pr_locked_files.get(team_id, {}):
            del self.pr_locked_files[team_id][user_id]
        self.activity_status[team_id][user_id] = 'idle'
        
        # Broadcast to team
        await self.broadcast_to_team(team_id, {
            'type': 'files_unlocked_from_pr',
            'user_id': user_id,
            'user_name': user_name
        })
    
    def get_pr_locked_files(self, team_id: str) -> dict:
        """Get all files locked for PR by any user"""
        return self.pr_locked_files.get(team_id, {})
    
    def is_file_locked_for_pr(self, team_id: str, file_path: str, exclude_user: str = None) -> Optional[dict]:
        """Check if a file is locked by someone creating a PR"""
        for uid, files in self.pr_locked_files.get(team_id, {}).items():
            if exclude_user and uid == exclude_user:
                continue
            if file_path in files:
                presence = self.team_presence.get(team_id, {}).get(uid, {})
                return {
                    'locked_by': uid,
                    'locked_by_name': presence.get('name', uid),
                    'reason': 'creating_pr'
                }
        return None
    
    def get_chat_history(self, team_id: str, limit: int = 50) -> list:
        """Get recent chat messages for team"""
        return self.chat_messages.get(team_id, [])[-limit:]
    
    def get_typing_users(self, team_id: str) -> list:
        """Get users currently typing"""
        return [
            {'user_id': uid, **info} 
            for uid, info in self.typing_users.get(team_id, {}).items()
        ]
    
    # ========== State Queries ==========
    
    def get_online_users(self, team_id: str) -> list:
        """Get list of online team members"""
        users = [
            user for user in self.team_presence.get(team_id, {}).values()
            if user.get('status') == 'online'
        ]
        # Add PR intent to each user
        for user in users:
            user['pr_intent'] = self.pr_intents.get(team_id, {}).get(user['user_id'], 'work-in-progress')
        return users
    
    def get_file_editors(self, team_id: str, repo_full_name: str, file_path: str) -> list:
        """Get users currently editing a specific file"""
        file_key = f"{repo_full_name}:{file_path}"
        activity = self.file_activity.get(team_id, {}).get(file_key)
        
        if activity:
            return [{
                'user_id': activity['user_id'],
                'user_name': activity['user_name'],
                'started_at': activity['started_at']
            }]
        return []
    
    def get_team_activity(self, team_id: str) -> Dict:
        """Get current team activity snapshot"""
        return {
            'online_users': self.get_online_users(team_id),
            'file_activity': dict(self.file_activity.get(team_id, {})),
            'recent_changes': self.recent_changes.get(team_id, [])[-20:],
            'cursor_positions': dict(self.cursor_positions.get(team_id, {})),
            'file_locks': dict(self.file_locks.get(team_id, {}))
        }
    
    # ========== Hard File Locks ==========
    
    async def acquire_lock(
        self,
        team_id: str,
        user_id: str,
        user_name: str,
        repo_full_name: str,
        file_path: str,
        lock_type: str = 'exclusive'  # 'exclusive' or 'soft'
    ) -> Dict:
        """
        Attempt to acquire a lock on a file.
        Returns success/failure and lock info.
        """
        file_key = f"{repo_full_name}:{file_path}"
        
        # Check if file is already locked by someone else
        existing_lock = self.file_locks.get(team_id, {}).get(file_key)
        
        if existing_lock and existing_lock['user_id'] != user_id:
            # File is locked by someone else
            if existing_lock['lock_type'] == 'exclusive':
                return {
                    'success': False,
                    'reason': 'locked',
                    'locked_by': existing_lock['user_name'],
                    'locked_at': existing_lock['locked_at'],
                    'lock_type': existing_lock['lock_type']
                }
        
        # Grant the lock
        self.file_locks[team_id][file_key] = {
            'user_id': user_id,
            'user_name': user_name,
            'repo': repo_full_name,
            'file_path': file_path,
            'locked_at': datetime.utcnow().isoformat(),
            'lock_type': lock_type
        }
        
        # Broadcast lock acquisition to team
        await self.broadcast_to_team(team_id, {
            'type': 'file_locked',
            'file_key': file_key,
            'user_id': user_id,
            'user_name': user_name,
            'repo': repo_full_name,
            'file_path': file_path,
            'lock_type': lock_type,
            'timestamp': datetime.utcnow().isoformat()
        }, exclude_user=user_id)
        
        return {
            'success': True,
            'lock': self.file_locks[team_id][file_key]
        }
    
    async def release_lock(
        self,
        team_id: str,
        user_id: str,
        repo_full_name: str,
        file_path: str
    ) -> Dict:
        """Release a file lock"""
        file_key = f"{repo_full_name}:{file_path}"
        
        existing_lock = self.file_locks.get(team_id, {}).get(file_key)
        
        if not existing_lock:
            return {'success': True, 'message': 'No lock to release'}
        
        # Only the lock holder can release (or force release by admin)
        if existing_lock['user_id'] != user_id:
            return {
                'success': False,
                'reason': 'not_owner',
                'message': f"Lock is held by {existing_lock['user_name']}"
            }
        
        # Release the lock
        del self.file_locks[team_id][file_key]
        
        # Check if anyone was waiting for this lock
        pending_requests = self.lock_requests.get(team_id, {}).get(file_key, [])
        
        # Broadcast lock release to team
        await self.broadcast_to_team(team_id, {
            'type': 'file_unlocked',
            'file_key': file_key,
            'user_id': user_id,
            'repo': repo_full_name,
            'file_path': file_path,
            'pending_requests': len(pending_requests),
            'timestamp': datetime.utcnow().isoformat()
        })
        
        # Notify first requester that lock is available
        if pending_requests:
            first_requester = pending_requests[0]
            await self.send_to_user(team_id, first_requester['user_id'], {
                'type': 'lock_available',
                'file_key': file_key,
                'repo': repo_full_name,
                'file_path': file_path,
                'message': f"Lock on {file_path} is now available!"
            })
        
        return {'success': True, 'message': 'Lock released'}
    
    async def request_lock(
        self,
        team_id: str,
        user_id: str,
        user_name: str,
        repo_full_name: str,
        file_path: str
    ) -> Dict:
        """Request a lock that's held by someone else"""
        file_key = f"{repo_full_name}:{file_path}"
        
        existing_lock = self.file_locks.get(team_id, {}).get(file_key)
        
        if not existing_lock:
            # No lock exists, they can just acquire it
            return await self.acquire_lock(team_id, user_id, user_name, repo_full_name, file_path)
        
        if existing_lock['user_id'] == user_id:
            return {'success': True, 'message': 'You already have the lock'}
        
        # Add to request queue
        request = {
            'user_id': user_id,
            'user_name': user_name,
            'requested_at': datetime.utcnow().isoformat()
        }
        
        # Check if already in queue
        existing_requests = self.lock_requests[team_id][file_key]
        if not any(r['user_id'] == user_id for r in existing_requests):
            self.lock_requests[team_id][file_key].append(request)
        
        # Notify the lock holder
        await self.send_to_user(team_id, existing_lock['user_id'], {
            'type': 'lock_requested',
            'file_key': file_key,
            'repo': repo_full_name,
            'file_path': file_path,
            'requester_id': user_id,
            'requester_name': user_name,
            'message': f"{user_name} is waiting to edit {file_path}"
        })
        
        return {
            'success': True,
            'queued': True,
            'position': len(self.lock_requests[team_id][file_key]),
            'message': f"Request sent to {existing_lock['user_name']}"
        }
    
    def get_file_lock(self, team_id: str, repo_full_name: str, file_path: str) -> Optional[Dict]:
        """Get current lock status for a file"""
        file_key = f"{repo_full_name}:{file_path}"
        return self.file_locks.get(team_id, {}).get(file_key)
    
    def get_all_locks(self, team_id: str) -> Dict:
        """Get all file locks for a team"""
        return dict(self.file_locks.get(team_id, {}))
    
    # ========== Dependency Tracking ==========
    
    async def update_dependency_graph(
        self,
        team_id: str,
        repo_full_name: str,
        resources: list,  # [{address, type, name, file, references}]
    ):
        """
        Update the dependency graph for a repository.
        Called when files are indexed or changed.
        """
        import re
        
        # Build dependency maps
        dependencies = {}  # resource -> [resources it depends on]
        dependents = {}    # resource -> [resources that depend on it]
        resource_files = {}  # resource -> file
        
        for resource in resources:
            address = resource.get('address', f"{resource.get('type')}.{resource.get('name')}")
            resource_files[address] = resource.get('file', '')
            dependencies[address] = []
            
            if address not in dependents:
                dependents[address] = []
            
            # Parse references from resource content/attributes
            refs = resource.get('references', [])
            if not refs and 'content' in resource:
                # Extract ${resource.name.attr} patterns
                content = str(resource.get('content', ''))
                ref_pattern = r'\$\{([a-z_]+\.[a-z0-9_]+)'
                refs = re.findall(ref_pattern, content, re.IGNORECASE)
            
            for ref in refs:
                if '.' in ref:
                    dependencies[address].append(ref)
                    if ref not in dependents:
                        dependents[ref] = []
                    dependents[ref].append(address)
        
        # Store in manager
        self.resource_dependencies[team_id][repo_full_name] = dependents
        self.resource_files[team_id][repo_full_name] = resource_files
        
        return {
            'resources_count': len(resources),
            'dependencies_mapped': len(dependencies)
        }
    
    async def notify_dependents(
        self,
        team_id: str,
        user_id: str,
        user_name: str,
        repo_full_name: str,
        changed_resource: str,  # e.g., "aws_vpc.main"
        change_type: str = 'modified'  # 'modified', 'deleted', 'created'
    ):
        """
        Notify team members about changes to a resource's dependencies.
        """
        # Get dependents of the changed resource
        dependents = self.resource_dependencies.get(team_id, {}).get(repo_full_name, {}).get(changed_resource, [])
        
        if not dependents:
            return {'notified': 0, 'dependents': []}
        
        # Get files containing dependent resources
        resource_files = self.resource_files.get(team_id, {}).get(repo_full_name, {})
        affected_files = set()
        affected_resources = []
        
        for dep in dependents:
            file_path = resource_files.get(dep)
            if file_path:
                affected_files.add(file_path)
                affected_resources.append({
                    'resource': dep,
                    'file': file_path
                })
        
        # Find who is editing affected files
        editors_to_notify = set()
        for file_key, activity in self.file_activity.get(team_id, {}).items():
            if any(f in file_key for f in affected_files):
                if activity['user_id'] != user_id:
                    editors_to_notify.add(activity['user_id'])
        
        # Send dependency notification
        notification = {
            'type': 'dependency_changed',
            'changed_resource': changed_resource,
            'change_type': change_type,
            'changed_by': user_name,
            'changed_by_id': user_id,
            'affected_resources': affected_resources,
            'affected_files': list(affected_files),
            'message': f"⚠️ {user_name} {change_type} {changed_resource} - this affects {len(dependents)} dependent resources",
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Notify specific editors
        for editor_id in editors_to_notify:
            await self.send_to_user(team_id, editor_id, notification)
        
        # Also broadcast general notification to team
        await self.broadcast_to_team(team_id, notification, exclude_user=user_id)
        
        return {
            'notified': len(editors_to_notify),
            'dependents': affected_resources
        }
    
    def get_resource_dependents(
        self,
        team_id: str,
        repo_full_name: str,
        resource_address: str
    ) -> list:
        """Get list of resources that depend on a given resource"""
        return self.resource_dependencies.get(team_id, {}).get(repo_full_name, {}).get(resource_address, [])
    
    def get_resource_dependencies(
        self,
        team_id: str,
        repo_full_name: str,
        resource_address: str
    ) -> list:
        """Get list of resources that a given resource depends on"""
        # Need to invert the dependents map
        dependents_map = self.resource_dependencies.get(team_id, {}).get(repo_full_name, {})
        dependencies = []
        
        for resource, deps in dependents_map.items():
            if resource_address in deps:
                dependencies.append(resource)
        
        return dependencies
    
    def get_dependency_graph(self, team_id: str, repo_full_name: str) -> Dict:
        """Get full dependency graph for visualization"""
        dependents = self.resource_dependencies.get(team_id, {}).get(repo_full_name, {})
        resource_files = self.resource_files.get(team_id, {}).get(repo_full_name, {})
        
        # Build nodes and edges for visualization
        nodes = []
        edges = []
        
        for resource, deps in dependents.items():
            nodes.append({
                'id': resource,
                'label': resource.split('.')[-1] if '.' in resource else resource,
                'type': resource.split('.')[0] if '.' in resource else 'unknown',
                'file': resource_files.get(resource, '')
            })
            
            for dep in deps:
                edges.append({
                    'from': resource,
                    'to': dep,
                    'label': 'depends on'
                })
        
        return {
            'nodes': nodes,
            'edges': edges,
            'resource_count': len(nodes),
            'dependency_count': len(edges)
        }


# Global collaboration manager instance
collaboration_manager = TeamCollaborationManager()

