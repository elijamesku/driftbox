# End-to-end RAG pipeline orchestration for infrastructure code generation
import os, json, tempfile, shutil
from pathlib import Path
from typing import Dict, Any
from .crawl_registry import crawl_terraform_provider_resources
from .crawl_tutorials import crawl_learning_portal_tutorials
from .crawl_modules import crawl_terraform_modules, POPULAR_AWS_MODULES
from .ingest import construct_searchable_vector_index
from .retrieve import execute_semantic_search
from .generate import convert_natural_language_to_infrastructure_plan
from .hcl import convert_resource_plan_to_hcl
from .postprocess import write_terraform_files_to_disk, validate_terraform_repository

# HashiCorp Learn tutorial URLs for best practices and patterns
HASHICORP_TUTORIAL_URLS = [
    "https://developer.hashicorp.com/terraform/tutorials/aws-get-started/aws-build",
    "https://developer.hashicorp.com/terraform/tutorials/aws-get-started/aws-change",
    "https://developer.hashicorp.com/terraform/tutorials/aws-get-started/aws-variables",
    "https://developer.hashicorp.com/terraform/tutorials/aws/aws-iam-policy",
    "https://developer.hashicorp.com/terraform/tutorials/aws/lambda-api-gateway",
    "https://developer.hashicorp.com/terraform/tutorials/aws/aws-rds",
    "https://developer.hashicorp.com/terraform/tutorials/modules/module",
    "https://developer.hashicorp.com/terraform/tutorials/modules/module-create",
    "https://developer.hashicorp.com/terraform/tutorials/configuration-language/sensitive-variables",
    "https://developer.hashicorp.com/terraform/tutorials/configuration-language/variables",
]

def ensure_terraform_registry_documentation_crawled():
    """Crawl AWS resources and data sources from Terraform Registry"""
    documentation_output_path = "app/data/registry/aws/resources.jsonl"
    os.makedirs(os.path.dirname(documentation_output_path), exist_ok=True)
    
    if not os.path.exists(documentation_output_path):
        print("📥 Crawling Terraform AWS provider documentation (resources + data sources)...")
        # Crawl ALL pages (maximum_pages=None) and include data sources
        results = crawl_terraform_provider_resources(
            cloud_provider="aws", 
            maximum_pages=None,  # Get ALL resources
            include_data_sources=True
        )
        
        # Save to JSONL
        with open(documentation_output_path, "w") as f:
            for doc in results:
                f.write(json.dumps(doc) + "\n")
        
        print(f"✅ Saved {len(results)} documentation pages to {documentation_output_path}")

def ensure_hashicorp_tutorials_crawled():
    """Crawl HashiCorp Learn tutorials for best practices"""
    tutorials_output_path = "app/data/raw/learn_terraform.jsonl"
    os.makedirs(os.path.dirname(tutorials_output_path), exist_ok=True)
    
    if not os.path.exists(tutorials_output_path):
        print("📚 Crawling HashiCorp Learn tutorials...")
        results = crawl_learning_portal_tutorials(HASHICORP_TUTORIAL_URLS, enable_verbose_logging=True)
        
        # Save to JSONL
        with open(tutorials_output_path, "w") as f:
            for tutorial in results:
                f.write(json.dumps(tutorial) + "\n")
        
        print(f"✅ Saved {len(results)} tutorials to {tutorials_output_path}")

def ensure_terraform_modules_crawled():
    """Crawl popular Terraform modules for reusable patterns"""
    modules_output_path = "app/data/raw/terraform_modules.jsonl"
    os.makedirs(os.path.dirname(modules_output_path), exist_ok=True)
    
    if not os.path.exists(modules_output_path):
        print("📦 Crawling popular Terraform modules...")
        results = crawl_terraform_modules(POPULAR_AWS_MODULES)
        
        # Save to JSONL
        with open(modules_output_path, "w") as f:
            for module in results:
                f.write(json.dumps(module) + "\n")
        
        print(f"✅ Saved {len(results)} modules to {modules_output_path}")

def ensure_vector_search_index_constructed():
    """Build vector index from all documentation sources"""
    documentation_jsonl_path = "app/data/registry/aws/resources.jsonl"
    vector_index_directory = "app/data/index/aws"
    
    if not (os.path.exists(vector_index_directory) and os.path.exists(f"{vector_index_directory}/faiss.index")):
        print("🔨 Building vector search index...")
        construct_searchable_vector_index(documentation_jsonl_path, vector_index_directory)
        print(f"✅ Vector index created at {vector_index_directory}")

def execute_full_rag_infrastructure_pipeline(user_natural_language_prompt: str, default_aws_region="us-east-1") -> Dict[str, Any]:
    # Ensure all documentation is crawled and indexed
    ensure_terraform_registry_documentation_crawled()
    ensure_hashicorp_tutorials_crawled()
    ensure_terraform_modules_crawled()
    ensure_vector_search_index_constructed()
    retrieved_documentation_context = execute_semantic_search(user_natural_language_prompt, "app/data/index/aws", top_k_results=8)
    infrastructure_plan = convert_natural_language_to_infrastructure_plan(user_natural_language_prompt, retrieved_documentation_context, ai_model=os.getenv("OPENAI_MODEL","gpt-4o"))
    terraform_hcl_files = convert_resource_plan_to_hcl(infrastructure_plan, default_region=default_aws_region)

    temporary_working_directory = Path(tempfile.mkdtemp(prefix="tf_rag_"))
    try:
        write_terraform_files_to_disk(terraform_hcl_files, temporary_working_directory)
        terraform_validation_results = validate_terraform_repository(temporary_working_directory)
        return {
            "prompt": user_natural_language_prompt,
            "retrieved": retrieved_documentation_context,
            "plan": infrastructure_plan,
            "hcl_files": {filename: (temporary_working_directory / filename).read_text() for filename in terraform_hcl_files},
            "validation": terraform_validation_results,
            "workdir": str(temporary_working_directory),
        }
    except Exception:
        shutil.rmtree(temporary_working_directory, ignore_errors=True)
        raise

if __name__ == "__main__":
    import sys, pprint
    user_query = sys.argv[1] if len(sys.argv) > 1 else "private S3 bucket with versioning in us-east-1"
    pipeline_response = execute_full_rag_infrastructure_pipeline(user_query)
    pprint.pp(pipeline_response["plan"])
    for hcl_filename, hcl_content in pipeline_response["hcl_files"].items():
        print(f"\n=== {hcl_filename} ===\n{hcl_content}")
    print("\nValidation status:", pipeline_response["validation"]["ok"])
