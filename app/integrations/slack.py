"""
Slack messaging integration for real-time infrastructure event notifications.
Delivers alerts for pull request creation, cost changes, validation outcomes, etc.
"""
import os
import requests
from typing import Dict, Optional, List


class SlackNotificationService:
    """Infrastructure event notification service via Slack webhook integration"""
    
    def __init__(self):
        self.notification_webhook_endpoint = os.getenv("SLACK_WEBHOOK_URL")
        # Optional: specific channel webhooks (overrides default)
        self.pr_channel_webhook = os.getenv("SLACK_PR_CHANNEL_WEBHOOK", self.notification_webhook_endpoint)
        self.sandbox_channel_webhook = os.getenv("SLACK_SANDBOX_CHANNEL_WEBHOOK", self.notification_webhook_endpoint)
        self.notification_enabled = bool(self.notification_webhook_endpoint)
        
        if not self.notification_enabled:
            print("⚠️  Slack notifications disabled (SLACK_WEBHOOK_URL not set)")
    
    def _transmit_message(self, message_text: str, message_blocks: Optional[List[Dict]] = None, webhook_url: Optional[str] = None):
        """Internal method to transmit formatted message to Slack webhook"""
        if not self.notification_enabled:
            return
        
        # Use provided webhook URL or default
        target_webhook = webhook_url or self.notification_webhook_endpoint
        if not target_webhook:
            return
        
        try:
            message_payload = {"text": message_text}
            if message_blocks:
                message_payload["blocks"] = message_blocks
            
            webhook_response = requests.post(
                target_webhook,
                json=message_payload,
                timeout=5
            )
            webhook_response.raise_for_status()
        except Exception as error:
            print(f"⚠️  Slack notification transmission failed: {error}")
    
    def send_pull_request_notification(
        self,
        pull_request_url: str,
        change_title: str,
        financial_impact: Optional[Dict] = None,
        validation_result: Optional[Dict] = None,
        modified_file_count: int = 0,
        channel_webhook: Optional[str] = None
    ):
        """
        Transmit notification when infrastructure pull request is created.
        
        Args:
            pull_request_url: GitHub pull request URL
            change_title: Pull request title or prompt description
            financial_impact: Monthly cost impact analysis
            validation_result: Terraform validation outcome
            modified_file_count: Count of modified files
        """
        # Calculate financial impact presentation
        monthly_cost_delta = 0
        if financial_impact:
            monthly_cost_delta = financial_impact.get("delta_monthly_cost", 0)
        
        cost_indicator_emoji = "💰" if monthly_cost_delta > 0 else "✅" if monthly_cost_delta == 0 else "💚"
        cost_description = f"${abs(monthly_cost_delta):.2f}/month" if monthly_cost_delta != 0 else "No cost change"
        if monthly_cost_delta > 0:
            cost_description = f"+{cost_description}"
        elif monthly_cost_delta < 0:
            cost_description = f"-{cost_description}"
        
        # Format validation status
        validation_indicator_emoji = "✅"
        validation_description = "Passed"
        if validation_result:
            if validation_result.get("valid") is False:
                validation_indicator_emoji = "❌"
                validation_description = "Failed"
            elif validation_result.get("valid") is None:
                validation_indicator_emoji = "⚠️"
                validation_description = "Skipped"
            
            if validation_result.get("auto_formatted"):
                validation_description += " (auto-formatted)"
        
        # Use dedicated PR channel webhook if available, otherwise use default
        webhook_url = channel_webhook or self.pr_channel_webhook or self.notification_webhook_endpoint
        
        self._transmit_message(
            message_text=f"🚀 New Infrastructure PR: {change_title}",
            message_blocks=[
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*🚀 New Infrastructure Change*\n<{pull_request_url}|{change_title}>"
                    }
                },
                {
                    "type": "section",
                    "fields": [
                        {
                            "type": "mrkdwn",
                            "text": f"{cost_indicator_emoji} *Cost Impact*\n{cost_description}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"{validation_indicator_emoji} *Validation*\n{validation_description}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"📁 *Files Changed*\n{modified_file_count}"
                        }
                    ]
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "View PR on GitHub"
                            },
                            "url": pull_request_url,
                            "style": "primary"
                        }
                    ]
                }
            ],
            webhook_url=webhook_url
        )
    
    def send_budget_alert_notification(
        self,
        current_monthly_cost: float,
        budget_ceiling: float,
        budget_utilization_percentage: float,
        expensive_resources: Optional[List[Dict]] = None
    ):
        """
        Transmit notification when infrastructure cost threshold is exceeded.
        
        Args:
            current_monthly_cost: Current monthly expenditure
            budget_ceiling: Configured budget limit
            budget_utilization_percentage: Percentage of budget consumed
            expensive_resources: List of most expensive infrastructure resources
        """
        alert_emoji = "🚨" if budget_utilization_percentage >= 100 else "⚠️" if budget_utilization_percentage >= 80 else "💰"
        
        status_fields = [
            {
                "type": "mrkdwn",
                "text": f"*Current Cost*\n${current_monthly_cost:.2f}/month"
            },
            {
                "type": "mrkdwn",
                "text": f"*Budget Limit*\n${budget_ceiling:.2f}/month"
            },
            {
                "type": "mrkdwn",
                "text": f"*Usage*\n{budget_utilization_percentage:.0f}%"
            }
        ]
        
        notification_blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{alert_emoji} Cost Alert*\nYour infrastructure costs are at {budget_utilization_percentage:.0f}% of the budget limit"
                }
            },
            {
                "type": "section",
                "fields": status_fields
            }
        ]
        
        # Include top expensive resources when available
        if expensive_resources:
            top_three_resources = expensive_resources[:3]
            resources_summary = "\n".join([
                f"• {resource.get('name', 'unknown')}: ${resource.get('cost', 0):.2f}/mo"
                for resource in top_three_resources
            ])
            notification_blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*💸 Top Expensive Resources*\n{resources_summary}"
                }
            })
        
        self._transmit_message(
            message_text=f"{alert_emoji} Cost Alert: {budget_utilization_percentage:.0f}% of budget used (${current_monthly_cost:.2f}/${budget_ceiling:.2f})",
            message_blocks=notification_blocks
        )
    
    def send_validation_failure_notification(
        self,
        validation_errors: List[str],
        change_description: str = "Infrastructure change",
        pull_request_url: Optional[str] = None
    ):
        """
        Transmit notification when Terraform validation fails.
        
        Args:
            validation_errors: List of validation error messages
            change_description: Original change prompt or description
            pull_request_url: Optional pull request URL
        """
        formatted_errors = "\n".join([f"• {error}" for error in validation_errors[:5]])
        
        notification_blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*❌ Terraform Validation Failed*\n_{change_description}_"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"```{formatted_errors}```"
                }
            }
        ]
        
        if pull_request_url:
            notification_blocks.append({
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "View PR"
                        },
                        "url": pull_request_url
                    }
                ]
            })
        
        self._transmit_message(
            message_text=f"❌ Terraform validation failed: {change_description}",
            message_blocks=notification_blocks
        )
    
    def send_change_approval_notification(
        self,
        change_identifier: str,
        change_description: str,
        approver_name: str = "User"
    ):
        """Transmit notification when infrastructure change is approved"""
        self._transmit_message(
            message_text=f"✅ Infrastructure change approved by {approver_name}",
            message_blocks=[
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*✅ Change Approved*\n_{change_description}_\n\nApproved by: {approver_name}"
                    }
                }
            ]
        )
    
    def send_change_rejection_notification(
        self,
        change_identifier: str,
        change_description: str,
        rejection_reason: Optional[str] = None
    ):
        """Transmit notification when infrastructure change is rejected"""
        reason_detail = f"\nReason: {rejection_reason}" if rejection_reason else ""
        
        self._transmit_message(
            message_text=f"❌ Infrastructure change rejected",
            message_blocks=[
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*❌ Change Rejected*\n_{change_description}_{reason_detail}"
                    }
                }
            ]
        )
    
    def send_daily_summary_notification(
        self,
        total_monthly_cost: float,
        daily_change_count: int,
        new_resource_count: int,
        cost_change_delta: float
    ):
        """Transmit daily infrastructure status summary"""
        delta_indicator = "📈" if cost_change_delta > 0 else "📉" if cost_change_delta < 0 else "➡️"
        delta_description = f"+${cost_change_delta:.2f}" if cost_change_delta > 0 else f"${cost_change_delta:.2f}" if cost_change_delta < 0 else "No change"
        
        self._transmit_message(
            message_text=f"📊 Daily Infrastructure Summary",
            message_blocks=[
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "*📊 Daily Infrastructure Summary*"
                    }
                },
                {
                    "type": "section",
                    "fields": [
                        {
                            "type": "mrkdwn",
                            "text": f"*💰 Total Cost*\n${total_monthly_cost:.2f}/month"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*{delta_indicator} Cost Change*\n{delta_description}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*🔄 Changes Today*\n{daily_change_count} PRs"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*➕ New Resources*\n{new_resource_count}"
                        }
                    ]
                }
            ]
        )
    
    def send_sandbox_run_notification(
        self,
        repository: str,
        status: str,
        user_name: str,
        team_name: Optional[str] = None,
        duration_ms: int = 0,
        files_tested: int = 0,
        security_issues: int = 0,
        auto_healed: bool = False,
        fixes_applied: Optional[int] = None,
        errors: Optional[List[str]] = None,
        channel_webhook: Optional[str] = None
    ):
        """
        Transmit notification when a sandbox run is executed.
        
        Args:
            repository: Repository name (e.g., "owner/repo")
            status: Run status ("passed", "failed", "running")
            user_name: Name of user who ran the test
            team_name: Optional team name
            duration_ms: Duration in milliseconds
            files_tested: Number of files tested
            security_issues: Number of security issues found
            auto_healed: Whether auto-healing was applied
            fixes_applied: Number of fixes applied (if auto_healed)
            errors: List of error messages (if failed)
            channel_webhook: Optional webhook URL for specific channel
        """
        # Status color
        if status == "passed":
            status_color = "good"
            status_indicator = "PASSED"
        elif status == "failed":
            status_color = "danger"
            status_indicator = "FAILED"
        else:
            status_color = "warning"
            status_indicator = "RUNNING"
        
        # Format duration
        duration_seconds = duration_ms / 1000
        if duration_seconds < 1:
            duration_str = f"{duration_ms}ms"
        elif duration_seconds < 60:
            duration_str = f"{duration_seconds:.1f}s"
        else:
            minutes = int(duration_seconds // 60)
            seconds = int(duration_seconds % 60)
            duration_str = f"{minutes}m {seconds}s"
        
        # Build fields
        fields = [
            {
                "type": "mrkdwn",
                "text": f"*Status*\n{status_indicator}"
            },
            {
                "type": "mrkdwn",
                "text": f"*Duration*\n{duration_str}"
            },
            {
                "type": "mrkdwn",
                "text": f"*Files Tested*\n{files_tested}"
            },
            {
                "type": "mrkdwn",
                "text": f"*Security Issues*\n{security_issues}"
            }
        ]
        
        # Add auto-heal info if applicable
        if auto_healed and fixes_applied:
            fields.append({
                "type": "mrkdwn",
                "text": f"*Auto-Healed*\n{fixes_applied} fix{'es' if fixes_applied != 1 else ''} applied"
            })
        
        # Build message blocks
        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Sandbox Run Executed*\nRepository: `{repository}`"
                }
            },
            {
                "type": "section",
                "fields": fields
            }
        ]
        
        # Add user/team info
        user_info = f"Run by: *{user_name}*"
        if team_name:
            user_info += f" (Team: *{team_name}*)"
        
        blocks.append({
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": user_info
                }
            ]
        })
        
        # Add errors if failed
        if status == "failed" and errors:
            error_text = "\n".join([f"• {error}" for error in errors[:5]])
            if len(errors) > 5:
                error_text += f"\n• ... and {len(errors) - 5} more"
            
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Errors:*\n```{error_text}```"
                }
            })
        
        # Use provided webhook, sandbox-specific webhook, or default
        webhook_url = channel_webhook or self.sandbox_channel_webhook or self.notification_webhook_endpoint
        
        self._transmit_message(
            message_text=f"Sandbox Run: {repository} - {status_indicator}",
            message_blocks=blocks,
            webhook_url=webhook_url
        )


# Global notification service instance
slack_notifier = SlackNotificationService()

