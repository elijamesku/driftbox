import os
from dotenv import load_dotenv
from pathlib import Path

# Load .env from the project root (parent of app/)
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# Application configuration module - defines runtime behavior and LLM integration settings

# Language model provider configuration
AI_PROVIDER = os.getenv("LLM_MODE", "claude")   # Options: "claude", "openai", "mock"
OPENAI_MODEL_NAME = os.getenv("OPENAI_MODEL", "gpt-4o")

# MODE-SPECIFIC MODELS (Using Sonnet 4 for quality)
# Both modes use Sonnet 4 from your env var
CLAUDE_ASK_MODEL = os.getenv("CLAUDE_ASK_MODEL", "claude-sonnet-4-20250514")  # Sonnet 4 for Ask mode
CLAUDE_AGENT_MODEL = os.getenv("CLAUDE_AGENT_MODEL", "claude-sonnet-4-20250514")  # Sonnet 4 for Agent mode

# Legacy: Single model for backward compatibility (defaults to Ask model)
CLAUDE_MODEL_NAME = os.getenv("CLAUDE_MODEL", CLAUDE_ASK_MODEL)

EXECUTION_ENVIRONMENT = os.getenv("EXEC_MODE", "online") # Options: "online" (production), "offline" (development)

# Alias for compatibility: LLM_MODE
LLM_MODE = AI_PROVIDER

# Initialize AI provider clients based on configuration
if AI_PROVIDER == "claude":
    try:
        from anthropic import Anthropic
        # Increase timeout to 300 seconds (5 minutes) for complex infrastructure queries
        _anthropic_instance = Anthropic(
            api_key=os.environ["ANTHROPIC_API_KEY"],
            timeout=300.0  # 5 minutes for complex queries with 50+ resources
        )
        _openai_instance = None
    except KeyError:
        raise RuntimeError("ANTHROPIC_API_KEY environment variable required. Set it or use LLM_MODE=mock.")
elif AI_PROVIDER == "openai":
    try:
        from openai import OpenAI, RateLimitError, APIStatusError
        _openai_instance = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        _anthropic_instance = None
    except KeyError:
        raise RuntimeError("OPENAI_API_KEY environment variable required. Set it or use LLM_MODE=mock.")
else:
    _openai_instance = None
    _anthropic_instance = None  # Mock mode requires no API clients

# Financial tracking and monitoring configuration
ENABLE_COST_MONITORING = os.getenv("COST_TRACKING_ENABLED", "true").lower() == "true"
BUDGET_ALERT_PERCENTAGE = float(os.getenv("COST_ALERT_THRESHOLD", "0.8"))  # Default: 80% threshold
DIFF_STORAGE_DIRECTORY = os.getenv("DIFF_CACHE_DIR", ".infrara_diffs")

# Retrieval-augmented generation system configuration
RAG_INDEX_DIRECTORY = Path(__file__).parent / "data" / "faiss_index"

# Attempts to load RAG modules dynamically
try:
    from app.rag.pipeline import initialize_registry_data, initialize_search_index, execute_rag_pipeline
    from app.rag.retrieve import search as perform_rag_search
    from app.rag.generate import nl_to_resource_plan as convert_prompt_to_plan
    from app.rag.hcl import plan_to_hcl as convert_plan_to_terraform
    RAG_SYSTEM_ACTIVE = True
except Exception:
    initialize_registry_data = initialize_search_index = execute_rag_pipeline = None
    perform_rag_search = convert_prompt_to_plan = convert_plan_to_terraform = None
    RAG_SYSTEM_ACTIVE = False

# Alias for compatibility
RAG_ENABLED = RAG_SYSTEM_ACTIVE