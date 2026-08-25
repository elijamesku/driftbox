from pathlib import Path
from typing import Dict, Any
from fastapi import HTTPException
from app.core.terraform import execute_terraform_plan
# ------------------------------------------------------------------------------
# CI pipeline preview (fmt→init→validate→plan) simulating GitHub Actions workflow
# ------------------------------------------------------------------------------
def execute_ci_validation_preview(repository_root: Path, target_subdirectory: str = ".") -> Dict[str, Any]:
    target_path = (repository_root / target_subdirectory).resolve()
    if not target_path.exists():
        raise HTTPException(status_code=400, detail={"error": "directory_not_found", "message": f"{target_subdirectory} does not exist in repository"})
    validation_result = execute_terraform_plan(target_path)
    return validation_result
