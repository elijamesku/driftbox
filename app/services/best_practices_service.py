"""
Best Practices Analyzer Service
Learns YOUR company's specific patterns and standards from your own code
"""
from typing import Dict, List, Any, Optional
from datetime import datetime
from collections import defaultdict, Counter
import json

from app.database.connection import get_db_connection


class BestPracticesService:
    """
    Learn company-specific best practices from user's actual code
    
    Features:
    - Identify required tags (appear in 80%+ of resources)
    - Detect naming conventions
    - Find common attribute defaults
    - Spot forbidden patterns (never used)
    - Check compliance against learned practices
    """
    
    async def learn_user_practices(
        self,
        user_id: int,
        force_relearn: bool = False
    ) -> Dict[str, Any]:
        """
        Analyze all user's resources to learn their best practices
        """
        try:
            print(f"📚 [Best Practices] Learning patterns for user {user_id}")
            
            db = await get_db_connection()
            
            # Fetch all commit patterns for analysis
            commits = await db.fetch("""
                SELECT 
                    repo_name,
                    commit_sha,
                    files_changed,
                    resources_affected,
                    attributes_changed
                FROM commit_patterns
                WHERE user_id = $1
                ORDER BY commit_date DESC
                LIMIT 500
            """, user_id)
            
            if not commits:
                print(f"  ⚠️  No commits found for user {user_id}")
                return {"success": False, "error": "No data to learn from"}
            
            print(f"  📊 Analyzing {len(commits)} commits...")
            
            # Learn different types of practices
            practices_learned = {
                "required_tags": await self._learn_required_tags(commits),
                "naming_conventions": await self._learn_naming_conventions(commits),
                "attribute_defaults": await self._learn_attribute_defaults(commits),
                "forbidden_patterns": await self._learn_forbidden_patterns(commits)
            }
            
            # Store learned practices
            total_stored = 0
            for practice_type, rules in practices_learned.items():
                for rule in rules:
                    await self._store_practice(
                        db=db,
                        user_id=user_id,
                        practice_type=practice_type,
                        rule=rule
                    )
                    total_stored += 1
            
            print(f"✅ [Best Practices] Learned {total_stored} practices")
            
            return {
                "success": True,
                "practices_learned": total_stored,
                "breakdown": {k: len(v) for k, v in practices_learned.items()}
            }
            
        except Exception as e:
            print(f"⚠️  [Best Practices] Error: {e}")
            return {"success": False, "error": str(e)}
    
    async def _learn_required_tags(self, commits: List[Dict]) -> List[Dict]:
        """Find tags that appear consistently (80%+ of resources)"""
        tag_counter = Counter()
        total_resources = 0
        
        for commit in commits:
            resources = json.loads(commit["resources_affected"]) if commit["resources_affected"] else []
            for resource in resources:
                total_resources += 1
                tags = resource.get("tags", {})
                for tag_key in tags.keys():
                    tag_counter[tag_key] += 1
        
        if total_resources == 0:
            return []
        
        # Tags that appear in 80%+ of resources are "required"
        threshold = total_resources * 0.8
        required_tags = []
        
        for tag_key, count in tag_counter.items():
            if count >= threshold:
                compliance_rate = count / total_resources
                required_tags.append({
                    "rule_name": f"tag_{tag_key}",
                    "rule_value": {"tag_key": tag_key, "required": True},
                    "compliance_rate": compliance_rate,
                    "confidence_score": min(compliance_rate, 0.95),
                    "frequency_count": count,
                    "total_resources": total_resources
                })
        
        print(f"    ✅ Found {len(required_tags)} required tags")
        return required_tags
    
    async def _learn_naming_conventions(self, commits: List[Dict]) -> List[Dict]:
        """Detect naming patterns (prefixes, suffixes, formats)"""
        naming_patterns = []
        
        # Analyze resource names from commits
        resource_names = defaultdict(list)
        
        for commit in commits:
            resources = json.loads(commit["resources_affected"]) if commit["resources_affected"] else []
            for resource in resources:
                resource_type = resource.get("type", "unknown")
                resource_name = resource.get("name", "")
                if resource_name:
                    resource_names[resource_type].append(resource_name)
        
        # Find common patterns
        for resource_type, names in resource_names.items():
            if len(names) < 5:  # Need at least 5 examples
                continue
            
            # Check for common prefixes
            prefix_counter = Counter()
            for name in names:
                # Extract first word/segment
                parts = name.split("-") or name.split("_")
                if parts:
                    prefix_counter[parts[0]] += 1
            
            # If 60%+ have same prefix, it's a convention
            threshold = len(names) * 0.6
            for prefix, count in prefix_counter.items():
                if count >= threshold:
                    naming_patterns.append({
                        "rule_name": f"naming_{resource_type}_prefix",
                        "rule_value": {"resource_type": resource_type, "prefix": prefix},
                        "compliance_rate": count / len(names),
                        "confidence_score": count / len(names),
                        "frequency_count": count,
                        "total_resources": len(names)
                    })
        
        print(f"    ✅ Found {len(naming_patterns)} naming conventions")
        return naming_patterns
    
    async def _learn_attribute_defaults(self, commits: List[Dict]) -> List[Dict]:
        """Find common attribute values (e.g., always use t3.* instances)"""
        attribute_patterns = []
        
        # Track attribute values by resource type
        attribute_values = defaultdict(lambda: defaultdict(Counter))
        
        for commit in commits:
            resources = json.loads(commit["resources_affected"]) if commit["resources_affected"] else []
            for resource in resources:
                resource_type = resource.get("type", "unknown")
                attributes = resource.get("attributes", {})
                
                for attr_key, attr_value in attributes.items():
                    # Convert to string for counting
                    value_str = str(attr_value)
                    attribute_values[resource_type][attr_key][value_str] += 1
        
        # Find dominant patterns (70%+ usage)
        for resource_type, attributes in attribute_values.items():
            for attr_key, value_counter in attributes.items():
                total = sum(value_counter.values())
                if total < 5:  # Need at least 5 examples
                    continue
                
                most_common_value, count = value_counter.most_common(1)[0]
                
                if count / total >= 0.7:  # 70%+ threshold
                    attribute_patterns.append({
                        "rule_name": f"default_{resource_type}_{attr_key}",
                        "rule_value": {
                            "resource_type": resource_type,
                            "attribute": attr_key,
                            "default_value": most_common_value
                        },
                        "compliance_rate": count / total,
                        "confidence_score": count / total,
                        "frequency_count": count,
                        "total_resources": total
                    })
        
        print(f"    ✅ Found {len(attribute_patterns)} attribute defaults")
        return attribute_patterns
    
    async def _learn_forbidden_patterns(self, commits: List[Dict]) -> List[Dict]:
        """Find patterns that are NEVER used (forbidden/deprecated)"""
        forbidden = []
        
        # Example: If user never uses t2.* instances (only t3.*), flag t2 as forbidden
        # This is a simplified implementation
        
        instance_types_used = Counter()
        
        for commit in commits:
            resources = json.loads(commit["resources_affected"]) if commit["resources_affected"] else []
            for resource in resources:
                if resource.get("type") == "aws_instance":
                    instance_type = resource.get("attributes", {}).get("instance_type", "")
                    if instance_type:
                        # Extract family (e.g., "t3" from "t3.medium")
                        family = instance_type.split(".")[0] if "." in instance_type else instance_type
                        instance_types_used[family] += 1
        
        # If t2 appears 0 times but t3 appears 10+ times, flag t2 as forbidden
        if instance_types_used.get("t3", 0) >= 10 and instance_types_used.get("t2", 0) == 0:
            forbidden.append({
                "rule_name": "forbidden_t2_instances",
                "rule_value": {"pattern": "t2.*", "reason": "Deprecated, use t3.* instead"},
                "compliance_rate": 1.0,  # 100% compliant (never used)
                "confidence_score": 0.9,
                "frequency_count": 0,
                "total_resources": sum(instance_types_used.values())
            })
        
        print(f"    ✅ Found {len(forbidden)} forbidden patterns")
        return forbidden
    
    async def _store_practice(
        self,
        db: Any,
        user_id: int,
        practice_type: str,
        rule: Dict[str, Any]
    ) -> None:
        """Store a learned best practice in the database"""
        await db.execute("""
            INSERT INTO best_practices (
                user_id, practice_type, resource_type,
                rule_name, rule_value,
                frequency_count, total_resources, compliance_rate, confidence_score,
                created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (user_id, practice_type, resource_type, rule_name)
            DO UPDATE SET
                rule_value = $5,
                frequency_count = $6,
                total_resources = $7,
                compliance_rate = $8,
                confidence_score = $9,
                updated_at = $11,
                last_validated = $11
        """,
            user_id, practice_type,
            rule["rule_value"].get("resource_type"),
            rule["rule_name"],
            json.dumps(rule["rule_value"]),
            rule.get("frequency_count", 0),
            rule.get("total_resources", 0),
            rule.get("compliance_rate", 0.0),
            rule.get("confidence_score", 0.0),
            datetime.now(), datetime.now()
        )
    
    async def check_compliance(
        self,
        user_id: int,
        new_resource: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Check if a new resource complies with learned best practices
        Returns violations and suggestions
        """
        try:
            db = await get_db_connection()
            
            # Fetch user's learned practices
            practices = await db.fetch("""
                SELECT practice_type, resource_type, rule_name, rule_value, confidence_score
                FROM best_practices
                WHERE user_id = $1
                  AND confidence_score >= 0.7
                ORDER BY confidence_score DESC
            """, user_id)
            
            violations = []
            compliant_items = []
            
            for practice in practices:
                rule = json.loads(practice["rule_value"])
                practice_type = practice["practice_type"]
                
                # Check each type of practice
                if practice_type == "required_tags":
                    violation = self._check_required_tags(new_resource, rule, practice["confidence_score"])
                    if violation:
                        violations.append(violation)
                    else:
                        compliant_items.append({"type": "tag", "name": rule.get("tag_key")})
                
                elif practice_type == "naming_conventions":
                    violation = self._check_naming_convention(new_resource, rule, practice["confidence_score"])
                    if violation:
                        violations.append(violation)
                    else:
                        compliant_items.append({"type": "naming", "pattern": rule.get("prefix")})
                
                elif practice_type == "attribute_defaults":
                    violation = self._check_attribute_default(new_resource, rule, practice["confidence_score"])
                    if violation:
                        violations.append(violation)
                    else:
                        compliant_items.append({"type": "attribute", "name": rule.get("attribute")})
                
                elif practice_type == "forbidden_patterns":
                    violation = self._check_forbidden_pattern(new_resource, rule, practice["confidence_score"])
                    if violation:
                        violations.append(violation)
            
            # Calculate compliance score
            total_checks = len(practices)
            passed_checks = total_checks - len(violations)
            compliance_score = (passed_checks / total_checks * 100) if total_checks > 0 else 100
            
            return {
                "compliance_score": round(compliance_score, 1),
                "violations": violations,
                "compliant_items": compliant_items,
                "total_checks": total_checks
            }
            
        except Exception as e:
            print(f"⚠️  [Compliance Check] Error: {e}")
            return {
                "compliance_score": 0,
                "violations": [],
                "error": str(e)
            }
    
    def _check_required_tags(self, resource: Dict, rule: Dict, confidence: float) -> Optional[Dict]:
        """Check if resource has required tags"""
        required_tag = rule.get("tag_key")
        resource_tags = resource.get("tags", {})
        
        if required_tag not in resource_tags:
            return {
                "type": "missing_tag",
                "severity": "medium" if confidence >= 0.9 else "low",
                "message": f"Missing required tag: '{required_tag}'",
                "suggestion": f"Add tag '{required_tag}' (found in {int(confidence * 100)}% of your resources)",
                "confidence": confidence
            }
        return None
    
    def _check_naming_convention(self, resource: Dict, rule: Dict, confidence: float) -> Optional[Dict]:
        """Check if resource name follows conventions"""
        expected_prefix = rule.get("prefix")
        resource_name = resource.get("name", "")
        
        if not resource_name.startswith(expected_prefix):
            return {
                "type": "naming_convention",
                "severity": "low",
                "message": f"Name doesn't follow convention (expected prefix: '{expected_prefix}')",
                "suggestion": f"Consider naming it '{expected_prefix}-{resource_name}'",
                "confidence": confidence
            }
        return None
    
    def _check_attribute_default(self, resource: Dict, rule: Dict, confidence: float) -> Optional[Dict]:
        """Check if attribute matches usual default"""
        expected_attr = rule.get("attribute")
        expected_value = rule.get("default_value")
        actual_value = str(resource.get("attributes", {}).get(expected_attr, ""))
        
        if actual_value != expected_value:
            return {
                "type": "non_standard_value",
                "severity": "low",
                "message": f"Non-standard value for '{expected_attr}': '{actual_value}'",
                "suggestion": f"You typically use '{expected_value}' ({int(confidence * 100)}% of the time)",
                "confidence": confidence
            }
        return None
    
    def _check_forbidden_pattern(self, resource: Dict, rule: Dict, confidence: float) -> Optional[Dict]:
        """Check if resource uses forbidden patterns"""
        forbidden_pattern = rule.get("pattern")
        reason = rule.get("reason", "Deprecated pattern")
        
        # Check instance type for forbidden patterns
        instance_type = resource.get("attributes", {}).get("instance_type", "")
        if instance_type and forbidden_pattern in instance_type:
            return {
                "type": "forbidden_pattern",
                "severity": "high",
                "message": f"Using forbidden pattern: {instance_type}",
                "suggestion": reason,
                "confidence": confidence
            }
        return None


# Singleton instance
best_practices_service = BestPracticesService()

