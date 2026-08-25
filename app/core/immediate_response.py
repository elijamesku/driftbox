from jsonschema import Draft202012Validator
from fastapi import HTTPException 
from app.utils.validators import EDIT_SCHEMA_VALIDATOR

def validate_edit_specification(edit_config: dict):
    """Validate edit/modification request against schema"""
    validation_errors = sorted(EDIT_SCHEMA_VALIDATOR.iter_errors(edit_config), key=lambda e: e.path)
    if validation_errors:
        error_messages = [f"{'/'.join(map(str, err.path))}: {err.message}" for err in validation_errors]
        raise HTTPException(400, {"error": "edit_ir_validation_failed", "messages": error_messages})
    