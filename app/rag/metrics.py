"""
Production Metrics & Monitoring for Infrastructure Generation
Tracks success rates, errors, and performance for observability.
"""
import time
from typing import Dict, Any, Optional
from datetime import datetime
import json


class GenerationMetrics:
    """Track metrics for infrastructure generation."""
    
    def __init__(self):
        self.total_requests = 0
        self.successful_generations = 0
        self.validation_failures = 0
        self.generation_failures = 0
        self.terraform_validation_failures = 0
        
        self.total_resources_generated = 0
        self.total_files_generated = 0
        
        self.generation_times = []
        self.validation_times = []
        
        self.error_types = {}  # error_type -> count
        
    def record_request(self):
        """Record a new generation request."""
        self.total_requests += 1
    
    def record_success(self, resource_count: int, file_count: int, generation_time: float):
        """Record a successful generation."""
        self.successful_generations += 1
        self.total_resources_generated += resource_count
        self.total_files_generated += file_count
        self.generation_times.append(generation_time)
    
    def record_validation_failure(self, error_type: str):
        """Record an IR validation failure."""
        self.validation_failures += 1
        self.error_types[error_type] = self.error_types.get(error_type, 0) + 1
    
    def record_generation_failure(self, error_type: str):
        """Record an HCL generation failure."""
        self.generation_failures += 1
        self.error_types[error_type] = self.error_types.get(error_type, 0) + 1
    
    def record_terraform_failure(self):
        """Record a Terraform validation failure (after HCL generation)."""
        self.terraform_validation_failures += 1
    
    def get_success_rate(self) -> float:
        """Calculate overall success rate."""
        if self.total_requests == 0:
            return 0.0
        return (self.successful_generations / self.total_requests) * 100
    
    def get_average_generation_time(self) -> float:
        """Get average generation time in seconds."""
        if not self.generation_times:
            return 0.0
        return sum(self.generation_times) / len(self.generation_times)
    
    def get_summary(self) -> Dict[str, Any]:
        """Get metrics summary for monitoring dashboard."""
        return {
            "timestamp": datetime.utcnow().isoformat(),
            "total_requests": self.total_requests,
            "successful_generations": self.successful_generations,
            "validation_failures": self.validation_failures,
            "generation_failures": self.generation_failures,
            "terraform_failures": self.terraform_validation_failures,
            "success_rate": f"{self.get_success_rate():.2f}%",
            "avg_generation_time_ms": f"{self.get_average_generation_time() * 1000:.0f}",
            "total_resources_generated": self.total_resources_generated,
            "total_files_generated": self.total_files_generated,
            "avg_resources_per_request": self.total_resources_generated / max(1, self.total_requests),
            "top_errors": sorted(self.error_types.items(), key=lambda x: x[1], reverse=True)[:5]
        }
    
    def log_summary(self):
        """Log metrics summary to console."""
        summary = self.get_summary()
        print("\n" + "="*60)
        print("📊 INFRASTRUCTURE GENERATION METRICS")
        print("="*60)
        print(json.dumps(summary, indent=2))
        print("="*60 + "\n")


# Global metrics instance
_metrics = GenerationMetrics()


def get_metrics() -> GenerationMetrics:
    """Get global metrics instance."""
    return _metrics


def track_generation(func):
    """Decorator to track generation function metrics."""
    def wrapper(*args, **kwargs):
        _metrics.record_request()
        start_time = time.time()
        
        try:
            result = func(*args, **kwargs)
            generation_time = time.time() - start_time
            
            # Check if result indicates success or error
            if isinstance(result, dict):
                first_file = list(result.values())[0] if result else ""
                if "❌" in first_file or "ERROR" in first_file:
                    # Error result
                    if "VALIDATION" in first_file:
                        _metrics.record_validation_failure("IR_VALIDATION")
                    else:
                        _metrics.record_generation_failure("HCL_GENERATION")
                else:
                    # Success
                    resource_count = sum(1 for content in result.values() if "resource" in content)
                    _metrics.record_success(resource_count, len(result), generation_time)
            
            return result
            
        except Exception as e:
            _metrics.record_generation_failure(type(e).__name__)
            raise
    
    return wrapper

