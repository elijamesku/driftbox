# difficulty.py
import re
from typing import Dict, Any, List, Tuple

# ---- Signals (each returns (score, reasons)) ---------------------------------

def _sig_resource_cardinality(prompt: str) -> Tuple[int, List[str]]:
    # More resources = harder
    pats = [
        r"\b(vpc|subnet|route table|igw|nat|security group|sg)\b",
        r"\b(lb|alb|nlb|target group|listener)\b",
        r"\b(ecs|fargate|task definition|service|cluster)\b",
        r"\b(rds|aurora|db instance|db subnet)\b",
        r"\b(eks|nodegroup|kubernetes)\b",
        r"\b(s3|bucket|kms|iam role|policy)\b",
        r"\b(vpn|dx|transit gateway|tgw)\b",
    ]
    hits = sum(len(re.findall(p, prompt, flags=re.I)) for p in pats)
    score = min(20, hits * 3)  # cap
    reasons = [f"mentions ~{hits} resource keywords"] if hits else []
    return score, reasons

def _sig_cross_resource_wiring(prompt: str) -> Tuple[int, List[str]]:
    # Clues that we must wire multiple services (ALB>ECS, SG rules, VPC layout…)
    cues = [
        r"\bbehind an (internet|internal)[ -]?facing (alb|lb|load balancer)\b",
        r"\btarget group\b",
        r"\blistener\b",
        r"\battach(ed)? to\b",
        r"\broute[s]?\b.*\b0\.0\.0\.0/0\b",
        r"\bpublic subnet[s]?\b|\bprivate subnet[s]?\b",
        r"\bnat gateway\b",
    ]
    hits = sum(1 for c in cues if re.search(c, prompt, re.I))
    score = hits * 4
    reasons = ["cross-resource wiring required"] if hits else []
    return score, reasons

def _sig_networking_complexity(prompt: str) -> Tuple[int, List[str]]:
    z = re.search(r"\b(10\.\d{1,3}\.\d{1,3}\.0/\d{1,2})\b", prompt)
    azs = len(re.findall(r"\b(us|eu|ap|sa|ca|me|af)-[a-z]+-\d[a-z]?\b", prompt))
    public_private = bool(re.search(r"\b(public|private) subnet", prompt, re.I))
    score = 0
    reasons: List[str] = []
    if z:
        score += 6; reasons.append("explicit VPC CIDR")
    if azs >= 2:
        score += 5; reasons.append(f"{azs} AZs")
    if public_private:
        score += 4; reasons.append("subnet tiering")
    return score, reasons

def _sig_control_plane_services(prompt: str) -> Tuple[int, List[str]]:
    # ECS/EKS/RDS => more schema + IAM + wiring
    cues = [
        r"\becs\b|\bfargate\b|\btask definition\b|\bservice\b",
        r"\beks\b|\bkubernetes\b|\bhelm\b",
        r"\brds\b|\baurora\b",
    ]
    hits = sum(1 for c in cues if re.search(c, prompt, re.I))
    score = hits * 6
    reasons = ["control-plane resources present"] if hits else []
    return score, reasons

def _sig_compliance_and_tls(prompt: str) -> Tuple[int, List[str]]:
    https = bool(re.search(r"\bhttps\b|certificate_arn|acm", prompt, re.I))
    health = bool(re.search(r"\bhealth ?check|\b/healthz\b", prompt, re.I))
    score = (6 if https else 0) + (3 if health else 0)
    reasons: List[str] = []
    if https: reasons.append("TLS/ACM details")
    if health: reasons.append("ALB health check")
    return score, reasons

def _sig_ambiguity(prompt: str) -> Tuple[int, List[str]]:
    # Ambiguous nouns push to RAG/examples
    fuzzy = [
        r"\bsecure\b", r"\bbest practice(s)?\b", r"\bhighly available\b",
        r"\bproduction(-grade)?\b", r"\bscalable\b", r"\bfast\b", r"\bcheap\b"
    ]
    hits = sum(1 for f in fuzzy if re.search(f, prompt, re.I))
    score = min(10, hits * 2)
    reasons = ["ambiguous requirements"] if hits else []
    return score, reasons

