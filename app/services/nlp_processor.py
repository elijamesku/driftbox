import os
import json
from fastapi import HTTPException
from app.config import AI_PROVIDER, OPENAI_MODEL_NAME, CLAUDE_MODEL_NAME, _openai_instance, _anthropic_instance
from app.utils.schemas import INFRASTRUCTURE_REPRESENTATION_SCHEMA  




# ------------------------------------------------------------------------------
# Natural Language to Infrastructure Representation (resource generation)
# ------------------------------------------------------------------------------
def generate_mock_infrastructure_representation(user_prompt: str) -> dict:
    """Generate mock infrastructure representation for testing without LLM"""
    normalized_prompt = user_prompt.lower()
    should_apply = any(action_word in normalized_prompt for action_word in ["apply", "deploy", "create now"])
    infrastructure_action = "apply" if should_apply else "plan"

    if "iam" in normalized_prompt or "user" in normalized_prompt:
        resource_name = "demo-user"
        for token in user_prompt.replace(",", " ").split():
            if token.endswith("-user"):
                resource_name = token
        return {"resource": "aws_iam_user", "name": resource_name,
                "properties": {"region": "us-east-1", "tags": {"env": "dev"}}, "actions": [infrastructure_action]}
    if any(keyword in normalized_prompt for keyword in ["table", "ddb", "dynamo"]):
        resource_name = "events-table"
        for token in user_prompt.replace(",", " ").split():
            if token.endswith("-table"):
                resource_name = token
        return {"resource": "aws_dynamodb_table", "name": resource_name,
                "properties": {"region": "us-east-1", "hash_key": "pk", "hash_key_type": "S", "tags": {"env": "dev"}}, "actions": [infrastructure_action]}
    resource_name = "logs-bucket"
    for token in user_prompt.replace(",", " ").split():
        if token.endswith("-bucket"):
            resource_name = token
    return {"resource": "aws_s3_bucket", "name": resource_name,
            "properties": {"versioning": True, "block_public_access": True, "tags": {"env": "dev"}, "region": "us-east-1"},
            "actions": [infrastructure_action]}

def generate_mock_ir(user_prompt: str) -> dict:
    """Legacy alias for generate_mock_infrastructure_representation."""
    return generate_mock_infrastructure_representation(user_prompt)

def convert_natural_language_to_infrastructure(user_prompt: str) -> dict:
    """Convert natural language infrastructure request to intermediate representation"""
    # Fast path: no LLM call required
    if AI_PROVIDER == "mock":
        return generate_mock_infrastructure_representation(user_prompt)
    
    # Route to appropriate LLM provider
    if AI_PROVIDER == "claude":
        return process_prompt_with_claude(user_prompt)
    elif AI_PROVIDER == "openai":
        return process_prompt_with_openai(user_prompt)
    else:
        raise HTTPException(
            status_code=500,
            detail={"error": "llm_config", "message": f"Unknown AI_PROVIDER: {AI_PROVIDER}"}
        )


