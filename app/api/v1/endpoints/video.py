from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
import subprocess
import shutil
import os
import logging

from app.services.auth import authentication_service
from app.database.models import UserAccount
from app.utils.errors import sanitize_error_detail

router = APIRouter()

RENDER_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "render_video_local.py"
VIDEO_BASE_DEFAULT = Path.home() / ".driftbox" / "videos"
REPO_BASE_DEFAULT = Path.home() / ".driftbox" / "repos"


def get_repo_path(owner: str, repo: str) -> Path:
    """
    Resolve a repo path with fallbacks:
    1) KYRNA_REPO_BASE env (owner/repo)
    2) ~/.driftbox/repos (owner/repo)
    3) WORKSPACE_ROOT env (owner/repo or repo)
    4) cwd (owner/repo or repo)
    """
    candidates = []

    repo_base_env = os.environ.get("KYRNA_REPO_BASE")
    if repo_base_env:
        candidates.append(Path(repo_base_env) / owner / repo)

    candidates.append(REPO_BASE_DEFAULT / owner / repo)

    workspace_root = os.environ.get("WORKSPACE_ROOT")
    if workspace_root:
        wr = Path(workspace_root)
        candidates.append(wr / owner / repo)
        candidates.append(wr / repo)

    cwd = Path.cwd()
    candidates.append(cwd / owner / repo)
    candidates.append(cwd / repo)

    for path in candidates:
        if path.exists():
            return path
    raise HTTPException(
        status_code=404,
        detail=f"Repository not found. Tried: {', '.join(str(p) for p in candidates)}",
    )


@router.get("/video/{owner}/{repo}")
async def get_repo_video(
    owner: str,
    repo: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
):
    """
    Serve the locally rendered repo walkthrough video.
    Workspace-only: looks under ~/.driftbox/videos/{owner}/{repo}.mp4
    """
    video_base = Path(os.environ.get("KYRNA_VIDEO_BASE", VIDEO_BASE_DEFAULT))
    video_path = video_base / owner / f"{repo}.mp4"
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(
        path=video_path,
        media_type="video/mp4",
        filename=f"{repo}.mp4",
    )


@router.post("/video/{owner}/{repo}/generate")
async def generate_repo_video(
    owner: str,
    repo: str,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
):
    """
    Generate the walkthrough video locally for this repo.
    Looks in ~/.driftbox/repos/{owner}/{repo} and writes to ~/.driftbox/videos/{owner}/{repo}.mp4
    """
    repo_path = get_repo_path(owner, repo)
    video_base = Path(os.environ.get("KYRNA_VIDEO_BASE", VIDEO_BASE_DEFAULT))
    video_base.mkdir(parents=True, exist_ok=True)

    if not RENDER_SCRIPT.exists():
        raise HTTPException(status_code=500, detail="Render script not found")

    if not shutil.which("ffmpeg"):
        raise HTTPException(status_code=500, detail="ffmpeg not found in PATH")

    env = os.environ.copy()
    # ensure user-local bin (for static ffmpeg) is present
    env["PATH"] = f"{Path.home() / '.local' / 'bin'}:{env.get('PATH','')}"
    env["KYRNA_VIDEO_BASE"] = str(video_base)
    try:
        result = subprocess.run(
            ["python3", str(RENDER_SCRIPT), "--owner", owner, "--repo", repo],
            capture_output=True,
            text=True,
            cwd=str(repo_path),
            timeout=180,
            env=env,
        )
        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=sanitize_error_detail(Exception(result.stderr), "Video generation failed"),
            )
        logging.info(result.stdout)
        return {"success": True, "message": "Video generated"}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Video generation timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Video generation failed"))

