"""
AI-Powered Drift Intelligence Service
Uses Voyage AI embeddings + conversation history to provide intelligent drift explanations
Safe, incremental enhancement - doesn't modify existing functionality
"""
from typing import List, Dict, Any, Optional
import os
import subprocess
from pathlib import Path

class DriftIntelligenceService:
    """Provides AI-powered insights into infrastructure drift"""
    
    def __init__(self):
        # Lazy import to avoid breaking if dependencies aren't available
        self.anthropic_client = None
        self._initialize_anthropic()
    
    def _initialize_anthropic(self):
        """Safely initialize Anthropic client"""
        try:
            import anthropic
            api_key = os.getenv("ANTHROPIC_API_KEY")
            if api_key:
                self.anthropic_client = anthropic.Anthropic(api_key=api_key)
        except Exception as e:
            print(f"⚠️ [DriftIntelligence] Could not initialize Anthropic: {e}")
    
    async def analyze_drift_with_context(
        self,
        drift_data: Dict[str, Any],
        user_id: str,
        owner: str,
        repo: str,
        workspace_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Analyze drift with full git context and conversation history
        
        SAFE: If AI fails, returns original drift_data unmodified
        
        Returns:
            Enhanced drift analysis with:
            - Why changes were made (from git commits + conversation history)
            - What resources are affected downstream
            - Risk assessment
            - Suggested actions
        """
        try:
            drifts = drift_data.get("drifts", [])
            
            if not drifts:
                return {
                    **drift_data,
                    "ai_insights": {
                        "summary": "No infrastructure changes detected.",
                        "recommendations": []
                    }
                }
            
            # Enrich each drift with context
            enriched_drifts = []
            for drift in drifts:
                try:
                    enriched = await self._enrich_drift_with_ai(
                        drift, user_id, owner, repo, workspace_path
                    )
                    enriched_drifts.append(enriched)
                except Exception as e:
                    print(f"⚠️ [DriftIntelligence] Error enriching drift, using original: {e}")
                    enriched_drifts.append(drift)  # Keep original if enrichment fails
            
            # Analyze overall impact
            impact_analysis = await self._analyze_overall_impact(
                enriched_drifts, user_id, owner, repo, workspace_path
            )
            
            # Generate summary and recommendations
            summary = await self._generate_drift_summary(enriched_drifts)
            recommendations = await self._generate_recommendations(enriched_drifts, impact_analysis)
            
            return {
                **drift_data,
                "drifts": enriched_drifts,
                "impact_analysis": impact_analysis,
                "ai_insights": {
                    "summary": summary,
                    "recommendations": recommendations
                }
            }
            
        except Exception as e:
            print(f"⚠️ [DriftIntelligence] analyze_drift_with_context failed: {e}")
            # SAFE: Return original data if anything goes wrong
            return drift_data
    
    async def _enrich_drift_with_ai(
        self,
        drift: Dict[str, Any],
        user_id: str,
        owner: str,
        repo: str,
        workspace_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """Enrich a single drift with AI-powered insights"""
        
        resource_name = drift.get("resource_name", "")
        resource_type = drift.get("resource_type", "")
        file_path = drift.get("file", "")
        
        # 1. Get git history for this specific file
        git_context = await self._get_git_context_for_file(
            file_path, owner, repo, workspace_path
        )
        
        # 2. Get codebase context using Voyage AI semantic search
        codebase_context = []
        try:
            from app.services.context_service import context_service
            search_query = f"{resource_type} {resource_name} dependencies configuration"
            codebase_context = await context_service.get_codebase_context(
                user_id=user_id,
                owner=owner,
                repo=repo,
                query=search_query,
                top_k=5,
                workspace_path=workspace_path
            )
        except Exception as e:
            print(f"⚠️ [DriftIntelligence] Could not get codebase context: {e}")
        
        # 3. Get conversation history about this resource
        conversation_context = []
        try:
            from app.services.context_service import context_service
            conversation_context = context_service.get_conversation_context(
                user_id=user_id,
                conversation_id=None,  # Search all conversations
                query=f"{resource_type} {resource_name}",
                top_k=3
            )
        except Exception as e:
            print(f"⚠️ [DriftIntelligence] Could not get conversation context: {e}")
        
        # 4. Use Claude to generate intelligent explanation
        explanation = await self._generate_drift_explanation(
            drift, git_context, codebase_context, conversation_context
        )
        
        # 5. Identify affected resources using semantic search
        affected_resources = await self._find_affected_resources(
            drift, user_id, owner, repo, workspace_path, codebase_context
        )
        
        return {
            **drift,
            "ai_explanation": explanation,
            "git_context": git_context,
            "affected_resources": affected_resources,
            "conversation_history": [
                {
                    "timestamp": c.get("meta", {}).get("timestamp"),
                    "snippet": c.get("text", "")[:200]
                }
                for c in conversation_context
            ]
        }
    
    async def _get_git_context_for_file(
        self,
        file_path: str,
        owner: str,
        repo: str,
        workspace_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get git commit history and context for a specific file"""
        
        if not workspace_path:
            return {"commits": [], "last_author": None, "last_message": None}
        
        try:
            workspace = Path(workspace_path)
            if not workspace.exists():
                return {"commits": [], "last_author": None, "last_message": None}
            
            # Check if it's a git repo
            git_dir = workspace / ".git"
            if not git_dir.exists():
                return {"commits": [], "last_author": None, "last_message": None}
            
            # Get last 5 commits that modified this file
            result = subprocess.run(
                [
                    "git", "log", "--format=%H|%an|%ae|%at|%s", 
                    "-n", "5", "--", file_path
                ],
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=5  # Prevent hanging
            )
            
            commits = []
            if result.returncode == 0 and result.stdout:
                for line in result.stdout.strip().split("\n"):
                    if not line:
                        continue
                    parts = line.split("|")
                    if len(parts) >= 5:
                        commits.append({
                            "sha": parts[0][:8],
                            "author": parts[1],
                            "email": parts[2],
                            "timestamp": int(parts[3]),
                            "message": parts[4]
                        })
            
            last_commit = commits[0] if commits else None
            
            return {
                "commits": commits,
                "last_author": last_commit["author"] if last_commit else None,
                "last_message": last_commit["message"] if last_commit else None,
                "commit_count": len(commits)
            }
            
        except Exception as e:
            print(f"⚠️ [DriftIntelligence] Error getting git context: {e}")
            return {"commits": [], "last_author": None, "last_message": None}
    
    async def _generate_drift_explanation(
        self,
        drift: Dict[str, Any],
        git_context: Dict[str, Any],
        codebase_context: List[Dict],
        conversation_context: List[Dict]
    ) -> Dict[str, Any]:
        """Use Claude to generate human-readable drift explanation"""
        
        # Fallback if Claude not available
        if not self.anthropic_client:
            return {
                "text": f"{drift.get('description', 'Configuration change detected')}",
                "risk_level": drift.get("severity", "medium"),
                "confidence": 0.5
            }
        
        try:
            # Format context for Claude
            context_text = "=== Git History ===\n"
            if git_context.get("commits"):
                for commit in git_context["commits"][:3]:
                    context_text += f"- {commit['message']} (by {commit['author']})\n"
            else:
                context_text += "No git history available\n"
            
            context_text += "\n=== Related Code ===\n"
            for i, chunk in enumerate(codebase_context[:3], 1):
                file = chunk.get("meta", {}).get("file", "unknown")
                text = chunk.get("text", "")[:200]
                context_text += f"{i}. From {file}:\n{text}\n\n"
            
            if conversation_context:
                context_text += "\n=== Conversation History ===\n"
                for i, chunk in enumerate(conversation_context[:2], 1):
                    text = chunk.get("text", "")[:200]
                    context_text += f"{i}. {text}\n\n"
            
            # Prompt Claude for explanation
            prompt = f"""You are analyzing infrastructure drift. Explain WHY this change happened and WHAT it affects.

Drift Details:
- Type: {drift.get('type')}
- Resource: {drift.get('resource_type')}.{drift.get('resource_name')}
- File: {drift.get('file')}
- Description: {drift.get('description')}
{f"- Old Value: {drift.get('old_value')}" if drift.get('old_value') else ""}
{f"- New Value: {drift.get('new_value')}" if drift.get('new_value') else ""}

Context:
{context_text}

Provide a conversational, 2-3 sentence explanation covering:
1. WHY this change likely happened (based on git history and conversations)
2. WHAT downstream resources might be affected
3. Whether this looks intentional or accidental

Be friendly and conversational. Don't use technical jargon.

Response:"""
            
            response = self.anthropic_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=300,
                temperature=0.3,
                messages=[{"role": "user", "content": prompt}]
            )
            
            explanation_text = response.content[0].text
            
            # Parse risk level from explanation
            risk_level = drift.get("severity", "medium")
            if any(word in explanation_text.lower() for word in ["critical", "dangerous", "breaking", "accidental", "unintended"]):
                risk_level = "high"
            elif any(word in explanation_text.lower() for word in ["safe", "routine", "intentional", "minor", "expected"]):
                risk_level = "low"
            
            return {
                "text": explanation_text,
                "risk_level": risk_level,
                "confidence": 0.85
            }
            
        except Exception as e:
            print(f"⚠️ [DriftIntelligence] Error generating explanation: {e}")
            return {
                "text": f"{drift.get('description', 'Configuration change detected')}. Unable to generate AI explanation.",
                "risk_level": drift.get("severity", "medium"),
                "confidence": 0.5
            }
    
    async def _find_affected_resources(
        self,
        drift: Dict[str, Any],
        user_id: str,
        owner: str,
        repo: str,
        workspace_path: Optional[str] = None,
        codebase_context: Optional[List[Dict]] = None
    ) -> List[Dict[str, str]]:
        """Use Voyage AI to find resources affected by this drift"""
        
        try:
            resource_name = drift.get("resource_name", "")
            resource_type = drift.get("resource_type", "")
            
            # Use existing codebase context if available, otherwise fetch
            if not codebase_context:
                from app.services.context_service import context_service
                search_query = f"references to {resource_type} {resource_name} dependency"
                codebase_context = await context_service.get_codebase_context(
                    user_id=user_id,
                    owner=owner,
                    repo=repo,
                    query=search_query,
                    top_k=10,
                    workspace_path=workspace_path
                )
            
            # Extract unique affected resources
            affected = []
            seen = set()
            
            for result in codebase_context:
                meta = result.get("meta", {})
                file = meta.get("file", "")
                text = result.get("text", "")
                
                # Extract resource references from text
                import re
                references = re.findall(r'(aws_\w+|google_\w+|azurerm_\w+)\.([\w-]+)', text)
                
                for ref_type, ref_name in references:
                    key = f"{ref_type}.{ref_name}"
                    if key not in seen and key != f"{resource_type}.{resource_name}":
                        affected.append({
                            "type": ref_type,
                            "name": ref_name,
                            "file": file,
                            "relationship": "references"
                        })
                        seen.add(key)
                        
                        if len(affected) >= 5:
                            break
                
                if len(affected) >= 5:
                    break
            
            return affected
            
        except Exception as e:
            print(f"⚠️ [DriftIntelligence] Error finding affected resources: {e}")
            return []
    
    async def _analyze_overall_impact(
        self,
        enriched_drifts: List[Dict],
        user_id: str,
        owner: str,
        repo: str,
        workspace_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """Analyze overall impact of all drifts combined"""
        
        try:
            high_risk_count = sum(1 for d in enriched_drifts 
                                 if d.get("ai_explanation", {}).get("risk_level") == "high")
            
            # Find cascade effects (changes that affect multiple resources)
            cascade_effects = []
            for drift in enriched_drifts:
                affected = drift.get("affected_resources", [])
                if len(affected) > 2:
                    cascade_effects.append({
                        "source": f"{drift.get('resource_type')}.{drift.get('resource_name')}",
                        "affected_count": len(affected),
                        "affected": [f"{r['type']}.{r['name']}" for r in affected[:3]]
                    })
            
            return {
                "total_drifts": len(enriched_drifts),
                "high_risk_count": high_risk_count,
                "cascade_effects": cascade_effects,
                "requires_review": high_risk_count > 0 or len(cascade_effects) > 0
            }
        except Exception as e:
            print(f"⚠️ [DriftIntelligence] Error analyzing impact: {e}")
            return {
                "total_drifts": len(enriched_drifts),
                "high_risk_count": 0,
                "cascade_effects": [],
                "requires_review": False
            }
    
    async def _generate_drift_summary(self, enriched_drifts: List[Dict]) -> str:
        """Generate a conversational summary of all drifts"""
        
        try:
            if not enriched_drifts:
                return "No infrastructure changes detected."
            
            summary_parts = []
            
            added = [d for d in enriched_drifts if d.get("type") == "added"]
            removed = [d for d in enriched_drifts if d.get("type") == "removed"]
            modified = [d for d in enriched_drifts if d.get("type") == "modified"]
            
            if added:
                summary_parts.append(f"{len(added)} resource(s) added")
            if removed:
                summary_parts.append(f"{len(removed)} resource(s) removed")
            if modified:
                summary_parts.append(f"{len(modified)} resource(s) modified")
            
            summary = "Detected " + ", ".join(summary_parts) + ". "
            
            high_risk = [d for d in enriched_drifts 
                        if d.get("ai_explanation", {}).get("risk_level") == "high"]
            
            if high_risk:
                summary += f"⚠️ {len(high_risk)} high-risk change(s) require immediate attention."
            else:
                summary += "✅ All changes appear routine and low-risk."
            
            return summary
        except Exception as e:
            print(f"⚠️ [DriftIntelligence] Error generating summary: {e}")
            return "Infrastructure changes detected."
    
    async def _generate_recommendations(
        self,
        enriched_drifts: List[Dict],
        impact_analysis: Dict
    ) -> List[str]:
        """Generate actionable recommendations"""
        
        try:
            recommendations = []
            
            if impact_analysis.get("high_risk_count", 0) > 0:
                recommendations.append("🔍 Review high-risk changes before deploying to production")
            
            if impact_analysis.get("cascade_effects"):
                recommendations.append("🔗 Test dependent resources after deploying these changes")
            
            removed = [d for d in enriched_drifts if d.get("type") == "removed"]
            if removed:
                recommendations.append("⚠️ Verify that removed resources are no longer needed")
            
            security_related = [d for d in enriched_drifts 
                              if any(word in d.get("resource_type", "").lower() 
                                    for word in ["security", "iam", "policy", "role"])]
            if security_related:
                recommendations.append("🔒 Review security-related changes with your team")
            
            if not recommendations:
                recommendations.append("✅ Changes look safe to proceed")
            
            return recommendations
        except Exception as e:
            print(f"⚠️ [DriftIntelligence] Error generating recommendations: {e}")
            return ["Review changes before deploying"]


# Global instance
drift_intelligence_service = DriftIntelligenceService()