def process_prompt_with_claude(user_prompt: str) -> dict:
    """Convert natural language to infrastructure representation using Claude"""
    if not _anthropic_instance:
        raise HTTPException(
            status_code=500,
            detail={"error": "llm_config", "message": "ANTHROPIC_API_KEY not set. Set it or use AI_PROVIDER=mock."}
        )

    system_instructions = (
        "You are an expert Terraform/Infrastructure as Code assistant. "
        "Convert user requests into STRICT JSON matching this JSON Schema:\n"
        + json.dumps(INFRASTRUCTURE_REPRESENTATION_SCHEMA)
        + "\n\nRules:\n"
          "- Only emit JSON (no markdown, no code blocks, no explanations).\n"
          "- Supported resources: aws_s3_bucket, aws_iam_user, aws_dynamodb_table, aws_ec2_instance, aws_vpc, aws_subnet, aws_security_group.\n"
          "- Use safe, production-ready defaults.\n"
          "- Actions allowed: plan or apply (single-item array).\n"
          "- For s3: region=us-east-1, versioning=true, block_public_access=true, encryption enabled.\n"
          "- For iam_user: region=us-east-1, force_destroy=false.\n"
          "- For dynamodb_table: region=us-east-1, billing_mode=PAY_PER_REQUEST, hash_key=pk, hash_key_type=S.\n"
          "- For ec2: use t3.micro by default, enable detailed monitoring.\n"
          "- Always add appropriate tags (env, project, etc.)."
    )
    
    try:
        llm_response = _anthropic_instance.messages.create(
            model=CLAUDE_MODEL_NAME,
            max_tokens=2048,
            temperature=0.2,
            system=system_instructions,
            messages=[{"role": "user", "content": user_prompt}]
        )
        
        response_content = llm_response.content[0].text.strip()
        
        # Remove markdown code blocks if present
        if response_content.startswith("```"):
            response_content = response_content.split("\n", 1)[1] if "\n" in response_content else response_content
        if response_content.endswith("```"):
            response_content = response_content.rsplit("\n", 1)[0] if "\n" in response_content else response_content
        
        # Remove "json" language identifier if present
        if response_content.startswith("json"):
            response_content = response_content[4:].lstrip()
        
        parsed_response = json.loads(response_content)
        return parsed_response
    
    except json.JSONDecodeError as json_error:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "llm_parse_error",
                "message": f"LLM returned invalid JSON: {str(json_error)}",
                "raw_response": llm_response.content[0].text if llm_response else None
            }
        )
    except Exception as general_error:
        raise HTTPException(
            status_code=500,
            detail={"error": "llm_error", "message": str(general_error)}
        )


def process_prompt_with_openai(user_prompt: str) -> dict:
    """Convert natural language to infrastructure representation using OpenAI"""
    if not _openai_instance:
        raise HTTPException(
            status_code=500,
            detail={"error": "llm_config", "message": "OPENAI_API_KEY not set. Set it or use AI_PROVIDER=mock."}
        )

    system_instructions = (
        "You are an expert Terraform/Infrastructure as Code assistant. "
        "Convert user requests into STRICT JSON matching this JSON Schema:\n"
        + json.dumps(INFRASTRUCTURE_REPRESENTATION_SCHEMA)
        + "\n\nRules:\n"
          "- Only emit JSON (no markdown, no code blocks, no explanations).\n"
          "- Supported resources: aws_s3_bucket, aws_iam_user, aws_dynamodb_table, aws_ec2_instance, aws_vpc, aws_subnet, aws_security_group.\n"
          "- Use safe, production-ready defaults.\n"
          "- Actions allowed: plan or apply (single-item array).\n"
          "- For s3: region=us-east-1, versioning=true, block_public_access=true, encryption enabled.\n"
          "- For iam_user: region=us-east-1, force_destroy=false.\n"
          "- For dynamodb_table: region=us-east-1, billing_mode=PAY_PER_REQUEST, hash_key=pk, hash_key_type=S.\n"
          "- For ec2: use t3.micro by default, enable detailed monitoring.\n"
          "- Always add appropriate tags (env, project, etc.)."
    )
    
    try:
        llm_response = _openai_instance.chat.completions.create(
            model=OPENAI_MODEL_NAME,
            temperature=0.2,
            messages=[
                {"role": "system", "content": system_instructions},
                {"role": "user", "content": user_prompt}
            ]
        )
        
        response_content = llm_response.choices[0].message.content.strip()
        
        # Remove markdown code blocks if present
        if response_content.startswith("```"):
            response_content = response_content.split("\n", 1)[1] if "\n" in response_content else response_content
        if response_content.endswith("```"):
            response_content = response_content.rsplit("\n", 1)[0] if "\n" in response_content else response_content
        
        # Remove "json" language identifier if present  
        if response_content.startswith("json"):
            response_content = response_content[4:].lstrip()
        
        parsed_response = json.loads(response_content)
        return parsed_response
    
    except json.JSONDecodeError as json_error:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "llm_parse_error",
                "message": f"LLM returned invalid JSON: {str(json_error)}",
                "raw_response": llm_response.choices[0].message.content if llm_response else None
            }
        )
    except Exception as general_error:
        raise HTTPException(
            status_code=500,
            detail={"error": "llm_error", "message": str(general_error)}
        )

def process_nl_to_ir_with_openai(user_prompt: str) -> dict:
    return process_prompt_with_openai(user_prompt)
