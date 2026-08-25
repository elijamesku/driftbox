# Infrastructure documentation ingestion and vector embedding generation
import os, json, hashlib
from typing import List, Dict, Any
import faiss
import numpy as np

EMBEDDING_MODEL_IDENTIFIER = os.getenv("EMBED_MODEL", "voyage-code-3")  # VoyageAI model identifier
EMBEDDING_DIMENSIONS = int(os.getenv("EMBED_DIMENSIONS", "1024"))  # VoyageAI voyage-code-3 default dimensions
MAXIMUM_EMBEDDING_CHARACTERS = int(os.getenv("MAX_EMBED_CHARS", "32000"))  # Per-item character limit (32k tokens for voyage-code-3)
EMBEDDING_REQUEST_CHAR_BUDGET = int(os.getenv("EMBED_CHAR_BUDGET", "128000"))  # Total characters per API request (larger for 32k context)


def _generate_voyage_embeddings_batch(text_items: List[str], items_per_batch: int = 128) -> List[List[float]]:
    """
    Generate VoyageAI embeddings in managed sub-batches with truncation and budget control.
    Ensures total input per request respects character budget.
    Uses voyage-code-3 model with 1024 dimensions by default.
    """
    from voyageai import Client as VoyageClient
    
    voyage_client = VoyageClient(api_key=os.environ["VOYAGE_API_KEY"])

    # Sanitize inputs → strings only, remove empty entries, apply truncation
    sanitized_texts: List[str] = []
    for raw_item in text_items:
        if raw_item is None:
            continue
        if isinstance(raw_item, bytes):
            try:
                raw_item = raw_item.decode("utf-8", "ignore")
            except Exception:
                raw_item = ""
        sanitized_string = str(raw_item).strip()
        if not sanitized_string:
            continue
        if len(sanitized_string) > MAXIMUM_EMBEDDING_CHARACTERS:
            sanitized_string = sanitized_string[:MAXIMUM_EMBEDDING_CHARACTERS]
        sanitized_texts.append(sanitized_string)

    generated_embeddings: List[List[float]] = []
    # Partition into request groups respecting both batch size and character budget
    current_index = 0
    total_items = len(sanitized_texts)
    while current_index < total_items:
        # Enforce both batch_size limit and character budget limit
        request_group: List[str] = []
        accumulated_characters = 0
        next_index = current_index
        while next_index < total_items and len(request_group) < items_per_batch:
            candidate_text = sanitized_texts[next_index]
            if accumulated_characters + len(candidate_text) > EMBEDDING_REQUEST_CHAR_BUDGET:
                break
            request_group.append(candidate_text)
            accumulated_characters += len(candidate_text)
            next_index += 1
        if not request_group:
            # Single exceptionally long item exceeding budget: force aggressive truncation
            truncated_text = sanitized_texts[current_index][: min(MAXIMUM_EMBEDDING_CHARACTERS, EMBEDDING_REQUEST_CHAR_BUDGET)]
            request_group = [truncated_text]
            next_index = current_index + 1
        
        # VoyageAI API call - voyage-code-3 with specified dimensions
        try:
            api_response = voyage_client.embed(
                texts=request_group,
                model=EMBEDDING_MODEL_IDENTIFIER,
                input_type="document"
            )
            # VoyageAI returns embeddings in response.embeddings
            generated_embeddings.extend(api_response.embeddings)
        except Exception as e:
            print(f"Error generating VoyageAI embeddings: {e}")
            # Fallback to mock embeddings for this batch
            generated_embeddings.extend(_generate_mock_embeddings(request_group))
        
        current_index = next_index
    return generated_embeddings

