# rag/generate.py
import os, json
from typing import List, Dict, Any
from jsonschema import Draft202012Validator
from .schemas import RESOURCE_PLAN_SCHEMA

def _validate_plan(plan: Dict[str, Any]):
    val = Draft202012Validator(RESOURCE_PLAN_SCHEMA)
    errs = sorted(val.iter_errors(plan), key=lambda e: e.path)
    if errs:
        msgs = [f"{'/'.join(map(str, e.path))}: {e.message}" for e in errs]
        raise ValueError("plan_validation_failed: " + " | ".join(msgs))

def build_prompt(user_prompt: str, retrieved: List[Dict[str, Any]]) -> str:
    support = []
    for r in retrieved:
        m = r["meta"]
        support.append({
            "score": r["score"],
            "type": m.get("type"),
            "arg": m.get("arg"),
            "kind": m.get("kind"),
            "text": r["text"][:1200],
            "url": m.get("url")
        })
    schema_str = json.dumps(RESOURCE_PLAN_SCHEMA, separators=(",",":"))
    return (
        "You are a Terraform planner.\n"
        "Produce STRICT JSON matching this schema (no markdown, no comments):\n"
        f"{schema_str}\n\n"
        "Use the SUPPORT below to choose correct resource types and arguments.\n"
        "Rules:\n"
        "- Only output valid JSON that conforms to the schema.\n"
        "- Prefer secure defaults: block public access for S3, enable versioning if asked, pin regions explicitly.\n"
        "- Do NOT include secrets; use variables or references.\n"
        "- If multiple resources are needed (e.g., bucket + policy), include them all.\n"
        "- Keep args flat unless a nested object is obviously required (e.g., versioning = { enabled = true }).\n\n"
        f"USER_PROMPT:\n{user_prompt}\n\n"
        f"SUPPORT_SNIPPETS:\n{json.dumps(support, ensure_ascii=False)}\n\n"
        "Now output the JSON only."
    )

def call_openai_chat(model: str, sys: str, user: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role":"system","content":sys},{"role":"user","content":user}],
        temperature=0,
        # response_format={"type":"json_object"}  # if available in your SDK
    )
    return resp.choices[0].message.content.strip()

def nl_to_resource_plan(user_prompt: str, retrieved: List[Dict[str, Any]], model: str = "gpt-4o") -> Dict[str, Any]:
    if "OPENAI_API_KEY" not in os.environ:
        # offline mock: naive s3 bucket
        plan = {
            "resources":[
                {"type":"aws_s3_bucket","name":"bucket","args":{"bucket":"example","versioning":{"enabled":True},"tags":{"env":"dev"}},"file_hint":"main.tf"}
            ]
        }
        _validate_plan(plan)
        return plan

    sys = "You strictly output JSON per the provided schema."
    prompt = build_prompt(user_prompt, retrieved)
    raw = call_openai_chat(model, sys, prompt)
    try:
        plan = json.loads(raw)
    except Exception as e:
        raise ValueError(f"LLM JSON parse error: {e}\nRaw: {raw[:800]}")
    _validate_plan(plan)
    return plan
