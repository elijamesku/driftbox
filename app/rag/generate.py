# Infrastructure plan generation from natural language using retrieved context
import os, json
from typing import List, Dict, Any
from jsonschema import Draft202012Validator
from .schemas import INFRASTRUCTURE_RESOURCE_PLAN_SCHEMA
from .hcl import convert_resource_plan_to_hcl
from app.rag.metrics import track_generation
from app.rag.validator import validate_ir, get_validation_suggestions

def validate_infrastructure_plan_schema(resource_plan: Dict[str, Any]):
    schema_validator = Draft202012Validator(INFRASTRUCTURE_RESOURCE_PLAN_SCHEMA)
    validation_errors = sorted(schema_validator.iter_errors(resource_plan), key=lambda error: error.path)
    if validation_errors:
        error_messages = [f"{'/'.join(map(str, error.path))}: {error.message}" for error in validation_errors]
        raise ValueError("Infrastructure plan validation failed: " + " | ".join(error_messages))

def construct_llm_prompt_with_context(user_natural_language_prompt: str, retrieved_documentation: List[Dict[str, Any]]) -> str:
    supporting_context = []
    for retrieved_doc in retrieved_documentation:
        doc_metadata = retrieved_doc["meta"]
        supporting_context.append({
            "score": retrieved_doc["score"],
            "type": doc_metadata.get("type"),
            "arg": doc_metadata.get("arg"),
            "kind": doc_metadata.get("kind"),
            "text": retrieved_doc["text"][:1200],
            "url": doc_metadata.get("url")
        })
    serialized_schema = json.dumps(INFRASTRUCTURE_RESOURCE_PLAN_SCHEMA, separators=(",",":"))
    return (
        "You are a Terraform infrastructure planning assistant.\n"
        "Generate STRICT JSON matching this schema (no markdown formatting, no comments):\n"
        f"{serialized_schema}\n\n"
        "Leverage the SUPPORT documentation below to select correct resource types and configuration arguments.\n"
        "Rules:\n"
        "- Output ONLY valid JSON conforming to the schema.\n"
        "- Apply secure defaults: block public S3 access, enable versioning when requested, specify regions explicitly.\n"
        "- Do NOT embed secrets; use variable references or placeholders.\n"
        "- If multiple resources required (e.g., bucket + policy), include them all.\n"
        "- **CRITICAL: JSON fields (policy, assume_role_policy, container_definitions) must be OBJECTS/ARRAYS, NOT quoted JSON strings**\n"
        "  * For IAM policies: use nested objects like {\"Version\": \"2012-10-17\", \"Statement\": [...]}\n"
        "  * For ECS container_definitions: use array of objects like [{\"name\": \"app\", \"image\": \"...\", \"portMappings\": [...]}]\n"
        "  * The HCL generator will automatically wrap them with jsonencode()\n"
        "- **CRITICAL: Load Balancer (aws_lb) - NEVER use 'scheme' argument (does not exist!)**\n"
        "  * Use \"internal\": false for internet-facing ALB\n"
        "  * Use \"internal\": true for internal ALB\n"
        "  * **MANDATORY**: ALB MUST have AT LEAST 2 subnets in DIFFERENT AZs (e.g., public_1 in us-east-1a, public_2 in us-east-1b)\n"
        "  * Even if user says 'one subnet', create 2+ for ALB or validation will fail with 'Reference to undeclared resource'\n"
        "- **CRITICAL: NO DUPLICATE RESOURCE NAMES**\n"
        "  * Every resource must have a UNIQUE name within its type\n"
        "  * Before adding a resource, verify that type+name combo doesn't already exist\n"
        "  * If duplicate detected, use a different unique name (e.g., \"main\" → \"main_app\", \"logs\" → \"logs_backup\")\n"
        "  * Example: Cannot have two `aws_s3_bucket.main` - use unique names like \"main\" and \"secondary\"\n"
        "- **CRITICAL: UNIQUE RESOURCE VALUES**\n"
        "  * S3 bucket names MUST be globally unique: \"my-bucket-1\", \"my-bucket-2\", NOT all \"my-bucket\"\n"
        "  * IAM role/policy names must be unique: \"app-role-1\", \"app-role-2\"\n"
        "  * If creating multiple S3 buckets, each bucket value must be different\n"
        "- Keep configuration arguments flat unless nested objects explicitly required (e.g., versioning = { enabled = true }).\n\n"
        f"USER_PROMPT:\n{user_natural_language_prompt}\n\n"
        f"SUPPORT_DOCUMENTATION:\n{json.dumps(supporting_context, ensure_ascii=False)}\n\n"
        "Generate the infrastructure plan JSON now."
    )

def invoke_openai_chat_completion(ai_model: str, system_instructions: str, user_message: str) -> str:
    from openai import OpenAI
    openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    api_response = openai_client.chat.completions.create(
        model=ai_model,
        messages=[{"role":"system","content":system_instructions},{"role":"user","content":user_message}],
        temperature=0,
        # response_format={"type":"json_object"}  # Enable if SDK supports structured output
    )
    return api_response.choices[0].message.content.strip()

