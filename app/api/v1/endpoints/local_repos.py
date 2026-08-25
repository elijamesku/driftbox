"""
Local repository management endpoints for desktop app.
Handles cloning repos and reading files from local filesystem.
"""
import os
import subprocess
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from app.services.auth import authentication_service
from app.database.models import UserAccount

router = APIRouter()

# Get repos directory (same logic as frontend)
def get_repos_dir() -> Path:
    """Get the directory where repos are cloned."""
    home_dir = Path.home()
    repos_dir = home_dir / '.infrara' / 'repos'
    repos_dir.mkdir(parents=True, exist_ok=True)
    return repos_dir

def validate_path_within_repo(repo_path: Path, file_path: str) -> Path:
    """
    Validate that a file path is within the repository directory.
    Prevents path traversal attacks.
    
    Args:
        repo_path: The repository root path
        file_path: The relative file path to validate
        
    Returns:
        Resolved Path object if valid
        
    Raises:
        HTTPException: If path traversal is detected
    """
    try:
        repo_path = repo_path.resolve()
        target_path = (repo_path / file_path).resolve()
        
        # Security check: ensure resolved path is within repo
        if not str(target_path).startswith(str(repo_path)):
            raise HTTPException(
                status_code=400,
                detail="Invalid file path - path traversal detected"
            )
        
        return target_path
    except (ValueError, OSError) as e:
        raise HTTPException(
            status_code=400,
            detail="Invalid file path"
        )


class CloneRepoRequest(BaseModel):
    owner: str
    repo: str


class CloneRepoResponse(BaseModel):
    success: bool
    message: str
    path: Optional[str] = None
    use_github_api: bool = False


class FileTreeRequest(BaseModel):
    owner: str
    repo: str
    path: str = ""


class FileNode(BaseModel):
    name: str
    type: str  # 'file' or 'folder'
    path: str
    children: Optional[List['FileNode']] = None
    isLoaded: bool = True


class ReadFileRequest(BaseModel):
    owner: str
    repo: str
    path: str


class MoveFileRequest(BaseModel):
    owner: str
    repo: str
    source_path: str  # Current path of file/folder
    target_path: str  # New path of file/folder


class DeleteFileRequest(BaseModel):
    owner: str
    repo: str
    path: str  # Path of file/folder to delete


class CreateFileRequest(BaseModel):
    owner: str
    repo: str
    path: str  # Path where to create the file/folder
    content: str = ""  # Initial content for files (empty for folders)
    is_folder: bool = False  # Whether to create a folder or file


