"""
Team management API endpoints.
Handles teams, members, invitations, and team billing.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime

from app.database.connection import acquire_auth_session
from app.services.auth import require_authentication
from app.database.models import UserAccount
from app.models.team import Team, TeamMember, TeamRepository, TeamInvitation, ROLE_PERMISSIONS
from app.services.team_service import TeamService

router = APIRouter(prefix="/teams", tags=["teams"])


# ========== Request/Response Models ==========

class CreateTeamRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    billing_email: Optional[EmailStr] = None


class UpdateTeamRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    billing_email: Optional[EmailStr] = None


class SetTeamCredentialsRequest(BaseModel):
    digitalocean_access_token: Optional[str] = None  # Set to null to clear


class TeamResponse(BaseModel):
    id: str
    name: str
    slug: str
    plan: str
    seats_limit: int
    member_count: int
    repo_count: int
    created_at: str


class InviteMemberRequest(BaseModel):
    email: EmailStr
    role: str = Field(..., pattern="^(admin|developer|viewer)$")


class UpdateMemberRoleRequest(BaseModel):
    role: str = Field(..., pattern="^(admin|developer|viewer)$")


class AddRepositoryRequest(BaseModel):
    repo_full_name: str = Field(..., pattern="^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$")


class MemberResponse(BaseModel):
    id: str
    user_id: str
    role: str
    status: str
    joined_at: Optional[str]
    user: dict


class InvitationResponse(BaseModel):
    id: str
    email: str
    role: str
    status: str
    invitation_token: str
    expires_at: str
    created_at: str


class RepositoryResponse(BaseModel):
    id: str
    repo_full_name: str
    repo_owner: str
    repo_name: str
    added_at: str


# ========== Team Management ==========

@router.post("/", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
async def create_team(
    request: CreateTeamRequest,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Create a new team.
    User becomes admin of the team.
    """
    service = TeamService(db)
    
    try:
        team = service.create_team(
            name=request.name,
            creator_id=current_user.id,
            billing_email=request.billing_email
        )
        
        return TeamResponse(**team.to_dict())
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/", response_model=List[TeamResponse])
async def get_my_teams(
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get all teams the current user is a member of.
    """
    service = TeamService(db)
    teams = service.get_user_teams(current_user.id)
    
    return [TeamResponse(**team.to_dict()) for team in teams]


@router.get("/{team_id}", response_model=TeamResponse)
async def get_team(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get team details.
    User must be a member of the team.
    """
    service = TeamService(db)
    
    # Check membership
    member = service.get_team_member(team_id, current_user.id)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this team"
        )
    
    team = service.get_team(team_id)
    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found"
        )
    
    return TeamResponse(**team.to_dict())


@router.patch("/{team_id}", response_model=TeamResponse)
async def update_team(
    team_id: str,
    request: UpdateTeamRequest,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Update team details.
    Requires admin role.
    """
    service = TeamService(db)
    
    try:
        # Filter out None values
        updates = {k: v for k, v in request.dict().items() if v is not None}
        
        team = service.update_team(
            team_id=team_id,
            user_id=current_user.id,
            **updates
        )
        
        return TeamResponse(**team.to_dict())
        
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/{team_id}/credentials", status_code=status.HTTP_200_OK)
async def set_team_credentials(
    team_id: str,
    request: SetTeamCredentialsRequest,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Set team-level cloud provider credentials.
    
    **ADMIN ONLY** - Requires admin role.
    
    This allows team members to use shared credentials when creating queries
    in the sandbox, even if they haven't configured their own credentials.
    
    Only team admins can create, update, or delete team credentials.
    """
    service = TeamService(db)
    
    # Check permission - must be admin (explicit check)
    user_role = service.get_user_role(team_id, current_user.id)
    if user_role != 'admin':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only team admins can set team credentials. Your role: {user_role}"
        )
    
    team = service.get_team(team_id)
    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found"
        )
    
    # Update credentials
    if request.digitalocean_access_token is not None:
        team.digitalocean_access_token = request.digitalocean_access_token
    
    db.commit()
    db.refresh(team)
    
    return {
        "success": True,
        "message": "Team credentials updated",
        "has_digitalocean_token": bool(team.digitalocean_access_token)
    }


