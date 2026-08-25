"""
Query logging service for LLM training dataset collection.
Persists all user prompts, generated infrastructure representations, and AI reasoning for model fine-tuning.
"""
import json
from typing import Optional, Dict, Any, List
from datetime import datetime
from app.database.connection import primary_session_context
from app.database.models import QueryLog


class InfrastructureQueryLogger:
    """Logs infrastructure queries for LLM training dataset generation"""
    
    def persist_query(
        self,
        user_prompt: str,
        infrastructure_representation: Optional[Dict[str, Any]] = None,
        ai_reasoning_tree: Optional[Dict[str, Any]] = None,
        processing_time_ms: Optional[int] = None,
        language_model_identifier: Optional[str] = None,
        account_id: Optional[str] = None,
        query_successful: bool = True,
        failure_message: Optional[str] = None,
    ) -> str:
        """
        Persist infrastructure query to database for training dataset.
        
        Args:
            user_prompt: User's natural language infrastructure request
            infrastructure_representation: Generated intermediate representation
            ai_reasoning_tree: AI reasoning and decision steps
            processing_time_ms: Time taken to process request
            language_model_identifier: Model used (claude, openai, mock)
            account_id: Optional user account identifier
            query_successful: Whether query processing succeeded
            failure_message: Error description if failed
        
        Returns:
            query_record_id: UUID of persisted query log
        """
        with primary_session_context() as db_session:
            query_record = QueryLog(
                prompt=user_prompt,
                ir=infrastructure_representation,
                reasoning_tree=ai_reasoning_tree,
                execution_time_ms=processing_time_ms,
                llm_model=language_model_identifier,
                user_id=account_id,
                success=query_successful,
                error_message=failure_message,
            )
            db_session.add(query_record)
            db_session.commit()
            db_session.refresh(query_record)
            
            return query_record.id
    
    def retrieve_query_by_id(self, query_record_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a specific query record by unique identifier"""
        with primary_session_context() as db_session:
            query_record = db_session.query(QueryLog).filter(QueryLog.id == query_record_id).first()
            if query_record:
                return self._convert_query_to_dict(query_record)
            return None
    
    def fetch_recent_queries(self, result_limit: int = 100, account_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetch recent query records, optionally filtered by user account"""
        with primary_session_context() as db_session:
            query_builder = db_session.query(QueryLog).order_by(QueryLog.created_at.desc())
            
            if account_id:
                query_builder = query_builder.filter(QueryLog.user_id == account_id)
            
            query_records = query_builder.limit(result_limit).all()
            return [self._convert_query_to_dict(record) for record in query_records]
    
    def export_fine_tuning_dataset(
        self,
        export_file_path: str,
        export_format: str = "jsonl",
        minimum_success_threshold: float = 0.8,
        maximum_records: Optional[int] = None
    ):
        """
        Export query logs as LLM fine-tuning training dataset.
        
        Args:
            export_file_path: Destination file path for export
            export_format: 'jsonl' or 'json' format
            minimum_success_threshold: Only include successful queries
            maximum_records: Maximum number of query records to export
        """
        with primary_session_context() as db_session:
            query_builder = db_session.query(QueryLog).filter(QueryLog.success == True).order_by(QueryLog.created_at.desc())
            
            if maximum_records:
                query_builder = query_builder.limit(maximum_records)
            
            successful_queries = query_builder.all()
            
            formatted_training_data = []
            for query_record in successful_queries:
                # Format for LLM fine-tuning (OpenAI/Anthropic compatible)
                formatted_training_data.append({
                    "prompt": query_record.prompt,
                    "completion": json.dumps(query_record.ir) if query_record.ir else "",
                    "metadata": {
                        "reasoning": query_record.reasoning_tree,
                        "execution_time_ms": query_record.execution_time_ms,
                        "model": query_record.llm_model,
                        "timestamp": query_record.created_at.isoformat(),
                    }
                })
            
            with open(export_file_path, 'w') as export_file:
                if export_format == "jsonl":
                    for training_item in formatted_training_data:
                        export_file.write(json.dumps(training_item) + "\n")
                else:
                    json.dump(formatted_training_data, export_file, indent=2)
            
            return len(formatted_training_data)
    
    def compute_query_statistics(self) -> Dict[str, Any]:
        """Compute comprehensive query statistics for system monitoring"""
        with primary_session_context() as db_session:
            total_query_count = db_session.query(QueryLog).count()
            successful_query_count = db_session.query(QueryLog).filter(QueryLog.success == True).count()
            failed_query_count = total_query_count - successful_query_count
            
            # Calculate average processing time
            execution_times = db_session.query(QueryLog.execution_time_ms).filter(
                QueryLog.execution_time_ms.isnot(None)
            ).all()
            average_processing_time = sum(time[0] for time in execution_times) / len(execution_times) if execution_times else 0
            
            # Aggregate model usage statistics
            model_usage_distribution = {}
            model_records = db_session.query(QueryLog.llm_model, QueryLog.id).filter(QueryLog.llm_model.isnot(None)).all()
            for model_name, _ in model_records:
                model_usage_distribution[model_name] = model_usage_distribution.get(model_name, 0) + 1
            
            return {
                "total_queries": total_query_count,
                "successful_queries": successful_query_count,
                "failed_queries": failed_query_count,
                "success_rate": (successful_query_count / total_query_count * 100) if total_query_count > 0 else 0,
                "average_execution_time_ms": round(average_processing_time, 2),
                "model_usage": model_usage_distribution,
            }
    
    def _convert_query_to_dict(self, query_record: QueryLog) -> Dict[str, Any]:
        """Convert QueryLog model instance to dictionary representation"""
        return {
            "id": query_record.id,
            "prompt": query_record.prompt,
            "ir": query_record.ir,
            "reasoning_tree": query_record.reasoning_tree,
            "execution_time_ms": query_record.execution_time_ms,
            "llm_model": query_record.llm_model,
            "user_id": query_record.user_id,
            "success": query_record.success,
            "error_message": query_record.error_message,
            "created_at": query_record.created_at.isoformat() if query_record.created_at else None,
        }


# Global query logger instance
infrastructure_query_logger = InfrastructureQueryLogger()
query_logger = infrastructure_query_logger