def _sig_placeholders_or_unknowns(prompt: str) -> Tuple[int, List[str]]:
    # Placeholders like "use this ACM cert ARN" without a valid ARN => harder
    dummy_arn = bool(re.search(r"arn:aws:acm:region:account-id:certificate/", prompt, re.I))
    missing_numbers = (bool(re.search(r"\b\d+ (tasks|instances)\b", prompt, re.I)) is False) and ("task" in prompt.lower())
    score = (5 if dummy_arn else 0) + (2 if missing_numbers else 0)
    reasons: List[str] = []
    if dummy_arn: reasons.append("placeholder ACM ARN")
    if missing_numbers: reasons.append("implicit scaling")
    return score, reasons

def _sig_catalog_overlap(prompt: str, catalog: Dict[str, Any]) -> Tuple[int, List[str]]:
    # If it clearly modifies existing things ⇒ usually easier than greenfield
    names = {r.get("name","") for r in (catalog.get("resources") or [])}
    mentions = sum(1 for n in names if n and n in prompt)
    if mentions >= 1:
        return -6, [f"targets existing resource(s): {min(mentions,5)} mention(s)"]
    # greenfield penalty if we see words like "create new", "new VPC"
    greenfield = bool(re.search(r"\bnew\b|\bcreate\b|\bprovision\b", prompt, re.I))
    return (4 if greenfield else 0), (["greenfield"] if greenfield else [])

def _sig_risky_ops(prompt: str) -> Tuple[int, List[str]]:
    destroy = bool(re.search(r"\bdestroy|delete|replace\b", prompt, re.I))
    rename = bool(re.search(r"\brename\b", prompt, re.I))  # might need moved{} + ref updates
    score = (6 if destroy else 0) + (4 if rename else 0)
    reasons: List[str] = []
    if destroy: reasons.append("potentially destructive")
    if rename: reasons.append("label rename semantics")
    return score, reasons

# ---- Main scoring ------------------------------------------------------------

WEIGHTS_DOC: Dict[str, float] = {
    "resource_cardinality": 1.0,
    "cross_wiring":        1.0,
    "networking":          1.0,
    "control_plane":       1.0,
    "compliance_tls":      1.0,
    "ambiguity":           0.8,
    "placeholders":        1.0,
    "catalog_overlap":     1.0,
    "risky_ops":           1.0,
}

def score_query_difficulty(prompt: str, catalog: Dict[str, Any]) -> Dict[str, Any]:
    prompt = prompt or ""
    totals: List[Tuple[str,int,List[str]]] = []
    for name, fn in [
        ("resource_cardinality", _sig_resource_cardinality),
        ("cross_wiring",        _sig_cross_resource_wiring),
        ("networking",          _sig_networking_complexity),
        ("control_plane",       _sig_control_plane_services),
        ("compliance_tls",      _sig_compliance_and_tls),
        ("ambiguity",           _sig_ambiguity),
        ("placeholders",        _sig_placeholders_or_unknowns),
        ("catalog_overlap",     lambda p: _sig_catalog_overlap(p, catalog)),
        ("risky_ops",           _sig_risky_ops),
    ]:
        s, reasons = fn(prompt)
        w = WEIGHTS_DOC.get(name, 1.0)
        totals.append((name, int(s * w), reasons))

    score = sum(s for _, s, _ in totals)
    score = max(0, min(100, score))  # clamp

    if score < 20:
        bucket = "easy"
        policy = {"use_rag": False, "generator": "llm-direct"}
    elif score < 40:
        bucket = "medium"
        policy = {"use_rag": False, "generator": "llm-direct", "enable_normalizers": True}
    elif score < 65:
        bucket = "hard"
        policy = {"use_rag": True, "generator": "rag+llm"}
    else:
        bucket = "very_hard"
        policy = {"use_rag": True, "generator": "rag+llm", "require_validation": True}

    reasons_flat = [f"{name}: {', '.join(r)} (+{s})" for name, s, r in totals if s or r]
    return {
        "score": score,
        "bucket": bucket,
        "policy": policy,
        "signals": totals,
        "reasons": reasons_flat,
    }
