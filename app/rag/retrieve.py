# Vector similarity search and retrieval for infrastructure documentation
import os, json
from typing import List, Dict, Any
import faiss, numpy as np
from .ingest import generate_vector_embeddings

def load_vector_search_index(index_directory_path: str):
    faiss_index = faiss.read_index(os.path.join(index_directory_path, "faiss.index"))
    documentation_chunks = [json.loads(line) for line in open(os.path.join(index_directory_path, "chunks.jsonl"), "r")]
    return faiss_index, documentation_chunks

def execute_semantic_search(user_query: str, index_directory_path: str, top_k_results: int = 8) -> List[Dict[str, Any]]:
    vector_index, indexed_chunks = load_vector_search_index(index_directory_path)

    # Sanitize query input and generate embedding
    sanitized_query = "" if user_query is None else str(user_query)
    query_embeddings = generate_vector_embeddings([sanitized_query])  # Returns List[List[float]]
    query_vector = np.array(query_embeddings, dtype=np.float32)

    # Apply cosine similarity normalization
    faiss.normalize_L2(query_vector)

    similarity_scores, result_indices = vector_index.search(query_vector, top_k_results)
    search_results: List[Dict[str, Any]] = []
    for similarity, chunk_index in zip(similarity_scores[0].tolist(), result_indices[0].tolist()):
        if chunk_index < 0:
            continue
        chunk_data = indexed_chunks[chunk_index]
        search_results.append({"score": float(similarity), "text": chunk_data["text"], "meta": chunk_data["meta"]})
    return search_results
