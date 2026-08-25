"""
Real-time team collaboration WebSocket endpoint.
Enables Figma-style live collaboration for infrastructure editing.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
import json

from app.database.connection import acquire_auth_session
from app.services.team_collaboration import collaboration_manager
from app.services.team_service import TeamService

router = APIRouter(prefix="/teams", tags=["team-collaboration"])


async def verify_team_access(
    team_id: str,
    user_id: str,
    db: Session
) -> bool:
    """Verify user has access to team"""
    service = TeamService(db)
    member = service.get_team_member(team_id, user_id)
    return member is not None


@router.websocket("/{team_id}/collaborate")
async def team_collaboration_websocket(
    websocket: WebSocket,
    team_id: str,
    user_id: str = Query(...),
    token: str = Query(...),
    user_name: str = Query(default=None)
):
    """
    WebSocket endpoint for real-time team collaboration.
    
    Features:
    - Live presence (who's online)
    - File activity tracking (who's editing what)
    - Real-time change broadcasting
    - Cursor position sharing
    - Conflict warnings
    """
    await websocket.accept()
    
    # Use name from query param (sent from frontend profile)
    user_info = {
        'user_id': user_id,
        'name': user_name or user_id,
        'email': user_id
    }
    
    try:
        # Connect user to team room
        await collaboration_manager.connect_user(
            team_id=team_id,
            user_id=user_id,
            websocket=websocket,
            user_info=user_info
        )
        
        # Listen for messages
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            message_type = message.get('type')
            
            # Handle different message types
            if message_type == 'file_open':
                # User opened a file
                conflict = await collaboration_manager.start_editing_file(
                    team_id=team_id,
                    user_id=user_id,
                    repo_full_name=message.get('repo'),
                    file_path=message.get('file_path'),
                    user_info=user_info
                )
                
                # Send conflict warning if exists
                if conflict:
                    await websocket.send_json(conflict)
            
            elif message_type == 'file_close':
                # User closed a file
                await collaboration_manager.stop_editing_file(
                    team_id=team_id,
                    user_id=user_id,
                    repo_full_name=message.get('repo'),
                    file_path=message.get('file_path')
                )
            
            elif message_type == 'file_change':
                # User made a change
                await collaboration_manager.broadcast_file_change(
                    team_id=team_id,
                    user_id=user_id,
                    repo_full_name=message.get('repo'),
                    file_path=message.get('file_path'),
                    change_data=message.get('change', {}),
                    user_info=user_info
                )
            
            elif message_type == 'cursor_move':
                # User moved cursor (throttled on client)
                await collaboration_manager.update_cursor_position(
                    team_id=team_id,
                    user_id=user_id,
                    file_path=message.get('file_path'),
                    line=message.get('line', 0),
                    column=message.get('column', 0),
                    repo=message.get('repo'),
                    user_info=user_info
                )
            
            elif message_type == 'text_change':
                # User made text changes - broadcast full content to team for live sync
                await collaboration_manager.broadcast_text_change(
                    team_id=team_id,
                    user_id=user_id,
                    repo=message.get('repo', ''),
                    file_path=message.get('file_path'),
                    full_content=message.get('full_content', ''),
                    user_info=user_info
                )
            
            elif message_type == 'files_updated':
                # User created/updated files via AI agent - notify team with file content
                files = message.get('files', [])
                print(f"📢 [WebSocket] files_updated received from {user_id}: {[f.get('path') for f in files]}")
                await collaboration_manager.broadcast_files_updated(
                    team_id=team_id,
                    user_id=user_id,
                    repo=message.get('repo', ''),
                    files=files,  # Now includes { path, content, action } for each file
                    user_info=user_info
                )
                print(f"📢 [WebSocket] files_updated broadcast complete")
            
            elif message_type == 'files_discarded':
                # User discarded files - notify team to delete/revert
                files = message.get('files', [])
                print(f"🗑️ [WebSocket] files_discarded received from {user_id}: {[f.get('path') for f in files]}")
                await collaboration_manager.broadcast_files_discarded(
                    team_id=team_id,
                    user_id=user_id,
                    repo=message.get('repo', ''),
                    files=files,  # Array of { path, action }
                    user_info=user_info
                )
                print(f"🗑️ [WebSocket] files_discarded broadcast complete")
            
            elif message_type == 'pr_intent_change':
                # User changed PR intent (work-in-progress or ready-for-pr)
                await collaboration_manager.update_pr_intent(
                    team_id=team_id,
                    user_id=user_id,
                    pr_intent=message.get('pr_intent', 'work-in-progress'),
                    user_info=user_info
                )
            
            elif message_type == 'intent_change':
                # User changed their intent (what they're doing)
                await collaboration_manager.broadcast_to_team(team_id, {
                    'type': 'intent_changed',
                    'user_id': user_id,
                    'user_name': user_info.get('name', user_id),
                    'intent': message.get('intent', 'exploring')
                }, exclude_user=user_id)
            
            elif message_type == 'create_team_pr':
                # User creating team PR
                await collaboration_manager.create_team_pr(
                    team_id=team_id,
                    user_id=user_id,
                    contributors=message.get('contributors', []),
                    title=message.get('title', ''),
                    description=message.get('description', ''),
                    user_info=user_info
                )
            
            elif message_type == 'ping':
                # Heartbeat - update last_seen to keep presence fresh
                await collaboration_manager.update_last_seen(team_id, user_id)
                await websocket.send_json({'type': 'pong'})
            
            elif message_type == 'chat_message':
                # User sending a chat message
                await collaboration_manager.send_chat_message(
                    team_id=team_id,
                    user_id=user_id,
                    user_name=user_info.get('name', user_id),
                    message=message.get('message', ''),
                    repo_full_name=message.get('repo'),
                    code_ref=message.get('code_ref')
                )
            
            elif message_type == 'typing':
                # User typing indicator
                await collaboration_manager.set_typing(
                    team_id=team_id,
                    user_id=user_id,
                    user_name=user_info.get('name', user_id),
                    is_typing=message.get('is_typing', False)
                )
            
            # ========== Activity Status ==========
            elif message_type == 'activity_status_change':
                # User changed their activity status (idle, editing, generating, creating_pr)
                await collaboration_manager.broadcast_activity_status(
                    team_id=team_id,
                    user_id=user_id,
                    user_name=user_info.get('name', user_id),
                    activity_status=message.get('activity_status', 'idle')
                )
            
            elif message_type == 'lock_files_for_pr':
                # User is creating a PR - lock the involved files
                await collaboration_manager.lock_files_for_pr(
                    team_id=team_id,
                    user_id=user_id,
                    user_name=user_info.get('name', user_id),
                    files=message.get('files', [])
                )
            
            elif message_type == 'unlock_files_from_pr':
                # PR is done - unlock the files
                await collaboration_manager.unlock_files_from_pr(
                    team_id=team_id,
                    user_id=user_id,
                    user_name=user_info.get('name', user_id)
                )
            
            # ========== File Locking ==========
            elif message_type == 'acquire_lock':
                # User requesting a file lock
                result = await collaboration_manager.acquire_lock(
                    team_id=team_id,
                    user_id=user_id,
                    user_name=user_info.get('name', user_id),
                    repo_full_name=message.get('repo'),
                    file_path=message.get('file_path'),
                    lock_type=message.get('lock_type', 'exclusive')
                )
                await websocket.send_json({'type': 'lock_result', **result})
            
            elif message_type == 'release_lock':
                # User releasing a file lock
                result = await collaboration_manager.release_lock(
                    team_id=team_id,
                    user_id=user_id,
                    repo_full_name=message.get('repo'),
                    file_path=message.get('file_path')
                )
                await websocket.send_json({'type': 'unlock_result', **result})
            
            elif message_type == 'request_lock':
                # User requesting lock held by someone else
                result = await collaboration_manager.request_lock(
                    team_id=team_id,
                    user_id=user_id,
                    user_name=user_info.get('name', user_id),
                    repo_full_name=message.get('repo'),
                    file_path=message.get('file_path')
                )
                await websocket.send_json({'type': 'lock_request_result', **result})
            
            elif message_type == 'get_lock_status':
                # Query lock status for a file
                lock = collaboration_manager.get_file_lock(
                    team_id=team_id,
                    repo_full_name=message.get('repo'),
                    file_path=message.get('file_path')
                )
                await websocket.send_json({
                    'type': 'lock_status',
                    'file_path': message.get('file_path'),
                    'locked': lock is not None,
                    'lock': lock
                })
            
            # ========== Dependency Notifications ==========
            elif message_type == 'update_dependencies':
                # Update dependency graph (usually after file index)
                result = await collaboration_manager.update_dependency_graph(
                    team_id=team_id,
                    repo_full_name=message.get('repo'),
                    resources=message.get('resources', [])
                )
                await websocket.send_json({'type': 'dependencies_updated', **result})
            
            elif message_type == 'resource_changed':
                # Notify about a resource change
                result = await collaboration_manager.notify_dependents(
                    team_id=team_id,
                    user_id=user_id,
                    user_name=user_info.get('name', user_id),
                    repo_full_name=message.get('repo'),
                    changed_resource=message.get('resource'),
                    change_type=message.get('change_type', 'modified')
                )
                await websocket.send_json({'type': 'dependents_notified', **result})
            
            elif message_type == 'get_dependents':
                # Get resources that depend on a given resource
                dependents = collaboration_manager.get_resource_dependents(
                    team_id=team_id,
                    repo_full_name=message.get('repo'),
                    resource_address=message.get('resource')
                )
                await websocket.send_json({
                    'type': 'resource_dependents',
                    'resource': message.get('resource'),
                    'dependents': dependents
                })
            
            elif message_type == 'get_dependency_graph':
                # Get full dependency graph for visualization
                graph = collaboration_manager.get_dependency_graph(
                    team_id=team_id,
                    repo_full_name=message.get('repo')
                )
                await websocket.send_json({'type': 'dependency_graph', **graph})
            
            elif message_type == 'leave':
                # User explicitly leaving workspace - clean up immediately
                print(f"👋 User {user_id} explicitly leaving team {team_id}")
                await collaboration_manager.disconnect_user(team_id, user_id)
                await websocket.close()
                return  # Exit the message loop
    
    except WebSocketDisconnect:
        await collaboration_manager.disconnect_user(team_id, user_id)
    except Exception as e:
        print(f"WebSocket error for user {user_id} in team {team_id}: {e}")
        await collaboration_manager.disconnect_user(team_id, user_id)


@router.get("/{team_id}/activity")
async def get_team_activity(
    team_id: str,
    db: Session = Depends(acquire_auth_session)
):
    """
    Get current team collaboration activity (REST fallback).
    Shows who's online, what files are being edited, recent changes.
    """
    activity = collaboration_manager.get_team_activity(team_id)
    
    return {
        "ok": True,
        "team_id": team_id,
        "activity": activity
    }


@router.get("/{team_id}/presence")
async def get_team_presence(
    team_id: str
):
    """Get list of online team members"""
    online_users = collaboration_manager.get_online_users(team_id)
    
    return {
        "ok": True,
        "team_id": team_id,
        "online_users": online_users,
        "count": len(online_users)
    }


@router.get("/{team_id}/chat")
async def get_chat_history(
    team_id: str,
    limit: int = 50
):
    """Get recent chat messages for team"""
    messages = collaboration_manager.get_chat_history(team_id, limit)
    typing_users = collaboration_manager.get_typing_users(team_id)
    
    return {
        "ok": True,
        "team_id": team_id,
        "messages": messages,
        "typing_users": typing_users
    }


# ========== File Locks REST Endpoints ==========

@router.get("/{team_id}/locks")
async def get_all_locks(team_id: str):
    """Get all file locks for a team"""
    locks = collaboration_manager.get_all_locks(team_id)
    
    return {
        "ok": True,
        "team_id": team_id,
        "locks": locks,
        "count": len(locks)
    }


@router.get("/{team_id}/locks/{repo_owner}/{repo_name}/{file_path:path}")
async def get_file_lock(
    team_id: str,
    repo_owner: str,
    repo_name: str,
    file_path: str
):
    """Get lock status for a specific file"""
    repo_full_name = f"{repo_owner}/{repo_name}"
    lock = collaboration_manager.get_file_lock(team_id, repo_full_name, file_path)
    
    return {
        "ok": True,
        "file_path": file_path,
        "locked": lock is not None,
        "lock": lock
    }


# ========== Dependency Graph REST Endpoints ==========

@router.get("/{team_id}/dependencies/{repo_owner}/{repo_name}")
async def get_dependency_graph(
    team_id: str,
    repo_owner: str,
    repo_name: str
):
    """Get full dependency graph for a repository"""
    repo_full_name = f"{repo_owner}/{repo_name}"
    graph = collaboration_manager.get_dependency_graph(team_id, repo_full_name)
    
    return {
        "ok": True,
        "repo": repo_full_name,
        **graph
    }


@router.get("/{team_id}/dependencies/{repo_owner}/{repo_name}/{resource_address}")
async def get_resource_dependents(
    team_id: str,
    repo_owner: str,
    repo_name: str,
    resource_address: str
):
    """Get resources that depend on a given resource"""
    repo_full_name = f"{repo_owner}/{repo_name}"
    dependents = collaboration_manager.get_resource_dependents(team_id, repo_full_name, resource_address)
    dependencies = collaboration_manager.get_resource_dependencies(team_id, repo_full_name, resource_address)
    
    return {
        "ok": True,
        "resource": resource_address,
        "dependents": dependents,
        "dependencies": dependencies,
        "dependents_count": len(dependents),
        "dependencies_count": len(dependencies)
    }

