# rag/ingest.py
import os, json, hashlib
from typing import List, Dict, Any
import faiss
import numpy as np

EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-large")  # model id only
MAX_EMBED_CHARS = int(os.getenv("MAX_EMBED_CHARS", "6000"))  # hard cap per item (chars)
EMBED_CHAR_BUDGET = int(os.getenv("EMBED_CHAR_BUDGET", "24000"))  # per request total chars


def _openai_embed_batched(items: List[str], batch_size: int = 128) -> List[List[float]]:
    """
    Calls OpenAI embeddings in safe sub-batches, truncating each item and
    ensuring the total input per request stays under a conservative budget.
    """
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    # Sanitize → strings only, strip empties, truncate
    clean: List[str] = []
    for x in items:
        if x is None:
            continue
        if isinstance(x, bytes):
            try:
                x = x.decode("utf-8", "ignore")
            except Exception:
                x = ""
        s = str(x).strip()
        if not s:
            continue
        if len(s) > MAX_EMBED_CHARS:
            s = s[:MAX_EMBED_CHARS]
        clean.append(s)

    out: List[List[float]] = []
    # Split into request groups by total char budget and by batch_size upper bound
    i = 0
    n = len(clean)
    while i < n:
        # Always keep group under both batch_size and char budget
        group: List[str] = []
        total = 0
        j = i
        while j < n and len(group) < batch_size:
            s = clean[j]
            if total + len(s) > EMBED_CHAR_BUDGET:
                break
            group.append(s)
            total += len(s)
            j += 1
        if not group:
            # Single item longer than budget: force truncate harder and include it
            s = clean[i][: min(MAX_EMBED_CHARS, EMBED_CHAR_BUDGET)]
            group = [s]
            j = i + 1
        resp = client.embeddings.create(model=EMBED_MODEL, input=group)
        out.extend([e.embedding for e in resp.data])
        i = j
    return out

def _mock_embed(items: List[str]) -> List[List[float]]:
    """Deterministic 512-d hash embeddings (works offline)."""
    out: List[List[float]] = []
    for s in items:
        h = hashlib.sha256(s.encode("utf-8", "ignore")).digest()
        vec = np.frombuffer((h * (512 // len(h) + 1))[:512], dtype=np.uint8).astype(np.float32)
        vec = (vec - vec.mean()) / (vec.std() + 1e-6)
        out.append(vec.tolist())
    return out

def embed(batch: List[str]) -> List[List[float]]:
    """
    Public entry point. Coerces inputs to strings, drops empties, and uses
    OpenAI if an API key is present; otherwise mock.
    """
    # Coerce to strings safely
    items: List[str] = []
    for x in batch:
        if x is None:
            continue
        if isinstance(x, bytes):
            try:
                x = x.decode("utf-8", "ignore")
            except Exception:
                x = ""
        s = str(x)
        if s.strip() != "":
            items.append(s)

    if not items:
        # Return one zero vector to keep callers from crashing
        return _mock_embed([""])

    if os.environ.get("OPENAI_API_KEY"):
        return _openai_embed_batched(items)

    return _mock_embed(items)

def _chunk_record(rec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Turn a resource doc record into multiple chunks:
      - one chunk per argument (arg + desc)
      - one chunk per example
    """
    chunks: List[Dict[str, Any]] = []
    base_meta = {"provider": rec["provider"], "type": rec["type"], "url": rec["url"]}

    for a in rec.get("args", []) or []:
        arg = a.get("arg", "")
        desc = a.get("desc", "")
        txt = f"{rec['type']} arg {arg}: {desc}"
        chunks.append({"text": txt, "meta": {**base_meta, "kind": "arg", "arg": arg}})

    for ex in rec.get("examples", []) or []:
        # Force to string to avoid dicts/lists leaking through
        txt = f"example for {rec['type']}:\n{str(ex)}"
        chunks.append({"text": txt, "meta": {**base_meta, "kind": "example"}})

    # resource overview chunk
    if rec.get("args") or rec.get("examples"):
        ov = f"resource {rec['type']} — {len(rec.get('args',[]))} args, {len(rec.get('examples',[]))} examples"
        chunks.append({"text": ov, "meta": {**base_meta, "kind": "overview"}})

    return chunks

def build_index(jsonl_path: str, index_dir: str = "data/index/aws"):
    os.makedirs(index_dir, exist_ok=True)
    with open(jsonl_path, "r") as f:
        records = [json.loads(l) for l in f if l.strip()]

    chunks: List[Dict[str, Any]] = []
    for rec in records:
        chunks.extend(_chunk_record(rec))

    texts = [c["text"] for c in chunks]

    # Get embeddings (batched + sanitized inside embed())
    vecs = np.array(embed(texts), dtype=np.float32)
    # Normalize for cosine
    faiss.normalize_L2(vecs)

    # Build index
    dim = vecs.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(vecs)

    faiss.write_index(index, os.path.join(index_dir, "faiss.index"))
    with open(os.path.join(index_dir, "chunks.jsonl"), "w") as out:
        for c in chunks:
            out.write(json.dumps(c) + "\n")
    print(f"Indexed {len(chunks)} chunks → {index_dir}")