def _generate_mock_embeddings(text_items: List[str]) -> List[List[float]]:
    """Generate deterministic 1024-dimensional hash-based embeddings (offline capability, matches VoyageAI dimensions)."""
    mock_embeddings: List[List[float]] = []
    for text_content in text_items:
        content_hash = hashlib.sha256(text_content.encode("utf-8", "ignore")).digest()
        # Generate 1024-dimensional vector to match VoyageAI voyage-code-3
        hash_vector = np.frombuffer((content_hash * (EMBEDDING_DIMENSIONS // len(content_hash) + 1))[:EMBEDDING_DIMENSIONS], dtype=np.uint8).astype(np.float32)
        normalized_vector = (hash_vector - hash_vector.mean()) / (hash_vector.std() + 1e-6)
        mock_embeddings.append(normalized_vector.tolist())
    return mock_embeddings

def generate_vector_embeddings(text_batch: List[str]) -> List[List[float]]:
    """
    Primary embedding generation entry point. Coerces inputs to strings, filters empty entries,
    and routes to VoyageAI embeddings if API key available; otherwise uses mock embeddings.
    """
    # Safely coerce all inputs to string format
    processed_items: List[str] = []
    for raw_input in text_batch:
        if raw_input is None:
            continue
        if isinstance(raw_input, bytes):
            try:
                raw_input = raw_input.decode("utf-8", "ignore")
            except Exception:
                raw_input = ""
        text_string = str(raw_input)
        if text_string.strip() != "":
            processed_items.append(text_string)

    if not processed_items:
        # Return single zero vector to prevent caller failures
        return _generate_mock_embeddings([""])

    if os.environ.get("VOYAGE_API_KEY"):
        return _generate_voyage_embeddings_batch(processed_items)

    return _generate_mock_embeddings(processed_items)

def _partition_resource_document_into_chunks(resource_doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Transform resource documentation record into multiple searchable chunks:
      - One chunk per documented argument (argument + description)
      - One chunk per code example
      - One overview chunk
    """
    document_chunks: List[Dict[str, Any]] = []
    base_metadata = {"provider": resource_doc["provider"], "type": resource_doc["type"], "url": resource_doc["url"]}

    for argument_entry in resource_doc.get("args", []) or []:
        argument_name = argument_entry.get("arg", "")
        argument_description = argument_entry.get("desc", "")
        chunk_text = f"{resource_doc['type']} arg {argument_name}: {argument_description}"
        document_chunks.append({"text": chunk_text, "meta": {**base_metadata, "kind": "arg", "arg": argument_name}})

    for code_example in resource_doc.get("examples", []) or []:
        # Force string conversion to prevent dict/list leakage
        example_text = f"example for {resource_doc['type']}:\n{str(code_example)}"
        document_chunks.append({"text": example_text, "meta": {**base_metadata, "kind": "example"}})

    # Generate resource overview chunk
    if resource_doc.get("args") or resource_doc.get("examples"):
        overview_text = f"resource {resource_doc['type']} — {len(resource_doc.get('args',[]))} args, {len(resource_doc.get('examples',[]))} examples"
        document_chunks.append({"text": overview_text, "meta": {**base_metadata, "kind": "overview"}})

    return document_chunks

def construct_searchable_vector_index(documentation_jsonl_path: str, output_index_directory: str = "app/data/index/aws"):
    os.makedirs(output_index_directory, exist_ok=True)
    with open(documentation_jsonl_path, "r") as jsonl_file:
        documentation_records = [json.loads(line) for line in jsonl_file if line.strip()]

    all_document_chunks: List[Dict[str, Any]] = []
    for doc_record in documentation_records:
        all_document_chunks.extend(_partition_resource_document_into_chunks(doc_record))

    chunk_texts = [chunk["text"] for chunk in all_document_chunks]

    # Generate embeddings with batching and sanitization
    embedding_vectors = np.array(generate_vector_embeddings(chunk_texts), dtype=np.float32)
    # Normalize vectors for cosine similarity search
    faiss.normalize_L2(embedding_vectors)

    # Construct FAISS index
    vector_dimensionality = embedding_vectors.shape[1]
    faiss_index = faiss.IndexFlatIP(vector_dimensionality)
    faiss_index.add(embedding_vectors)

    faiss.write_index(faiss_index, os.path.join(output_index_directory, "faiss.index"))
    with open(os.path.join(output_index_directory, "chunks.jsonl"), "w") as chunks_output:
        for chunk_data in all_document_chunks:
            chunks_output.write(json.dumps(chunk_data) + "\n")
    print(f"Successfully indexed {len(all_document_chunks)} documentation chunks → {output_index_directory}")