def convert_natural_language_to_infrastructure_plan(user_prompt: str, retrieved_context: List[Dict[str, Any]], ai_model: str = "gpt-4o") -> Dict[str, Any]:
    if "OPENAI_API_KEY" not in os.environ:
        # Offline fallback: generate mock S3 bucket plan
        mock_plan = {
            "resources":[
                {"type":"aws_s3_bucket","name":"bucket","args":{"bucket":"example","versioning":{"enabled":True},"tags":{"env":"dev"}},"file_hint":"main.tf"}
            ]
        }
        validate_infrastructure_plan_schema(mock_plan)
        return mock_plan

    system_role = "You strictly generate JSON conforming to the provided schema."
    llm_prompt = construct_llm_prompt_with_context(user_prompt, retrieved_context)
    raw_llm_response = invoke_openai_chat_completion(ai_model, system_role, llm_prompt)
    try:
        parsed_plan = json.loads(raw_llm_response)
    except Exception as parse_error:
        raise ValueError(f"LLM JSON parsing error: {parse_error}\nRaw response preview: {raw_llm_response[:800]}")
    validate_infrastructure_plan_schema(parsed_plan)
    return parsed_plan


def generate_multi_resource_terraform_hcl(intermediate_representation: Dict[str, Any]) -> Dict[str, str]:
    """
    Convert multi-resource IR to Terraform HCL format with validation.
    
    Args:
        intermediate_representation: Dictionary with "ops" key containing operation list
        
    Returns:
        Dictionary mapping filenames to Terraform HCL content (.tf files)
        
    Raises:
        ValueError: If IR validation fails
    """
    # Wrap with metrics tracking
    return _generate_with_metrics(intermediate_representation)


@track_generation
def _generate_with_metrics(intermediate_representation: Dict[str, Any]) -> Dict[str, str]:
    """Internal generation function wrapped with metrics."""
    # STEP 1: Validate IR before generation (catches 80% of errors)
    is_valid, validation_errors = validate_ir(intermediate_representation)
    
    if not is_valid:
        error_msg = get_validation_suggestions(validation_errors)
        print(f"❌ IR Validation Failed:\n{error_msg}")
        
        # Return errors as comments in TF file for user feedback
        return {
            "main.tf": f"""# ❌ VALIDATION ERRORS - Please fix before deploying

{error_msg}

# Generated IR (for debugging):
# {json.dumps(intermediate_representation, indent=2)}
"""
        }
    
    # STEP 2: Convert IR format to infrastructure_plan format
    infrastructure_plan = _ir_to_infrastructure_plan(intermediate_representation)
    
    # STEP 2.5: Detect cloud provider from resources
    cloud_provider = None
    for op in intermediate_representation.get("ops", []):
        resource_type = op.get("selector", {}).get("type", "")
        if resource_type.startswith("digitalocean_"):
            cloud_provider = "digitalocean"
            break
        elif resource_type.startswith("aws_"):
            cloud_provider = "aws"
            break
    
    # STEP 3: Generate HCL (production-ready, native Terraform syntax)
    try:
        hcl_files = convert_resource_plan_to_hcl(
            infrastructure_plan,
            default_region="us-east-1",
            cloud_provider=cloud_provider
        )
        
        # Log success metrics
        resource_count = len(infrastructure_plan.get("resources", []))
        file_count = len(hcl_files)
        print(f"✅ Generated {resource_count} resources across {file_count} files")
        
        return hcl_files
        
    except Exception as e:
        print(f"❌ Terraform HCL generation error: {e}")
        import traceback
        traceback.print_exc()
        
        # Return detailed error for debugging
        return {
            "main.tf": f"""# ❌ HCL GENERATION ERROR

{str(e)}

# Stack trace:
{traceback.format_exc()}

# IR that caused the error:
# {json.dumps(intermediate_representation, indent=2)}
"""
        }


def _ir_to_infrastructure_plan(ir: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert IR format (ops-based) to infrastructure_plan format (resources-based).
    """
    resources = []
    
    for operation in ir.get("ops", []):
        if operation.get("action") == "delete":
            continue  # Skip deletions
        
        selector = operation.get("selector", {})
        resource_type = selector.get("type", "")
        resource_name = selector.get("name", "")
        file_hint = operation.get("file_hint", "main.tf")
        
        if not resource_type or not resource_name:
            continue
        
        # Build args from changes (nested dict structure)
        args = {}
        for change in operation.get("changes", []):
            if change.get("op") == "set":
                path = change.get("path", "")
                value = change.get("value")
                
                # Convert flat path to nested dict
                _set_nested_path(args, path, value)
        
        resources.append({
            "type": resource_type,
            "name": resource_name,
            "args": args,
            "file_hint": file_hint
        })
    
    return {"resources": resources}


def _set_nested_path(obj: Dict[str, Any], path: str, value: Any) -> None:
    """Set a nested path in a dict. Example: path="tags.Name" → obj["tags"]["Name"] = value"""
    parts = path.split(".")
    current = obj
    
    for part in parts[:-1]:
        if part not in current:
            current[part] = {}
        current = current[part]
    
    current[parts[-1]] = value