@router.post("/clone", response_model=CloneRepoResponse, tags=["local-repos"])
async def clone_repository(
    req: CloneRepoRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Clone a GitHub repository locally or pull if it already exists.
    For desktop app use - provides instant local file access.
    """
    try:
        repos_dir = get_repos_dir()
        repo_path = repos_dir / req.owner / req.repo
        
        # Check if repo already exists
        if repo_path.exists() and (repo_path / '.git').exists():
            # Repo exists, try to pull latest
            try:
                result = subprocess.run(
                    ['git', 'pull'],
                    cwd=repo_path,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                
                if result.returncode == 0:
                    return CloneRepoResponse(
                        success=True,
                        message="Repository updated successfully",
                        path=str(repo_path),
                        use_github_api=False
                    )
                else:
                    # Pull failed, but repo exists - still usable
                    return CloneRepoResponse(
                        success=True,
                        message=f"Using existing repo (pull failed: {result.stderr})",
                        path=str(repo_path),
                        use_github_api=False
                    )
            except Exception as e:
                # Pull failed but repo exists
                return CloneRepoResponse(
                    success=True,
                    message=f"Using existing repo (update failed: {str(e)})",
                    path=str(repo_path),
                    use_github_api=False
                )
        
        # Repo doesn't exist, need to clone
        if not user.github_access_token:
            return CloneRepoResponse(
                success=False,
                message="No GitHub token available. Please authenticate with GitHub.",
                use_github_api=True
            )
        
        # Create owner directory
        owner_dir = repos_dir / req.owner
        owner_dir.mkdir(parents=True, exist_ok=True)
        
        # Clone using GitHub token
        clone_url = f"https://{user.github_access_token}@github.com/{req.owner}/{req.repo}.git"
        
        try:
            result = subprocess.run(
                ['git', 'clone', clone_url, req.repo],
                cwd=owner_dir,
                capture_output=True,
                text=True,
                timeout=120  # 2 minutes for large repos
            )
            
            if result.returncode == 0:
                return CloneRepoResponse(
                    success=True,
                    message="Repository cloned successfully",
                    path=str(repo_path),
                    use_github_api=False
                )
            else:
                raise Exception(f"Git clone failed: {result.stderr}")
                
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=408, detail="Clone operation timed out")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to clone repository: {str(e)}")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files/tree", tags=["local-repos"])
async def get_file_tree(req: FileTreeRequest):
    """
    Get file tree from locally cloned repository.
    Returns instant results from local filesystem.
    """
    try:
        repos_dir = get_repos_dir()
        repo_path = repos_dir / req.owner / req.repo
        
        if not repo_path.exists():
            raise HTTPException(
                status_code=404, 
                detail=f"Repository not found locally. Please clone it first: {req.owner}/{req.repo}"
            )
        
        # Build path to requested directory
        if req.path:
            target_path = repo_path / req.path
        else:
            target_path = repo_path
        
        if not target_path.exists():
            raise HTTPException(status_code=404, detail=f"Path not found: {req.path}")
        
        if not target_path.is_dir():
            raise HTTPException(status_code=400, detail=f"Path is not a directory: {req.path}")
        
        # Read directory contents
        files = []
        for item in sorted(target_path.iterdir()):
            # Skip .git directory and hidden files
            if item.name.startswith('.'):
                continue
            
            relative_path = str(item.relative_to(repo_path)).replace('\\', '/')
            
            files.append({
                'name': item.name,
                'type': 'folder' if item.is_dir() else 'file',
                'path': relative_path,
                'children': [] if item.is_dir() else None,
                'isLoaded': item.is_file()
            })
        
        return {'files': files}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading directory: {str(e)}")


@router.post("/files/read", tags=["local-repos"])
async def read_file(req: ReadFileRequest):
    """
    Read file content from locally cloned repository.
    Returns instant results from local filesystem.
    """
    try:
        repos_dir = get_repos_dir()
        repo_path = repos_dir / req.owner / req.repo
        
        if not repo_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Repository not found locally: {req.owner}/{req.repo}"
            )
        
        file_path = repo_path / req.path
        
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {req.path}")
        
        if not file_path.is_file():
            raise HTTPException(status_code=400, detail=f"Path is not a file: {req.path}")
        
        # Read file content
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return {'content': content}
        except UnicodeDecodeError:
            # Try reading as binary for non-text files
            with open(file_path, 'rb') as f:
                content = f.read()
            return {'content': content.decode('utf-8', errors='replace')}
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {str(e)}")


@router.post("/files/move", tags=["local-repos"])
async def move_file(
    req: MoveFileRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Move or rename a file or folder in the repository using git mv.
    This preserves git history and stages the changes automatically.
    """
    try:
        repos_dir = get_repos_dir()
        repo_path = repos_dir / req.owner / req.repo
        
        if not repo_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Repository not found locally: {req.owner}/{req.repo}"
            )
        
        # Check if .git exists (must be a git repo)
        if not (repo_path / '.git').exists():
            raise HTTPException(
                status_code=400,
                detail="Repository is not a git repository. Cannot use git mv."
            )
        
        source_path = repo_path / req.source_path
        target_path = repo_path / req.target_path
        
        # Validate source exists
        if not source_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Source path not found: {req.source_path}"
            )
        
        # Validate target doesn't already exist
        if target_path.exists():
            raise HTTPException(
                status_code=409,
                detail=f"Target path already exists: {req.target_path}"
            )
        
        # Ensure target parent directory exists
        target_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Check if source is tracked in git
        # For files, check directly; for folders, check if any files inside are tracked
        if source_path.is_file():
            check_tracked = subprocess.run(
                ['git', 'ls-files', '--error-unmatch', str(source_path.relative_to(repo_path))],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=10
            )
            is_tracked = check_tracked.returncode == 0
        else:
            # For folders, check if any files inside are tracked
            # Use ls-files without --error-unmatch to list tracked files in the folder
            check_tracked = subprocess.run(
                ['git', 'ls-files', '--', str(source_path.relative_to(repo_path))],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=10
            )
            # If ls-files returns any output, the folder contains tracked files
            is_tracked = len(check_tracked.stdout.strip()) > 0
        
        if is_tracked:
            # Use git mv to preserve history (automatically stages)
            result = subprocess.run(
                ['git', 'mv', str(source_path.relative_to(repo_path)), str(target_path.relative_to(repo_path))],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"Git mv failed: {result.stderr}"
                )
        else:
            # File not tracked, use regular move and stage manually
            import shutil
            shutil.move(str(source_path), str(target_path))
            
            # Stage the new file
            add_result = subprocess.run(
                ['git', 'add', str(target_path.relative_to(repo_path))],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if add_result.returncode != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"Git add failed: {add_result.stderr}"
                )
        
        return {
            'success': True,
            'message': f"Successfully moved {req.source_path} to {req.target_path}",
            'source_path': req.source_path,
            'target_path': req.target_path
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error moving file: {str(e)}")


@router.post("/files/delete", tags=["local-repos"])
async def delete_file(
    req: DeleteFileRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Delete a file or folder from the repository using git rm.
    This stages the deletion automatically.
    """
    try:
        repos_dir = get_repos_dir()
        repo_path = repos_dir / req.owner / req.repo
        
        if not repo_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Repository not found locally: {req.owner}/{req.repo}"
            )
        
        # Check if .git exists (must be a git repo)
        if not (repo_path / '.git').exists():
            raise HTTPException(
                status_code=400,
                detail="Repository is not a git repository. Cannot use git rm."
            )
        
        target_path = repo_path / req.path
        
        # Validate path exists
        if not target_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Path not found: {req.path}"
            )
        
        # Check if path is tracked in git
        # For files, check directly; for folders, check if any files inside are tracked
        if target_path.is_file():
            check_tracked = subprocess.run(
                ['git', 'ls-files', '--error-unmatch', str(target_path.relative_to(repo_path))],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=10
            )
            is_tracked = check_tracked.returncode == 0
        else:
            # For folders, check if any files inside are tracked
            # Use ls-files without --error-unmatch to list tracked files in the folder
            check_tracked = subprocess.run(
                ['git', 'ls-files', '--', str(target_path.relative_to(repo_path))],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=10
            )
            # If ls-files returns any output, the folder contains tracked files
            is_tracked = len(check_tracked.stdout.strip()) > 0
        
        if is_tracked:
            # Use git rm with -f flag to force removal even if files have staged changes
            # Automatically stages deletion
            if target_path.is_dir():
                # For directories, use -rf flags (recursive + force)
                result = subprocess.run(
                    ['git', 'rm', '-rf', str(target_path.relative_to(repo_path))],
                    cwd=repo_path,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
            else:
                # For files, use -f flag (force)
                result = subprocess.run(
                    ['git', 'rm', '-f', str(target_path.relative_to(repo_path))],
                    cwd=repo_path,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
            
            if result.returncode != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"Git rm failed: {result.stderr}"
                )
        else:
            # Not tracked, just delete from filesystem
            import shutil
            if target_path.is_dir():
                shutil.rmtree(target_path)
            else:
                target_path.unlink()
        
        return {
            'success': True,
            'message': f"Successfully deleted {req.path}",
            'path': req.path
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting file: {str(e)}")


@router.post("/files/create", tags=["local-repos"])
async def create_file(
    req: CreateFileRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Create a new file or folder in the repository.
    Automatically stages the new file with git add.
    """
    try:
        repos_dir = get_repos_dir()
        repo_path = repos_dir / req.owner / req.repo
        
        if not repo_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Repository not found locally: {req.owner}/{req.repo}"
            )
        
        # Check if .git exists (must be a git repo)
        if not (repo_path / '.git').exists():
            raise HTTPException(
                status_code=400,
                detail="Repository is not a git repository. Cannot stage new files."
            )
        
        target_path = repo_path / req.path
        
        # Validate target doesn't already exist
        if target_path.exists():
            raise HTTPException(
                status_code=409,
                detail=f"Path already exists: {req.path}"
            )
        
        # Ensure parent directory exists
        target_path.parent.mkdir(parents=True, exist_ok=True)
        
        if req.is_folder:
            # Create folder
            # Note: Git doesn't track empty folders, so we don't need to stage it
            # The folder will be tracked when files are added to it
            target_path.mkdir(parents=True, exist_ok=True)
        else:
            # Create file with content
            target_path.write_text(req.content, encoding='utf-8')
            
            # Stage the new file (git only tracks files, not folders)
            add_result = subprocess.run(
                ['git', 'add', str(target_path.relative_to(repo_path))],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if add_result.returncode != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"Git add failed: {add_result.stderr}"
                )
        
        return {
            'success': True,
            'message': f"Successfully created {req.path}",
            'path': req.path
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating file: {str(e)}")


# Update FileNode model to support recursive definition
FileNode.model_rebuild()

