"""
MCP-enhanced endpoints for infrastructure management.
Combines Claude with Model Context Protocol for powerful agentic workflows.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.services.enhanced_nlp_processor import nl_to_multi_resource_ir
from app.services.prompt_validator import prompt_validator
from app.services.catalog import CATALOG
from app.services.query_logger import query_logger
from app.config import LLM_MODE
from app.utils.errors import sanitize_error_detail
import time


router = APIRouter()


class MultiResourceRequest(BaseModel):
    prompt: str
    environment: Optional[str] = None
    dry_run: bool = False


@router.post("/infra/multi-resource")
async def process_multi_resource_request(req: MultiResourceRequest):
    """
    Process complex multi-resource infrastructure requests.
    
    Example prompts:
    - "Create VPC with 2 subnets, update S3 bucket versioning, delete old Lambda"
    - "In staging: provision RDS database, add security group, enable CloudWatch logs"
    - "Set up complete web app infrastructure: VPC, ALB, EC2 instances, RDS, S3"
    
    Body:
        prompt: Natural language describing all desired changes
        environment: Optional environment context (staging/production)
        dry_run: If true, only parse and return IR without executing
    """
    start_time = time.time()
    
    # Validate prompt is infrastructure-related
    prompt_validator.validate_or_raise(req.prompt)
    
    try:
        # Parse complex prompt into multi-resource IR
        ir = await nl_to_multi_resource_ir(req.prompt)
        
        # Add environment context if provided
        if req.environment:
            for op in ir.get("ops", []):
                changes = op.get("changes", [])
                # Add environment tag if not already present
                if not any(c.get("path") == "tags.Environment" for c in changes):
                    changes.append({
                        "op": "set",
                        "path": "tags.Environment",
                        "value": req.environment
                    })
        
        execution_time = int((time.time() - start_time) * 1000)
        
        # Log query for LLM training
        try:
            query_logger.log_query(
                prompt=req.prompt,
                ir=ir,
                reasoning_tree={"summary": ir.get("summary"), "operation_count": len(ir.get("ops", []))},
                execution_time_ms=execution_time,
                llm_model=LLM_MODE,
                success=True,
            )
        except Exception:
            pass  # Don't fail request if logging fails
        
        # Return analysis
        response = {
            "ok": True,
            "prompt": req.prompt,
            "ir": ir,
            "summary": ir.get("summary"),
            "operation_count": len(ir.get("ops", [])),
            "operations": [
                {
                    "action": op.get("action"),
                    "resource_type": op.get("selector", {}).get("type"),
                    "resource_name": op.get("selector", {}).get("name"),
                    "file": op.get("file_hint", "main.tf"),
                    "change_count": len(op.get("changes", []))
                }
                for op in ir.get("ops", [])
            ],
            "timing": {
                "parsing_ms": execution_time
            }
        }
        
        if req.dry_run:
            response["message"] = "Dry run - no changes made. Use /edit-repo-with-approval to apply changes."
        else:
            response["message"] = "IR generated. Use /edit-repo-with-approval with this IR to proceed with approval workflow."
            response["next_step"] = "POST /edit-repo-with-approval with {\"ir\": <this_ir>}"
        
        return response
    
    except Exception as e:
        # Log failed query
        execution_time = int((time.time() - start_time) * 1000)
        try:
            query_logger.log_query(
                prompt=req.prompt,
                execution_time_ms=execution_time,
                llm_model=LLM_MODE,
                success=False,
                error_message=str(e),
            )
        except Exception:
            pass
        
        raise HTTPException(
            status_code=500,
            detail={
                "error": "parsing_failed",
                "message": str(e),
                "prompt": req.prompt
            }
        )


@router.post("/infra/explain")
async def explain_infrastructure_request(req: MultiResourceRequest):
    """
    Explain what a complex prompt would do WITHOUT executing it.
    Useful for understanding before committing.
    """
    try:
        ir = await nl_to_multi_resource_ir(req.prompt)
        
        # Generate detailed explanation
        explanations = []
        for op in ir.get("ops", []):
            action = op.get("action")
            selector = op.get("selector", {})
            rtype = selector.get("type")
            rname = selector.get("name")
            changes = op.get("changes", [])
            
            if action == "create":
                explanations.append({
                    "action": "CREATE",
                    "resource": f"{rtype}.{rname}",
                    "description": f"Create new {rtype} named '{rname}'",
                    "attributes": [f"{c['path']} = {c['value']}" for c in changes],
                    "file": op.get("file_hint", "main.tf")
                })
            elif action == "update":
                explanations.append({
                    "action": "UPDATE",
                    "resource": f"{rtype}.{rname}",
                    "description": f"Modify existing {rtype} '{rname}'",
                    "attributes": [f"{c['path']} = {c['value']}" for c in changes],
                    "file": op.get("file_hint", "main.tf")
                })
            elif action == "delete":
                explanations.append({
                    "action": "DELETE",
                    "resource": f"{rtype}.{rname}",
                    "description": f"Remove {rtype} '{rname}' from infrastructure",
                    "file": op.get("file_hint", "main.tf")
                })
        
        return {
            "ok": True,
            "prompt": req.prompt,
            "summary": ir.get("summary"),
            "explanations": explanations,
            "total_operations": len(explanations),
            "message": "This is what would happen. Use /infra/multi-resource to generate full IR for approval."
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "explanation_failed", "message": sanitize_error_detail(e, "Failed to explain infrastructure")}
        )


@router.get("/infra/examples")
def get_example_prompts():
    """
    Get example multi-resource prompts to understand capabilities.
    """
    return {
        "ok": True,
        "examples": [
            {
                "category": "VPC Setup",
                "prompt": "In staging, create a new VPC named staging-vpc with CIDR block 10.2.0.0/16, add two public subnets in us-east-1a and us-east-1b, and attach an internet gateway",
                "operations": ["Create VPC", "Create 2 subnets", "Create IGW", "Create route table"]
            },
            {
                "category": "Web App Infrastructure",
                "prompt": "Set up web app: create VPC with public/private subnets, provision RDS MySQL database, add application load balancer, create 2 EC2 instances for web servers, and S3 bucket for static assets",
                "operations": ["VPC + subnets", "RDS", "ALB", "EC2 x2", "S3 bucket", "Security groups"]
            },
            {
                "category": "Update Multiple Resources",
                "prompt": "Enable versioning on all S3 buckets, add encryption to logs-bucket, and update RDS instance to enable automated backups",
                "operations": ["Update S3 versioning", "Add S3 encryption", "Update RDS backups"]
            },
            {
                "category": "Mixed Operations",
                "prompt": "Create new Lambda function for data processing, update existing DynamoDB table to enable point-in-time recovery, and delete the old EC2 instance named legacy-server",
                "operations": ["Create Lambda", "Update DynamoDB", "Delete EC2"]
            },
            {
                "category": "Complete Environment",
                "prompt": "In production: provision complete 3-tier architecture with VPC (10.0.0.0/16), 2 public subnets for ALB, 2 private subnets for app servers, 2 private subnets for RDS, NAT gateway, internet gateway, security groups, and CloudWatch log groups",
                "operations": ["VPC", "6 subnets", "ALB", "NAT/IGW", "Security groups", "CloudWatch"]
            }
        ],
        "note": "These prompts can handle multiple resources in a single request. The system will parse them into individual operations and present them for approval."
    }

