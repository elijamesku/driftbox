from app.api.v1.endpoints import (
    health, git, generation, repo, rag, diff, costs, 
    conversations, queries, mcp_routes, streaming, billing, auth, chat, local_repos, local, aws_resources, github_parser, diagram_generator, drift_detection, file_proposals, terraform_to_pulumi, documentation_generator, pr_tracking, context, security, cost_analysis, cortex, infrastructure_index, teams, team_collab, team_staging, achievements, terraform, aws_import, video, wiki, digitalocean, audit, admin, sandbox, audit_logs, policies, dashboard
)
from fastapi import APIRouter

api_router = APIRouter()

# Authentication routes - must be registered first
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])

# Admin dashboard and analytics endpoints
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])

# Chat interface with ask/agent modes (Cursor-inspired)
api_router.include_router(chat.router, tags=["chat"])

# Local repository management for desktop app
api_router.include_router(local_repos.router, prefix="/local", tags=["local-repos"])

# Local file operations (delete, git reset, etc.)
api_router.include_router(local.router, prefix="/local", tags=["local-operations"])
api_router.include_router(video.router, tags=["video"])

# Terraform to Pulumi conversion
api_router.include_router(terraform_to_pulumi.router, tags=["terraform-to-pulumi"])

# Core infrastructure generation endpoints
api_router.include_router(health.router)
api_router.include_router(git.router, prefix="/git", tags=["git"])
api_router.include_router(generation.router)
api_router.include_router(repo.router)
api_router.include_router(rag.router)

# Change approval workflow
api_router.include_router(diff.router)

# Cost estimation and tracking
api_router.include_router(costs.router)

# AWS Resources Dashboard
api_router.include_router(aws_resources.router, prefix="/dashboard", tags=["dashboard"])

# GitHub Parser (serverless-friendly)
api_router.include_router(github_parser.router, prefix="/github", tags=["github"])

# Architecture Diagram Generator
api_router.include_router(diagram_generator.router, prefix="/diagram", tags=["diagram"])

# Professional Documentation Generator
api_router.include_router(documentation_generator.router, prefix="/documentation", tags=["documentation"])

# Drift Detection (code-based, no AWS creds needed)
api_router.include_router(drift_detection.router, prefix="/drift", tags=["drift"])

# Security Scanning (code-based, no AWS creds needed)
api_router.include_router(security.router, prefix="/security", tags=["security"])

# AWS Import - Convert existing AWS infrastructure to Terraform (no AWS creds needed)
api_router.include_router(aws_import.router, prefix="/aws-import", tags=["aws-import"])

# Cost Analysis (code-based, no AWS creds needed)
api_router.include_router(cost_analysis.router, prefix="/cost", tags=["cost-analysis"])

# Driftbox Cortex - Intelligence about learned codebase patterns
api_router.include_router(cortex.router, prefix="/cortex", tags=["cortex"])

# Conversation and query history
api_router.include_router(conversations.router)
api_router.include_router(queries.router)

# Model Context Protocol integrations
api_router.include_router(mcp_routes.router)

# WebSocket streaming interface
api_router.include_router(streaming.router, tags=["streaming"])

# Billing and usage management
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])

# Team management (member invitations, RBAC, shared repos)
api_router.include_router(teams.router, tags=["teams"])

# Real-time team collaboration (WebSockets, live editing, presence)
api_router.include_router(team_collab.router, tags=["team-collaboration"])

# Team staging area for collaborative PR building
api_router.include_router(team_staging.router, tags=["team-staging"])

# Achievements, badges, and leaderboards
api_router.include_router(achievements.router, tags=["achievements"])

# File proposals for Cursor-style approve/reject workflow
api_router.include_router(file_proposals.router, prefix="/files", tags=["file-proposals"])

# PR tracking and analytics
api_router.include_router(pr_tracking.router, prefix="/prs", tags=["pr-tracking"])

# Context-based agency (RAG for codebase and conversation indexing)
api_router.include_router(context.router, prefix="/context", tags=["context"])

# Infrastructure indexing and querying
api_router.include_router(infrastructure_index.router, prefix="/infrastructure", tags=["infrastructure"])

# Server-side Terraform validation (fast - providers cached on server)
api_router.include_router(terraform.router, prefix="/terraform", tags=["terraform"])  

# Team Wiki - AI-powered documentation for repositories
api_router.include_router(wiki.router, prefix="/wiki", tags=["wiki"])

# DigitalOcean API - Cloud infrastructure management
api_router.include_router(digitalocean.router, prefix="/digitalocean", tags=["digitalocean"])

# Lifecycle Audit - Compliance and governance trail
api_router.include_router(audit.router, tags=["audit"])

# Comprehensive Audit Logs - All platform activity
api_router.include_router(audit_logs.router, prefix="/audit-logs", tags=["audit-logs"])

# Sandbox run management - Pre-deployment validation history
api_router.include_router(sandbox.router, prefix="/sandbox", tags=["sandbox"])

# Policy management - Governance rules and compliance checks
api_router.include_router(policies.router, prefix="/policies", tags=["policies"])

# Dashboard - Main dashboard statistics and aggregated data
api_router.include_router(dashboard.router, tags=["dashboard"])
