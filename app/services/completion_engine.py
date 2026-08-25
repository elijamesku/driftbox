"""
Intelligent code completion engine for real-time suggestions.
Powers inline code completion, conversational responses, and multi-file contextual awareness.
"""
import asyncio
from typing import AsyncGenerator, Dict, List, Optional
from app.config import _anthropic_instance, CLAUDE_MODEL_NAME, AI_PROVIDER
from app.services.catalog import INFRASTRUCTURE_CATALOG


class IntelligentCompletionEngine:
    """Generate context-aware code completions and conversational responses"""
    
    def __init__(self):
        self.llm_client = _anthropic_instance
        self.model_identifier = CLAUDE_MODEL_NAME
    
    async def generate_streaming_completion(
        self,
        code_before_cursor: str,
        code_after_cursor: str,
        current_file_path: str,
        workspace_context: Dict
    ) -> AsyncGenerator[str, None]:
        """
        Stream inline code completion suggestions (Copilot-style).
        
        Args:
            code_before_cursor: Code content before cursor position
            code_after_cursor: Code content after cursor position
            current_file_path: Path to file being edited
            workspace_context: Additional contextual information (open files, workspace state)
        
        Yields:
            Completion text fragments
        """
        if AI_PROVIDER == "mock":
            # Mock response for development/testing
            simulated_completion = '\n  bucket = "my-terraform-bucket"\n  \n  tags = {\n    Environment = "production"\n  }\n'
            for character in simulated_completion:
                yield character
                await asyncio.sleep(0.01)  # Simulate streaming latency
            return
        
        if not self.llm_client:
            yield "# LLM client not configured"
            return
        
        # Construct context-aware completion prompt
        completion_prompt = self._construct_inline_completion_prompt(code_before_cursor, code_after_cursor, current_file_path, workspace_context)
        
        try:
            # Stream completion from language model
            with self.llm_client.messages.stream(
                model=self.model_identifier,
                max_tokens=1024,
                temperature=0.2,
                messages=[{
                    "role": "user",
                    "content": completion_prompt
                }]
            ) as response_stream:
                for text_fragment in response_stream.text_stream:
                    yield text_fragment
        
        except Exception as error:
            yield f"# Error: {str(error)}"
    
    async def generate_streaming_chat_response(
        self,
        user_message: str,
        workspace_context: Dict
    ) -> AsyncGenerator[str, None]:
        """
        Stream conversational response with comprehensive context awareness.
        
        Args:
            user_message: User's conversational message
            workspace_context: Complete workspace context (files, resources, infrastructure state)
        
        Yields:
            Response text fragments
        """
        if AI_PROVIDER == "mock":
            simulated_response = "I'll help you with that infrastructure change. Let me generate the Terraform code..."
            for character in simulated_response:
                yield character
                await asyncio.sleep(0.02)
            return
        
        if not self.llm_client:
            yield "LLM client not configured"
            return
        
        # Construct context-enriched chat prompt
        chat_prompt = self._construct_contextual_chat_prompt(user_message, workspace_context)
        
        try:
            with self.llm_client.messages.stream(
                model=self.model_identifier,
                max_tokens=2048,
                temperature=0.3,
                messages=[{
                    "role": "user",
                    "content": chat_prompt
                }]
            ) as response_stream:
                for text_fragment in response_stream.text_stream:
                    yield text_fragment
        
        except Exception as error:
            yield f"Error: {str(error)}"
    
    async def perform_comprehensive_workspace_analysis(self, workspace_files: List[Dict]) -> Dict:
        """
        Analyze entire workspace for comprehensive multi-file contextual understanding.
        
        Args:
            workspace_files: List of file objects with {path: str, content: str}
        
        Returns:
            {
                "resources": [...],
                "dependencies": {...},
                "security_issues": [...],
                "cost_estimate": float,
                "recommendations": [...]
            }
        """
        # Parse all Terraform infrastructure resources
        discovered_resources = []
        resource_dependencies = {}
        
        for file_obj in workspace_files:
            if file_obj["path"].endswith(".tf"):
                # Extract Terraform resources (simplified implementation)
                # Production systems should use proper HCL parsing
                file_content = file_obj["content"]
                
                # Extract resource declaration blocks
                import re
                resource_declaration_pattern = r'resource\s+"([^"]+)"\s+"([^"]+)"'
                resource_matches = re.findall(resource_declaration_pattern, file_content)
                
                for resource_type, resource_name in resource_matches:
                    discovered_resources.append({
                        "type": resource_type,
                        "name": resource_name,
                        "file": file_obj["path"]
                    })
        
        # Construct dependency graph
        for discovered_resource in discovered_resources:
            # Track inter-resource dependencies (simplified)
            resource_identifier = f"{discovered_resource['type']}.{discovered_resource['name']}"
            resource_dependencies[resource_identifier] = []
        
        # Perform basic security vulnerability analysis
        identified_security_issues = []
        for file_obj in workspace_files:
            normalized_content = file_obj["content"].lower()
            
            if "0.0.0.0/0" in normalized_content:
                identified_security_issues.append({
                    "severity": "high",
                    "message": "Security group allows unrestricted access from anywhere (0.0.0.0/0)",
                    "file": file_obj["path"]
                })
            
            if "public_access_block" not in normalized_content and "s3_bucket" in normalized_content:
                identified_security_issues.append({
                    "severity": "medium",
                    "message": "S3 bucket may not have public access blocking enabled",
                    "file": file_obj["path"]
                })
        
        # Generate infrastructure recommendations
        optimization_recommendations = []
        if len(discovered_resources) > 20:
            optimization_recommendations.append("Consider splitting resources into reusable modules for improved organization")
        
        if not any("tags" in file_obj["content"] for file_obj in workspace_files):
            optimization_recommendations.append("Add resource tags for enhanced cost tracking and management")
        
        return {
            "resources": discovered_resources,
            "resource_count": len(discovered_resources),
            "dependencies": resource_dependencies,
            "security_issues": identified_security_issues,
            "recommendations": optimization_recommendations,
            "file_count": len(workspace_files)
        }
    
    def _construct_inline_completion_prompt(self, code_before_cursor: str, code_after_cursor: str, current_file_path: str, workspace_context: Dict) -> str:
        """Construct prompt for intelligent inline code completion"""
        # Determine file type
        is_terraform_file = current_file_path.endswith(".tf")
        is_yaml_file = current_file_path.endswith((".yaml", ".yml"))
        
        # Build context-enriched completion prompt
        completion_prompt = f"""You are an expert DevOps engineer specializing in infrastructure as code.

Generate code completion for the following context:

File: {current_file_path}
Language: {"Terraform" if is_terraform_file else "YAML" if is_yaml_file else "Unknown"}

Code before cursor:
```
{code_before_cursor[-500:]}  # Last 500 characters for contextual awareness
```

Code after cursor:
```
{code_after_cursor[:100]}  # Next 100 characters for contextual awareness
```

Generate ONLY the completion code that should appear at the cursor position.
Follow infrastructure best practices:
- Use descriptive resource identifiers
- Add appropriate resource tags
- Include clarifying comments for complex logic
- Follow cloud provider naming conventions

Completion:"""
        
        return completion_prompt
    
    def _construct_contextual_chat_prompt(self, user_message: str, workspace_context: Dict) -> str:
        """Construct prompt for context-aware chat response"""
        # Extract workspace contextual information
        open_file_list = workspace_context.get("open_files", [])
        infrastructure_resources = workspace_context.get("resources", [])
        
        contextual_information = ""
        if infrastructure_resources:
            contextual_information += f"\nCurrent infrastructure contains {len(infrastructure_resources)} resources.\n"
        
        if open_file_list:
            contextual_information += f"Open files: {', '.join(file_obj['path'] for file_obj in open_file_list[:5])}\n"
        
        chat_prompt = f"""You are an expert DevOps engineer and infrastructure architect.

{contextual_information}

User question:
{user_message}

Provide a comprehensive, actionable response. If infrastructure code is needed, generate complete, production-ready configurations following best practices.
If discussing infrastructure costs, provide detailed estimates. If discussing security, identify potential vulnerabilities.

Response:"""
        
        return chat_prompt


# Global completion engine instance
intelligent_completion_engine = IntelligentCompletionEngine()
completion_engine = intelligent_completion_engine

