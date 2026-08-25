# JSON schema definitions for infrastructure resource plan validation
# Compact yet strict schema for LLM-generated infrastructure plans
INFRASTRUCTURE_RESOURCE_PLAN_SCHEMA = {
  "type": "object",
  "required": ["resources"],
  "properties": {
    "resources": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["type", "name", "args"],
        "properties": {
          "type": {"type": "string"},   # e.g., "aws_s3_bucket"
          "name": {"type": "string"},   # Terraform logical resource name
          "args": {"type": "object"},   # Configuration arguments (flat + nested objects)
          "depends_on": {
            "type": "array",
            "items": {"type":"string"}
          },
          "file_hint": {"type":"string"}  # Optional target file (e.g., "storage.tf")
        },
        "additionalProperties": False
      }
    }
  },
  "additionalProperties": False
}
