"""
Fix Learning Service
Learns from successful auto-heal fixes and applies knowledge to future code generation.
"""
import sqlite3
import json
import re
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from datetime import datetime


class FixLearningService:
    """Service that learns from successful fixes and applies them to prevent future errors."""
    
    def __init__(self, db_path: str = "data/fix_learning.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
    
    def _init_db(self):
        """Initialize the learning database."""
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        # Table for learned fixes
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS learned_fixes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                error_pattern TEXT NOT NULL,
                error_type TEXT NOT NULL,
                resource_type TEXT,
                fix_description TEXT NOT NULL,
                fix_pattern TEXT NOT NULL,
                old_value TEXT,
                new_value TEXT,
                success_count INTEGER DEFAULT 1,
                failure_count INTEGER DEFAULT 0,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                confidence_score REAL DEFAULT 0.5
            )
        """)
        
        # Index for fast lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_error_pattern 
            ON learned_fixes(error_pattern)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_resource_type 
            ON learned_fixes(resource_type)
        """)
        
        conn.commit()
        conn.close()
        print(f"✅ [Fix Learning] Database initialized at {self.db_path}")
    
    def learn_from_fix(self, error_message: str, old_code: str, new_code: str, 
                       resource_type: Optional[str] = None) -> bool:
        """
        Learn from a successful fix by extracting patterns.
        
        Args:
            error_message: The original Terraform error
            old_code: The code before fixing
            new_code: The code after fixing
            resource_type: AWS resource type (e.g., aws_redshift_cluster)
        
        Returns:
            True if a pattern was learned, False otherwise
        """
        # Extract fix pattern
        pattern = self._extract_fix_pattern(error_message, old_code, new_code, resource_type)
        
        if not pattern:
            print(f"⚠️  [Fix Learning] Could not extract pattern from fix")
            return False
        
        # Store or update the pattern
        self._store_pattern(pattern)
        print(f"✅ [Fix Learning] Learned: {pattern['fix_description']}")
        return True
    
    def _extract_fix_pattern(self, error_message: str, old_code: str, new_code: str,
                            resource_type: Optional[str]) -> Optional[Dict]:
        """Extract a fix pattern from before/after code."""
        
        # Detect error type
        error_type = "unknown"
        if "Invalid multi-line string" in error_message or "Unterminated template string" in error_message:
            error_type = "jsonencode"
        elif "Unsupported argument" in error_message:
            error_type = "invalid_argument"
        elif "Missing required" in error_message:
            error_type = "missing_field"
        elif "Reference to undeclared resource" in error_message:
            error_type = "missing_resource"
        
        # Extract specific patterns based on error type
        if error_type == "jsonencode":
            return self._extract_jsonencode_pattern(error_message, old_code, new_code, resource_type)
        elif error_type == "invalid_argument":
            return self._extract_invalid_argument_pattern(error_message, old_code, new_code, resource_type)
        elif error_type == "missing_field":
            return self._extract_missing_field_pattern(error_message, old_code, new_code, resource_type)
        
        return None
    
    def _extract_jsonencode_pattern(self, error_message: str, old_code: str, 
                                   new_code: str, resource_type: Optional[str]) -> Optional[Dict]:
        """Extract pattern for jsonencode fixes."""
        # Find the attribute that was wrapped
        jsonencode_match = re.search(r'(\w+)\s*=\s*jsonencode\(', new_code)
        if not jsonencode_match:
            return None
        
        attribute = jsonencode_match.group(1)
        
        return {
            "error_pattern": f"{attribute}.*multi-line",
            "error_type": "jsonencode",
            "resource_type": resource_type,
            "fix_description": f"Wrap {attribute} with jsonencode()",
            "fix_pattern": "jsonencode",
            "old_value": attribute,
            "new_value": f"jsonencode({attribute})"
        }
    
    def _extract_invalid_argument_pattern(self, error_message: str, old_code: str,
                                         new_code: str, resource_type: Optional[str]) -> Optional[Dict]:
        """Extract pattern for invalid argument fixes."""
        # Extract the invalid argument name from error
        arg_match = re.search(r'argument named "([^"]+)"', error_message)
        if not arg_match:
            return None
        
        invalid_arg = arg_match.group(1)
        
        # Check if argument was renamed or removed
        if invalid_arg in old_code and invalid_arg not in new_code:
            # Try to find what it was renamed to
            # Look for similar attribute names in new_code
            old_lines = old_code.split('\n')
            new_lines = new_code.split('\n')
            
            renamed_to = None
            for old_line in old_lines:
                if invalid_arg in old_line and '=' in old_line:
                    # Find corresponding line in new code
                    for new_line in new_lines:
                        if '=' in new_line and new_line.strip().split('=')[1].strip() == old_line.strip().split('=')[1].strip():
                            # Same value, different attribute name
                            new_arg_match = re.search(r'(\w+)\s*=', new_line)
                            if new_arg_match:
                                renamed_to = new_arg_match.group(1)
                                break
            
            if renamed_to:
                return {
                    "error_pattern": f"{invalid_arg}.*{resource_type or 'resource'}",
                    "error_type": "invalid_argument",
                    "resource_type": resource_type,
                    "fix_description": f"Rename '{invalid_arg}' to '{renamed_to}' for {resource_type}",
                    "fix_pattern": "rename",
                    "old_value": invalid_arg,
                    "new_value": renamed_to
                }
            else:
                return {
                    "error_pattern": f"{invalid_arg}.*{resource_type or 'resource'}",
                    "error_type": "invalid_argument",
                    "resource_type": resource_type,
                    "fix_description": f"Remove invalid argument '{invalid_arg}' from {resource_type}",
                    "fix_pattern": "remove",
                    "old_value": invalid_arg,
                    "new_value": None
                }
        
        return None
    
    def _extract_missing_field_pattern(self, error_message: str, old_code: str,
                                      new_code: str, resource_type: Optional[str]) -> Optional[Dict]:
        """Extract pattern for missing field fixes."""
        # Extract the missing field name from error
        field_match = re.search(r'required argument "([^"]+)"', error_message, re.IGNORECASE)
        if not field_match:
            return None
        
        missing_field = field_match.group(1)
        
        # Find the value that was added in new_code
        field_line_match = re.search(rf'{missing_field}\s*=\s*(.+)', new_code)
        if not field_line_match:
            return None
        
        added_value = field_line_match.group(1).strip()
        
        return {
            "error_pattern": f"missing.*{missing_field}.*{resource_type or 'resource'}",
            "error_type": "missing_field",
            "resource_type": resource_type,
            "fix_description": f"Add required field '{missing_field}' to {resource_type}",
            "fix_pattern": "add_field",
            "old_value": None,
            "new_value": f"{missing_field} = {added_value}"
        }
    
    def _store_pattern(self, pattern: Dict):
        """Store or update a pattern in the database."""
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        now = datetime.utcnow().isoformat()
        
        # Check if similar pattern exists
        cursor.execute("""
            SELECT id, success_count, confidence_score
            FROM learned_fixes
            WHERE error_pattern = ? AND resource_type = ? AND old_value = ?
        """, (pattern["error_pattern"], pattern.get("resource_type"), pattern.get("old_value")))
        
        existing = cursor.fetchone()
        
        if existing:
            # Update existing pattern
            fix_id, success_count, confidence = existing
            new_success = success_count + 1
            new_confidence = min(0.99, confidence + 0.1)  # Increase confidence, max 0.99
            
            cursor.execute("""
                UPDATE learned_fixes
                SET success_count = ?, last_seen = ?, confidence_score = ?
                WHERE id = ?
            """, (new_success, now, new_confidence, fix_id))
            
            print(f"📈 [Fix Learning] Updated pattern (confidence: {new_confidence:.2f}, uses: {new_success})")
        else:
            # Insert new pattern
            cursor.execute("""
                INSERT INTO learned_fixes (
                    error_pattern, error_type, resource_type, fix_description,
                    fix_pattern, old_value, new_value, first_seen, last_seen
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                pattern["error_pattern"],
                pattern["error_type"],
                pattern.get("resource_type"),
                pattern["fix_description"],
                pattern["fix_pattern"],
                pattern.get("old_value"),
                pattern.get("new_value"),
                now,
                now
            ))
            
            print(f"🆕 [Fix Learning] Stored new pattern")
        
        conn.commit()
        conn.close()
    
    def get_applicable_fixes(self, resource_type: Optional[str] = None, 
                           limit: int = 10) -> List[Dict]:
        """
        Get fixes that might be applicable to current code generation.
        
        Args:
            resource_type: Filter by resource type
            limit: Maximum number of fixes to return
        
        Returns:
            List of fix patterns, sorted by confidence
        """
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        if resource_type:
            cursor.execute("""
                SELECT error_pattern, error_type, resource_type, fix_description,
                       fix_pattern, old_value, new_value, confidence_score, success_count
                FROM learned_fixes
                WHERE resource_type = ? OR resource_type IS NULL
                ORDER BY confidence_score DESC, success_count DESC
                LIMIT ?
            """, (resource_type, limit))
        else:
            cursor.execute("""
                SELECT error_pattern, error_type, resource_type, fix_description,
                       fix_pattern, old_value, new_value, confidence_score, success_count
                FROM learned_fixes
                ORDER BY confidence_score DESC, success_count DESC
                LIMIT ?
            """, (limit,))
        
        fixes = []
        for row in cursor.fetchall():
            fixes.append({
                "error_pattern": row[0],
                "error_type": row[1],
                "resource_type": row[2],
                "fix_description": row[3],
                "fix_pattern": row[4],
                "old_value": row[5],
                "new_value": row[6],
                "confidence_score": row[7],
                "success_count": row[8]
            })
        
        conn.close()
        return fixes
    
    def apply_learned_fixes_to_ir(self, ir: Dict) -> Dict:
        """
        Apply learned fixes to IR before HCL generation.
        Prevents errors before they happen!
        
        Args:
            ir: Infrastructure IR
        
        Returns:
            Modified IR with fixes applied
        """
        if not ir or "ops" not in ir:
            return ir
        
        fixes_applied = 0
        
        for op in ir["ops"]:
            resource_type = op.get("selector", {}).get("type", "")
            
            # Get applicable fixes for this resource type
            applicable_fixes = self.get_applicable_fixes(resource_type, limit=20)
            
            for fix in applicable_fixes:
                if fix["fix_pattern"] == "rename" and fix["old_value"] and fix["new_value"]:
                    # Rename invalid arguments
                    for change in op.get("changes", []):
                        if change.get("path") == fix["old_value"]:
                            change["path"] = fix["new_value"]
                            fixes_applied += 1
                            print(f"🔧 [Fix Learning] Applied: {fix['fix_description']}")
                
                elif fix["fix_pattern"] == "remove" and fix["old_value"]:
                    # Remove invalid arguments
                    op["changes"] = [
                        c for c in op.get("changes", [])
                        if c.get("path") != fix["old_value"]
                    ]
                    if len(op["changes"]) < len(op.get("changes", [])):
                        fixes_applied += 1
                        print(f"🔧 [Fix Learning] Applied: {fix['fix_description']}")
        
        if fixes_applied > 0:
            print(f"✅ [Fix Learning] Applied {fixes_applied} learned fixes to prevent errors")
        
        return ir
    
    def get_recent_fixes_summary(self, days: int = 7, limit: int = 5) -> str:
        """
        Get a summary of recent fixes for LLM prompt enhancement.
        
        Args:
            days: Number of days to look back
            limit: Maximum number of fixes to include
        
        Returns:
            Formatted string for LLM prompt
        """
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        cutoff_date = datetime.utcnow().isoformat()[:10]  # Today's date
        
        cursor.execute("""
            SELECT fix_description, resource_type, old_value, new_value, success_count
            FROM learned_fixes
            WHERE confidence_score > 0.6
            ORDER BY success_count DESC, confidence_score DESC
            LIMIT ?
        """, (limit,))
        
        fixes = cursor.fetchall()
        conn.close()
        
        if not fixes:
            return ""
        
        summary = "\n**LEARNED FIXES (from recent auto-heals):**\n"
        for fix_desc, res_type, old_val, new_val, count in fixes:
            if old_val and new_val:
                summary += f"- {res_type}: {old_val} → {new_val} (fixed {count}x)\n"
            else:
                summary += f"- {fix_desc} (fixed {count}x)\n"
        
        return summary


# Global instance
fix_learning_service = FixLearningService()

