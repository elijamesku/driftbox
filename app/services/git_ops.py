import re
import subprocess
from pathlib import Path
from fastapi import HTTPException
from typing import Optional
import time

PULL_REQUEST_URL_PATTERN = re.compile(r"https://github\.com/\S+/pull/new/\S+")

def locate_repository_root() -> Path:
    git_process = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if git_process.returncode != 0:
        raise HTTPException(status_code=500, detail={"error": "not_a_git_repo", "message": git_process.stderr.strip()})
    return Path(git_process.stdout.strip())

def compute_git_commit_hash(repository_root: Path) -> str:
    git_process = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repository_root, capture_output=True, text=True)
    if git_process.returncode != 0:
        raise HTTPException(status_code=500, detail={"error": "git_error", "message": git_process.stderr.strip()})
    return git_process.stdout.strip()

def get_active_branch_name(repository_root: Path) -> str:
    git_process = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repository_root, capture_output=True, text=True)
    if git_process.returncode != 0:
        return "unknown"
    return git_process.stdout.strip()

def fetch_remote_origin_url(repository_root: Path) -> Optional[str]:
    git_process = subprocess.run(["git", "remote", "get-url", "origin"], cwd=repository_root, capture_output=True, text=True)
    if git_process.returncode != 0:
        return None
    return git_process.stdout.strip()

def parse_pull_request_url(push_output: str) -> Optional[str]:
    if not push_output:
        return None
    url_match = PULL_REQUEST_URL_PATTERN.search(push_output)
    return url_match.group(0) if url_match else None

def create_branch_commit_and_push(branch_name: str, commit_message: str, working_directory: Path, modified_files: list = None) -> str:
    """
    Create new branch, commit pending changes, and push to remote repository.
    
    Args:
        branch_name: Name for the new branch
        commit_message: Git commit message
        working_directory: Repository root directory path
        modified_files: Optional list of specific files to stage. If None, adds all tracked changes.
    
    Returns:
        Push command output (may contain pull request URL)
    """
    subprocess.run(["git", "checkout", "-B", branch_name], cwd=working_directory, check=True)
    try:
        subprocess.run(["terraform", "fmt", "-recursive"], cwd=working_directory, check=False)
    except Exception:
        pass

    # Stage files - either specific files or all tracked modifications
    if modified_files:
        # Stage only specified files that were modified
        for file_path in modified_files:
            absolute_file_path = working_directory / file_path if not Path(file_path).is_absolute() else Path(file_path)
            if absolute_file_path.exists():
                subprocess.run(["git", "add", str(file_path)], cwd=working_directory, check=True)
    else:
        # Default: stage only tracked files (respects .gitignore)
        subprocess.run(["git", "add", "-u"], cwd=working_directory, check=True)

    # Verify if any changes are staged
    diff_check = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=working_directory)
    if diff_check.returncode == 0:
        # No changes staged - create a marker file to force commit
        (working_directory / ".infrara-touch").write_text(str(time.time()))
        subprocess.run(["git", "add", ".infrara-touch"], cwd=working_directory, check=True)

    subprocess.run(["git", "commit", "-m", commit_message], cwd=working_directory, check=True)
    push_result = subprocess.run(
        ["git", "push", "-u", "origin", branch_name],
        cwd=working_directory, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    return push_result.stdout or ""
