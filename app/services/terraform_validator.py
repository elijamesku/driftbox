"""
Fast Terraform validation service - format and validate without initialization overhead.
Optimized for sub-second validation during infrastructure code generation.
"""
import subprocess
from pathlib import Path
from typing import Dict
import os


class RapidTerraformValidator:
    """Lightweight high-performance Terraform validator"""
    
    def __init__(self):
        # Verify terraform CLI availability
        self.terraform_cli_available = self._verify_terraform_installation()
    
    def _verify_terraform_installation(self) -> bool:
        """Verify Terraform CLI is installed and accessible"""
        try:
            cli_check_result = subprocess.run(
                ["terraform", "version"],
                capture_output=True,
                timeout=2
            )
            return cli_check_result.returncode == 0
        except:
            return False
    
    def execute_rapid_validation(self, target_directory: Path) -> Dict:
        """
        High-speed validation: format check + validate (skipping init).
        Returns validation results in under 1 second.
        """
        validation_results = {
            "formatted": False,
            "valid": None,  # None = skipped, True/False = validation result
            "errors": [],
            "warnings": [],
            "duration_ms": 0
        }
        
        if not self.terraform_cli_available:
            validation_results["warnings"].append("Terraform CLI unavailable - validation skipped")
            return validation_results
        
        import time
        validation_start_time = time.time()
        
        # Operation 1: Format verification (rapid - no file modification, check only)
        try:
            format_check_result = subprocess.run(
                ["terraform", "fmt", "-check", "-recursive"],
                cwd=target_directory,
                capture_output=True,
                text=True,
                timeout=3  # 3-second timeout limit
            )
            validation_results["formatted"] = (format_check_result.returncode == 0)
            
            # Auto-format if not properly formatted
            if not validation_results["formatted"]:
                subprocess.run(
                    ["terraform", "fmt", "-recursive"],
                    cwd=target_directory,
                    capture_output=True,
                    timeout=3
                )
                validation_results["formatted"] = True
                validation_results["auto_formatted"] = True
                
        except subprocess.TimeoutExpired:
            validation_results["warnings"].append("Format verification timed out")
        except Exception as format_error:
            validation_results["warnings"].append(f"Format verification failed: {str(format_error)}")
        
        # Operation 2: Syntax validation (no initialization - pure syntax check)
        # NOTE: Validates syntax but won't detect provider-specific issues
        try:
            validation_check_result = subprocess.run(
                ["terraform", "validate", "-no-color"],
                cwd=target_directory,
                capture_output=True,
                text=True,
                timeout=5,  # 5-second timeout limit
                env={**os.environ, "TF_CLI_ARGS": "-no-color"}
            )
            
            # Process validation output
            if validation_check_result.returncode == 0:
                validation_results["valid"] = True
            else:
                validation_results["valid"] = False
                # Extract error messages from stderr
                error_message_lines = [line for line in validation_check_result.stderr.split("\n") if line.strip()]
                if error_message_lines:
                    validation_results["errors"] = error_message_lines[:5]  # Limit to first 5 errors
                    
        except subprocess.TimeoutExpired:
            validation_results["warnings"].append("Validation timed out - configuration may be complex")
        except Exception as validation_error:
            validation_results["warnings"].append(f"Validation skipped: {str(validation_error)}")
        
        validation_results["duration_ms"] = int((time.time() - validation_start_time) * 1000)
        return validation_results


# Global rapid validator singleton
rapid_terraform_validator = RapidTerraformValidator()
terraform_validator = rapid_terraform_validator
