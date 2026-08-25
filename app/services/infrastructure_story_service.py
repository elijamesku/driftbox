"""
Infrastructure Story Service
Builds comprehensive narrative timelines of infrastructure changes with rich context
"""
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import requests
from collections import defaultdict
import anthropic
import os


class InfrastructureStoryService:
    """Generate rich infrastructure stories from Git history"""
    
    def __init__(self):
        self.anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    
    async def build_infrastructure_story(
        self,
        owner: str,
        repo: str,
        github_token: str,
        months: int = 6
    ) -> Dict[str, Any]:
        """
        Build a comprehensive infrastructure story with:
        - Timeline of all changes
        - Cost evolution
        - Key milestones
        - Trend analysis
        - Recommendations
        """
        try:
            # Fetch commit history
            commits = await self._fetch_commit_history(
                owner=owner,
                repo=repo,
                github_token=github_token,
                months=months
            )
            
            # Enrich commits with file changes
            enriched_commits = await self._enrich_commits_with_changes(
                owner=owner,
                repo=repo,
                github_token=github_token,
                commits=commits
            )
            
            # Build timeline chapters (NO pre-generated AI explanations)
            chapters = self._build_timeline_chapters(enriched_commits)
            
            # Calculate cost evolution
            cost_timeline = self._calculate_cost_timeline(enriched_commits)
            
            # Identify trends and patterns
            trends = self._identify_trends(enriched_commits)
            
            # Generate recommendations
            recommendations = self._generate_recommendations(
                enriched_commits, cost_timeline, trends
            )
            
            # Build narrative summary
            narrative = self._build_narrative_summary(
                chapters, cost_timeline, trends
            )
            
            return {
                "repo": f"{owner}/{repo}",
                "timeframe": f"Last {months} months",
                "narrative": narrative,
                "chapters": chapters,
                "cost_timeline": cost_timeline,
                "trends": trends,
                "recommendations": recommendations,
                "total_commits": len(enriched_commits),
                "total_authors": len(set(c["author"]["email"] for c in enriched_commits if c.get("author"))),
                "period_start": enriched_commits[-1]["date"] if enriched_commits else None,
                "period_end": enriched_commits[0]["date"] if enriched_commits else None
            }
            
        except Exception as e:
            print(f"⚠️  [Infrastructure Story] Error: {e}")
            return self._empty_story(owner, repo, months)
    
    async def _fetch_commit_history(
        self,
        owner: str,
        repo: str,
        github_token: str,
        months: int
    ) -> List[Dict]:
        """Fetch commit history from GitHub"""
        since_date = (datetime.now() - timedelta(days=months * 30)).isoformat()
        
        headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        # First, detect the default branch
        repo_info_url = f"https://api.github.com/repos/{owner}/{repo}"
        repo_response = requests.get(repo_info_url, headers=headers)
        
        if repo_response.status_code != 200:
            print(f"⚠️  [Git History] Failed to fetch repo info: {repo_response.status_code}")
            print(f"   Response: {repo_response.json()}")
            return []
        
        default_branch = repo_response.json().get("default_branch", "main")
        print(f"✅ [Git History] Detected default branch: {default_branch}")
        
        # Now fetch commits from the correct branch
        url = f"https://api.github.com/repos/{owner}/{repo}/commits"
        params = {
            "sha": default_branch,  # Specify the branch
            "since": since_date,
            "per_page": 100
        }
        
        response = requests.get(url, headers=headers, params=params)
        if response.status_code != 200:
            error_data = response.json() if response.content else {}
            print(f"⚠️  [Git History] Failed to fetch commits: {response.status_code}")
            print(f"   Error: {error_data}")
            return []
        
        commits = response.json()
        print(f"✅ [Git History] Fetched {len(commits)} commits from '{default_branch}'")
        return commits
    
    async def _enrich_commits_with_changes(
        self,
        owner: str,
        repo: str,
        github_token: str,
        commits: List[Dict]
    ) -> List[Dict]:
        """Enrich each commit with file changes and stats"""
        enriched = []
        
        headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        for commit in commits[:50]:  # Limit to 50 most recent for performance
            try:
                sha = commit["sha"]
                detail_url = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
                
                response = requests.get(detail_url, headers=headers)
                if response.status_code == 200:
                    detail = response.json()
                    
                    # Extract Terraform file changes
                    tf_files = [
                        f for f in detail.get("files", [])
                        if f["filename"].endswith(".tf")
                    ]
                    
                    # Build file details with patches (limit patch size for UI)
                    file_details = []
                    for f in tf_files[:10]:  # Limit to 10 files per commit
                        patch = f.get("patch", "")
                        # Truncate large patches
                        if len(patch) > 3000:
                            lines = patch.split("\n")
                            patch = "\n".join(lines[:50]) + f"\n\n... ({len(lines) - 50} more lines)"
                        
                        file_details.append({
                            "filename": f["filename"],
                            "status": f["status"],  # added, removed, modified
                            "additions": f.get("additions", 0),
                            "deletions": f.get("deletions", 0),
                            "changes": f.get("changes", 0),
                            "patch": patch
                        })
                    
                    enriched.append({
                        "sha": sha,
                        "short_sha": sha[:7],
                        "message": commit["commit"]["message"].split("\n")[0],  # First line
                        "full_message": commit["commit"]["message"],
                        "author": {
                            "name": commit["commit"]["author"]["name"],
                            "email": commit["commit"]["author"]["email"]
                        },
                        "date": commit["commit"]["author"]["date"],
                        "stats": detail.get("stats", {}),
                        "tf_files_changed": len(tf_files),
                        "files_changed": [f["filename"] for f in tf_files],
                        "files": file_details,  # NEW: Detailed file changes
                        "additions": sum(f.get("additions", 0) for f in tf_files),
                        "deletions": sum(f.get("deletions", 0) for f in tf_files),
                        "change_type": self._classify_change_type(detail.get("files", [])),
                        "estimated_cost_impact": self._estimate_cost_impact(tf_files)
                    })
            except Exception as e:
                print(f"⚠️  [Commit Enrichment] Error for {commit.get('sha', 'unknown')}: {e}")
                continue
        
        return enriched
    
    async def _add_ai_explanations(self, commits: List[Dict]) -> List[Dict]:
        """Add AI-generated explanations to each commit"""
        # Only generate explanations for the most recent 15 commits to avoid timeout
        max_explanations = 15
        commits_to_explain = commits[:max_explanations]
        
        print(f"🤖 [AI Explanations] Generating explanations for {len(commits_to_explain)} of {len(commits)} commits...")
        
        for idx, commit in enumerate(commits_to_explain):
            try:
                # Build context for AI
                files_summary = ""
                if commit.get("files"):
                    files_summary = "\n".join([
                        f"- {f['filename']} ({f['status']}): +{f['additions']}/-{f['deletions']}"
                        for f in commit["files"][:5]
                    ])
                
                # Get first patch as example (if available)
                sample_patch = ""
                if commit.get("files") and len(commit["files"]) > 0:
                    first_file = commit["files"][0]
                    if first_file.get("patch"):
                        patch_lines = first_file["patch"].split("\n")[:20]
                        sample_patch = "\n".join(patch_lines)
                
                prompt = f"""Analyze this Terraform infrastructure commit and provide a clear, concise explanation.

COMMIT MESSAGE: {commit['message']}

FILES CHANGED:
{files_summary}

SAMPLE CODE CHANGES:
{sample_patch}

STATISTICS:
- Files changed: {commit.get('tf_files_changed', 0)}
- Lines added: {commit.get('additions', 0)}
- Lines removed: {commit.get('deletions', 0)}
- Change type: {commit.get('change_type', 'unknown')}

Provide a 2-3 sentence explanation that answers:
1. WHAT was changed (in plain English, not code)
2. WHY this change matters (impact, purpose, risk level)

Keep it conversational and focused on business/operational impact, not technical details."""

                # Call Claude for explanation
                response = self.anthropic_client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=200,
                    temperature=0.7,
                    messages=[{
                        "role": "user",
                        "content": prompt
                    }]
                )
                
                explanation = response.content[0].text.strip()
                commit["ai_explanation"] = explanation
                print(f"✅ [AI] Explained commit {idx+1}/{len(commits_to_explain)}: {commit['short_sha']}")
                
            except Exception as e:
                print(f"⚠️  [AI Explanations] Error for {commit.get('short_sha', 'unknown')}: {e}")
                # Fallback to basic summary if AI fails
                commit["ai_explanation"] = f"Modified {commit.get('tf_files_changed', 0)} infrastructure file(s) with {commit.get('change_type', 'configuration')} changes."
                continue
        
        print(f"✅ [AI Explanations] Complete! {len(commits_to_explain)} commits explained, {len(commits) - len(commits_to_explain)} without AI explanation")
        return commits
    
    async def generate_commit_explanation(
        self,
        owner: str,
        repo: str,
        sha: str,
        github_token: str
    ) -> str:
        """Generate AI explanation for a single commit on-demand"""
        try:
            print(f"🤖 [On-Demand AI] Generating explanation for commit {sha[:7]}...")
            
            # Fetch commit details from GitHub
            url = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
            headers = {
                "Authorization": f"token {github_token}",
                "Accept": "application/vnd.github.v3+json"
            }
            
            response = requests.get(url, headers=headers)
            if response.status_code != 200:
                return "Unable to fetch commit details."
            
            commit_data = response.json()
            
            # Extract Terraform files
            tf_files = [
                f for f in commit_data.get("files", [])
                if f["filename"].endswith(".tf")
            ]
            
            if not tf_files:
                return "This commit doesn't contain any Terraform changes."
            
            # Build context for AI
            files_summary = "\n".join([
                f"- {f['filename']} ({f['status']}): +{f.get('additions', 0)}/-{f.get('deletions', 0)}"
                for f in tf_files[:5]
            ])
            
            # Get patches from all files (up to reasonable size)
            sample_patch = ""
            for tf_file in tf_files[:3]:  # Show up to 3 files
                if tf_file.get("patch"):
                    patch_lines = tf_file["patch"].split("\n")[:30]  # More context
                    sample_patch += f"\n\n--- {tf_file['filename']} ---\n"
                    sample_patch += "\n".join(patch_lines)
            
            commit_message = commit_data["commit"]["message"]
            total_additions = sum(f.get("additions", 0) for f in tf_files)
            total_deletions = sum(f.get("deletions", 0) for f in tf_files)
            
            prompt = f"""You are analyzing a Terraform infrastructure change. Look at the code diff and explain it in plain English.

COMMIT MESSAGE: {commit_message}

CODE CHANGES:
{sample_patch}

FILES MODIFIED:
{files_summary}

Your job: Write 2-3 sentences explaining:
1. WHAT specific resources were added/changed/removed (be specific - mention resource types like "EC2 instance", "S3 bucket", "VPC", etc.)
2. WHY this matters (cost impact, security implications, performance, compliance, etc.)

Rules:
- Be SPECIFIC about what changed (e.g., "Added a t3.medium Windows EC2 instance" not "Modified infrastructure")
- Mention actual resource names if visible in the diff
- Focus on business impact, not technical jargon
- Keep it conversational and easy to understand

Example good response: "This commit creates a new t3.medium EC2 instance for Windows workloads with proper tagging. The instance size provides adequate compute resources while keeping costs around $40/month. The tags ensure proper cost tracking and resource management."

Now analyze this commit:"""

            # Call Claude for explanation
            response = self.anthropic_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=300,  # More room for detailed explanations
                temperature=0.7,
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )
            
            explanation = response.content[0].text.strip()
            print(f"✅ [On-Demand AI] Generated explanation for {sha[:7]}: {explanation[:100]}...")
            return explanation
            
        except Exception as e:
            print(f"⚠️  [On-Demand AI] Error: {e}")
            import traceback
            traceback.print_exc()
            
            # Better fallback - at least describe what files were touched
            if 'tf_files' in locals() and len(tf_files) > 0:
                file_names = [f['filename'].split('/')[-1] for f in tf_files[:3]]
                return f"Modified {len(tf_files)} Terraform file(s): {', '.join(file_names)}. Changes include {total_additions} additions and {total_deletions} deletions."
            else:
                return "Unable to generate explanation at this time."
    
    def _classify_change_type(self, files: List[Dict]) -> str:
        """Classify the type of change based on files modified"""
        filenames = [f["filename"].lower() for f in files if f["filename"].endswith(".tf")]
        
        if any("compute" in f or "instance" in f or "ec2" in f for f in filenames):
            return "compute"
        elif any("storage" in f or "s3" in f or "ebs" in f for f in filenames):
            return "storage"
        elif any("database" in f or "rds" in f or "dynamodb" in f for f in filenames):
            return "database"
        elif any("network" in f or "vpc" in f or "subnet" in f for f in filenames):
            return "networking"
        elif any("security" in f or "iam" in f for f in filenames):
            return "security"
        else:
            return "configuration"
    
    def _estimate_cost_impact(self, tf_files: List[Dict]) -> Dict[str, Any]:
        """Estimate cost impact from Terraform file changes"""
        # Simplified cost estimation based on resource types detected in diffs
        cost_keywords = {
            "t3.micro": 10,
            "t3.small": 20,
            "t3.medium": 40,
            "t3.large": 80,
            "t3.xlarge": 160,
            "m5.large": 100,
            "m5.xlarge": 200,
            "rds": 150,
            "elasticache": 50,
            "nat_gateway": 45
        }
        
        estimated_monthly = 0
        changes_detected = []
        
        for file in tf_files:
            patch = file.get("patch", "").lower()
            for keyword, cost in cost_keywords.items():
                if keyword in patch:
                    if "+" in patch:  # Addition
                        estimated_monthly += cost
                        changes_detected.append(f"+{keyword}")
                    elif "-" in patch:  # Removal
                        estimated_monthly -= cost
                        changes_detected.append(f"-{keyword}")
        
        return {
            "estimated_monthly_impact": estimated_monthly,
            "changes": changes_detected,
            "confidence": "low" if estimated_monthly == 0 else "medium"
        }
    
    def _build_timeline_chapters(self, commits: List[Dict]) -> List[Dict]:
        """Build chronological chapters from commits"""
        if not commits:
            return []
        
        # Group commits by month
        chapters_by_month = defaultdict(list)
        for commit in commits:
            try:
                date = datetime.fromisoformat(commit["date"].replace("Z", "+00:00"))
                month_key = date.strftime("%B %Y")
                chapters_by_month[month_key].append(commit)
            except:
                continue
        
        # Build chapters
        chapters = []
        for month, month_commits in sorted(chapters_by_month.items(), reverse=True):
            total_cost_impact = sum(
                c.get("estimated_cost_impact", {}).get("estimated_monthly_impact", 0)
                for c in month_commits
            )
            
            # Format commits for frontend with simplified structure
            formatted_commits = []
            for c in month_commits:
                formatted_commits.append({
                    "sha": c["sha"],
                    "message": c["message"],
                    "author": c["author"],
                    "date": c["date"],
                    "files_changed": c.get("tf_files_changed", len(c.get("files_changed", []))),
                    "insertions": c.get("additions", 0),
                    "deletions": c.get("deletions", 0),
                    "files": c.get("files", []),  # File details with patches
                    "summary": self._generate_commit_summary(c),
                    "explanation": c.get("ai_explanation", "")  # AI-generated explanation
                })
            
            chapters.append({
                "title": month,
                "commits": len(month_commits),
                "authors": list(set(c["author"]["name"] for c in month_commits)),
                "cost_impact": total_cost_impact,
                "changes": formatted_commits,
                "summary": self._summarize_month(month_commits)
            })
        
        return chapters
    
    def _generate_commit_summary(self, commit: Dict) -> str:
        """Generate a short summary for a single commit"""
        files_changed = commit.get("files_changed", [])
        change_type = commit.get("change_type", "configuration")
        additions = commit.get("additions", 0)
        deletions = commit.get("deletions", 0)
        
        if not files_changed:
            return f"{change_type.capitalize()} update"
        
        # Build summary based on changes
        if len(files_changed) == 1:
            file_name = files_changed[0].split("/")[-1]
            if additions > 0 and deletions == 0:
                return f"Added {additions} lines to {file_name}"
            elif deletions > 0 and additions == 0:
                return f"Removed {deletions} lines from {file_name}"
            else:
                return f"Modified {file_name} (+{additions}/-{deletions})"
        else:
            return f"Updated {len(files_changed)} files: {change_type} changes (+{additions}/-{deletions})"
    
    def _summarize_month(self, commits: List[Dict]) -> str:
        """Generate a summary for a month's changes"""
        if not commits:
            return "No changes"
        
        change_types = defaultdict(int)
        for commit in commits:
            change_types[commit.get("change_type", "other")] += 1
        
        main_activity = max(change_types.items(), key=lambda x: x[1])
        return f"{main_activity[1]} {main_activity[0]} changes, {len(commits)} total commits"
    
    def _calculate_cost_timeline(self, commits: List[Dict]) -> List[Dict]:
        """Calculate cumulative cost over time"""
        timeline = []
        cumulative_cost = 2000  # Starting baseline
        
        for commit in reversed(commits):  # Oldest to newest
            cost_impact = commit.get("estimated_cost_impact", {}).get("estimated_monthly_impact", 0)
            cumulative_cost += cost_impact
            
            try:
                date = datetime.fromisoformat(commit["date"].replace("Z", "+00:00"))
                timeline.append({
                    "date": date.strftime("%Y-%m-%d"),
                    "month": date.strftime("%B %Y"),
                    "cost": round(cumulative_cost, 2),
                    "change": round(cost_impact, 2),
                    "commit": commit["short_sha"],
                    "description": commit["message"][:60]
                })
            except:
                continue
        
        return timeline
    
    def _identify_trends(self, commits: List[Dict]) -> Dict[str, Any]:
        """Identify patterns and trends"""
        if len(commits) < 5:
            return {"sufficient_data": False}
        
        # Analyze commit frequency
        dates = []
        for commit in commits:
            try:
                date = datetime.fromisoformat(commit["date"].replace("Z", "+00:00"))
                dates.append(date)
            except:
                continue
        
        if len(dates) < 2:
            return {"sufficient_data": False}
        
        # Calculate trends
        date_range = (max(dates) - min(dates)).days
        commits_per_week = len(commits) / max(date_range / 7, 1)
        
        # Most active authors
        author_counts = defaultdict(int)
        for commit in commits:
            author_counts[commit["author"]["name"]] += 1
        
        top_authors = sorted(author_counts.items(), key=lambda x: x[1], reverse=True)[:3]
        
        # Change type distribution
        change_types = defaultdict(int)
        for commit in commits:
            change_types[commit.get("change_type", "other")] += 1
        
        return {
            "sufficient_data": True,
            "commits_per_week": round(commits_per_week, 1),
            "most_active_authors": [{"name": name, "commits": count} for name, count in top_authors],
            "change_distribution": dict(change_types),
            "total_cost_drift": sum(
                c.get("estimated_cost_impact", {}).get("estimated_monthly_impact", 0)
                for c in commits
            )
        }
    
    def _generate_recommendations(
        self,
        commits: List[Dict],
        cost_timeline: List[Dict],
        trends: Dict[str, Any]
    ) -> List[Dict]:
        """Generate actionable recommendations"""
        recommendations = []
        
        # Check for rapid cost growth
        if len(cost_timeline) >= 2:
            start_cost = cost_timeline[0]["cost"]
            end_cost = cost_timeline[-1]["cost"]
            growth_rate = ((end_cost - start_cost) / start_cost) * 100 if start_cost > 0 else 0
            
            if growth_rate > 50:
                recommendations.append({
                    "type": "cost_alert",
                    "priority": "high",
                    "title": "Rapid Cost Growth Detected",
                    "description": f"Infrastructure costs grew {growth_rate:.1f}% over the analyzed period",
                    "impact": f"${end_cost - start_cost:.0f}/month increase",
                    "action": "Review recent infrastructure changes for optimization opportunities"
                })
        
        # Check commit frequency
        if trends.get("sufficient_data") and trends.get("commits_per_week", 0) > 10:
            recommendations.append({
                "type": "process",
                "priority": "medium",
                "title": "High Change Frequency",
                "description": f"{trends['commits_per_week']} commits/week - consider consolidating changes",
                "action": "Implement change approval process or batching"
            })
        
        # Always add a best practice recommendation
        recommendations.append({
            "type": "best_practice",
            "priority": "low",
            "title": "Enable Cost Tagging",
            "description": "Tag all resources with cost centers for better cost attribution",
            "impact": "Improve cost visibility and chargeback",
            "action": "Add tags: CostCenter, Environment, Team to all resources"
        })
        
        return recommendations
    
    def _build_narrative_summary(
        self,
        chapters: List[Dict],
        cost_timeline: List[Dict],
        trends: Dict[str, Any]
    ) -> str:
        """Build a human-readable narrative"""
        if not chapters:
            return "No infrastructure changes detected in the analyzed period."
        
        narrative_parts = []
        
        # Opening
        total_commits = sum(c["commits"] for c in chapters)
        total_authors = len(set(author for c in chapters for author in c["authors"]))
        
        narrative_parts.append(
            f"Over the past {len(chapters)} months, your infrastructure evolved through "
            f"{total_commits} changes made by {total_authors} team member(s)."
        )
        
        # Cost evolution
        if len(cost_timeline) >= 2:
            start_cost = cost_timeline[0]["cost"]
            end_cost = cost_timeline[-1]["cost"]
            change = end_cost - start_cost
            
            if abs(change) > 100:
                direction = "increased" if change > 0 else "decreased"
                narrative_parts.append(
                    f"Infrastructure costs {direction} by ${abs(change):.0f}/month "
                    f"(from ${start_cost:.0f} to ${end_cost:.0f}/month)."
                )
        
        # Activity highlights
        if trends.get("sufficient_data"):
            most_active = trends.get("most_active_authors", [])
            if most_active:
                narrative_parts.append(
                    f"Most active contributor: {most_active[0]['name']} "
                    f"({most_active[0]['commits']} changes)."
                )
            
            change_dist = trends.get("change_distribution", {})
            if change_dist:
                top_category = max(change_dist.items(), key=lambda x: x[1])
                narrative_parts.append(
                    f"Primary focus area: {top_category[0]} ({top_category[1]} changes)."
                )
        
        return " ".join(narrative_parts)
    
    def _empty_story(self, owner: str, repo: str, months: int) -> Dict[str, Any]:
        """Return empty story structure"""
        return {
            "repo": f"{owner}/{repo}",
            "timeframe": f"Last {months} months",
            "narrative": "Unable to build infrastructure story at this time.",
            "chapters": [],
            "cost_timeline": [],
            "trends": {"sufficient_data": False},
            "recommendations": [],
            "total_commits": 0,
            "total_authors": 0
        }


# Global instance
infrastructure_story_service = InfrastructureStoryService()

