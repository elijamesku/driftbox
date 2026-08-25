"""
GitHub Actions integration service.
Monitors workflow runs and manages deployment state.
"""
import os
import requests
import subprocess
import json
from typing import Optional, Dict, Any, List
from pathlib import Path


class GitHubActionsService:
    """Service for interacting with GitHub Actions API and managing deployment state"""
    
    def __init__(self):
        pass
    
    def get_workflow_runs_for_pr(
        self,
        token: str,
        owner: str,
        repo: str,
        pr_number: Optional[int] = None,
        branch: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get workflow runs for a PR or branch.
        
        Args:
            token: GitHub access token
            owner: Repository owner
            repo: Repository name
            pr_number: PR number (optional)
            branch: Branch name (optional)
        
        Returns:
            List of workflow runs
        """
        url = f"https://api.github.com/repos/{owner}/{repo}/actions/runs"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        params = {"per_page": 10}
        if branch:
            params["branch"] = branch
        
        try:
            response = requests.get(url, headers=headers, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            runs = data.get("workflow_runs", [])
            
            # Filter by PR if provided
            if pr_number:
                runs = [r for r in runs if r.get("pull_requests") and 
                       any(pr.get("number") == pr_number for pr in r.get("pull_requests", []))]
            
            return runs
        except Exception as e:
            print(f"[GitHubActions] Error fetching workflow runs: {e}")
            return []
    
    def get_workflow_run_status(
        self,
        token: str,
        owner: str,
        repo: str,
        run_id: int
    ) -> Optional[Dict[str, Any]]:
        """
        Get status of a specific workflow run.
        
        Returns:
            Workflow run details with status, conclusion, etc.
        """
        url = f"https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"[GitHubActions] Error fetching workflow run {run_id}: {e}")
            return None
    
    def is_deployment_successful(
        self,
        token: str,
        owner: str,
        repo: str,
        branch: str
    ) -> bool:
        """
        Check if the latest workflow run for a branch completed successfully.
        
        Returns:
            True if latest run is successful, False otherwise
        """
        runs = self.get_workflow_runs_for_pr(token, owner, repo, branch=branch)
        if not runs:
            return False
        
        latest_run = runs[0]  # Most recent
        conclusion = latest_run.get("conclusion")
        status = latest_run.get("status")
        
        # Check if completed and successful
        return status == "completed" and conclusion == "success"
    
    def get_workflow_artifacts(
        self,
        token: str,
        owner: str,
        repo: str,
        run_id: int
    ) -> List[Dict[str, Any]]:
        """
        Get artifacts from a workflow run.
        
        Returns:
            List of artifact metadata
        """
        url = f"https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()
            return data.get("artifacts", [])
        except Exception as e:
            print(f"[GitHubActions] Error fetching artifacts for run {run_id}: {e}")
            return []
    
    def download_artifact(
        self,
        token: str,
        owner: str,
        repo: str,
        artifact_id: int,
        download_path: Path
    ) -> bool:
        """
        Download a workflow artifact.
        
        Returns:
            True if successful, False otherwise
        """
        url = f"https://api.github.com/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        try:
            response = requests.get(url, headers=headers, timeout=30, stream=True)
            response.raise_for_status()
            
            download_path.parent.mkdir(parents=True, exist_ok=True)
            with open(download_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            return True
        except Exception as e:
            print(f"[GitHubActions] Error downloading artifact {artifact_id}: {e}")
            return False


# Global instance
github_actions_service = GitHubActionsService()

