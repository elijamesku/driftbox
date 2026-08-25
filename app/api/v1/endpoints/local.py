"""
Local file operations endpoint.
Handles file deletion and git operations on cloned repositories.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from pathlib import Path
import subprocess
import os

from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.utils.errors import sanitize_error_detail

router = APIRouter()


class DeleteFileRequest(BaseModel):
    repo_owner: str
    repo_name: str
    file_path: str


class GitResetRequest(BaseModel):
    repo_owner: str
    repo_name: str


def get_repo_path(repo_owner: str, repo_name: str) -> Path:
    """Get the local path to a cloned repository."""
    # Use the same cloning location as elsewhere in the app
    base_dir = Path(os.path.expanduser("~/.driftbox/repos"))
    repo_path = base_dir / repo_owner / repo_name
    
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository not found at {repo_path}")
    
    return repo_path


@router.post("/delete-file")
async def delete_file(
    request: DeleteFileRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Delete a file from the local repository.
    Used to clean up invalid generated files after validation failures.
    """
    try:
        repo_path = get_repo_path(request.repo_owner, request.repo_name)
        file_full_path = repo_path / request.file_path
        
        # Security check: ensure file is within repo
        if not str(file_full_path.resolve()).startswith(str(repo_path.resolve())):
            raise HTTPException(status_code=400, detail="Invalid file path - outside repository")
        
        # Delete the file if it exists
        if file_full_path.exists():
            file_full_path.unlink()
            print(f"✅ [Local] Deleted file: {file_full_path}")
            
            # Also delete parent directories if they're empty (cleanup)
            parent = file_full_path.parent
            while parent != repo_path and parent.exists():
                try:
                    if not any(parent.iterdir()):  # Directory is empty
                        parent.rmdir()
                        print(f"✅ [Local] Removed empty directory: {parent}")
                        parent = parent.parent
                    else:
                        break
                except:
                    break
            
            return {"success": True, "message": f"Deleted {request.file_path}"}
        else:
            return {"success": True, "message": f"File {request.file_path} does not exist"}
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ [Local] Error deleting file: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to delete file"))


@router.post("/git-reset")
async def git_reset(
    request: GitResetRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Reset git staging area (git reset).
    Unstages all changes to give a clean slate after validation failures.
    """
    try:
        repo_path = get_repo_path(request.repo_owner, request.repo_name)
        
        # Run git reset to unstage everything
        result = subprocess.run(
            ["git", "reset"],
            cwd=str(repo_path),
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode != 0:
            print(f"❌ [Local] Git reset failed: {result.stderr}")
            raise HTTPException(status_code=500, detail=sanitize_error_detail(Exception(result.stderr), "Git reset failed"))
        
        print(f"✅ [Local] Git staging area reset for {request.repo_owner}/{request.repo_name}")
        return {
            "success": True,
            "message": "Git staging area reset",
            "output": result.stdout
        }
            
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Git reset timed out")
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ [Local] Error resetting git: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to reset git"))

