import re

# Regular expression patterns for parsing HCL and Terraform output
HCL_RESOURCE_DECLARATION_PATTERN = re.compile(r'^\s*resource\s+"(?P<type>[^"]+)"\s+"(?P<name>[^"]+)"\s*\{', re.MULTILINE)
TERRAFORM_PLAN_PATTERN = re.compile(r"Plan:\s*(\d+)\s+to add,\s*(\d+)\s+to change,\s*(\d+)\s+to destroy", re.IGNORECASE)
TERRAFORM_RESOURCE_PATTERN = re.compile(r'^[ \t]*#\s*(?P<addr>[A-Za-z0-9_.\-\[\]]+)\s+will be\s+(?P<action>created|updated in-place|destroyed)$', re.MULTILINE)

# JSON Schema definition for infrastructure representation
INFRASTRUCTURE_REPRESENTATION_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["resource", "name", "properties", "actions"],
    "properties": {
        "resource": {"type": "string", "enum": ["aws_s3_bucket", "aws_iam_user", "aws_dynamodb_table"]},
        "name": {"type": "string", "minLength": 3, "maxLength": 63},
        "properties": {"type": "object"},
        "actions": {
            "type": "array",
            "items": {"enum": ["plan", "apply"]},
            "minItems": 1,
            "maxItems": 1,
        },
    },
    "additionalProperties": False,
}

# JSON Schema definition for edit/modification operations
EDIT_SPECIFICATION_SCHEMA = {
    "type": "object",
    "required": ["ops"],
    "properties": {
        "ops": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["action", "selector"],
                "properties": {
                    "action": {"enum": ["create", "update", "delete"]},
                    "selector": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string"},
                            "name": {"type": "string"},
                            "match": {"type": "object"}
                        }
                    },
                    "changes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["op", "path"],
                            "properties": {
                                "op": {"enum": ["set", "ensure_block", "remove"]},
                                "path": {"type": "string"},
                                "value": {}
                            }
                        }
                    },
                    "file_hint": {"type": "string"}
                },
                "additionalProperties": False
            }
        }
    },
    "additionalProperties": False
}