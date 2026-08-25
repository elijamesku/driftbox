# rag/hcl.py
from typing import Dict, Any, List
from jinja2 import Template
import textwrap

RESOURCE_TPL = Template(textwrap.dedent("""\
resource "{{ r.type }}" "{{ r.name }}" {
{% for k, v in r.args.items() -%}
  {{k}} = {{ render(v, 1) }}
{% endfor -%}
}
"""))

PROVIDER_TPL = Template(textwrap.dedent("""\
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = "{{ region }}"
}
"""))

def _render_scalar(val):
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, (int, float)):
        return str(val)
    if val is None:
        return "null"
    return f"\"{val}\""

def _render(val, level=0):
    pad = "  " * level
    if isinstance(val, dict):
        # Detect HCL block-ish values (like versioning = { enabled = true })
        lines = ["{"]
        for k,v in val.items():
            if isinstance(v, dict):
                # nested object: render recursively
                lines.append(f"{pad}  {k} = {_render(v, level+1)}")
            else:
                lines.append(f"{pad}  {k} = {_render_scalar(v)}")
        lines.append(pad + "}")
        return "\n".join(lines)
    if isinstance(val, list):
        items = ", ".join(_render_scalar(x) if not isinstance(x, (dict,list)) else _render(x, level+1) for x in val)
        return f"[{items}]"
    return _render_scalar(val)

def plan_to_hcl(plan: Dict[str, Any], region_default: str = "us-east-1") -> Dict[str, str]:
    """
    Returns mapping file_path -> HCL text.
    Merges resources by file_hint; injects a provider if missing.
    """
    files: Dict[str, List[str]] = {}
    for r in plan["resources"]:
        file_hint = r.get("file_hint") or "main.tf"
        hcl = RESOURCE_TPL.render(r=r, render=_render)
        files.setdefault(file_hint, []).append(hcl)

    # Add a provider block in main.tf if none present
    if "main.tf" in files:
        prov = PROVIDER_TPL.render(region=region_default)
        files["main.tf"].insert(0, prov)

    return {fn: "\n\n".join(stmts) + "\n" for fn, stmts in files.items()}
