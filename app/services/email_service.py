"""
Email service for team invitations and notifications.
Integrates with SendGrid/SMTP for production email delivery.
"""
import os
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Email configuration from environment
SENDGRID_API_KEY = os.getenv('SENDGRID_API_KEY')
FROM_EMAIL = os.getenv('FROM_EMAIL', 'team@driftbox.io')
FROM_NAME = os.getenv('FROM_NAME', 'Driftbox')


def send_team_invitation_email(
    email: str,
    team_name: str,
    inviter_name: str,
    invitation_url: str,
    role: str
) -> bool:
    """
    Send team invitation email to new member.
    
    Args:
        email: Recipient email
        team_name: Name of team they're invited to
        inviter_name: Name of person who invited them
        invitation_url: URL to accept invitation
        role: Role they'll have (admin, developer, viewer)
    """
    subject = f"{inviter_name} invited you to join {team_name} on Driftbox"
    
    # Email body (HTML)
    html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }}
        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 8px 8px 0 0;
            text-align: center;
        }}
        .content {{
            background: #f9fafb;
            padding: 30px;
            border: 1px solid #e5e7eb;
            border-top: none;
        }}
        .button {{
            display: inline-block;
            background: #667eea;
            color: white !important;
            padding: 14px 32px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            margin: 20px 0;
        }}
        .button:hover {{
            background: #5568d3;
        }}
        .role-badge {{
            display: inline-block;
            background: #e0e7ff;
            color: #4338ca;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 14px;
            font-weight: 500;
        }}
        .footer {{
            text-align: center;
            color: #6b7280;
            font-size: 14px;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
        }}
        .security-note {{
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 12px;
            margin: 20px 0;
            font-size: 14px;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1 style="margin: 0; font-size: 24px;">🚀 Team Invitation</h1>
    </div>
    
    <div class="content">
        <p style="font-size: 16px;">Hi there!</p>
        
        <p><strong>{inviter_name}</strong> has invited you to join <strong>{team_name}</strong> on Driftbox.</p>
        
        <p>You'll join as: <span class="role-badge">{role.title()}</span></p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{invitation_url}" class="button">Accept Invitation</a>
        </div>
        
        <div class="security-note">
            <strong>🔒 Security Notice:</strong> This invitation link will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
        </div>
        
        <p style="font-size: 14px; color: #6b7280;">
            <strong>What is Driftbox?</strong><br>
            Driftbox is the first AI-powered infrastructure-as-code platform that helps teams deploy, secure, and manage cloud infrastructure with confidence.
        </p>
        
        <p style="font-size: 14px; color: #6b7280;">
            With Driftbox, your team can:
            <ul style="font-size: 14px; color: #6b7280;">
                <li>🔍 Detect security vulnerabilities and drift in real-time</li>
                <li>🤖 Auto-heal infrastructure issues with AI</li>
                <li>🎯 Deploy directly from GitHub with OIDC</li>
                <li>📊 Track infrastructure health scores</li>
            </ul>
        </p>
    </div>
    
    <div class="footer">
        <p>This invitation was sent to {email}</p>
        <p>If you have any questions, reach out to us at support@driftbox.io</p>
        <p style="margin-top: 20px;">
            <a href="https://driftbox.io" style="color: #667eea; text-decoration: none;">driftbox.io</a> | 
            <a href="https://docs.driftbox.io" style="color: #667eea; text-decoration: none;">Documentation</a>
        </p>
    </div>
</body>
</html>
"""
    
    # Plain text fallback
    text_body = f"""
{inviter_name} invited you to join {team_name} on Driftbox

You'll join as: {role.title()}

Accept your invitation here:
{invitation_url}

This invitation will expire in 7 days.

What is Driftbox?
Driftbox is the first AI-powered infrastructure-as-code platform that helps teams deploy, secure, and manage cloud infrastructure with confidence.

---
This invitation was sent to {email}
If you have any questions, reach out to us at support@driftbox.io
"""
    
    try:
        # If SendGrid is configured, use it
        if SENDGRID_API_KEY:
            return _send_via_sendgrid(email, subject, html_body, text_body)
        else:
            # Log for development (no actual email sent)
            logger.info(f"[EMAIL] Team invitation to {email}")
            logger.info(f"[EMAIL] Invitation URL: {invitation_url}")
            print(f"\n{'='*80}")
            print(f"📧 TEAM INVITATION EMAIL (Dev Mode)")
            print(f"{'='*80}")
            print(f"To: {email}")
            print(f"Subject: {subject}")
            print(f"Invitation URL: {invitation_url}")
            print(f"{'='*80}\n")
            return True
            
    except Exception as e:
        logger.error(f"Failed to send team invitation email: {e}")
        return False


def _send_via_sendgrid(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: str
) -> bool:
    """Send email via SendGrid"""
    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail, Email, To, Content
        
        message = Mail(
            from_email=Email(FROM_EMAIL, FROM_NAME),
            to_emails=To(to_email),
            subject=subject,
            plain_text_content=Content("text/plain", text_content),
            html_content=Content("text/html", html_content)
        )
        
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        response = sg.send(message)
        
        logger.info(f"Email sent to {to_email}, status: {response.status_code}")
        return response.status_code in [200, 201, 202]
        
    except Exception as e:
        logger.error(f"SendGrid error: {e}")
        return False


def send_team_member_removed_email(
    email: str,
    team_name: str,
    removed_by: str
) -> bool:
    """Notify user they were removed from team"""
    subject = f"You've been removed from {team_name}"
    
    html_body = f"""
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Team Membership Update</h2>
    <p>Hi,</p>
    <p>You've been removed from the <strong>{team_name}</strong> team on Driftbox by {removed_by}.</p>
    <p>You no longer have access to this team's repositories and resources.</p>
    <p>If you believe this was done in error, please contact your team administrator.</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    <p style="color: #6b7280; font-size: 14px;">This notification was sent to {email}</p>
</body>
</html>
"""
    
    text_body = f"""
You've been removed from the {team_name} team on Driftbox by {removed_by}.

You no longer have access to this team's repositories and resources.

If you believe this was done in error, please contact your team administrator.
"""
    
    try:
        if SENDGRID_API_KEY:
            return _send_via_sendgrid(email, subject, html_body, text_body)
        else:
            logger.info(f"[EMAIL] Removal notification to {email}")
            return True
    except Exception as e:
        logger.error(f"Failed to send removal email: {e}")
        return False

