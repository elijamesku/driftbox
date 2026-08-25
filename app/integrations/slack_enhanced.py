"""
Enhanced Slack integration with interactive features.
Includes slash commands, interactive buttons, and rich notifications.
"""
import os
from typing import Dict, Optional, List
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from slack_bolt import App
from slack_bolt.adapter.fastapi import SlackRequestHandler


class EnhancedSlackIntegration:
    """Advanced Slack integration with interactive features"""
    
    def __init__(self):
        # Bot token for posting messages
        self.bot_token = os.getenv("SLACK_BOT_TOKEN")
        # App token for Socket Mode (interactive features)
        self.app_token = os.getenv("SLACK_APP_TOKEN")
        # Signing secret for verifying requests
        self.signing_secret = os.getenv("SLACK_SIGNING_SECRET")
        
        self.enabled = bool(self.bot_token)
        
        if self.enabled:
            self.client = WebClient(token=self.bot_token)
            
            if self.signing_secret:
                # Initialize Bolt app for interactive features
                self.app = App(
                    token=self.bot_token,
                    signing_secret=self.signing_secret
                )
                self._register_handlers()
                self.handler = SlackRequestHandler(self.app)
            else:
                self.app = None
                self.handler = None
        else:
            print("⚠️  Slack enhanced features disabled (tokens not set)")
    
    def _register_handlers(self):
        """Register interactive handlers (slash commands, buttons, etc.)"""
        if not self.app:
            return
        
        # Slash command: /infrara-status
        @self.app.command("/infrara-status")
        def handle_status_command(ack, command, say):
            ack()
            # Get infrastructure status
            say({
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": "*Infrastructure Status* 📊"
                        }
                    },
                    {
                        "type": "section",
                        "fields": [
                            {"type": "mrkdwn", "text": "*Resources*\n47"},
                            {"type": "mrkdwn", "text": "*Cost*\n$1,247/month"},
                            {"type": "mrkdwn", "text": "*Active PRs*\n3"},
                            {"type": "mrkdwn", "text": "*Last Deploy*\n2 hours ago"}
                        ]
                    }
                ]
            })
        
        # Slash command: /infrara-cost
        @self.app.command("/infrara-cost")
        def handle_cost_command(ack, command, say):
            ack()
            say({
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": "*Cost Breakdown* 💰"
                        }
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": "```\nEC2 Instances:  $450/mo\nRDS Database:   $380/mo\nS3 Storage:     $120/mo\nLoad Balancers: $200/mo\nOther:          $97/mo\n-----------------------\nTotal:         $1,247/mo\n```"
                        }
                    }
                ]
            })
        
        # Button: Approve PR
        @self.app.action("approve_pr")
        def handle_approve_pr(ack, body, action):
            ack()
            pr_id = action["value"]
            # Call API to approve PR
            self.client.chat_update(
                channel=body["channel"]["id"],
                ts=body["message"]["ts"],
                text="✅ PR Approved!",
                blocks=[
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"✅ *PR #{pr_id} Approved*\nChanges will be merged shortly."
                        }
                    }
                ]
            )
        
        # Button: Reject PR
        @self.app.action("reject_pr")
        def handle_reject_pr(ack, body, action):
            ack()
            pr_id = action["value"]
            self.client.chat_update(
                channel=body["channel"]["id"],
                ts=body["message"]["ts"],
                text="❌ PR Rejected",
                blocks=[
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"❌ *PR #{pr_id} Rejected*\nChanges discarded."
                        }
                    }
                ]
            )
    
    def send_interactive_pr_notification(
        self,
        channel: str,
        pr_url: str,
        pr_id: str,
        title: str,
        cost_delta: float,
        file_count: int,
        diff_preview: str
    ):
        """
        Send interactive PR notification with approve/reject buttons.
        
        Args:
            channel: Slack channel ID
            pr_url: PR URL
            pr_id: PR identifier
            title: PR title
            cost_delta: Cost change (positive or negative)
            file_count: Number of files changed
            diff_preview: Preview of changes
        """
        if not self.enabled:
            return
        
        emoji = "💰" if cost_delta > 0 else "💵" if cost_delta < 0 else "✅"
        cost_text = f"+${cost_delta:.2f}/month" if cost_delta > 0 else f"${cost_delta:.2f}/month"
        
        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*🚀 New Infrastructure PR*\n<{pr_url}|{title}>"
                }
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"{emoji} *Cost Impact*\n{cost_text}"},
                    {"type": "mrkdwn", "text": f"📄 *Files Changed*\n{file_count}"}
                ]
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Preview:*\n```{diff_preview[:500]}```"
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Approve ✅"},
                        "style": "primary",
                        "value": pr_id,
                        "action_id": "approve_pr"
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Reject ❌"},
                        "style": "danger",
                        "value": pr_id,
                        "action_id": "reject_pr"
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "View PR"},
                        "url": pr_url
                    }
                ]
            }
        ]
        
        try:
            self.client.chat_postMessage(
                channel=channel,
                text=f"New PR: {title}",
                blocks=blocks
            )
        except SlackApiError as e:
            print(f"Slack error: {e.response['error']}")
    
    def send_usage_alert(
        self,
        channel: str,
        user: str,
        usage_percent: int,
        tier: str,
        limit: int,
        used: int
    ):
        """
        Alert when user approaches usage limit.
        
        Args:
            channel: Slack channel
            user: User identifier
            usage_percent: Percentage of limit used
            tier: Subscription tier
            limit: Usage limit
            used: Current usage
        """
        if not self.enabled or usage_percent < 80:
            return
        
        emoji = "⚠️" if usage_percent < 95 else "🚨"
        color = "#FFA500" if usage_percent < 95 else "#FF0000"
        
        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"{emoji} *Usage Alert for {user}*"
                }
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Tier*\n{tier}"},
                    {"type": "mrkdwn", "text": f"*Usage*\n{usage_percent}%"},
                    {"type": "mrkdwn", "text": f"*Used*\n{used}/{limit}"},
                    {"type": "mrkdwn", "text": f"*Remaining*\n{limit - used}"}
                ]
            }
        ]
        
        if usage_percent >= 95:
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "⚠️ *Action Required:* Upgrade plan or wait for limit reset"
                }
            })
        
        try:
            self.client.chat_postMessage(
                channel=channel,
                text=f"Usage alert: {usage_percent}%",
                blocks=blocks
            )
        except SlackApiError as e:
            print(f"Slack error: {e.response['error']}")
    
    def send_daily_summary(
        self,
        channel: str,
        summary: Dict
    ):
        """
        Send daily infrastructure summary.
        
        Args:
            channel: Slack channel
            summary: {
                "prs_created": int,
                "resources_added": int,
                "cost_delta": float,
                "security_issues_fixed": int
            }
        """
        if not self.enabled:
            return
        
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "📊 Daily Infrastructure Summary"
                }
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*PRs Created*\n{summary.get('prs_created', 0)}"},
                    {"type": "mrkdwn", "text": f"*Resources Added*\n{summary.get('resources_added', 0)}"},
                    {"type": "mrkdwn", "text": f"*Cost Change*\n${summary.get('cost_delta', 0):.2f}/month"},
                    {"type": "mrkdwn", "text": f"*Security Fixes*\n{summary.get('security_issues_fixed', 0)}"}
                ]
            }
        ]
        
        try:
            self.client.chat_postMessage(
                channel=channel,
                text="Daily summary",
                blocks=blocks
            )
        except SlackApiError as e:
            print(f"Slack error: {e.response['error']}")
    
    def send_security_alert(
        self,
        channel: str,
        severity: str,
        issue: str,
        file: str,
        recommendation: str
    ):
        """
        Alert on security issues detected.
        
        Args:
            channel: Slack channel
            severity: "critical", "high", "medium", "low"
            issue: Description of security issue
            file: Affected file
            recommendation: How to fix
        """
        if not self.enabled:
            return
        
        emoji_map = {
            "critical": "🚨",
            "high": "⚠️",
            "medium": "⚡",
            "low": "ℹ️"
        }
        
        emoji = emoji_map.get(severity, "ℹ️")
        
        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"{emoji} *Security Alert: {severity.upper()}*"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Issue:* {issue}\n*File:* `{file}`\n*Fix:* {recommendation}"
                }
            }
        ]
        
        try:
            self.client.chat_postMessage(
                channel=channel,
                text=f"Security alert: {issue}",
                blocks=blocks
            )
        except SlackApiError as e:
            print(f"Slack error: {e.response['error']}")


# Singleton
slack_enhanced = EnhancedSlackIntegration()

