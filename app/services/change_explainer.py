"""
Infrastructure change explanation service - generates human-readable change summaries.
Leverages Claude AI to analyze infrastructure modifications and produce clear explanations.
"""
from typing import Dict, List, Any, Optional
from app.config import AI_PROVIDER, CLAUDE_MODEL_NAME, _anthropic_instance


class InfrastructureChangeNarrator:
    """Generates AI-powered natural language explanations of infrastructure changes"""
    
    def generate_change_explanation(
        self,
        user_prompt: str,
        intermediate_representation: Dict[str, Any],
        file_modifications: Dict[str, Dict[str, str]],
    ) -> str:
        """
        Generate human-readable explanation of infrastructure changes.
        
        Args:
            user_prompt: Original user request
            intermediate_representation: IR of planned changes
            file_modifications: Dictionary of file modifications
        
        Returns:
            Natural language explanation string
        """
        if AI_PROVIDER == "mock":
            return self._construct_mock_explanation(user_prompt, intermediate_representation)
        
        if AI_PROVIDER == "claude" and _anthropic_instance:
            return self._generate_claude_explanation(user_prompt, intermediate_representation, file_modifications)
        
        # Fallback to structured basic explanation
        return self._construct_basic_explanation(intermediate_representation)
    
    def _generate_claude_explanation(
        self,
        user_prompt: str,
        intermediate_representation: Dict[str, Any],
        file_modifications: Dict[str, Dict[str, str]],
    ) -> str:
        """Generate detailed explanation using Claude AI"""
        # Construct operations summary from IR
        operations_descriptions = []
        for operation in intermediate_representation.get("ops", []):
            action_type = operation.get("action", "update")
            resource_selector = operation.get("selector", {})
            resource_type = resource_selector.get("type", "resource")
            resource_name = resource_selector.get("name", "unknown")
            modifications = operation.get("changes", [])
            
            modification_details = []
            for modification in modifications:
                config_path = modification.get("path", "")
                config_value = modification.get("value", "")
                modification_details.append(f"  - {config_path} = {config_value}")
            
            operations_descriptions.append(
                f"{action_type.upper()} {resource_type}.{resource_name}:\n" + "\n".join(modification_details)
            )
        
        # Construct Claude AI prompt
        ai_system_instructions = """You are an infrastructure documentation expert. 
Your job is to explain Terraform/infrastructure changes in clear, concise language that both technical and non-technical stakeholders can understand.

Focus on:
1. What resources are being created/updated/deleted
2. Why these changes matter (security, cost, functionality)
3. Any important implications or considerations

Keep explanations brief (2-4 sentences) but informative."""
        
        ai_user_query = f"""User requested: "{user_prompt}"

The following infrastructure changes will be made:

{chr(10).join(operations_descriptions)}

Please provide a clear, concise explanation of these changes and their implications."""
        
        try:
            ai_response = _anthropic_instance.messages.create(
                model=CLAUDE_MODEL_NAME,
                max_tokens=500,
                messages=[
                    {"role": "user", "content": ai_user_query}
                ],
                system=ai_system_instructions,
            )
            
            # Extract textual explanation from AI response
            generated_explanation = ""
            for content_block in ai_response.content:
                if hasattr(content_block, 'text'):
                    generated_explanation += content_block.text
            
            return generated_explanation.strip()
        
        except Exception as ai_error:
            # Fallback if AI generation fails
            return f"Changes summary: {self._construct_basic_explanation(intermediate_representation)} (AI explanation unavailable: {str(ai_error)})"
    
    def _construct_mock_explanation(self, user_prompt: str, intermediate_representation: Dict[str, Any]) -> str:
        """Generate mock explanation for testing environments"""
        operations_list = intermediate_representation.get("ops", [])
        if not operations_list:
            return "No infrastructure changes detected."
        
        first_operation = operations_list[0]
        action_type = first_operation.get("action", "update")
        resource_selector = first_operation.get("selector", {})
        resource_type = resource_selector.get("type", "resource")
        resource_name = resource_selector.get("name", "unknown")
        
        mock_explanations = {
            "create": f"This will provision a new {resource_type} resource named '{resource_name}'. The resource will be configured with specified settings and deployed to infrastructure.",
            "update": f"This will modify the existing {resource_type} resource '{resource_name}'. Specified properties will be updated while preserving other configurations.",
            "delete": f"This will destroy the {resource_type} resource '{resource_name}' from infrastructure. This operation is irreversible.",
        }
        
        return mock_explanations.get(action_type, f"This will {action_type} the {resource_type} resource '{resource_name}'.")
    
    def _construct_basic_explanation(self, intermediate_representation: Dict[str, Any]) -> str:
        """Generate structured explanation from IR without AI"""
        operations_list = intermediate_representation.get("ops", [])
        if not operations_list:
            return "No infrastructure changes detected."
        
        operation_summaries = []
        for operation in operations_list:
            action_type = operation.get("action", "update").upper()
            resource_selector = operation.get("selector", {})
            resource_type = resource_selector.get("type", "resource")
            resource_name = resource_selector.get("name", "unknown")
            modifications = operation.get("changes", [])
            
            modification_count = len(modifications)
            operation_summaries.append(f"{action_type} {resource_type}.{resource_name} ({modification_count} changes)")
        
        return "; ".join(operation_summaries)
    
    def explain_cost_implications(self, cost_analysis: Dict[str, Any]) -> str:
        """Generate human-readable cost impact narrative"""
        if not cost_analysis:
            return "Cost impact analysis unavailable."
        
        monthly_cost_delta = cost_analysis.get("delta_monthly_cost", 0)
        delta_percentage = cost_analysis.get("delta_percentage", 0)
        baseline_monthly_cost = cost_analysis.get("current_monthly_cost", 0)
        projected_monthly_cost = cost_analysis.get("new_monthly_cost", 0)
        
        if monthly_cost_delta == 0:
            return f"No significant cost impact. Monthly cost remains approximately ${baseline_monthly_cost:.2f}."
        
        cost_direction = "increase" if monthly_cost_delta > 0 else "decrease"
        absolute_delta = abs(monthly_cost_delta)
        
        cost_narrative = f"This change will {cost_direction} monthly costs by ${absolute_delta:.2f} "
        cost_narrative += f"({abs(delta_percentage):.1f}%), from ${baseline_monthly_cost:.2f} to ${projected_monthly_cost:.2f}."
        
        # Highlight primary cost drivers
        added_resources = cost_analysis.get("additions", [])
        removed_resources = cost_analysis.get("removals", [])
        
        if added_resources:
            most_expensive_addition = max(added_resources, key=lambda x: x["cost"])
            cost_narrative += f" Primary addition: {most_expensive_addition['resource']} (+${most_expensive_addition['cost']:.2f}/mo)."
        
        if removed_resources:
            most_expensive_removal = max(removed_resources, key=lambda x: x["cost"])
            cost_narrative += f" Primary removal: {most_expensive_removal['resource']} (-${most_expensive_removal['cost']:.2f}/mo)."
        
        return cost_narrative


# Global change narrator singleton
infrastructure_change_narrator = InfrastructureChangeNarrator()
change_explainer = infrastructure_change_narrator
