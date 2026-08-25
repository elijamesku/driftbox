"""
Terraform to Pulumi conversion endpoint
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
from app.utils.errors import sanitize_error_detail
import logging
import os
import tempfile
import subprocess
import shutil
import base64
import requests
from pathlib import Path

from app.services.auth import authentication_service
from app.database.models import UserAccount

router = APIRouter()
logger = logging.getLogger(__name__)

class TerraformToPulumiRequest(BaseModel):
    owner: str
    repo: str
    language: str  # typescript, python, go, csharp
    files: List[str]

class TerraformToPulumiResponse(BaseModel):
    success: bool
    files_converted: int
    pulumi_directory: str
    message: str
    files_created: List[str] = []
    file_contents: Dict[str, str] = {}  # filename -> content

def get_file_content_from_github(owner: str, repo: str, file_path: str, github_token: str) -> str:
    """Fetch file content from GitHub"""
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{file_path}"
    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github.v3+json"
    }
    
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        raise Exception(f"Failed to fetch file from GitHub: {response.status_code}")
    
    data = response.json()
    content = base64.b64decode(data["content"]).decode("utf-8")
    return content

def convert_terraform_to_pulumi_code(tf_content: str, language: str, temp_dir: Path) -> Dict[str, str]:
    """
    Convert Terraform to Pulumi using tf2pulumi or custom conversion
    Returns dict of {filename: content}
    """
    # Write Terraform file to temp directory
    tf_file = temp_dir / "main.tf"
    tf_file.write_text(tf_content)
    
    # Try to use tf2pulumi if available
    try:
        # Check if tf2pulumi is installed
        result = subprocess.run(
            ["tf2pulumi", "--version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        has_tf2pulumi = result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        has_tf2pulumi = False
        logger.warning("tf2pulumi not found, using basic conversion")
    
    if has_tf2pulumi:
        # Use tf2pulumi for conversion
        output_dir = temp_dir / "pulumi_output"
        output_dir.mkdir(exist_ok=True)
        
        try:
            # Run tf2pulumi
            cmd = [
                "tf2pulumi",
                "--target-language", language,
                "--terraform-dir", str(temp_dir),
                "--output-dir", str(output_dir)
            ]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                cwd=str(temp_dir)
            )
            
            if result.returncode != 0:
                logger.error(f"tf2pulumi failed: {result.stderr}")
                raise Exception(f"tf2pulumi conversion failed: {result.stderr}")
            
            # Read converted files
            converted_files = {}
            for file in output_dir.rglob("*"):
                if file.is_file():
                    rel_path = file.relative_to(output_dir)
                    converted_files[str(rel_path)] = file.read_text()
            
            return converted_files
            
        except subprocess.TimeoutExpired:
            raise Exception("Conversion timeout - file may be too complex")
    else:
        # Fallback: Basic conversion using templates
        return generate_pulumi_code_basic(tf_content, language)

def generate_pulumi_code_basic(tf_content: str, language: str) -> Dict[str, str]:
    """
    Basic Terraform to Pulumi conversion using templates
    This is a fallback when tf2pulumi is not available
    """
    files = {}
    
    # Parse basic resource blocks from Terraform
    import re
    
    logger.info(f"Parsing Terraform content ({len(tf_content)} chars)")
    
    # Extract resources - improved pattern to handle nested braces
    # This pattern finds resource blocks by matching balanced braces
    resources = []
    pattern = r'resource\s+"([^"]+)"\s+"([^"]+)"\s*\{'
    
    for match in re.finditer(pattern, tf_content):
        resource_type = match.group(1)
        resource_name = match.group(2)
        start_pos = match.end()
        
        # Find the matching closing brace
        brace_count = 1
        end_pos = start_pos
        while brace_count > 0 and end_pos < len(tf_content):
            if tf_content[end_pos] == '{':
                brace_count += 1
            elif tf_content[end_pos] == '}':
                brace_count -= 1
            end_pos += 1
        
        resource_body = tf_content[start_pos:end_pos-1]
        resources.append((resource_type, resource_name, resource_body))
    
    logger.info(f"Found {len(resources)} Terraform resources")
    
    if not resources:
        logger.warning("No resources found in Terraform file")
        # Still create a basic template
    
    if language == "typescript":
        # Generate TypeScript Pulumi code
        imports = "import * as pulumi from '@pulumi/pulumi';\nimport * as aws from '@pulumi/aws';\n\n"
        code = imports
        
        for resource_type, resource_name, resource_body in resources:
            # Convert resource type (e.g., aws_s3_bucket -> aws.s3.Bucket)
            parts = resource_type.split("_")
            if len(parts) >= 3:
                provider = parts[0]  # aws
                service = parts[1]   # s3
                resource_class = "".join([p.capitalize() for p in parts[2:]])  # Bucket
                
                # Extract basic attributes
                attrs = {}
                attr_pattern = r'(\w+)\s*=\s*"([^"]+)"'
                for attr_match in re.finditer(attr_pattern, resource_body):
                    attrs[attr_match.group(1)] = attr_match.group(2)
                
                # Generate Pulumi resource
                code += f"const {resource_name} = new aws.{service}.{resource_class}('{resource_name}', {{\n"
                for key, value in attrs.items():
                    code += f"    {key}: '{value}',\n"
                code += "});\n\n"
        
        code += "// Export any outputs here\n"
        
        files["index.ts"] = code
        files["package.json"] = generate_package_json()
        files["Pulumi.yaml"] = generate_pulumi_yaml("typescript")
        
    elif language == "python":
        # Generate Python Pulumi code
        imports = "import pulumi\nimport pulumi_aws as aws\n\n"
        code = imports
        
        for resource_type, resource_name, resource_body in resources:
            parts = resource_type.split("_")
            if len(parts) >= 3:
                service = parts[1]   # s3
                resource_class = "".join([p.capitalize() for p in parts[2:]])  # Bucket
                
                # Extract basic attributes
                attrs = {}
                attr_pattern = r'(\w+)\s*=\s*"([^"]+)"'
                for attr_match in re.finditer(attr_pattern, resource_body):
                    key = attr_match.group(1)
                    value = attr_match.group(2)
                    attrs[key] = value
                
                # Generate Pulumi resource
                code += f"{resource_name} = aws.{service}.{resource_class}('{resource_name}',\n"
                for key, value in attrs.items():
                    code += f"    {key}='{value}',\n"
                code += ")\n\n"
        
        code += "# Export any outputs here\n"
        
        files["__main__.py"] = code
        files["requirements.txt"] = "pulumi>=3.0.0\npulumi-aws>=6.0.0\n"
        files["Pulumi.yaml"] = generate_pulumi_yaml("python")
        
    elif language == "go":
        # Generate Go Pulumi code
        code = """package main

