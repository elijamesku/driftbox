import subprocess
from pathlib import Path 
from typing import List, Tuple, Dict, Any
from fastapi import HTTPException 
from app.utils.timestamp import get_current_timestamp

def _execute_subprocess(command: List[str], working_dir: Path) -> Tuple[int, str]:
    """Execute subprocess and capture output"""
    try:
        process = subprocess.Popen(command, cwd=working_dir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        output, _ = process.communicate()
        return process.returncode, output
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail={"error": "missing_dependency", "message": f"{command[0]} not found on PATH"})

def execute_terraform_command(step_name: str, command: List[str], working_dir: Path) -> Dict[str, Any]:
    """Execute a Terraform command step and capture result metadata"""
    start_time = get_current_timestamp()
    exit_code, command_output = _execute_subprocess(command, working_dir)
    end_time = get_current_timestamp()
    return {
        "name": step_name,
        "cmd": " ".join(command),
        "ok": exit_code == 0,
        "exit_code": exit_code,
        "started_at": start_time,
        "finished_at": end_time,
        "output": command_output,
    }