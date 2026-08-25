"""
Performance metrics tracking for sub-10 second workflow optimization.
Measures timing for: prompt processing → terraform init → fmt → validate operations.
"""
import time
from typing import Optional, Dict, Any
from datetime import datetime
from contextlib import contextmanager
from app.database.connection import primary_session_context
from app.database.models import PerformanceMetric


class WorkflowPerformanceMonitor:
    """Tracks and analyzes performance metrics for workflow optimization"""
    
    @contextmanager
    def monitor_operation_performance(
        self,
        operation_name: str,
        user_prompt_length: Optional[int] = None,
        affected_resource_count: Optional[int] = None,
        ai_model_identifier: Optional[str] = None,
    ):
        """
        Context manager for operation timing measurement.
        
        Usage:
            with workflow_performance_monitor.monitor_operation_performance("terraform_validate"):
                execute_terraform_validation()
        """
        operation_start_time = time.time()
        operation_started_at = datetime.utcnow()
        execution_error = None
        
        try:
            yield
        except Exception as caught_exception:
            execution_error = str(caught_exception)
            raise
        finally:
            operation_end_time = time.time()
            operation_completed_at = datetime.utcnow()
            elapsed_duration_ms = int((operation_end_time - operation_start_time) * 1000)
            
            # Persist metric to database
            try:
                self.persist_performance_metric(
                    operation_name=operation_name,
                    duration_milliseconds=elapsed_duration_ms,
                    started_timestamp=operation_started_at,
                    completed_timestamp=operation_completed_at,
                    user_prompt_length=user_prompt_length,
                    affected_resource_count=affected_resource_count,
                    ai_model_identifier=ai_model_identifier,
                    operation_successful=execution_error is None,
                    error_description=execution_error,
                )
            except Exception:
                # Suppress logging failures to avoid disrupting primary operation
                pass
    
    def persist_performance_metric(
        self,
        operation_name: str,
        duration_milliseconds: int,
        started_timestamp: datetime,
        completed_timestamp: datetime,
        user_prompt_length: Optional[int] = None,
        affected_resource_count: Optional[int] = None,
        ai_model_identifier: Optional[str] = None,
        operation_successful: bool = True,
        error_description: Optional[str] = None,
    ):
        """Persist performance metric to database"""
        with primary_session_context() as db_session:
            performance_metric_record = PerformanceMetric(
                operation=operation_name,
                duration_ms=duration_milliseconds,
                started_at=started_timestamp,
                completed_at=completed_timestamp,
                prompt_length=user_prompt_length,
                resource_count=affected_resource_count,
                llm_model=ai_model_identifier,
                success=operation_successful,
                error_message=error_description,
            )
            db_session.add(performance_metric_record)
            db_session.commit()
    
    def compute_performance_statistics(self, operation_filter: Optional[str] = None) -> Dict[str, Any]:
        """Compute performance statistics for operations"""
        with primary_session_context() as db_session:
            query = db_session.query(PerformanceMetric)
            
            if operation_filter:
                query = query.filter(PerformanceMetric.operation == operation_filter)
            
            metric_records = query.all()
            
            if not metric_records:
                return {
                    "operation": operation_filter,
                    "total_samples": 0,
                }
            
            duration_measurements = [record.duration_ms for record in metric_records]
            successful_operations = [record for record in metric_records if record.success]
            
            return {
                "operation": operation_filter or "all_operations",
                "total_samples": len(metric_records),
                "successful_samples": len(successful_operations),
                "success_rate": (len(successful_operations) / len(metric_records) * 100) if metric_records else 0,
                "avg_duration_ms": sum(duration_measurements) / len(duration_measurements),
                "min_duration_ms": min(duration_measurements),
                "max_duration_ms": max(duration_measurements),
                "p50_duration_ms": self._compute_percentile(duration_measurements, 0.5),
                "p95_duration_ms": self._compute_percentile(duration_measurements, 0.95),
                "p99_duration_ms": self._compute_percentile(duration_measurements, 0.99),
            }
    
    def generate_workflow_performance_breakdown(self) -> Dict[str, Any]:
        """
        Generate detailed breakdown of complete workflow timing.
        Performance goal: prompt + init + fmt + validate < 10 seconds
        """
        critical_operations = [
            "prompt_to_ir",
            "terraform_init",
            "terraform_fmt",
            "terraform_validate",
        ]
        
        operation_breakdown = {}
        cumulative_average_duration = 0
        
        for critical_operation in critical_operations:
            operation_stats = self.compute_performance_statistics(critical_operation)
            average_duration = operation_stats.get("avg_duration_ms", 0)
            operation_breakdown[critical_operation] = {
                "avg_ms": round(average_duration, 2),
                "samples": operation_stats.get("total_samples", 0),
            }
            cumulative_average_duration += average_duration
        
        return {
            "breakdown": operation_breakdown,
            "total_avg_ms": round(cumulative_average_duration, 2),
            "total_avg_seconds": round(cumulative_average_duration / 1000, 2),
            "meets_performance_goal": cumulative_average_duration < 10000,  # < 10 seconds target
            "performance_goal_ms": 10000,
        }
    
    def _compute_percentile(self, measurement_data: list, percentile_value: float) -> float:
        """Calculate statistical percentile from measurements"""
        if not measurement_data:
            return 0
        sorted_measurements = sorted(measurement_data)
        percentile_index = int(len(sorted_measurements) * percentile_value)
        return sorted_measurements[min(percentile_index, len(sorted_measurements) - 1)]


# Global performance monitoring singleton
workflow_performance_monitor = WorkflowPerformanceMonitor()
performance_tracker = workflow_performance_monitor
