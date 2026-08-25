"""
Predictive Drift Detection Service
Predicts what will change next based on historical patterns
"""
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from collections import defaultdict, Counter
import json

from app.database.connection import get_db_connection


class PredictiveDriftService:
    """
    Predict future changes based on commit sequences
    
    Features:
    - Learn common commit sequences (A followed by B)
    - Predict what user will likely change next
    - Suggest proactive changes
    - Track prediction accuracy
    """
    
    async def learn_commit_sequences(
        self,
        user_id: int
    ) -> Dict[str, Any]:
        """
        Analyze commit history to find common sequences
        """
        try:
            print(f"🔮 [Predictions] Learning sequences for user {user_id}")
            
            db = await get_db_connection()
            
            # Fetch commits in chronological order
            commits = await db.fetch("""
                SELECT 
                    commit_sha,
                    commit_message,
                    commit_date,
                    pattern_type,
                    change_category,
                    files_changed,
                    resources_affected
                FROM commit_patterns
                WHERE user_id = $1
                ORDER BY commit_date ASC
            """, user_id)
            
            if len(commits) < 10:
                print(f"  ⚠️  Need at least 10 commits for sequence learning")
                return {"success": False, "error": "Insufficient data"}
            
            print(f"  📊 Analyzing {len(commits)} commits for sequences...")
            
            # Find sequences (commit A followed by commit B within 48 hours)
            sequences = []
            for i in range(len(commits) - 1):
                commit_a = commits[i]
                commit_b = commits[i + 1]
                
                time_diff = commit_b["commit_date"] - commit_a["commit_date"]
                
                # Only consider commits within 48 hours as a "sequence"
                if time_diff <= timedelta(hours=48):
                    sequence = {
                        "trigger_pattern": commit_a["pattern_type"] or "unknown",
                        "follow_up_pattern": commit_b["pattern_type"] or "unknown",
                        "trigger_category": commit_a["change_category"] or "general",
                        "follow_up_category": commit_b["change_category"] or "general",
                        "time_gap": time_diff,
                        "trigger_sha": commit_a["commit_sha"],
                        "follow_up_sha": commit_b["commit_sha"]
                    }
                    sequences.append(sequence)
            
            # Group and count frequent sequences
            sequence_counts = defaultdict(lambda: {
                "count": 0,
                "time_gaps": [],
                "examples": []
            })
            
            for seq in sequences:
                key = f"{seq['trigger_pattern']}:{seq['follow_up_pattern']}"
                sequence_counts[key]["count"] += 1
                sequence_counts[key]["time_gaps"].append(seq["time_gap"])
                sequence_counts[key]["examples"].append({
                    "trigger_sha": seq["trigger_sha"],
                    "follow_up_sha": seq["follow_up_sha"],
                    "time_gap": seq["time_gap"].total_seconds() / 3600  # hours
                })
            
            # Store frequent sequences (appeared 2+ times)
            total_stored = 0
            for sequence_key, data in sequence_counts.items():
                if data["count"] >= 2:  # At least 2 occurrences
                    trigger, follow_up = sequence_key.split(":")
                    
                    # Calculate statistics
                    time_gaps = data["time_gaps"]
                    avg_gap = sum(gap.total_seconds() for gap in time_gaps) / len(time_gaps)
                    min_gap = min(gap.total_seconds() for gap in time_gaps)
                    max_gap = max(gap.total_seconds() for gap in time_gaps)
                    
                    # Calculate probability (what % of triggers led to this follow-up)
                    total_triggers = sum(
                        1 for c in commits if c["pattern_type"] == trigger
                    )
                    probability = data["count"] / total_triggers if total_triggers > 0 else 0
                    
                    await self._store_sequence(
                        db=db,
                        user_id=user_id,
                        trigger_pattern=trigger,
                        follow_up_pattern=follow_up,
                        occurrence_count=data["count"],
                        total_opportunities=total_triggers,
                        probability=probability,
                        avg_time_gap=timedelta(seconds=avg_gap),
                        min_time_gap=timedelta(seconds=min_gap),
                        max_time_gap=timedelta(seconds=max_gap),
                        examples=data["examples"][:5]  # Keep top 5 examples
                    )
                    total_stored += 1
            
            print(f"✅ [Predictions] Learned {total_stored} sequences")
            
            return {
                "success": True,
                "sequences_learned": total_stored,
                "total_commits_analyzed": len(commits)
            }
            
        except Exception as e:
            print(f"⚠️  [Predictions] Error: {e}")
            return {"success": False, "error": str(e)}
    
    async def _store_sequence(
        self,
        db: Any,
        user_id: int,
        trigger_pattern: str,
        follow_up_pattern: str,
        occurrence_count: int,
        total_opportunities: int,
        probability: float,
        avg_time_gap: timedelta,
        min_time_gap: timedelta,
        max_time_gap: timedelta,
        examples: List[Dict]
    ) -> None:
        """Store a learned commit sequence"""
        await db.execute("""
            INSERT INTO commit_sequences (
                user_id, trigger_pattern, follow_up_pattern,
                occurrence_count, total_opportunities, probability,
                avg_time_gap, min_time_gap, max_time_gap,
                example_sequences, confidence_score, last_seen,
                created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (user_id, trigger_pattern, follow_up_pattern)
            DO UPDATE SET
                occurrence_count = $4,
                total_opportunities = $5,
                probability = $6,
                avg_time_gap = $7,
                min_time_gap = $8,
                max_time_gap = $9,
                example_sequences = $10,
                confidence_score = $11,
                last_seen = $12,
                updated_at = $14
        """,
            user_id, trigger_pattern, follow_up_pattern,
            occurrence_count, total_opportunities, probability,
            avg_time_gap, min_time_gap, max_time_gap,
            json.dumps(examples),
            min(probability, 0.95),  # Confidence capped at 95%
            datetime.now(),
            datetime.now(), datetime.now()
        )
    
    async def predict_next_changes(
        self,
        user_id: int,
        current_commit: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Predict what changes will likely follow the current commit
        """
        try:
            print(f"🔮 [Predictions] Generating predictions for user {user_id}")
            
            db = await get_db_connection()
            
            # Extract pattern from current commit
            current_pattern = current_commit.get("pattern_type", "unknown")
            current_category = current_commit.get("change_category", "general")
            
            # Find sequences that match this trigger
            sequences = await db.fetch("""
                SELECT 
                    trigger_pattern,
                    follow_up_pattern,
                    occurrence_count,
                    probability,
                    confidence_score,
                    avg_time_gap,
                    example_sequences
                FROM commit_sequences
                WHERE user_id = $1
                  AND trigger_pattern = $2
                  AND probability >= 0.3
                ORDER BY probability DESC
                LIMIT 5
            """, user_id, current_pattern)
            
            predictions = []
            
            for seq in sequences:
                # Parse examples
                examples = json.loads(seq["example_sequences"]) if seq["example_sequences"] else []
                
                # Build prediction
                avg_hours = seq["avg_time_gap"].total_seconds() / 3600 if seq["avg_time_gap"] else 24
                
                prediction = {
                    "predicted_pattern": seq["follow_up_pattern"],
                    "confidence": round(seq["confidence_score"], 2),
                    "probability": round(seq["probability"], 2),
                    "occurrences": seq["occurrence_count"],
                    "typical_timeframe": self._format_timeframe(avg_hours),
                    "typical_hours": round(avg_hours, 1),
                    "description": self._generate_prediction_description(
                        seq["trigger_pattern"],
                        seq["follow_up_pattern"],
                        seq["probability"],
                        avg_hours
                    ),
                    "examples": examples[:3]  # Top 3 examples
                }
                
                predictions.append(prediction)
            
            print(f"✅ [Predictions] Generated {len(predictions)} predictions")
            
            return predictions
            
        except Exception as e:
            print(f"⚠️  [Predictions] Error: {e}")
            return []
    
    def _format_timeframe(self, hours: float) -> str:
        """Format hours into human-readable timeframe"""
        if hours < 1:
            return f"{int(hours * 60)} minutes"
        elif hours < 24:
            return f"{int(hours)} hours"
        elif hours < 168:  # 1 week
            days = int(hours / 24)
            return f"{days} day{'s' if days > 1 else ''}"
        else:
            weeks = int(hours / 168)
            return f"{weeks} week{'s' if weeks > 1 else ''}"
    
    def _generate_prediction_description(
        self,
        trigger: str,
        follow_up: str,
        probability: float,
        avg_hours: float
    ) -> str:
        """Generate human-readable prediction description"""
        timeframe = self._format_timeframe(avg_hours)
        percentage = int(probability * 100)
        
        descriptions = {
            ("scaling", "observability"): f"After scaling changes, you typically add monitoring within {timeframe} ({percentage}% of the time)",
            ("scaling", "security"): f"After scaling, you usually update security groups within {timeframe} ({percentage}% of the time)",
            ("security", "observability"): f"After security changes, you often add logging within {timeframe} ({percentage}% of the time)",
            ("cost_optimization", "observability"): f"After cost changes, you typically verify with metrics within {timeframe} ({percentage}% of the time)",
            ("compliance", "security"): f"After compliance updates, you usually adjust security settings within {timeframe} ({percentage}% of the time)",
        }
        
        key = (trigger, follow_up)
        if key in descriptions:
            return descriptions[key]
        
        # Generic description
        return f"Based on your history, {trigger} changes are typically followed by {follow_up} changes within {timeframe} ({percentage}% probability)"
    
    async def record_prediction_outcome(
        self,
        user_id: int,
        prediction_id: int,
        was_correct: bool,
        actual_commit_sha: Optional[str] = None
    ) -> None:
        """
        Record whether a prediction came true (for accuracy tracking)
        """
        try:
            db = await get_db_connection()
            
            await db.execute("""
                UPDATE pattern_predictions
                SET was_correct = $1,
                    actual_commit_sha = $2,
                    validated_at = $3
                WHERE id = $4 AND user_id = $5
            """, was_correct, actual_commit_sha, datetime.now(), prediction_id, user_id)
            
            print(f"✅ [Predictions] Recorded outcome for prediction {prediction_id}: {'✓' if was_correct else '✗'}")
            
        except Exception as e:
            print(f"⚠️  [Predictions] Error recording outcome: {e}")
    
    async def get_prediction_accuracy(self, user_id: int) -> Dict[str, Any]:
        """
        Calculate overall prediction accuracy for a user
        """
        try:
            db = await get_db_connection()
            
            stats = await db.fetchrow("""
                SELECT 
                    COUNT(*) as total_predictions,
                    SUM(CASE WHEN was_correct = true THEN 1 ELSE 0 END) as correct_predictions,
                    SUM(CASE WHEN was_correct = false THEN 1 ELSE 0 END) as incorrect_predictions,
                    SUM(CASE WHEN was_correct IS NULL THEN 1 ELSE 0 END) as pending_predictions
                FROM pattern_predictions
                WHERE user_id = $1
            """, user_id)
            
            if stats["total_predictions"] == 0:
                return {
                    "accuracy": 0.0,
                    "total": 0,
                    "correct": 0,
                    "incorrect": 0,
                    "pending": 0
                }
            
            validated = stats["correct_predictions"] + stats["incorrect_predictions"]
            accuracy = stats["correct_predictions"] / validated if validated > 0 else 0
            
            return {
                "accuracy": round(accuracy * 100, 1),
                "total": stats["total_predictions"],
                "correct": stats["correct_predictions"],
                "incorrect": stats["incorrect_predictions"],
                "pending": stats["pending_predictions"]
            }
            
        except Exception as e:
            print(f"⚠️  [Predictions] Error calculating accuracy: {e}")
            return {"error": str(e)}


# Singleton instance
predictive_drift_service = PredictiveDriftService()