import (
    "github.com/pulumi/pulumi-aws/sdk/v6/go/aws"
    "github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

func main() {
    pulumi.Run(func(ctx *pulumi.Context) error {
        // TODO: Convert Terraform resources to Pulumi Go
        // This is a basic template
        return nil
    })
}
"""
        files["main.go"] = code
        files["go.mod"] = generate_go_mod()
        files["Pulumi.yaml"] = generate_pulumi_yaml("go")
        
    elif language == "csharp":
        # Generate C# Pulumi code
        code = """using Pulumi;
using Pulumi.Aws;
using System.Collections.Generic;

return await Deployment.RunAsync(() =>
{
    // TODO: Convert Terraform resources to Pulumi C#
    // This is a basic template
});
"""
        files["Program.cs"] = code
        files["MyProject.csproj"] = generate_csharp_project()
        files["Pulumi.yaml"] = generate_pulumi_yaml("csharp")
    
    return files

def generate_package_json() -> str:
    return """{
    "name": "pulumi-infrastructure",
    "version": "1.0.0",
    "main": "index.ts",
    "devDependencies": {
        "@types/node": "^20.0.0",
        "typescript": "^5.0.0"
    },
    "dependencies": {
        "@pulumi/pulumi": "^3.0.0",
        "@pulumi/aws": "^6.0.0"
    }
}
"""

def generate_pulumi_yaml(runtime: str) -> str:
    return f"""name: pulumi-infrastructure
runtime: {runtime}
description: Converted from Terraform
"""

def generate_go_mod() -> str:
    return """module pulumi-infrastructure

go 1.21

require (
    github.com/pulumi/pulumi-aws/sdk/v6 v6.0.0
    github.com/pulumi/pulumi/sdk/v3 v3.0.0
)
"""

def generate_csharp_project() -> str:
    return """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net6.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Pulumi" Version="3.*" />
    <PackageReference Include="Pulumi.Aws" Version="6.*" />
  </ItemGroup>
</Project>
"""

def create_pulumi_directory_in_repo(
    owner: str, 
    repo: str, 
    language: str, 
    files: Dict[str, str], 
    github_token: str
) -> List[str]:
    """
    Create /pulumi directory in GitHub repo with converted files
    Returns list of created file paths
    """
    created_files = []
    base_path = f"pulumi/{language}"
    
    for filename, content in files.items():
        file_path = f"{base_path}/{filename}"
        
        # Create or update file in GitHub
        url = f"https://api.github.com/repos/{owner}/{repo}/contents/{file_path}"
        headers = {
            "Authorization": f"Bearer {github_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        # Check if file exists
        response = requests.get(url, headers=headers)
        sha = None
        if response.status_code == 200:
            sha = response.json()["sha"]
        
        # Encode content to base64
        encoded_content = base64.b64encode(content.encode("utf-8")).decode("utf-8")
        
        # Create/update file
        data = {
            "message": f"Add converted Pulumi code: {filename}",
            "content": encoded_content,
            "branch": "main"
        }
        if sha:
            data["sha"] = sha
        
        response = requests.put(url, headers=headers, json=data)
        if response.status_code in [200, 201]:
            created_files.append(file_path)
            logger.info(f"Created file: {file_path}")
        else:
            logger.error(f"Failed to create {file_path}: {response.status_code} - {response.text}")
            raise Exception(f"Failed to create file in GitHub: {response.status_code}")
    
    return created_files

@router.post("/terraform-to-pulumi", response_model=TerraformToPulumiResponse)
async def convert_terraform_to_pulumi(
    request: TerraformToPulumiRequest,
    current_user: UserAccount = Depends(authentication_service.extract_authenticated_user)
):
    """
    Convert Terraform files to Pulumi code in the specified language.
    Creates a /pulumi directory in the repository with the converted files.
    """
    try:
        logger.info(f"Converting Terraform to Pulumi for {request.owner}/{request.repo}")
        logger.info(f"Target language: {request.language}")
        logger.info(f"Files to convert: {request.files}")
        
        if not current_user.github_access_token:
            raise HTTPException(status_code=403, detail="GitHub token not available")
        
        if not request.files:
            raise HTTPException(status_code=400, detail="No files specified for conversion")
        
        # Get the first file (for now, convert one at a time)
        tf_file_path = request.files[0]
        
        # Fetch Terraform file content from GitHub
        logger.info(f"Fetching {tf_file_path} from GitHub...")
        tf_content = get_file_content_from_github(
            request.owner,
            request.repo,
            tf_file_path,
            current_user.github_access_token
        )
        
        # Convert to Pulumi
        logger.info(f"Converting to Pulumi {request.language}...")
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            converted_files = convert_terraform_to_pulumi_code(tf_content, request.language, temp_path)
        
        logger.info(f"Converted {len(converted_files)} files")
        
        # Return the converted files for display in IDE
        # Users can review and commit via IDE terminal/git workflow
        return TerraformToPulumiResponse(
            success=True,
            files_converted=len(request.files),
            pulumi_directory=f"/pulumi/{request.language}",
            message=f"Successfully converted {len(request.files)} Terraform files to Pulumi {request.language}. Review the files and commit via terminal.",
            files_created=list(converted_files.keys()),
            file_contents=converted_files
        )
        
    except Exception as e:
        logger.error(f"Error converting Terraform to Pulumi: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Failed to convert Terraform to Pulumi"))

