from fastapi import APIRouter
from app.services.nlp_processor import convert_natural_language_to_infrastructure
from app.core.policy import validate_infrastructure_request, enforce_security_policy
from app.core.terraform import generate_terraform_files, execute_infrastructure_workflow
from app.models.requests import NaturalLanguagePrompt
from pathlib import Path
import tempfile
import shutil

router = APIRouter()

# Infrastructure generation from natural language
@router.post("/generate-plan")
def generate_infrastructure_plan(request_payload: NaturalLanguagePrompt):
    infrastructure_spec = convert_natural_language_to_infrastructure(request_payload.prompt)
    validate_infrastructure_request(infrastructure_spec)
    enforce_security_policy(infrastructure_spec)

    temporary_directory = Path(tempfile.mkdtemp(prefix="tfgen_"))
    try:
        generate_terraform_files(infrastructure_spec, temporary_directory)
        execution_result = execute_infrastructure_workflow(infrastructure_spec, temporary_directory)
        terraform_configuration = (temporary_directory / "main.tf").read_text()
        return {"ir": infrastructure_spec, "terraform": terraform_configuration, "result": execution_result}
    finally:
        shutil.rmtree(temporary_directory, ignore_errors=True)