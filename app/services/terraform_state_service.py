"""
Terraform state management service.
Handles state locking, backend configuration, and state file operations.
"""
import os
import subprocess
import json
import time
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
import re


class TerraformStateService:
    """Service for managing Terraform state with proper locking support"""
    
    def __init__(self):
        pass
    
    def detect_backend_config(self, workspace_path: str) -> Dict[str, Any]:
        """
        Detect if Terraform backend is configured and what type.
        
        Returns:
            {
                "has_backend": bool,
                "backend_type": str | None,  # "s3", "remote", "local", etc.
                "supports_locking": bool,
                "lock_table": str | None,  # DynamoDB table name if S3 backend
                "state_bucket": str | None  # S3 bucket if S3 backend
            }
        """
        workspace = Path(workspace_path)
        
        # Check for backend configuration in terraform blocks
        backend_info = {
            "has_backend": False,
            "backend_type": None,
            "supports_locking": False,
            "lock_table": None,
            "state_bucket": None
        }
        
        # Search for backend configuration in .tf files
        tf_files = list(workspace.glob("*.tf"))
        backend_config_found = False
        
        for tf_file in tf_files:
            try:
                content = tf_file.read_text()
                
                # Check for backend block
                if "backend" in content:
                    backend_config_found = True
                    backend_info["has_backend"] = True
                    
                    # Check for S3 backend with DynamoDB locking
                    if "backend \"s3\"" in content or 'backend "s3"' in content:
                        backend_info["backend_type"] = "s3"
                        
                        # Extract bucket name
                        bucket_match = re.search(r'bucket\s*=\s*["\']([^"\']+)["\']', content)
                        if bucket_match:
                            backend_info["state_bucket"] = bucket_match.group(1)
                        
                        # Extract DynamoDB table (for locking)
                        table_match = re.search(r'dynamodb_table\s*=\s*["\']([^"\']+)["\']', content)
                        if table_match:
                            backend_info["lock_table"] = table_match.group(1)
                            backend_info["supports_locking"] = True
                        else:
                            # S3 backend without DynamoDB table doesn't support locking
                            backend_info["supports_locking"] = False
                    
                    # Check for other backend types
                    elif "backend \"remote\"" in content:
                        backend_info["backend_type"] = "remote"
                        backend_info["supports_locking"] = True  # Terraform Cloud/Enterprise supports locking
                    elif "backend \"azurerm\"" in content:
                        backend_info["backend_type"] = "azurerm"
                        backend_info["supports_locking"] = True
                    elif "backend \"gcs\"" in content:
                        backend_info["backend_type"] = "gcs"
                        backend_info["supports_locking"] = True
                    else:
                        # Local backend or unspecified
                        backend_info["backend_type"] = "local"
                        backend_info["supports_locking"] = False
                    
                    break  # Found backend config, no need to check other files
            except Exception as e:
                print(f"[StateService] Error reading {tf_file}: {e}")
                continue
        
        # If no backend block found, check if using default local backend
        if not backend_config_found:
            backend_info["backend_type"] = "local"
            backend_info["supports_locking"] = False
        
        return backend_info
    
    def check_state_lock(self, workspace_path: str) -> Tuple[bool, Optional[str]]:
        """
        Check if state is currently locked.
        
        Returns:
            (is_locked: bool, lock_info: str | None)
        """
        try:
            # Try to run terraform plan with -lock=false to check for locks
            # If state is locked, terraform will return an error
            result = subprocess.run(
                ["terraform", "plan", "-lock=false", "-refresh=false", "-out=/dev/null"],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                timeout=10
            )
            
            # Check for lock-related errors
            if "Error acquiring the state lock" in result.stderr or "lock" in result.stderr.lower():
                # Extract lock information
                lock_match = re.search(r'Lock ID:\s*([^\n]+)', result.stderr)
                lock_id = lock_match.group(1) if lock_match else "unknown"
                return True, f"State is locked (Lock ID: {lock_id})"
            
            return False, None
        except Exception as e:
            # If command fails for other reasons, assume not locked
            print(f"[StateService] Could not check lock status: {e}")
            return False, None
    
    def wait_for_lock_release(
        self,
        workspace_path: str,
        max_wait_seconds: int = 300,
        check_interval: int = 5
    ) -> Tuple[bool, Optional[str]]:
        """
        Wait for state lock to be released.
        
        Args:
            workspace_path: Path to Terraform workspace
            max_wait_seconds: Maximum time to wait
            check_interval: Seconds between lock checks
        
        Returns:
            (success: bool, message: str | None)
        """
        start_time = time.time()
        
        while time.time() - start_time < max_wait_seconds:
            is_locked, lock_info = self.check_state_lock(workspace_path)
            
            if not is_locked:
                return True, "State lock released"
            
            print(f"[StateService] State is locked, waiting... ({lock_info})")
            time.sleep(check_interval)
        
        return False, f"State lock not released after {max_wait_seconds} seconds"
    
    def ensure_state_lock_released(self, workspace_path: str) -> Dict[str, Any]:
        """
        Ensure state lock is released before operations.
        If locked, wait for release or provide guidance.
        
        Returns:
            {
                "success": bool,
                "was_locked": bool,
                "message": str,
                "lock_info": str | None
            }
        """
        is_locked, lock_info = self.check_state_lock(workspace_path)
        
        if not is_locked:
            return {
                "success": True,
                "was_locked": False,
                "message": "State is not locked, safe to proceed",
                "lock_info": None
            }
        
        # State is locked - wait for release
        print(f"[StateService] State is locked: {lock_info}")
        print(f"[StateService] Waiting for lock to be released...")
        
        success, message = self.wait_for_lock_release(workspace_path)
        
        if success:
            return {
                "success": True,
                "was_locked": True,
                "message": message,
                "lock_info": lock_info
            }
        else:
            return {
                "success": False,
                "was_locked": True,
                "message": message,
                "lock_info": lock_info,
                "error": "State lock timeout - another process may be using the state"
            }
    
    def get_backend_locking_guidance(self, backend_info: Dict[str, Any]) -> str:
        """
        Generate guidance for setting up state locking based on backend type.
        """
        if backend_info["supports_locking"]:
            if backend_info["backend_type"] == "s3":
                if backend_info["lock_table"]:
                    return f"✅ State locking is configured (S3 backend with DynamoDB table: {backend_info['lock_table']})"
                else:
                    return "⚠️  S3 backend detected but no DynamoDB table configured. Add 'dynamodb_table' to enable state locking."
            else:
                return f"✅ State locking is supported by {backend_info['backend_type']} backend"
        else:
            if backend_info["backend_type"] == "local":
                return """⚠️  Local backend detected - state locking is not available.
            
To enable state locking, configure a remote backend:
1. S3 backend with DynamoDB (recommended for AWS):
   terraform {
     backend "s3" {
       bucket         = "your-terraform-state-bucket"
       key            = "path/to/terraform.tfstate"
       region         = "us-east-1"
       dynamodb_table = "terraform-state-lock"  # Required for locking
       encrypt        = true
     }
   }

2. Create DynamoDB table for locking:
   - Table name: terraform-state-lock
   - Primary key: LockID (String)
   - Enable point-in-time recovery (recommended)
"""
            else:
                return f"⚠️  Backend type '{backend_info['backend_type']}' may not support state locking"
        
        return ""


# Global instance
terraform_state_service = TerraformStateService()