@router.get("/{team_id}/credentials", status_code=status.HTTP_200_OK)
async def get_team_credentials_status(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get team credentials status (admin only).
    
    Returns whether credentials are configured, but NOT the actual token values.
    """
    service = TeamService(db)
    
    # Check permission - must be admin
    user_role = service.get_user_role(team_id, current_user.id)
    if user_role != 'admin':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only team admins can view credentials status. Your role: {user_role}"
        )
    
    team = service.get_team(team_id)
    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found"
        )
    
    return {
        "has_digitalocean_token": bool(team.digitalocean_access_token),
        "configured_at": team.updated_at.isoformat() if team.updated_at and team.digitalocean_access_token else None
    }


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Delete a team and all associated data.
    Requires admin role.
    """
    service = TeamService(db)
    
    try:
        service.delete_team(team_id=team_id, user_id=current_user.id)
        return None
        
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


# ========== Member Management ==========

@router.get("/{team_id}/members", response_model=List[MemberResponse])
async def get_team_members(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get all team members.
    User must be a member of the team.
    """
    service = TeamService(db)
    
    # Check membership
    member = service.get_team_member(team_id, current_user.id)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this team"
        )
    
    members = service.get_team_members(team_id)
    return [MemberResponse(**m) for m in members]


@router.post("/{team_id}/invitations", response_model=InvitationResponse, status_code=status.HTTP_201_CREATED)
async def invite_team_member(
    team_id: str,
    request: InviteMemberRequest,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Invite a new member to the team via email.
    Requires admin or manage_members permission.
    """
    service = TeamService(db)
    
    try:
        invitation = service.create_invitation(
            team_id=team_id,
            email=request.email,
            role=request.role,
            invited_by=current_user.id
        )
        
        return InvitationResponse(**invitation.to_dict())
        
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/{team_id}/invitations", response_model=List[InvitationResponse])
async def get_team_invitations(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get all pending invitations for team.
    Requires admin role.
    """
    service = TeamService(db)
    
    # Check permission
    if not service.check_user_permission(team_id, current_user.id, 'manage_members'):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can view invitations"
        )
    
    invitations = service.get_team_invitations(team_id)
    return [InvitationResponse(**inv.to_dict()) for inv in invitations]


@router.post("/invitations/{token}/accept", status_code=status.HTTP_200_OK)
async def accept_invitation(
    token: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Accept a team invitation.
    Token is from invitation email.
    """
    service = TeamService(db)
    
    try:
        member = service.accept_invitation(
            token=token,
            user_id=current_user.id
        )
        
        return {
            "success": True,
            "message": "Successfully joined team",
            "team_id": member.team_id,
            "role": member.role
        }
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.delete("/{team_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_invitation(
    team_id: str,
    invitation_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Cancel a pending invitation.
    Requires admin role.
    """
    service = TeamService(db)
    
    try:
        service.cancel_invitation(
            invitation_id=invitation_id,
            cancelled_by=current_user.id
        )
        
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.patch("/{team_id}/members/{user_id}/role", response_model=MemberResponse)
async def update_member_role(
    team_id: str,
    user_id: str,
    request: UpdateMemberRoleRequest,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Change a team member's role.
    Requires admin role.
    """
    service = TeamService(db)
    
    try:
        member = service.update_member_role(
            team_id=team_id,
            user_id=user_id,
            new_role=request.role,
            updated_by=current_user.id
        )
        
        # Get full member details with user info
        members = service.get_team_members(team_id)
        member_data = next((m for m in members if m['user_id'] == user_id), None)
        
        if not member_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found"
            )
        
        return MemberResponse(**member_data)
        
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.delete("/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team_member(
    team_id: str,
    user_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Remove a member from the team.
    Admins can remove anyone, users can remove themselves.
    """
    service = TeamService(db)
    
    try:
        service.remove_team_member(
            team_id=team_id,
            user_id=user_id,
            removed_by=current_user.id
        )
        
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# ========== Repository Management ==========

@router.post("/{team_id}/repositories", response_model=RepositoryResponse, status_code=status.HTTP_201_CREATED)
async def add_team_repository(
    team_id: str,
    request: AddRepositoryRequest,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Add a repository to the team.
    All team members will have access based on their role.
    """
    service = TeamService(db)
    
    try:
        repo = service.add_repository(
            team_id=team_id,
            repo_full_name=request.repo_full_name,
            added_by=current_user.id
        )
        
        return RepositoryResponse(**repo.to_dict())
        
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/{team_id}/repositories", response_model=List[RepositoryResponse])
async def get_team_repositories(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get all repositories for the team.
    User must be a member of the team.
    """
    service = TeamService(db)
    
    # Check membership
    member = service.get_team_member(team_id, current_user.id)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this team"
        )
    
    repos = service.get_team_repositories(team_id)
    return [RepositoryResponse(**repo.to_dict()) for repo in repos]


@router.delete("/{team_id}/repositories/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team_repository(
    team_id: str,
    repo_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Remove a repository from the team.
    Requires admin role.
    """
    service = TeamService(db)
    
    try:
        service.remove_repository(
            team_id=team_id,
            repo_id=repo_id,
            removed_by=current_user.id
        )
        
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


# ========== Permissions & Info ==========

@router.get("/{team_id}/permissions")
async def get_my_permissions(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get current user's role and permissions in the team.
    """
    service = TeamService(db)
    
    role = service.get_user_role(team_id, current_user.id)
    if not role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this team"
        )
    
    permissions = ROLE_PERMISSIONS.get(role, {})
    
    return {
        "role": role,
        "permissions": permissions
    }


@router.get("/{team_id}/audit-log")
async def get_team_audit_log(
    team_id: str,
    limit: int = 100,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get audit log for team.
    Requires admin role.
    """
    service = TeamService(db)
    
    # Check permission
    if not service.check_user_permission(team_id, current_user.id, 'manage_team'):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can view audit log"
        )
    
    logs = service.get_team_audit_log(team_id, limit)
    return {
        "team_id": team_id,
        "logs": [log.to_dict() for log in logs]
    }


@router.get("/{team_id}/activity")
async def get_team_activity(
    team_id: str,
    limit: int = 50,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get real-time activity from GitHub for all team repositories.
    Returns commits, PRs, and other events.
    """
    import httpx
    from datetime import datetime, timedelta
    
    service = TeamService(db)
    
    # Verify membership
    member = service.get_team_member(team_id, current_user.id)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a team member"
        )
    
    # Get all team members for name lookup
    members = service.get_team_members(team_id)
    member_lookup = {}
    for m in members:
        if m.user:
            member_lookup[m.user.github_username] = {
                "name": m.user.github_username or m.user.email.split('@')[0],
                "initial": (m.user.github_username or m.user.email)[0].upper(),
                "role": m.role
            }
    
    # Get repositories
    repositories = service.get_team_repositories(team_id)
    
    # Get GitHub token
    github_token = current_user.github_access_token
    if not github_token:
        return {"team_id": team_id, "logs": []}
    
    headers = {
        "Authorization": f"token {github_token}",
        "Accept": "application/vnd.github.v3+json"
    }
    
    all_activities = []
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        for repo in repositories[:10]:  # Limit to 10 repos for performance
            repo_full_name = repo.repo_full_name
            
            try:
                # Get recent commits
                commits_url = f"https://api.github.com/repos/{repo_full_name}/commits?per_page=10"
                commits_resp = await client.get(commits_url, headers=headers)
                
                if commits_resp.status_code == 200:
                    commits = commits_resp.json()
                    for commit in commits:
                        author_login = commit.get('author', {}).get('login', '') if commit.get('author') else ''
                        author_name = commit.get('commit', {}).get('author', {}).get('name', 'Unknown')
                        commit_date = commit.get('commit', {}).get('author', {}).get('date', '')
                        message = commit.get('commit', {}).get('message', '').split('\n')[0][:50]
                        
                        # Check if author is a team member
                        member_info = member_lookup.get(author_login, {
                            "name": author_name,
                            "initial": author_name[0].upper() if author_name else "?",
                            "role": "external"
                        })
                        
                        all_activities.append({
                            "id": commit.get('sha', '')[:8],
                            "user": member_info["name"],
                            "initial": member_info["initial"],
                            "action": "commit",
                            "target": message,
                            "extra": "",
                            "time": commit_date,
                            "repo": repo_full_name,
                            "is_member": author_login in member_lookup
                        })
                
                # Get recent PRs
                prs_url = f"https://api.github.com/repos/{repo_full_name}/pulls?state=all&sort=updated&direction=desc&per_page=5"
                prs_resp = await client.get(prs_url, headers=headers)
                
                if prs_resp.status_code == 200:
                    prs = prs_resp.json()
                    for pr in prs:
                        author_login = pr.get('user', {}).get('login', '')
                        pr_number = pr.get('number')
                        pr_title = pr.get('title', '')[:40]
                        pr_state = pr.get('state')
                        merged = pr.get('merged_at') is not None
                        created_at = pr.get('created_at', '')
                        
                        member_info = member_lookup.get(author_login, {
                            "name": author_login,
                            "initial": author_login[0].upper() if author_login else "?",
                            "role": "external"
                        })
                        
                        action = "merge" if merged else ("pr" if pr_state == "open" else "pr_close")
                        
                        all_activities.append({
                            "id": f"pr-{pr_number}",
                            "user": member_info["name"],
                            "initial": member_info["initial"],
                            "action": action,
                            "target": f"#{pr_number}",
                            "extra": f': "{pr_title}"',
                            "time": created_at,
                            "repo": repo_full_name,
                            "is_member": author_login in member_lookup
                        })
                
                # Get recent issues/comments
                events_url = f"https://api.github.com/repos/{repo_full_name}/events?per_page=10"
                events_resp = await client.get(events_url, headers=headers)
                
                if events_resp.status_code == 200:
                    events = events_resp.json()
                    for event in events:
                        event_type = event.get('type', '')
                        actor_login = event.get('actor', {}).get('login', '')
                        created_at = event.get('created_at', '')
                        payload = event.get('payload', {})
                        
                        member_info = member_lookup.get(actor_login, {
                            "name": actor_login,
                            "initial": actor_login[0].upper() if actor_login else "?",
                            "role": "external"
                        })
                        
                        # Map GitHub event types to our actions
                        action_map = {
                            'CreateEvent': ('create', payload.get('ref_type', 'branch'), payload.get('ref', '')),
                            'DeleteEvent': ('delete', payload.get('ref_type', 'branch'), payload.get('ref', '')),
                            'ForkEvent': ('fork', 'repository', ''),
                            'IssueCommentEvent': ('comment', f"issue #{payload.get('issue', {}).get('number', '')}", ''),
                            'IssuesEvent': (payload.get('action', 'issue'), f"issue #{payload.get('issue', {}).get('number', '')}", ''),
                            'PushEvent': None,  # Skip - we get commits separately
                            'PullRequestEvent': None,  # Skip - we get PRs separately
                            'WatchEvent': ('star', 'repository', ''),
                        }
                        
                        mapped = action_map.get(event_type)
                        if mapped:
                            action, target, extra = mapped
                            all_activities.append({
                                "id": event.get('id', ''),
                                "user": member_info["name"],
                                "initial": member_info["initial"],
                                "action": action,
                                "target": target,
                                "extra": extra,
                                "time": created_at,
                                "repo": repo_full_name,
                                "is_member": actor_login in member_lookup
                            })
                
            except Exception as e:
                print(f"⚠️ GitHub API error for {repo_full_name}: {e}")
    
    # Sort by time (newest first) and limit
    def parse_time(item):
        try:
            return datetime.fromisoformat(item['time'].replace('Z', '+00:00'))
        except:
            return datetime.min
    
    all_activities.sort(key=parse_time, reverse=True)
    
    # Convert times to relative format
    now = datetime.utcnow()
    for activity in all_activities:
        try:
            activity_time = datetime.fromisoformat(activity['time'].replace('Z', '+00:00')).replace(tzinfo=None)
            delta = now - activity_time
            
            if delta.total_seconds() < 60:
                activity['time'] = "Just now"
            elif delta.total_seconds() < 3600:
                mins = int(delta.total_seconds() / 60)
                activity['time'] = f"{mins} minute{'s' if mins > 1 else ''} ago"
            elif delta.total_seconds() < 86400:
                hours = int(delta.total_seconds() / 3600)
                activity['time'] = f"{hours} hour{'s' if hours > 1 else ''} ago"
            elif delta.days == 1:
                activity['time'] = f"Yesterday at {activity_time.strftime('%I:%M %p')}"
            elif delta.days < 7:
                activity['time'] = f"{delta.days} days ago"
            else:
                activity['time'] = activity_time.strftime('%b %d, %Y')
        except:
            pass
    
    return {
        "team_id": team_id,
        "logs": all_activities[:limit]
    }


@router.get("/{team_id}/dashboard")
async def get_team_dashboard(
    team_id: str,
    current_user: UserAccount = Depends(require_authentication),
    db: Session = Depends(acquire_auth_session)
):
    """
    Get aggregated dashboard data for team admin overview.
    Pulls real GitHub stats, cost estimates, and security scan results for repositories.
    """
    import httpx
    import re
    from app.services.team_staging import staging_manager
    from app.services.cost_tracker import cost_tracker
    from datetime import datetime, timedelta
    
    service = TeamService(db)
    
    # Verify membership
    member = service.get_team_member(team_id, current_user.id)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a team member"
        )
    
    # Get team data
    team = service.get_team(team_id)
    members = service.get_team_members(team_id)
    repositories = service.get_team_repositories(team_id)
    
    # Get staging data
    staging_data = staging_manager.get_staged_changes(team_id)
    staging_stats = staging_manager.get_staging_stats(team_id)
    
    # Get GitHub token for API calls
    github_token = current_user.github_access_token
    
    # Calculate weekly activity from GitHub API
    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)
    week_ago_iso = week_ago.strftime('%Y-%m-%dT%H:%M:%SZ')
    
    weekly_stats = {
        "prs_created": 0,
        "files_changed": 0,
        "issues_resolved": 0,
        "ai_interactions": 0,
        "daily_activity": [0, 0, 0, 0, 0, 0, 0]  # Mon-Sun
    }
    
    total_commits = 0
    total_prs = 0
    repo_costs = []
    total_estimated_cost = 0.0
    
    # Security tracking
    security_issues = []
    critical_issues = 0
    high_issues = 0
    medium_issues = 0
    low_issues = 0
    
    # Security patterns to check
    security_checks = [
        {"pattern": r'0\.0\.0\.0/0', "severity": "high", "title": "Open CIDR block (0.0.0.0/0)", "deduction": 10},
        {"pattern": r'encrypted\s*=\s*false', "severity": "high", "title": "Encryption disabled", "deduction": 10},
        {"pattern": r'publicly_accessible\s*=\s*true', "severity": "high", "title": "Publicly accessible resource", "deduction": 8},
        {"pattern": r'deletion_protection\s*=\s*false', "severity": "medium", "title": "Deletion protection disabled", "deduction": 5},
        {"pattern": r'skip_final_snapshot\s*=\s*true', "severity": "medium", "title": "Final snapshot disabled", "deduction": 3},
        {"pattern": r'port\s*=\s*22\b', "severity": "low", "title": "SSH port exposed", "deduction": 2},
        {"pattern": r'protocol\s*=\s*"-1"', "severity": "medium", "title": "All protocols allowed", "deduction": 5},
        {"pattern": r'"Action":\s*"\*"', "severity": "high", "title": "Wildcard IAM action", "deduction": 10},
        {"pattern": r'"Resource":\s*"\*"', "severity": "medium", "title": "Wildcard IAM resource", "deduction": 5},
    ]
    
    # Resource cost estimates (monthly)
    resource_costs = {
        "aws_instance": {"t2.micro": 8.50, "t2.small": 17.00, "t2.medium": 34.00, "t3.micro": 7.50, "t3.small": 15.00, "t3.medium": 30.00, "default": 25.00},
        "aws_db_instance": {"db.t3.micro": 15.00, "db.t3.small": 30.00, "db.t3.medium": 60.00, "default": 50.00},
        "aws_s3_bucket": {"default": 5.00},
        "aws_lambda_function": {"default": 10.00},
        "aws_vpc": {"default": 0.00},
        "aws_security_group": {"default": 0.00},
        "aws_lb": {"default": 25.00},
        "aws_elasticache_cluster": {"default": 45.00},
        "digitalocean_droplet": {"s-1vcpu-1gb": 6.00, "s-1vcpu-2gb": 12.00, "s-2vcpu-2gb": 18.00, "s-2vcpu-4gb": 24.00, "default": 12.00},
        "digitalocean_database_cluster": {"db-s-1vcpu-1gb": 15.00, "db-s-1vcpu-2gb": 25.00, "default": 25.00},
        "digitalocean_spaces_bucket": {"default": 5.00},
        "digitalocean_loadbalancer": {"default": 12.00},
        "digitalocean_kubernetes_cluster": {"default": 48.00},
        "google_compute_instance": {"e2-micro": 7.50, "e2-small": 13.00, "e2-medium": 26.00, "default": 20.00},
        "google_storage_bucket": {"default": 5.00},
        "google_sql_database_instance": {"default": 50.00},
        "azurerm_virtual_machine": {"Standard_B1s": 8.00, "Standard_B2s": 30.00, "default": 25.00},
        "azurerm_storage_account": {"default": 10.00},
    }
    
    # Fetch real GitHub stats and scan files for each repo
    if github_token and repositories:
        headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            for repo in repositories:
                repo_full_name = repo.repo_full_name
                repo_cost = 0.0
                
                try:
                    # Get recent commits (last 7 days)
                    commits_url = f"https://api.github.com/repos/{repo_full_name}/commits?since={week_ago_iso}&per_page=100"
                    commits_resp = await client.get(commits_url, headers=headers)
                    if commits_resp.status_code == 200:
                        commits = commits_resp.json()
                        total_commits += len(commits)
                        
                        # Track daily activity from commits
                        for commit in commits:
                            try:
                                commit_date = commit.get('commit', {}).get('author', {}).get('date', '')
                                if commit_date:
                                    commit_dt = datetime.fromisoformat(commit_date.replace('Z', '+00:00'))
                                    day_index = commit_dt.weekday()
                                    weekly_stats["daily_activity"][day_index] += 1
                            except Exception:
                                pass
                    
                    # Get recent PRs (last 7 days)
                    prs_url = f"https://api.github.com/repos/{repo_full_name}/pulls?state=all&sort=created&direction=desc&per_page=50"
                    prs_resp = await client.get(prs_url, headers=headers)
                    if prs_resp.status_code == 200:
                        prs = prs_resp.json()
                        for pr in prs:
                            created_at = pr.get('created_at', '')
                            if created_at:
                                pr_dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                                if pr_dt.replace(tzinfo=None) >= week_ago:
                                    total_prs += 1
                                    if pr.get('merged_at'):
                                        weekly_stats["issues_resolved"] += 1
                    
                    # Get repo stats for file changes
                    stats_url = f"https://api.github.com/repos/{repo_full_name}/stats/code_frequency"
                    stats_resp = await client.get(stats_url, headers=headers)
                    if stats_resp.status_code == 200:
                        stats = stats_resp.json()
                        if isinstance(stats, list) and len(stats) > 0:
                            last_week = stats[-1] if stats else [0, 0, 0]
                            weekly_stats["files_changed"] += abs(last_week[1]) + abs(last_week[2]) if len(last_week) >= 3 else 0
                    
                    # Get .tf files to scan for security issues and estimate costs
                    tree_url = f"https://api.github.com/repos/{repo_full_name}/git/trees/main?recursive=1"
                    tree_resp = await client.get(tree_url, headers=headers)
                    
                    if tree_resp.status_code != 200:
                        # Try master branch
                        tree_url = f"https://api.github.com/repos/{repo_full_name}/git/trees/master?recursive=1"
                        tree_resp = await client.get(tree_url, headers=headers)
                    
                    if tree_resp.status_code == 200:
                        tree_data = tree_resp.json()
                        tf_files = [f for f in tree_data.get('tree', []) if f.get('path', '').endswith('.tf')]
                        
                        for tf_file in tf_files[:10]:  # Limit to 10 files per repo
                            file_path = tf_file.get('path', '')
                            file_url = f"https://api.github.com/repos/{repo_full_name}/contents/{file_path}"
                            file_resp = await client.get(file_url, headers=headers)
                            
                            if file_resp.status_code == 200:
                                file_data = file_resp.json()
                                import base64
                                content = ""
                                if file_data.get('content'):
                                    try:
                                        content = base64.b64decode(file_data['content']).decode('utf-8')
                                    except Exception:
                                        continue
                                
                                # Security scanning
                                for check in security_checks:
                                    if re.search(check["pattern"], content, re.IGNORECASE):
                                        issue = {
                                            "severity": check["severity"],
                                            "title": check["title"],
                                            "file": file_path,
                                            "repo": repo_full_name
                                        }
                                        security_issues.append(issue)
                                        if check["severity"] == "critical":
                                            critical_issues += 1
                                        elif check["severity"] == "high":
                                            high_issues += 1
                                        elif check["severity"] == "medium":
                                            medium_issues += 1
                                        else:
                                            low_issues += 1
                                
                                # Cost estimation from resources
                                for resource_type, costs in resource_costs.items():
                                    pattern = rf'resource\s+"{resource_type}"\s+"([^"]+)"'
                                    matches = re.findall(pattern, content)
                                    for match in matches:
                                        # Try to find instance type
                                        instance_pattern = rf'{resource_type}"[^{{]*{{[^}}]*(?:instance_type|size|tier|machine_type)\s*=\s*"([^"]+)"'
                                        instance_match = re.search(instance_pattern, content, re.DOTALL | re.IGNORECASE)
                                        
                                        if instance_match:
                                            instance_type = instance_match.group(1)
                                            cost = costs.get(instance_type, costs.get("default", 10.00))
                                        else:
                                            cost = costs.get("default", 10.00)
                                        
                                        repo_cost += cost
                    
                except Exception as e:
                    print(f"⚠️ GitHub API error for {repo_full_name}: {e}")
                
                # Add repo to cost list
                repo_costs.append({
                    "repo_full_name": repo_full_name,
                    "estimated_cost": round(repo_cost, 2)
                })
                total_estimated_cost += repo_cost
    
    weekly_stats["prs_created"] = total_prs
    
    # Calculate security score (start at 100, deduct for issues)
    security_score = 100
    security_score -= critical_issues * 15
    security_score -= high_issues * 10
    security_score -= medium_issues * 5
    security_score -= low_issues * 2
    security_score = max(0, min(100, security_score))  # Clamp to 0-100
    
    # Estimate time saved based on commits (rough: 5 min saved per commit with AI assistance)
    ai_time_saved_hours = round((total_commits * 5) / 60, 1)
    
    # Calculate AI fix rate from merged PRs vs total PRs
    ai_fix_rate = round((weekly_stats["issues_resolved"] / max(total_prs, 1)) * 100) if total_prs > 0 else 0
    
    # Get staged changes awaiting review
    pending_staged = []
    staged_changes = staging_data.get('staged_changes', {})
    for user_id, user_data in staged_changes.items():
        file_count = len(user_data.get('files', []))
        if file_count > 0:
            pending_staged.append({
                "user_id": user_id,
                "user_name": user_data.get('user_name', 'Unknown'),
                "file_count": file_count
            })
    
    return {
        "team_id": team_id,
        "team_name": team.name,
        "plan": team.plan,
        
        # Overview stats - NOW REAL DATA
        "security_score": security_score,
        "total_security_issues": critical_issues + high_issues + medium_issues + low_issues,
        "critical_issues": critical_issues,
        "high_issues": high_issues,
        "medium_issues": medium_issues,
        "low_issues": low_issues,
        "security_issues": security_issues[:10],  # Return top 10 issues
        "estimated_monthly_cost": round(total_estimated_cost, 2),
        
        # Weekly productivity - FROM REAL GITHUB DATA
        "weekly_stats": weekly_stats,
        "ai_time_saved_hours": ai_time_saved_hours,
        "ai_fix_rate": ai_fix_rate,
        
        # Team
        "member_count": len(members),
        "repository_count": len(repositories),
        
        # Staging
        "pending_staged": pending_staged,
        "total_staged_files": staging_stats.get('total_files', 0),
        "staging_contributors": staging_stats.get('contributors_count', 0),
        
        # Cost breakdown
        "repo_costs": repo_costs,
        
        # Action items
        "action_items": {
            "security_issues": critical_issues + high_issues + medium_issues,
            "pending_reviews": len(pending_staged),
            "drift_detected": 0
        }
    }

