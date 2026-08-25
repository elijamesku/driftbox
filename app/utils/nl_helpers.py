import re
from typing import Optional
# ------------------------------------------------------------------------------
# create-intent helpers
# ------------------------------------------------------------------------------
def should_force_create(prompt: str, prefer_flag: Optional[str]) -> bool:
    if prefer_flag and prefer_flag.lower() == "create":
        return True
    p = (prompt or "").strip().lower()
    # treat common verbs as create-intent
    verbs = ["create", "add", "make", "provision", "spin up", "spin-up", "new "]
    return any(p.startswith(v) or f" {v} " in p for v in verbs)

_BUCKET_NAME_PATTERNS = [
    r"(?:named|called)\s+([a-z0-9.-]{3,63})",
    r"\bbucket\s+([a-z0-9.-]{3,63})",
    r"\bname\s+([a-z0-9.-]{3,63})",
    r"\b([a-z0-9.-]{3,63})\b(?:\s+bucket|\s*$)",
]

def extract_bucket_name_from_prompt(prompt: str) -> Optional[str]:
    txt = (prompt or "")
    for pat in _BUCKET_NAME_PATTERNS:
        m = re.search(pat, txt, flags=re.IGNORECASE)
        if m:
            return m.group(1)
    return None
 

def env_from_prompt(text: str) -> Optional[str]:
    if "prod" in text or "production" in text: return "prod"
    if "stage" in text or "staging" in text:   return "stage"
    if "dev" in text or "development" in text: return "dev"
    return None