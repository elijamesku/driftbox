"""
AWS Import API Endpoint
Convert existing AWS infrastructure to Terraform without requiring AWS credentials.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from typing import Optional, Dict, Any
from pydantic import BaseModel
import json
import tempfile
from pathlib import Path

from app.services.aws_import_service import aws_import_service
from app.services.auth import require_authentication
from app.database.models import UserAccount
from app.utils.errors import sanitize_error_detail

router = APIRouter()


class ImportRequest(BaseModel):
    """Request to import AWS infrastructure."""
    format: str  # 'aws_config', 'cloudformation', 'aws_cli', 'terraform_state', 'natural_language'
    data: Optional[Dict[str, Any]] = None  # For JSON uploads
    description: Optional[str] = None  # For natural language descriptions
    resource_type: Optional[str] = None  # For AWS CLI format


@router.post("/import")
async def import_aws_infrastructure(
    request: ImportRequest,
    user: UserAccount = Depends(require_authentication)
):
    """
    Import AWS infrastructure from various formats and convert to Terraform.
    
    Supported formats:
    - aws_config: AWS Config snapshot JSON
    - cloudformation: CloudFormation template JSON/YAML
    - aws_cli: AWS CLI describe output JSON
    - terraform_state: Terraform state file JSON
    - natural_language: Natural language description (uses AI)
    """
    try:
        if request.format == 'natural_language':
            if not request.description:
                raise HTTPException(
                    status_code=400,
                    detail={"error": "missing_description", "message": "Natural language format requires 'description' field"}
                )
            result = aws_import_service.import_from_natural_language(request.description)
            # Mark for AI processing - will be handled by chat endpoint
            return {
                "ok": True,
                "format": request.format,
                "needs_ai_processing": True,
                "description": request.description,
                "message": "Use the /chat endpoint with this description to generate Terraform code"
            }
        
        elif request.format == 'aws_config':
            if not request.data:
                raise HTTPException(
                    status_code=400,
                    detail={"error": "missing_data", "message": "AWS Config format requires 'data' field"}
                )
            result = aws_import_service.import_from_aws_config(request.data)
        
        elif request.format == 'cloudformation':
            if not request.data:
                raise HTTPException(
                    status_code=400,
                    detail={"error": "missing_data", "message": "CloudFormation format requires 'data' field"}
                )
            result = aws_import_service.import_from_cloudformation(request.data)
        
        elif request.format == 'aws_cli':
            if not request.data:
                raise HTTPException(
                    status_code=400,
                    detail={"error": "missing_data", "message": "AWS CLI format requires 'data' field"}
                )
            resource_type = request.resource_type or 'unknown'
            if isinstance(request.data, list):
                result = aws_import_service.import_from_aws_cli_output(request.data, resource_type)
            else:
                # Handle nested structures (e.g., EC2 Reservations)
                if 'Reservations' in request.data:
                    instances = []
                    for reservation in request.data.get('Reservations', []):
                        instances.extend(reservation.get('Instances', []))
                    result = aws_import_service.import_from_aws_cli_output(instances, 'ec2-instances')
                elif 'Buckets' in request.data:
                    result = aws_import_service.import_from_aws_cli_output(
                        request.data.get('Buckets', []), 's3-buckets'
                    )
                else:
                    result = aws_import_service.import_from_aws_cli_output([request.data], resource_type)
        
        elif request.format == 'terraform_state':
            if not request.data:
                raise HTTPException(
                    status_code=400,
                    detail={"error": "missing_data", "message": "Terraform state format requires 'data' field"}
                )
            result = aws_import_service.import_from_terraform_state(request.data)
        
        else:
            raise HTTPException(
                status_code=400,
                detail={"error": "invalid_format", "message": f"Unsupported format: {request.format}"}
            )
        
        return {
            "ok": True,
            "format": request.format,
            "summary": result.get("summary", ""),
            "resources": result.get("resources", []),
            "resource_count": len(result.get("resources", []))
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "import_failed", "message": sanitize_error_detail(e, "Failed to import AWS infrastructure")}
        )


@router.post("/import/upload")
async def import_from_file(
    file: UploadFile = File(...),
    format: Optional[str] = None,
    user: UserAccount = Depends(require_authentication)
):
    """
    Import AWS infrastructure from an uploaded file.
    
    Supports:
    - AWS Config snapshots (.json)
    - CloudFormation templates (.json, .yaml, .yml)
    - Terraform state files (.json)
    - AWS CLI output (.json)
    - CSV files (.csv) - AWS Migration Hub exports OR generic AWS resource CSV format
      (with columns: resourceType, resourceId, resourceName, etc.)
    """
    try:
        # Save uploaded file temporarily
        file_suffix = Path(file.filename).suffix if file.filename else '.txt'
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = Path(tmp.name)
        
        try:
            # Parse the file
            result = aws_import_service.parse_import_file(tmp_path, format)
            
            return {
                "ok": True,
                "filename": file.filename,
                "summary": result.get("summary", ""),
                "resources": result.get("resources", []),
                "resource_count": len(result.get("resources", []))
            }
        finally:
            # Clean up temp file
            tmp_path.unlink()
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "import_failed", "message": sanitize_error_detail(e, "Failed to import from file")}
        )


@router.get("/import/instructions")
def get_import_instructions():
    """
    Get instructions on how to export AWS infrastructure for import.
    """
    return {
        "ok": True,
        "instructions": {
            "aws_config": {
                "description": "Export AWS Config snapshot",
                "steps": [
                    "1. Enable AWS Config in your AWS account",
                    "2. Run: aws configservice get-resource-config-history --resource-type AWS::S3::Bucket --resource-id my-bucket",
                    "3. Or export all resources: aws configservice get-discovered-resource-counts",
                    "4. Download configuration snapshot from AWS Config console",
                    "5. Upload the JSON file or paste the JSON in the import endpoint"
                ],
                "example_command": "aws configservice get-resource-config-history --resource-type AWS::S3::Bucket --resource-id my-bucket"
            },
            "cloudformation": {
                "description": "Export CloudFormation template",
                "steps": [
                    "1. If you have CloudFormation stacks, export the template:",
                    "   aws cloudformation get-template --stack-name MyStack --query TemplateBody",
                    "2. Or download template from CloudFormation console",
                    "3. Upload the JSON/YAML file or paste the content"
                ],
                "example_command": "aws cloudformation get-template --stack-name MyStack --query TemplateBody > template.json"
            },
            "aws_cli": {
                "description": "Export using AWS CLI describe commands",
                "steps": [
                    "1. Run AWS CLI describe commands for your resources:",
                    "   - EC2: aws ec2 describe-instances > instances.json",
                    "   - S3: aws s3api list-buckets > buckets.json",
                    "   - RDS: aws rds describe-db-instances > rds.json",
                    "   - VPC: aws ec2 describe-vpcs > vpcs.json",
                    "   - Lambda: aws lambda list-functions > lambda.json",
                    "2. Upload the JSON file or paste the JSON content"
                ],
                "example_commands": {
                    "ec2": "aws ec2 describe-instances > instances.json",
                    "s3": "aws s3api list-buckets > buckets.json",
                    "rds": "aws rds describe-db-instances > rds.json",
                    "vpc": "aws ec2 describe-vpcs > vpcs.json",
                    "lambda": "aws lambda list-functions > lambda.json"
                }
            },
            "terraform_state": {
                "description": "Import from existing Terraform state",
                "steps": [
                    "1. If you already have Terraform state:",
                    "   terraform show -json > terraform.tfstate.json",
                    "2. Upload the state file"
                ],
                "example_command": "terraform show -json > terraform.tfstate.json"
            },
            "natural_language": {
                "description": "Describe your infrastructure in plain English",
                "steps": [
                    "1. Describe your AWS resources in natural language",
                    "2. Example: 'I have an S3 bucket named my-app-logs with versioning, a VPC with CIDR 10.0.0.0/16, and a t3.micro EC2 instance'",
                    "3. Use the /chat endpoint with this description to generate Terraform"
                ],
                "example": "I have an S3 bucket named my-app-logs with versioning enabled, a VPC with CIDR 10.0.0.0/16, and a t3.micro EC2 instance in us-east-1a"
            }
        }
    }

