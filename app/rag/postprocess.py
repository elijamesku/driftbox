# Terraform repository post-processing: file writing and validation
import subprocess, textwrap
from typing import Dict, Any, Tuple
from pathlib import Path

def _execute_subprocess_command(command_args, working_directory) -> Tuple[int,str]:
    process = subprocess.Popen(command_args, cwd=working_directory, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    stdout_output, _ = process.communicate()
    return process.returncode, stdout_output

def write_terraform_files_to_disk(hcl_files_mapping: Dict[str, str], output_directory: Path):
    output_directory.mkdir(parents=True, exist_ok=True)
    for relative_file_path, hcl_content in hcl_files_mapping.items():
        destination_file_path = output_directory / relative_file_path
        destination_file_path.parent.mkdir(parents=True, exist_ok=True)
        destination_file_path.write_text(hcl_content)

def validate_terraform_repository(repository_directory: Path) -> Dict[str, Any]:
    validation_workflow_steps = [
        (["terraform","fmt","-recursive"], "fmt"),
        (["terraform","init","-backend=false","-input=false","-no-color"], "init"),
        (["terraform","validate"], "validate"),
    ]
    validation_results = {}
    last_exit_code = 0
    for command_args, step_name in validation_workflow_steps:
        exit_code, command_output = _execute_subprocess_command(command_args, cwd=repository_directory)
        validation_results[step_name] = {"ok": exit_code == 0, "output": command_output}
        last_exit_code = exit_code
        if exit_code != 0:
            return {"ok": False, "steps": validation_results}

    # Execute optional validation tools if available
    for tool_name, tool_command_args in [("tflint", ["tflint","--format","json"]), ("tfsec", ["tfsec","--format","json"])]:
        try:
            exit_code, tool_output = _execute_subprocess_command(tool_command_args, cwd=repository_directory)
            validation_results[tool_name] = {"ok": exit_code == 0, "output": tool_output}
        except FileNotFoundError:
            validation_results[tool_name] = {"ok": True, "note": f"{tool_name} not installed on system"}
    return {"ok": True, "steps": validation_results}
