"""
Terraform initialization service with intelligent caching capabilities.
Automatically executes terraform init when repository is indexed and caches results.
"""
import subprocess
from pathlib import Path
from typing import Dict
import time


class TerraformInitializationManager:
    """Manages terraform initialization with intelligent caching"""
    
    def __init__(self):
        self._initialization_cache: Dict[str, float] = {}  # directory -> timestamp mapping
        self._cache_expiration_seconds = 3600  # 1 hour TTL
    
    def check_initialization_status(self, working_directory: Path) -> bool:
        """Verify if terraform is already initialized in specified directory"""
        terraform_state_dir = working_directory / ".terraform"
        return terraform_state_dir.exists() and (terraform_state_dir / "providers").exists()
    
    def run_init(self, working_directory: Path, force_reinitialize: bool = False) -> Dict:
        """
        Execute terraform init if needed, utilizing cache when appropriate.
        
        Args:
            working_directory: Directory containing terraform configuration files
            force_reinitialize: Force initialization even if already initialized
        
        Returns:
            {
                "initialized": bool,
                "already_initialized": bool,
                "duration_ms": int,
                "output": str
            }
        """
        directory_path = str(working_directory.resolve())
        operation_start_time = time.time()
        
        # Verify if already initialized and cache is valid
        if not force_reinitialize and self.check_initialization_status(working_directory):
            last_cached_timestamp = self._initialization_cache.get(directory_path, 0)
            if time.time() - last_cached_timestamp < self._cache_expiration_seconds:
                return {
                    "initialized": True,
                    "already_initialized": True,
                    "cached": True,
                    "duration_ms": int((time.time() - operation_start_time) * 1000),
                    "output": "Terraform already initialized (cached)"
                }
        
        # Execute terraform init
        try:
            init_process = subprocess.run(
                ["terraform", "init", "-backend=false", "-input=false", "-no-color"],
                cwd=working_directory,
                capture_output=True,
                text=True,
                timeout=60  # 1 minute timeout
            )
            
            operation_duration_ms = int((time.time() - operation_start_time) * 1000)
            
            if init_process.returncode == 0:
                # Cache successful initialization
                self._initialization_cache[directory_path] = time.time()
                return {
                    "initialized": True,
                    "already_initialized": False,
                    "cached": False,
                    "duration_ms": operation_duration_ms,
                    "output": init_process.stdout
                }
            else:
                return {
                    "initialized": False,
                    "already_initialized": False,
                    "cached": False,
                    "duration_ms": operation_duration_ms,
                    "error": init_process.stderr,
                    "output": init_process.stdout
                }
        
        except subprocess.TimeoutExpired:
            return {
                "initialized": False,
                "already_initialized": False,
                "duration_ms": int((time.time() - operation_start_time) * 1000),
                "error": "Terraform init timed out after 60 seconds"
            }
        
        except FileNotFoundError:
            return {
                "initialized": False,
                "already_initialized": False,
                "duration_ms": int((time.time() - operation_start_time) * 1000),
                "error": "Terraform not installed or not in PATH"
            }
        
        except Exception as e:
            return {
                "initialized": False,
                "already_initialized": False,
                "duration_ms": int((time.time() - operation_start_time) * 1000),
                "error": f"Terraform init failed: {str(e)}"
            }
    
    def purge_initialization_cache(self, working_directory: Path = None):
        """Clear initialization cache for a specific directory or all directories"""
        if working_directory:
            directory_path = str(working_directory.resolve())
            self._initialization_cache.pop(directory_path, None)
        else:
            self._initialization_cache.clear()


# Global singleton instance
terraform_initialization_manager = TerraformInitializationManager()
terraform_init_manager = terraform_initialization_manager

