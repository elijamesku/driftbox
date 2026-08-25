# rag/postprocess.py
import subprocess, textwrap
from typing import Dict, Any, Tuple
from pathlib import Path

def _run(cmd, cwd) -> Tuple[int,str]:
    p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    out, _ = p.communicate()
    return p.returncode, out

def write_files(hcl_map: Dict[str, str], workdir: Path):
    workdir.mkdir(parents=True, exist_ok=True)
    for rel, text in hcl_map.items():
        p = workdir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

def validate_repo(workdir: Path) -> Dict[str, Any]:
    steps = [
        (["terraform","fmt","-recursive"], "fmt"),
        (["terraform","init","-backend=false","-input=false","-no-color"], "init"),
        (["terraform","validate"], "validate"),
    ]
    out = {}
    last_code = 0
    for cmd, name in steps:
        code, txt = _run(cmd, cwd=workdir)
        out[name] = {"ok": code == 0, "output": txt}
        last_code = code
        if code != 0:
            return {"ok": False, "steps": out}

    # Optional tools
    for tool, args in [("tflint", ["tflint","--format","json"]), ("tfsec", ["tfsec","--format","json"])]:
        try:
            code, txt = _run(args, cwd=workdir)
            out[tool] = {"ok": code == 0, "output": txt}
        except FileNotFoundError:
            out[tool] = {"ok": True, "note": f"{tool} not installed"}
    return {"ok": True, "steps": out}
