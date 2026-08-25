# rag/retrieve.py
import os, json
from typing import List, Dict, Any
import faiss, numpy as np
from .ingest import embed

def load_index(index_dir: str):
    index = faiss.read_index(os.path.join(index_dir, "faiss.index"))
    chunks = [json.loads(l) for l in open(os.path.join(index_dir, "chunks.jsonl"), "r")]
    return index, chunks

def search(prompt: str, index_dir: str, k: int = 8) -> List[Dict[str, Any]]:
    index, chunks = load_index(index_dir)

    # Coerce prompt to a clean string and embed
    p = "" if prompt is None else str(prompt)
    q_vecs = embed([p])  # returns List[List[float]]
    q = np.array(q_vecs, dtype=np.float32)

    # Cosine normalization
    faiss.normalize_L2(q)

    D, I = index.search(q, k)
    results: List[Dict[str, Any]] = []
    for score, idx in zip(D[0].tolist(), I[0].tolist()):
        if idx < 0:
            continue
        c = chunks[idx]
        results.append({"score": float(score), "text": c["text"], "meta": c["meta"]})
    return results
