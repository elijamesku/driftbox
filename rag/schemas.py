# rag/schemas.py
# JSON schema the model must output (resource list). Keep compact but strict.
RESOURCE_PLAN_SCHEMA = {
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
          "name": {"type": "string"},   # local name (tf resource name)
          "args": {"type": "object"},   # flat args + simple nested objects
          "depends_on": {
            "type": "array",
            "items": {"type":"string"}
          },
          "file_hint": {"type":"string"}  # optional file target
        },
        "additionalProperties": False
      }
    }
  },
  "additionalProperties": False
}
