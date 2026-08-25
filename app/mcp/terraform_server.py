#!/usr/bin/env python3
"""
Model Context Protocol Server enabling direct Terraform operations with intelligent caching.
Provides Claude with direct access to infrastructure configuration files and commands.
"""
import asyncio
import subprocess
import json
from pathlib import Path
from typing import Any
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from mcp.server.models import InitializationOptions
from mcp.server import NotificationOptions, Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    Tool,
    TextContent,
    ImageContent,
    EmbeddedResource,
)
from app.services.terraform_init import terraform_initialization_manager

# Initialize MCP server instance
mcp_server = Server("terraform-server")


@mcp_server.list_tools()
async def enumerate_available_tools() -> list[Tool]:
    """Enumerate all available Terraform operational tools"""
    return [
        Tool(
            name="read_terraform_files",
            description="Read all Terraform (.tf) files in a directory. Returns content of all .tf files.",
            inputSchema={
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Directory path to scan for .tf files (e.g., '.' or 'terraform/')"
                    }
                },
                "required": ["directory"]
            }
        ),
        Tool(
            name="terraform_validate",
            description="Run 'terraform validate' to check if configuration is valid",
            inputSchema={
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Working directory containing Terraform files"
                    }
                },
                "required": ["directory"]
            }
        ),
        Tool(
            name="terraform_fmt_check",
            description="Check if Terraform files are properly formatted",
            inputSchema={
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Directory to check formatting"
                    }
                },
                "required": ["directory"]
            }
        ),
        Tool(
            name="terraform_plan",
            description="Run 'terraform plan' to preview infrastructure changes (requires AWS credentials)",
            inputSchema={
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Working directory"
                    }
                },
                "required": ["directory"]
            }
        ),
    ]


@mcp_server.call_tool()
async def execute_tool_operation(tool_name: str, tool_arguments: dict[str, Any]) -> list[TextContent | ImageContent | EmbeddedResource]:
    """Execute requested tool operation and return results"""
    
    if tool_name == "read_terraform_files":
        target_directory = Path(tool_arguments["directory"]).resolve()
        
        if not target_directory.exists():
            return [TextContent(
                type="text",
                text=f"Error: Directory '{target_directory}' does not exist"
            )]
        
        terraform_files = list(target_directory.glob("**/*.tf"))
        
        if not terraform_files:
            return [TextContent(
                type="text",
                text=f"No Terraform files found in '{target_directory}'"
            )]
        
        aggregated_output = f"Found {len(terraform_files)} Terraform files:\n\n"
        
        for config_file in sorted(terraform_files):
            file_relative_path = config_file.relative_to(target_directory)
            file_content = config_file.read_text()
            aggregated_output += f"=== {file_relative_path} ===\n{file_content}\n\n"
        
        return [TextContent(type="text", text=aggregated_output)]
    
    elif tool_name == "terraform_validate":
        working_directory = Path(tool_arguments["directory"])
        
        # Use cached initialization - only runs if not already initialized
        initialization_result = terraform_initialization_manager.run_init(working_directory)
        
        if not initialization_result["initialized"]:
            return [TextContent(
                type="text",
                text=f"❌ Terraform init failed:\n{initialization_result.get('error', 'Unknown error')}"
            )]
        
        # Execute validation
        validation_process = subprocess.run(
            ["terraform", "validate", "-json"],
            cwd=working_directory,
            capture_output=True,
            text=True
        )
        
        try:
            validation_data = json.loads(validation_process.stdout)
            if validation_data.get("valid"):
                return [TextContent(
                    type="text",
                    text="✅ Terraform configuration is valid"
                )]
            else:
                diagnostic_messages = validation_data.get("diagnostics", [])
                error_summary = "\n".join([f"- {diagnostic.get('summary')}: {diagnostic.get('detail')}" for diagnostic in diagnostic_messages])
                return [TextContent(
                    type="text",
                    text=f"❌ Terraform validation failed:\n{error_summary}"
                )]
        except json.JSONDecodeError:
            return [TextContent(
                type="text",
                text=f"Validation output:\n{validation_process.stdout}\n{validation_process.stderr}"
            )]
    
    elif tool_name == "terraform_fmt_check":
        working_directory = tool_arguments["directory"]
        
        formatting_check = subprocess.run(
            ["terraform", "fmt", "-check", "-recursive"],
            cwd=working_directory,
            capture_output=True,
            text=True
        )
        
        if formatting_check.returncode == 0:
            return [TextContent(
                type="text",
                text="All Terraform files are properly formatted"
            )]
        else:
            return [TextContent(
                type="text",
                text=f"Some files need formatting:\n{formatting_check.stdout}"
            )]
    
    elif tool_name == "terraform_plan":
        working_directory = tool_arguments["directory"]
        
        plan_execution = subprocess.run(
            ["terraform", "plan", "-no-color", "-compact-warnings"],
            cwd=working_directory,
            capture_output=True,
            text=True,
            timeout=60
        )
        
        return [TextContent(
            type="text",
            text=f"Terraform Plan (exit code {plan_execution.returncode}):\n\n{plan_execution.stdout}\n{plan_execution.stderr}"
        )]
    
    else:
        return [TextContent(
            type="text",
            text=f"Unknown tool: {tool_name}"
        )]


async def run_mcp_server():
    """Execute the Model Context Protocol server"""
    async with stdio_server() as (input_stream, output_stream):
        await mcp_server.run(
            input_stream,
            output_stream,
            InitializationOptions(
                server_name="terraform-server",
                server_version="1.0.0",
                capabilities=mcp_server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )


if __name__ == "__main__":
    asyncio.run(run_mcp_server())

