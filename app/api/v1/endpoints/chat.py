"""
Chat endpoint with Cursor-style ask/agent mode switching.
Supports both regular JSON responses and SSE streaming for real-time updates.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, AsyncGenerator, Tuple
from datetime import datetime
import json
import asyncio

from app.services.mode_detector import interaction_mode_analyzer as mode_detector
from app.services.enhanced_nlp_processor import nl_to_multi_resource_ir
from app.services.auth import authentication_service
from app.services.usage_tracker import usage_tracker
from app.services.conversation_manager import conversation_manager
from app.services import credit_tracker
from app.services.prompt_validator import intelligent_prompt_validator
from app.services.llm_failover import llm_failover_service
from app.services.context_service import context_service
from app.services.conversation_indexing_service import conversation_indexing_service
from app.database.models import UserAccount
from app.database.connection import get_auth_db
from app.utils.errors import sanitize_error_detail
from sqlalchemy.orm import Session
from pathlib import Path
import re


router = APIRouter()


async def generate_driftbox_md(
    user_prompt: str,
    generated_files: Dict[str, str],
    workspace_path: str,
    owner: Optional[str],
    repo: Optional[str]
) -> str:
    """
    Generate comprehensive driftbox.md documentation that explains the infrastructure.
    If driftbox.md exists, append new section. If not, create new file.
    """
    from datetime import datetime
    import re
    
    # Parse resources from generated files
    resources_by_file = {}
    total_resource_count = 0
    
    for filename, content in generated_files.items():
        # Find all resource declarations
        resource_pattern = re.compile(
            r'resource\s+"([^"]+)"\s+"([^"]+)"\s*\{',
            re.MULTILINE
        )
        matches = list(resource_pattern.finditer(content))
        if matches:
            resources_by_file[filename] = []
            for match in matches:
                resource_type = match.group(1)
                resource_name = match.group(2)
                resources_by_file[filename].append({
                    "type": resource_type,
                    "name": resource_name
                })
                total_resource_count += 1
    
    # Check if driftbox.md already exists
    driftbox_md_path = Path(workspace_path) / "driftbox.md"
    existing_content = ""
    is_update = False
    
    if driftbox_md_path.exists():
        try:
            existing_content = driftbox_md_path.read_text()
            is_update = True
        except:
            pass
    
    # Build resource list for prompt
    resource_list = []
    for filename, resources in resources_by_file.items():
        for res in resources:
            resource_list.append(f"{res['type']}.{res['name']} in {filename}")
    
    # Generate documentation with AI
    if is_update:
        doc_prompt = f"""You are updating an existing driftbox.md file with NEW infrastructure that was just created.

EXISTING DOCUMENTATION:
{existing_content}

NEW USER REQUEST:
"{user_prompt}"

NEW FILES GENERATED:
{list(generated_files.keys())}

NEW RESOURCES CREATED:
{resource_list}

TASK:
Add a new section to the existing driftbox.md that documents this new infrastructure. Include:

1. **New Section Header** (NO timestamp/date)
2. **Overview** of what was added
3. **Architecture** explanation for new components
4. **Resources** with Terraform registry links (format: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/RESOURCE_TYPE)
5. **Integration** with existing infrastructure (if applicable)
6. **Cost estimate** for new resources
7. **Deployment** instructions for the additions

FORMAT:
- Use clean Markdown with proper headings (##, ###)
- NO emojis - professional documentation style
- Use **bold** for emphasis
- Use proper spacing and line breaks for readability

APPEND the new section to the existing content. Return the COMPLETE updated driftbox.md file."""

    else:
        doc_prompt = f"""You are creating a comprehensive driftbox.md file that explains this infrastructure in detail.

USER'S REQUEST:
"{user_prompt}"

GENERATED FILES:
{list(generated_files.keys())}

RESOURCES CREATED:
{resource_list}

TOTAL RESOURCES: {total_resource_count}

TASK:
Create a concise, professional driftbox.md file. **Match the documentation depth to the query complexity.**

For SIMPLE queries (1-3 resources like "create s3 bucket"), keep it SHORT:
- Brief overview (2-3 sentences)
- List of resources with Terraform links
- Basic deployment commands
- Quick cost estimate (1-2 lines)
- Skip: detailed architecture diagrams, extensive troubleshooting, monitoring sections

For COMPLEX queries (5+ resources, multi-tier architectures), include:
- Detailed overview
- Architecture explanation
- Component breakdown with configuration details
- Full deployment guide
- Cost breakdown table
- Security features
- Monitoring recommendations
- Troubleshooting section

ALWAYS include:
1. **Header** with what was created (NO timestamp/date)
2. **Resources** with Terraform registry links (format: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/RESOURCE_TYPE)
3. **Deployment** commands (terraform init/plan/apply)
4. **Cost estimate** (brief for simple, detailed for complex)

FORMAT:
- Use clean Markdown with proper headings (##, ###)
- NO emojis - professional documentation style
- Use **bold** for emphasis
- Keep it scannable and proportional to complexity
- Professional tone

Return ONLY the driftbox.md content, no explanations."""

    try:
        # Generate documentation with AI
        doc_response = llm_failover_service.stream_chat_completion(
            messages=[{"role": "user", "content": doc_prompt}],
            system_prompt="You are a senior DevOps engineer creating comprehensive infrastructure documentation.",
            temperature=0.3,  # Lower temperature for more consistent docs
            max_tokens=4000
        )
        
        # Collect full response
        doc_content = ""
        async for chunk in doc_response:
            if isinstance(chunk, dict) and "content" in chunk:
                doc_content += chunk["content"]
            elif isinstance(chunk, str):
                doc_content += chunk
        
        # Add footer (no timestamp)
        if not is_update:
            doc_content += f"\n\n---\n\n*Documentation generated by Driftbox AI*\n"
        else:
            doc_content += f"\n\n*Updated by Driftbox AI*\n"
        
        return doc_content
    
    except Exception as e:
        print(f"❌ [driftbox.md] Generation failed: {e}")
        # Fallback: Create basic documentation
        fallback_content = f"""# Infrastructure Documentation

> **Generated by Driftbox AI** | {datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")}

## 📋 Overview

This infrastructure was created from the request:
> "{user_prompt}"

**Files Created:** {len(generated_files)}
**Resources:** {total_resource_count}

## 📂 Generated Files

"""
        for filename in generated_files.keys():
            fallback_content += f"- `{filename}`\n"
        
        fallback_content += f"""

## 🚀 Deployment

```bash
terraform init
terraform plan
terraform apply
```

---

*Documentation generated by Driftbox AI*
"""
        return fallback_content


def extract_owner_repo_from_context(workspace_path: Optional[str], context: Optional[Dict]) -> Tuple[Optional[str], Optional[str]]:
    """Extract owner and repo from context dict or workspace_path"""
    # First try context dict (frontend sends this)
    if context:
        owner = context.get("owner")
        repo = context.get("repo")
        if owner and repo:
            return owner, repo
    
    # Fallback: parse workspace_path
    if workspace_path:
        # Format: ~/.infrara/repos/owner/repo or /path/to/repos/owner/repo
        parts = workspace_path.replace('~', '').strip('/').split('/')
        if 'repos' in parts:
            idx = parts.index('repos')
            if idx + 2 < len(parts):
                return parts[idx + 1], parts[idx + 2]
        # Direct owner/repo at end
        if len(parts) >= 2:
            return parts[-2], parts[-1]
    
    return None, None


def check_and_fix_duplicate_resources(workspace_path: str, generated_hcl: str, filename: str) -> str:
    """
    Check if generated HCL contains resources that already exist in workspace.
    Auto-rename duplicates to avoid conflicts.
    
    Args:
        workspace_path: Path to the workspace directory
        generated_hcl: The newly generated HCL content
        filename: The target filename (e.g., 'storage.tf')
        
    Returns:
        Modified HCL content with renamed resources if duplicates were found
    """
    try:
        print(f"\n🔍 [Duplicate Check] Starting for {filename}")
        print(f"🔍 [Duplicate Check] Workspace path: {workspace_path}")
        
        workspace = Path(workspace_path)
        if not workspace.exists():
            print(f"⚠️  [Duplicate Check] Workspace does not exist: {workspace_path}")
            return generated_hcl
        
        print(f"✅ [Duplicate Check] Workspace exists")
        
        # Parse resources from existing .tf files in workspace
        existing_resources = {}  # {(type, name): count}
        
        # Search for .tf files recursively
        tf_files = list(workspace.rglob('*.tf'))
        print(f"🔍 [Duplicate Check] Found {len(tf_files)} .tf files in workspace")
        
        for tf_file in tf_files:
            try:
                print(f"📄 [Duplicate Check] Reading: {tf_file.name}")
                content = tf_file.read_text()
                # Find all resource declarations: resource "type" "name" {
                resource_pattern = re.compile(
                    r'resource\s+"([^"]+)"\s+"([^"]+)"\s*\{',
                    re.MULTILINE
                )
                matches = list(resource_pattern.finditer(content))
                for match in matches:
                    resource_type = match.group(1)
                    resource_name = match.group(2)
                    key = (resource_type, resource_name)
                    existing_resources[key] = existing_resources.get(key, 0) + 1
                    print(f"   Found resource: {resource_type}.{resource_name}")
            except Exception as e:
                print(f"⚠️  [Duplicate Check] Error reading {tf_file}: {e}")
                continue
        
        print(f"🔍 [Duplicate Check] Total existing resources: {len(existing_resources)}")
        
        # Parse resources from generated HCL
        modified_hcl = generated_hcl
        resource_pattern = re.compile(
            r'resource\s+"([^"]+)"\s+"([^"]+)"\s*\{',
            re.MULTILINE
        )
        
        generated_resources = list(resource_pattern.finditer(generated_hcl))
        print(f"🔍 [Duplicate Check] Generated HCL has {len(generated_resources)} resources")
        
        # Track resources we've seen in THIS generated HCL to catch duplicates within the same generation
        seen_in_generation = {}  # {(type, name): occurrence_count}
        resources_to_rename = []  # [(match, resource_type, resource_name, occurrence_number)]
        
        # PASS 1: Identify which resources need renaming
        for match in generated_resources:
            resource_type = match.group(1)
            resource_name = match.group(2)
            key = (resource_type, resource_name)
            
            print(f"🔍 [Duplicate Check] Checking generated: {resource_type}.{resource_name}")
            
            # Track occurrence count
            if key in seen_in_generation:
                seen_in_generation[key] += 1
                occurrence_num = seen_in_generation[key]
                print(f"⚠️  [Duplicate Check] DUPLICATE IN GENERATION (occurrence #{occurrence_num}): {resource_type}.{resource_name}")
                # This is a duplicate within the generation - mark for renaming
                resources_to_rename.append((match, resource_type, resource_name, occurrence_num))
            else:
                seen_in_generation[key] = 1
                # Check if it conflicts with existing workspace resources
                if key in existing_resources and existing_resources[key] > 0:
                    print(f"⚠️  [Duplicate Check] CONFLICTS WITH WORKSPACE: {resource_type}.{resource_name}")
                    resources_to_rename.append((match, resource_type, resource_name, 1))
                else:
                    print(f"✅ [Duplicate Check] No conflict for: {resource_type}.{resource_name}")
                
        # PASS 2: Rename duplicates (in REVERSE order so position shifts don't affect earlier matches)
        position_shift = 0  # Track cumulative position shift
        for match, resource_type, resource_name, occurrence_num in reversed(resources_to_rename):
            # Find a unique name by trying suffixes
            new_name = None
            for i in range(occurrence_num + 1, 100):
                candidate_name = f"{resource_name}_{i}"
                candidate_key = (resource_type, candidate_name)
                if candidate_key not in existing_resources and candidate_key not in seen_in_generation:
                    new_name = candidate_name
                    break
            
            if new_name:
                # Get original match position and adjust for cumulative shifts
                start, end = match.span()
                adjusted_start = start + position_shift
                adjusted_end = end + position_shift
                
                old_declaration = match.group(0)  # Full match: resource "type" "name" {
                new_declaration = f'resource "{resource_type}" "{new_name}" {{'
                
                # Calculate length change
                length_change = len(new_declaration) - len(old_declaration)
                
                # Replace at adjusted position
                modified_hcl = modified_hcl[:adjusted_start] + new_declaration + modified_hcl[adjusted_end:]
                
                # Update cumulative position shift
                position_shift += length_change
                
                # For S3 buckets, also update the bucket name attribute
                if resource_type == "aws_s3_bucket":
                    # Find the bucket attribute within this resource block
                    # Start searching from the resource declaration
                    block_start = adjusted_start
                    # Find the closing brace (approximate - find next "}\n" after reasonable distance)
                    block_search = modified_hcl[block_start:block_start + 1000]
                    bucket_match = re.search(rf'bucket\s*=\s*"([^"]+)"', block_search)
                    if bucket_match:
                        old_bucket_name = bucket_match.group(1)
                        # Append suffix to bucket name (e.g., "my-bucket" → "my-bucket-2")
                        suffix = new_name.split('_')[-1]  # Extract "2" from "main_2"
                        # Skip if bucket name already has random suffix
                        if '${' not in old_bucket_name:
                            new_bucket_name = f"{old_bucket_name}-{suffix}"
                            # Find and replace the bucket attribute
                            bucket_attr_match = re.search(rf'bucket\s*=\s*"{re.escape(old_bucket_name)}"', modified_hcl[block_start:block_start + 1000])
                            if bucket_attr_match:
                                attr_start = block_start + bucket_attr_match.start()
                                attr_end = block_start + bucket_attr_match.end()
                                new_bucket_attr = f'bucket = "{new_bucket_name}"'
                                modified_hcl = modified_hcl[:attr_start] + new_bucket_attr + modified_hcl[attr_end:]
                                # Update position shift for bucket attribute change
                                position_shift += len(new_bucket_attr) - len(bucket_attr_match.group(0))
                                print(f"🪣 [Duplicate Check] Also renamed bucket attribute: {old_bucket_name} → {new_bucket_name}")
                    
                    print(f"🔧 [Duplicate Check] Auto-renamed: {resource_type}.{resource_name} → {resource_type}.{new_name}")
                    
                # Mark this new name as used
                    existing_resources[(resource_type, new_name)] = 1
                else:
                    print(f"❌ [Duplicate Check] Could not find unique name for: {resource_type}.{resource_name}")
        
        print(f"✅ [Duplicate Check] Completed for {filename}\n")
        return modified_hcl
    
    except Exception as e:
        print(f"⚠️  [Duplicate Check] Error: {e}")
        import traceback
        traceback.print_exc()
        return generated_hcl  # Return original if error occurs


# ===== Request/Response Models =====

class ChatMessage(BaseModel):
    """Single message in conversation"""
    role: str  # "user" or "assistant"
    content: str
    mode: Optional[str] = None
    timestamp: Optional[datetime] = None


class ChatRequest(BaseModel):
    """User's chat message"""
    prompt: str
    mode: str = "ask"  # "ask" or "agent"
    provider: str = "claude"  # "claude" or "openai" - user's preference (defaults to claude)
    cloud_provider: str = "aws"  # "aws" or "digitalocean" - which cloud provider to generate code for
    conversation_id: Optional[str] = None
    workspace_path: Optional[str] = None  # If None, returns proposals; if set, writes directly
    context: Optional[Dict] = None


class ModeSuggestion(BaseModel):
    """Suggestion to switch modes"""
    suggested_mode: str
    reason: str
    confidence: float
    message: str
    action_text: str


class ActionResult(BaseModel):
    """Result of an action taken in agent mode"""
    type: str  # "file_edit", "terraform_apply", etc.
    description: str
    file: Optional[str] = None
    status: str  # "success", "pending", "failed"
    details: Optional[Dict] = None


class ChatResponse(BaseModel):
    """AI's response"""
    message: str
    mode: str
    mode_info: Dict[str, str]  # Icon, title, description
    mode_suggestion: Optional[ModeSuggestion] = None
    actions: Optional[List[ActionResult]] = None
    thinking: Optional[str] = None
    conversation_id: str
    timestamp: datetime


# ===== Chat Endpoint =====

@router.post("/chat/stream", tags=["chat"])
async def chat_stream(
    req: ChatRequest,
    request: Request,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    auth_db: Session = Depends(get_auth_db)
):
    """
    Chat with AI in ask or agent mode with Server-Sent Events (SSE) streaming.
    
    Streams progress updates in real-time:
    - "🧠 Analyzing your request..."
    - "📝 Generating Terraform code..."
    - "✅ Done!"
    
    Returns: text/event-stream with JSON events
    """
    async def generate_stream() -> AsyncGenerator[str, None]:
        try:
            # Merge user into the current session
            user_merged = auth_db.merge(user)
            
            # INSTANT START: Only validate prompt (1ms, not 100ms+)
            validation_result = intelligent_prompt_validator.assess_prompt_validity(req.prompt)
            if not validation_result["valid"]:
                yield f"data: {json.dumps({'type': 'error', 'message': validation_result['reason']})}\n\n"
                return
            
            # Retrieve conversation BEFORE streaming if conversation_id provided (for history)
            # Security: Pass user_id to verify ownership at service layer
            conversation = None
            if req.conversation_id:
                conversation = conversation_manager.retrieve_conversation_thread(
                    req.conversation_id, 
                    user_id=user_merged.id  # Verify ownership
                )
                if not conversation:
                    conversation = None  # Invalid conversation or wrong user, create new one later
            
            # Execute based on mode with streaming (START IMMEDIATELY!)
            full_message = ""
            
            if req.mode == "ask":
                # START STREAMING IMMEDIATELY (no status messages, they slow things down)
                # Pass user's provider preference to streaming handler (defaults to "claude" if not provided)
                provider = getattr(req, 'provider', 'claude')
                cloud_provider = getattr(req, 'cloud_provider', 'aws') or 'aws'
                print(f"🎯 [Chat Stream] User selected provider: {provider}, cloud_provider: {cloud_provider}")
                async for token in handle_ask_mode_stream(req.prompt, user_merged, conversation, req.context, provider, req.workspace_path, cloud_provider):
                    full_message += token
                    yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
                    await asyncio.sleep(0)  # Allow event loop to process
                
                result = {"message": full_message}
            elif req.mode == "agent":
                
                # Get provider preference
                provider = getattr(req, 'provider', 'claude')
                print(f"🎯 [Agent Mode] User selected provider: {provider}")
                
                # Scan workspace for existing resources AND file structure (CACHED for speed!)
                existing_resources_context = ""
                existing_file_structure = {}
                
                # Cloud provider priority: 1) Frontend toggle, 2) Query mention, 3) Existing files, 4) Default AWS
                cloud_provider = getattr(req, 'cloud_provider', 'aws') or 'aws'
                frontend_set_provider = cloud_provider != 'aws'  # Track if frontend explicitly set DO
                print(f"☁️  [Provider] Frontend selection: {cloud_provider}")
                
                if req.workspace_path:
                    try:
                        from app.services.workspace_cache_service import workspace_cache_service
                        existing_resources_context, existing_file_structure = workspace_cache_service.get_workspace_context(
                            req.workspace_path
                        )
                    except Exception as e:
                        print(f"⚠️  [Context] Failed to get workspace context: {e}")
                    
                    # 🌐 Auto-detect cloud provider (only if frontend didn't explicitly set DO)
                    if not frontend_set_provider:
                        try:
                            from app.services.cloud_provider import detect_provider_from_files, detect_provider_from_query
                            
                            # First check if user explicitly mentioned a provider in query
                            query_provider = detect_provider_from_query(req.prompt)
                            if query_provider:
                                cloud_provider = query_provider
                                print(f"☁️  [Provider] Detected from query: {cloud_provider}")
                            elif existing_file_structure:
                                # Check existing terraform files
                                file_provider = detect_provider_from_files(existing_file_structure)
                                if file_provider:
                                    cloud_provider = file_provider
                                    print(f"☁️  [Provider] Detected from files: {cloud_provider}")
                        except Exception as e:
                            print(f"⚠️  [Provider] Detection failed, using: {cloud_provider}: {e}")
                
                # 🚀 ENHANCED: Add drift context if user is asking about changes/drift
                drift_context = ""
                if req.context and req.context.get('repo') and any(word in req.prompt.lower() for word in ['change', 'drift', 'modified', 'updated', 'difference', 'what happened', 'why']):
                    try:
                        print("🔍 [Chat] Detected drift-related query, fetching drift context...")
                        from app.services.drift_intelligence_service import drift_intelligence_service
                        from app.api.v1.endpoints.drift_detection import detect_terraform_drift
                        
                        repo_full_name = req.context.get('repo', '')
                        if '/' in repo_full_name:
                            owner, repo = repo_full_name.split('/')
                            
                            # Get basic drift (use try/except to not break if it fails)
                            try:
                                basic_drift = await detect_terraform_drift(owner, repo, "main", current_user=user)
                                
                                # Enhance with AI insights
                                enhanced_drift = await drift_intelligence_service.analyze_drift_with_context(
                                    drift_data=basic_drift,
                                    user_id=user.id,
                                    owner=owner,
                                    repo=repo,
                                    workspace_path=req.workspace_path
                                )
                                
                                # Build drift context for prompt injection
                                if enhanced_drift and enhanced_drift.get('drifts'):
                                    drift_context = f"\n\n**RECENT INFRASTRUCTURE CHANGES:**\n"
                                    if enhanced_drift.get('ai_insights', {}).get('summary'):
                                        drift_context += f"{enhanced_drift['ai_insights']['summary']}\n\n"
                                    
                                    drift_context += "Recent changes:\n"
                                    for drift in enhanced_drift.get('drifts', [])[:5]:  # Limit to 5 most recent
                                        drift_context += f"- {drift.get('resource_type')}.{drift.get('resource_name')} ({drift.get('type')})"
                                        if drift.get('ai_explanation', {}).get('text'):
                                            drift_context += f": {drift['ai_explanation']['text'][:150]}..."
                                        drift_context += "\n"
                                        
                                        # Add affected resources
                                        affected = drift.get('affected_resources', [])
                                        if affected:
                                            affected_names = [f"{r.get('type', '')}.{r.get('name', '')}" for r in affected[:3]]
                                            drift_context += f"  → Affects: {', '.join(affected_names)}\n"
                                    
                                    print(f"✅ [Chat] Added drift context ({len(enhanced_drift.get('drifts', []))} changes)")
                                    
                            except Exception as drift_error:
                                print(f"⚠️  [Chat] Could not fetch drift data: {drift_error}")
                        
                    except Exception as e:
                        print(f"⚠️  [Chat] Failed to add drift context: {e}")
                        # Don't break chat if drift context fails
                
                # Merge all context
                existing_resources_context += drift_context
                
                # SPEED OPTIMIZATION: Smart query chunking for large deployments
                from app.services.query_chunker import should_chunk_query, chunk_query_with_claude, estimate_chunk_time
                from app.services.enhanced_nlp_processor import process_multi_resource_nl_to_ir_with_claude
                
                files_already_streamed = False  # Track if we streamed proposals
                
                if should_chunk_query(req.prompt):
                    # Large query detected - use FAST static chunking (no Claude call for splitting)
                    yield f"data: {json.dumps({'type': 'status', 'message': 'large query detected - splitting into chunks...'})}\n\n"
                    await asyncio.sleep(0.1)
                    
                    # Use static chunking (instant, no Claude call needed)
                    from app.services.query_chunker import chunk_query  # Static chunking function
                    chunks = chunk_query(req.prompt)  # <1 second (was chunk_query_with_claude - 10+ seconds)
                    total_chunks = len(chunks)
                    
                    yield f"data: {json.dumps({'type': 'status', 'message': f'split into {total_chunks} chunks - processing in parallel...'})}\n\n"
                    await asyncio.sleep(0.1)
                    
                    # PARALLEL PROCESSING: Process ALL chunks at once for 4x speed!
                    all_ops = []
                    all_file_proposals = []
                    accumulated_hcl_files = {}  # Track HCL content across chunks for smart merging
                    files_already_streamed = True  # Mark that we're streaming
                    
                    yield f"data: {json.dumps({'type': 'status', 'message': f'processing {total_chunks} chunks in parallel...'})}\n\n"
                    
                    # Process chunks SEQUENTIALLY for now (simpler, still fast with static chunking)
                    for idx, (chunk_name, chunk_query_text) in enumerate(chunks, 1):
                        try:
                            # Show which chunk we're processing
                            yield f"data: {json.dumps({'type': 'status', 'message': f'[{idx}/{total_chunks}] processing {chunk_name}...'})}\n\n"
                            await asyncio.sleep(0.1)
                            
                            chunk_ir = None
                            last_chars = 0
                            async for event in process_multi_resource_nl_to_ir_with_claude(chunk_query_text, "", cloud_provider):
                                if event["type"] == "progress":
                                    # Stream Claude's progress every 1000 chars
                                    chars = event.get("total_length", 0)
                                    if chars - last_chars >= 1000:
                                        last_chars = chars
                                        yield f"data: {json.dumps({'type': 'status', 'message': f'[{idx}/{total_chunks}] {chunk_name} ({chars} chars)...'})}\n\n"
                                        await asyncio.sleep(0)
                                elif event["type"] == "complete":
                                    chunk_ir = event["ir"]
                                    break
                            
                            if not chunk_ir or "ops" not in chunk_ir:
                                yield f"data: {json.dumps({'type': 'status', 'message': f'[{idx}/{total_chunks}] {chunk_name} skipped - no resources'})}\n\n"
                                continue
                            
                            # POST-PROCESS: Auto-wrap JSON fields with jsonencode() for this chunk
                            from app.services.ir_postprocessor import postprocess_ir_for_terraform, auto_detect_and_wrap_json_fields
                            from app.services.fix_learning_service import fix_learning_service
                            
                            chunk_ir = postprocess_ir_for_terraform(chunk_ir)
                            chunk_ir = auto_detect_and_wrap_json_fields(chunk_ir)  # Aggressive fallback
                            
                            # LEARN: Apply learned fixes to prevent known errors
                            chunk_ir = fix_learning_service.apply_learned_fixes_to_ir(chunk_ir)
                            
                            # POST-PROCESS: Auto-fix missing VPC dependencies for this chunk
                            chunk_ops = chunk_ir.get("ops", [])
                            vpc_dependent_types = ["aws_internet_gateway", "aws_subnet", "aws_route_table", "aws_security_group"]
                            has_vpc = any(op.get("selector", {}).get("type") == "aws_vpc" for op in chunk_ops)
                            needs_vpc = any(op.get("selector", {}).get("type") in vpc_dependent_types for op in chunk_ops)
                            
                            if needs_vpc and not has_vpc:
                                # Check if VPC exists in workspace or was created in a previous chunk
                                vpc_exists_in_workspace = "aws_vpc.main" in existing_resources_context
                                vpc_in_previous_chunk = any(op.get("selector", {}).get("type") == "aws_vpc" for op in all_ops)
                                
                                if not vpc_exists_in_workspace and not vpc_in_previous_chunk:
                                    # Auto-inject VPC creation at the beginning of this chunk
                                    print(f"⚠️  [IR-FIX-CHUNK] VPC-dependent resources in chunk {idx} but no VPC - auto-injecting")
                                    vpc_op = {
                                        "action": "create",
                                        "selector": {"type": "aws_vpc", "name": "main"},
                                        "changes": [
                                            {"op": "set", "path": "cidr_block", "value": "10.0.0.0/16"},
                                            {"op": "set", "path": "enable_dns_hostnames", "value": True},
                                            {"op": "set", "path": "enable_dns_support", "value": True},
                                            {"op": "set", "path": "tags.Name", "value": "main-vpc"}
                                        ],
                                        "file_hint": "vpc.tf"
                                    }
                                    chunk_ir["ops"].insert(0, vpc_op)
                                    chunk_ops = chunk_ir["ops"]
                                    print(f"✅ [IR-FIX-CHUNK] VPC auto-injected in chunk {idx}")
                            
                            all_ops.extend(chunk_ops)
                            ops_count = len(chunk_ops)
                            
                            # STREAM HCL IMMEDIATELY for this chunk!
                            yield f"data: {json.dumps({'type': 'status', 'message': f'[{idx}/{total_chunks}] {chunk_name} complete - {ops_count} resources'})}\n\n"
                            
                            from app.rag.generate import generate_multi_resource_terraform_hcl
                            chunk_hcl_files = generate_multi_resource_terraform_hcl(chunk_ir)
                            
                            # Check and fix duplicates for this chunk's HCL
                            # Skip for desktop mode (backend can't access local filesystem)
                            is_desktop_path = req.workspace_path and ('/Users/' in req.workspace_path or 'C:\\' in req.workspace_path)
                            if req.workspace_path and not is_desktop_path:
                                for filename in chunk_hcl_files:
                                    chunk_hcl_files[filename] = check_and_fix_duplicate_resources(
                                        workspace_path=req.workspace_path,
                                        generated_hcl=chunk_hcl_files[filename],
                                        filename=filename
                                    )
                            
                            # Merge this chunk's HCL with accumulated HCL (for cross-chunk merging)
                            from app.services.file_merger import _merge_terraform_content
                            for filename, content in chunk_hcl_files.items():
                                if filename in accumulated_hcl_files:
                                    # File appeared in previous chunk - merge them
                                    print(f"🔄 [Chunked-Merge] Merging {filename} from chunk {idx} with previous chunks")
                                    accumulated_hcl_files[filename] = _merge_terraform_content(
                                        accumulated_hcl_files[filename],
                                        content
                                    )
                                else:
                                    # First time seeing this file
                                    accumulated_hcl_files[filename] = content
                                
                            # Stream and create proposals for NEW files in this chunk
                            for filename, content in chunk_hcl_files.items():
                                # Check if file already proposed (avoid duplicates)
                                if not any(p["path"] == filename for p in all_file_proposals):
                                    # STREAM CODE IMMEDIATELY (green box in chat)
                                    yield f"data: {json.dumps({'type': 'streaming_code', 'file_path': filename, 'content': content, 'complete': False})}\n\n"
                                    await asyncio.sleep(0.05)
                                    
                                    file_proposal = {
                                        "action": "create",
                                        "path": filename,
                                        "oldContent": None,
                                        "newContent": accumulated_hcl_files[filename],  # Use accumulated (merged) content
                                        "description": f"Create {filename} ({chunk_name})"
                                    }
                                    all_file_proposals.append(file_proposal)
                                    
                                    # Mark streaming code as COMPLETE
                                    yield f"data: {json.dumps({'type': 'streaming_code', 'file_path': filename, 'content': content, 'complete': True})}\n\n"
                                    await asyncio.sleep(0.1)
                                    
                                    # Send file proposal IMMEDIATELY
                                    yield f"data: {json.dumps({'type': 'file_proposal', 'file_proposal': file_proposal})}\n\n"
                                    await asyncio.sleep(0.3)  # Small delay for Monaco
                                else:
                                    # File already proposed - update the existing proposal with merged content
                                    for proposal in all_file_proposals:
                                        if proposal["path"] == filename:
                                            proposal["newContent"] = accumulated_hcl_files[filename]
                                            print(f"📝 [Chunked-Merge] Updated proposal for {filename} with chunk {idx} content")
                                            break
                            
                            yield f"data: {json.dumps({'type': 'status', 'message': f'[{idx}/{total_chunks}] {chunk_name}: {ops_count} resources, {len(chunk_hcl_files)} files'})}\n\n"
                        
                        except Exception as e:
                            yield f"data: {json.dumps({'type': 'status', 'message': f'[{idx}/{total_chunks}] {chunk_name} warning: {str(e)[:50]}...'})}\n\n"
                            continue
                    
                    
                    # Combine all ops into single IR (for conversation history)
                    parsed_ir = {
                        "ops": all_ops,
                        "summary": f"Generated {len(all_ops)} resources across {total_chunks} chunks"
                    }
                    
                    yield f"data: {json.dumps({'type': 'status', 'message': f'{len(all_ops)} resources • {len(all_file_proposals)} files'})}\n\n"
                    
                    # GENERATE driftbox.md documentation
                    try:
                        yield f"data: {json.dumps({'type': 'status', 'message': '📝 Generating documentation...'})}\n\n"
                        
                        driftbox_md_content = await generate_driftbox_md(
                            user_prompt=req.prompt,
                            generated_files=accumulated_hcl_files,
                            workspace_path=req.workspace_path,
                            owner=owner,
                            repo=repo
                        )
                        
                        # Check if driftbox.md already exists (only in server mode)
                        existing_driftbox_md = None
                        is_desktop = req.workspace_path and ('/Users/' in req.workspace_path or 'C:\\' in req.workspace_path)
                        if req.workspace_path and not is_desktop:
                            driftbox_md_path = Path(req.workspace_path) / "driftbox.md"
                            if driftbox_md_path.exists():
                                try:
                                    existing_driftbox_md = driftbox_md_path.read_text()
                                except:
                                    pass
                        # In desktop mode, we can't check if file exists on client, so always treat as create
                        
                        # Add driftbox.md proposal
                        driftbox_proposal = {
                            "action": "edit" if existing_driftbox_md else "create",
                            "path": "driftbox.md",
                            "oldContent": existing_driftbox_md,
                            "newContent": driftbox_md_content,
                            "description": "Update infrastructure documentation" if existing_driftbox_md else "Create infrastructure documentation"
                        }
                        all_file_proposals.append(driftbox_proposal)
                        
                        # Stream driftbox.md
                        yield f"data: {json.dumps({'type': 'streaming_code', 'file_path': 'driftbox.md', 'content': driftbox_md_content, 'complete': True})}\n\n"
                        await asyncio.sleep(0.1)
                        
                        # Send driftbox.md proposal
                        yield f"data: {json.dumps({'type': 'file_proposal', 'file_proposal': driftbox_proposal})}\n\n"
                        await asyncio.sleep(0.2)
                        
                        yield f"data: {json.dumps({'type': 'status', 'message': '✅ Documentation generated'})}\n\n"
                        
                    except Exception as e:
                        import traceback
                        print(f"❌ [driftbox.md] Generation failed: {e}")
                        print(f"❌ [driftbox.md] Traceback: {traceback.format_exc()}")
                        yield f"data: {json.dumps({'type': 'status', 'message': f'⚠️  Documentation generation failed: {str(e)[:100]}'})}\n\n"
                    
                    # Override result to use streamed proposals
                    # Pass accumulated HCL files to avoid regenerating
                    result = await handle_agent_mode(req.prompt, req.workspace_path, user_merged, conversation, req.context, pre_generated_ir=parsed_ir, pre_generated_hcl=accumulated_hcl_files)
                    result["file_proposals"] = all_file_proposals  # Use our streamed proposals
                    
                    # Send completion event
                    yield f"data: {json.dumps({'type': 'complete'})}\n\n"
                    
                else:
                    # Small query - process normally
                    chars_received = 0
                    last_update = 0
                    parsed_ir = None
                    
                    # existing_resources_context already scanned above
                    if provider == "openai":
                        print(f"🔵 [Agent Mode] Using OpenAI for IR generation")
                        try:
                            # Use OpenAI for infrastructure generation
                            yield f"data: {json.dumps({'type': 'status', 'message': 'generating with GPT-5...'})}\n\n"
                            await asyncio.sleep(0.1)
                            
                            # Call OpenAI to generate IR (infrastructure representation)
                            from app.services.llm_failover import llm_failover_service
                            from app.services.cloud_provider import get_ir_system_prompt
                            
                            # Get provider-specific IR system prompt (AWS or DigitalOcean)
                            ir_system_prompt = get_ir_system_prompt(cloud_provider, existing_resources_context)
                            print(f"☁️  [IR Generation] Using {cloud_provider} system prompt")

                            response_text = ""
                            async for token in llm_failover_service.stream_chat_completion(
                                messages=[{"role": "user", "content": req.prompt}],
                                system_prompt=ir_system_prompt,
                                model="claude-sonnet-4-20250514",  # Will map to GPT-4
                                max_tokens=4096,
                                temperature=0,
                                force_provider="openai"
                            ):
                                response_text += token
                                if len(response_text) % 100 == 0:
                                    yield f"data: {json.dumps({'type': 'status', 'message': f'generating... {len(response_text)} chars'})}\n\n"
                                    await asyncio.sleep(0)
                            
                            # Parse the IR
                            response_text = response_text.strip()
                            if response_text.startswith("```"):
                                lines = response_text.split("\n")
                                response_text = "\n".join(lines[1:-1]) if len(lines) > 2 else response_text
                                response_text = response_text.strip()
                            
                            import json as json_lib
                            parsed_ir = json_lib.loads(response_text)
                            
                        except Exception as e:
                            error_msg = str(e)
                            yield f"data: {json.dumps({'type': 'error', 'message': f'OpenAI generation failed: {error_msg}'})}\n\n"
                            return
                    else:
                        # Use Claude for IR generation (default)
                        print(f"🔵 [Agent Mode] Using Claude for IR generation ({cloud_provider})")
                        try:
                            async for event in process_multi_resource_nl_to_ir_with_claude(req.prompt, existing_resources_context, cloud_provider):
                                if event["type"] == "progress":
                                    chars_received = event["total_length"]
                                    if chars_received - last_update >= 1000:
                                        last_update = chars_received
                                        yield f"data: {json.dumps({'type': 'status', 'message': f'generating... {chars_received} chars'})}\n\n"
                                        await asyncio.sleep(0)
                                elif event["type"] == "complete":
                                    parsed_ir = event["ir"]
                                    break
                        except Exception as e:
                            error_msg = str(e)
                            if "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
                                yield f"data: {json.dumps({'type': 'error', 'message': 'Query too complex - Claude timed out. Try breaking it into smaller queries.'})}\n\n"
                            else:
                                yield f"data: {json.dumps({'type': 'error', 'message': f'Generation failed: {error_msg}'})}\n\n"
                            return
                
                if not parsed_ir or not parsed_ir.get("ops"):
                    raise Exception("Failed to generate infrastructure plan")
                
                # POST-PROCESS: Auto-wrap JSON fields with jsonencode() to prevent multi-line string errors
                from app.services.ir_postprocessor import postprocess_ir_for_terraform, auto_detect_and_wrap_json_fields
                from app.services.fix_learning_service import fix_learning_service
                
                parsed_ir = postprocess_ir_for_terraform(parsed_ir)
                parsed_ir = auto_detect_and_wrap_json_fields(parsed_ir)  # Aggressive fallback
                
                # LEARN: Apply learned fixes to prevent known errors
                parsed_ir = fix_learning_service.apply_learned_fixes_to_ir(parsed_ir)
                
                # POST-PROCESS: Auto-fix missing VPC dependencies
                ops = parsed_ir.get("ops", [])
                vpc_dependent_types = ["aws_internet_gateway", "aws_subnet", "aws_route_table", "aws_security_group"]
                has_vpc = any(op.get("selector", {}).get("type") == "aws_vpc" for op in ops)
                needs_vpc = any(op.get("selector", {}).get("type") in vpc_dependent_types for op in ops)
                
                if needs_vpc and not has_vpc:
                    # Check if VPC exists in workspace
                    vpc_exists_in_workspace = "aws_vpc.main" in existing_resources_context
                    
                    if not vpc_exists_in_workspace:
                        # Auto-inject VPC creation at the beginning
                        print(f"⚠️  [IR-FIX] VPC-dependent resources found but no VPC - auto-injecting VPC")
                        vpc_op = {
                            "action": "create",
                            "selector": {"type": "aws_vpc", "name": "main"},
                            "changes": [
                                {"op": "set", "path": "cidr_block", "value": "10.0.0.0/16"},
                                {"op": "set", "path": "enable_dns_hostnames", "value": True},
                                {"op": "set", "path": "enable_dns_support", "value": True},
                                {"op": "set", "path": "tags.Name", "value": "main-vpc"}
                            ],
                            "file_hint": "vpc.tf"
                        }
                        parsed_ir["ops"].insert(0, vpc_op)
                        print(f"✅ [IR-FIX] VPC auto-injected successfully")
                
                # STREAM HCL GENERATION PROGRESSIVELY (don't wait for all files)
                from app.rag.generate import generate_multi_resource_terraform_hcl
                
                # Generate HCL from IR
                yield f"data: {json.dumps({'type': 'status', 'message': 'generating terraform files...'})}\n\n"
                await asyncio.sleep(0.05)
                
                hcl_files = generate_multi_resource_terraform_hcl(parsed_ir)
                
                # 🌍 CHECK FOR CROSS-REGION RESOURCES: Add providers.tf if needed (AWS only)
                cross_region_keywords = ['replication', 'replica', 'cross-region', 'disaster recovery', 'dr', 'failover', 'multi-region']
                needs_cross_region = any(keyword in req.prompt.lower() for keyword in cross_region_keywords)
                
                # Only add cross-region providers for AWS, not DigitalOcean
                if needs_cross_region and cloud_provider == 'aws':
                    print(f"🌍 [Cross-Region] Detected cross-region requirement, adding providers.tf")
                    providers_tf_content = '''# AWS Provider Configuration
# Primary region for main resources
provider "aws" {
  region = "us-east-1"
}

# Replica region for disaster recovery and cross-region replication
provider "aws" {
  alias  = "replica"
  region = "us-west-2"
}
'''
                    hcl_files["providers.tf"] = providers_tf_content
                    print(f"✅ [Cross-Region] Added providers.tf with primary (us-east-1) and replica (us-west-2) regions")
                
                # Check and fix duplicate resources for each file
                # Skip for desktop mode (backend can't access local filesystem)
                is_desktop_path = req.workspace_path and ('/Users/' in req.workspace_path or 'C:\\' in req.workspace_path)
                if req.workspace_path and not is_desktop_path:
                    for filename in hcl_files:
                        hcl_files[filename] = check_and_fix_duplicate_resources(
                            workspace_path=req.workspace_path,
                            generated_hcl=hcl_files[filename],
                            filename=filename
                        )
                elif is_desktop_path:
                    print(f"🖥️  [Desktop Mode] Skipping server-side duplicate check (client-side only)")
                
                # 🚀 USE FILE MERGER: Intelligently decide create vs update
                from app.services.file_merger import merge_hcl_into_workspace
                
                if req.workspace_path:
                    print(f"🔄 [FileMerger] Analyzing workspace for intelligent file placement...")
                    file_proposals = merge_hcl_into_workspace(hcl_files, req.workspace_path)
                else:
                    # Fallback: no workspace, create all files
                    file_proposals = [
                        {
                            "action": "create",
                            "path": filename,
                            "oldContent": None,
                            "newContent": content,
                            "description": f"Create {filename}"
                        }
                        for filename, content in hcl_files.items()
                    ]
                
                # Stream each file proposal
                for file_proposal in file_proposals:
                    filename = file_proposal["path"]
                    content = file_proposal["newContent"]
                    action = file_proposal["action"]
                    
                    # Stream code block (incomplete state) - show the NEW content
                    yield f"data: {json.dumps({'type': 'streaming_code', 'file_path': filename, 'content': content, 'complete': False})}\n\n"
                    await asyncio.sleep(0.05)
                    
                    # Mark as complete
                    yield f"data: {json.dumps({'type': 'streaming_code', 'file_path': filename, 'content': content, 'complete': True})}\n\n"
                    await asyncio.sleep(0.1)
                    
                    # Send file proposal immediately (with action='create' or 'update')
                    yield f"data: {json.dumps({'type': 'file_proposal', 'file_proposal': file_proposal})}\n\n"
                    await asyncio.sleep(0.3)
                    
                    # Log action
                    if action == "update":
                        print(f"📝 [FileMerger] APPEND to {filename}")
                    else:
                        print(f"📄 [FileMerger] CREATE {filename}")
                
                # Mark files as already streamed
                files_already_streamed = True
                
                # 🚫 DOCUMENTATION GENERATION DISABLED
                # User only wants Driftbox docs, not infrara docs
                # Skipping driftbox/docs/*.md generation
                
                # Call handle_agent_mode with pre-generated files to save in conversation
                # Pass both IR and HCL to avoid regenerating files
                result = await handle_agent_mode(req.prompt, req.workspace_path, user_merged, conversation, req.context, pre_generated_ir=parsed_ir, pre_generated_hcl=hcl_files)
                # Merge: Keep streamed proposals + add any new ones from handle_agent_mode (like driftbox.md)
                streamed_paths = {p['path'] for p in file_proposals}
                for proposal in result.get("file_proposals", []):
                    if proposal['path'] not in streamed_paths:
                        file_proposals.append(proposal)
                        # Stream the new proposal
                        yield f"data: {json.dumps({'type': 'file_proposal', 'file_proposal': proposal})}\n\n"
                        await asyncio.sleep(0.1)
                result["file_proposals"] = file_proposals
                
                # Create summary message AFTER adding driftbox.md
                resource_count = len(parsed_ir.get("ops", []))
                file_count = len(file_proposals)
                summary_message = f"{resource_count} resources • {file_count} files"
                
                yield f"data: {json.dumps({'type': 'status', 'message': summary_message})}\n\n"
                yield f"data: {json.dumps({'type': 'token', 'content': summary_message})}\n\n"
                await asyncio.sleep(0.1)
                
                # Send completion event
                yield f"data: {json.dumps({'type': 'complete'})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Invalid mode'})}\n\n"
                return
            
            # ========================================
            # SEND COMPLETION IMMEDIATELY (don't make user wait for DB ops)
            # ========================================
            response_data = {
                "type": "complete",
                "message": "",
                "mode": req.mode,
                "timestamp": datetime.utcnow().isoformat()
            }
            yield f"data: {json.dumps(response_data)}\n\n"
            
            # ========================================
            # AFTER COMPLETION: DB operations (truly non-blocking now)
            # ========================================
            
            # 1. Deduct credits (user already saw the response, so this is safe)
            try:
                user_merged = credit_tracker.validate_and_deduct_action_credits(user_merged, "chat_message", auth_db)
            except Exception as e:
                pass
            
            # 2. Track usage in background
            usage_tracker.track_event(
                user_id=user_merged.id,
                event_type="chat_message",
                metadata={"mode": req.mode, "prompt_length": len(req.prompt), "stream": True}
            )
            
            # 3. Create/get conversation (only for saving history, not needed for streaming)
            # Security: Pass user_id to verify ownership at service layer
            if req.conversation_id:
                conversation = conversation_manager.retrieve_conversation_thread(
                    req.conversation_id,
                    user_id=user_merged.id  # Verify ownership
                )
                if not conversation:
                    # Conversation not found or wrong user, create new one
                    conversation = None
            
            if not conversation:
                title = req.prompt[:50] + "..." if len(req.prompt) > 50 else req.prompt
                conversation_id = conversation_manager.initialize_conversation_thread(
                    thread_title=title,
                    account_id=user_merged.id,
                    repository_location=req.workspace_path
                )
                conversation = conversation_manager.retrieve_conversation_thread(
                    conversation_id,
                    user_id=user_merged.id  # Verify ownership
                )
            
            # 4. Add messages to conversation history (for future context)
            try:
                conversation_manager.append_message_to_thread(
                    thread_identifier=conversation["id"],
                    message_role="user",
                    message_content=req.prompt
                )
                conversation_manager.append_message_to_thread(
                    thread_identifier=conversation["id"],
                    message_role="assistant",
                    message_content=result["message"],
                    infrastructure_changes=result.get("ir"),
                    ai_reasoning_data=result.get("thinking")
                )
                
                # Index conversation messages for future context retrieval
                try:
                    conversation_data = conversation_manager.retrieve_conversation_thread(
                        conversation["id"],
                        user_id=user_merged.id  # Verify ownership
                    )
                    if conversation_data and conversation_data.get("messages"):
                        conversation_indexing_service.index_conversation_messages(
                            user_id=user_merged.id,
                            conversation_id=conversation["id"],
                            messages=conversation_data["messages"],
                            conversation_title=conversation_data.get("title")
                        )
                except Exception as e:
                    print(f"Error indexing conversation: {e}")
                    # Don't fail the request if indexing fails
            except Exception as e:
                pass
        
        except HTTPException as e:
            print(f"❌ [Chat] HTTPException: {e.detail}", flush=True)
            yield f"data: {json.dumps({'type': 'error', 'message': e.detail})}\n\n"
        except Exception as e:
            import traceback
            import sys
            error_msg = str(e)
            tb = traceback.format_exc()
            print(f"❌ [Chat] EXCEPTION TYPE: {type(e).__name__}", flush=True)
            print(f"❌ [Chat] EXCEPTION MSG: {error_msg}", flush=True)
            print(f"❌ [Chat] TRACEBACK:", flush=True)
            print(tb, flush=True)
            sys.stdout.flush()
            sys.stderr.flush()
            from app.utils.errors import sanitize_error_detail
            error_message = sanitize_error_detail(e, "Chat request failed")
            yield f"data: {json.dumps({'type': 'error', 'message': error_message})}\n\n"
    
    return StreamingResponse(generate_stream(), media_type="text/event-stream")


@router.post("/chat", response_model=ChatResponse, tags=["chat"])
async def chat(
    req: ChatRequest,
    user: UserAccount = Depends(authentication_service.extract_authenticated_user),
    auth_db: Session = Depends(get_auth_db)
):
    """
    Chat with AI in ask or agent mode (Cursor-style).
    
    **Ask Mode:** AI explains what it would do, provides guidance
    **Agent Mode:** AI executes tasks autonomously
    
    The AI automatically suggests mode switches based on your intent.
    
    **Note:** For real-time progress updates, use /chat/stream instead.
    """
    try:
        # Merge user into the current session to avoid detachment
        user = auth_db.merge(user)
        
        # Check and deduct credits for chat
        user = credit_tracker.validate_and_deduct_action_credits(user, "chat_message", auth_db)
        
        # Track usage (use user.id to avoid session issues)
        usage_tracker.track_event(
            user_id=user.id,
            event_type="chat_message",
            metadata={"mode": req.mode, "prompt_length": len(req.prompt)}
        )
        
        # Get or create conversation
        # Security: Pass user_id to verify ownership at service layer
        if req.conversation_id:
            conversation = conversation_manager.retrieve_conversation_thread(
                req.conversation_id,
                user_id=user.id  # Verify ownership
            )
            if not conversation:
                raise HTTPException(status_code=404, detail="Conversation not found")
        else:
            # Create new conversation
            title = req.prompt[:50] + "..." if len(req.prompt) > 50 else req.prompt
            conversation_id = conversation_manager.initialize_conversation_thread(
                thread_title=title,
                account_id=user.id,
                repository_location=req.workspace_path
            )
            conversation = conversation_manager.retrieve_conversation_thread(
                conversation_id,
                user_id=user.id  # Verify ownership
            )
        
        # Add user message
        conversation_manager.append_message_to_thread(
            thread_identifier=conversation["id"],
            message_role="user",
            message_content=req.prompt
        )
        
        # Analyze if mode switch would be beneficial
        mode_suggestion_data = mode_detector.evaluate_prompt_intent(
            user_prompt=req.prompt,
            active_mode=req.mode
        )
        
        # Get mode description
        mode_info = mode_detector.get_mode_metadata(req.mode)
        
        # Execute based on mode with conversation history
        if req.mode == "ask":
            result = await handle_ask_mode(req.prompt, user, conversation, req.context)
        elif req.mode == "agent":
            result = await handle_agent_mode(req.prompt, req.workspace_path, user, conversation, req.context)
        else:
            raise HTTPException(status_code=400, detail="Invalid mode. Use 'ask' or 'agent'")
        
        # Add AI response to conversation
        conversation_manager.append_message_to_thread(
            thread_identifier=conversation["id"],
            message_role="assistant",
            message_content=result["message"],
            infrastructure_changes=result.get("ir"),
            ai_reasoning_data=result.get("thinking")
        )
        
        # Index conversation messages for future context retrieval
        try:
            conversation_data = conversation_manager.retrieve_conversation_thread(
                conversation["id"],
                user_id=user.id  # Verify ownership
            )
            if conversation_data and conversation_data.get("messages"):
                conversation_indexing_service.index_conversation_messages(
                    user_id=user.id,
                    conversation_id=conversation["id"],
                    messages=conversation_data["messages"],
                    conversation_title=conversation_data.get("title")
                )
        except Exception as e:
            print(f"Error indexing conversation: {e}")
            # Don't fail the request if indexing fails
        
        # Build mode suggestion if applicable
        mode_suggestion = None
        if mode_suggestion_data:
            mode_suggestion = ModeSuggestion(**mode_suggestion_data)
        
        return ChatResponse(
            message=result["message"],
            mode=req.mode,
            mode_info=mode_info,
            mode_suggestion=mode_suggestion,
            actions=result.get("actions"),
            thinking=result.get("thinking"),
            conversation_id=conversation["id"],
            timestamp=datetime.utcnow()
        )
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=sanitize_error_detail(e, "Chat request failed"))


# ===== Mode Handlers =====

async def handle_ask_mode(prompt: str, user: UserAccount, conversation: Dict, context: Optional[Dict] = None) -> Dict:
    """
    Ask Mode: Explain what would be done without executing.
    Like Cursor's ask mode - shows the plan with generated Terraform code.
    """
    # Get context for codebase and conversation
    combined_context_text = ""
    owner, repo = extract_owner_repo_from_context(None, context)  # workspace_path not available in ask mode
    if owner and repo:
        try:
            # Use smart context retrieval (RAG + direct file reading when needed)
            combined_context = context_service.get_combined_context(
                user_id=user.id,
                owner=owner,
                repo=repo,
                conversation_id=conversation.get("id") if conversation else None,
                query=prompt,
                workspace_path=None  # Ask mode doesn't have workspace_path
            )
            combined_context_text = combined_context.get("combined_text", "")
            print(f"📚 [handle_ask_mode] Retrieved context: {len(combined_context_text)} chars")
        except Exception as e:
            print(f"Error retrieving context: {e}")
    
    # Check if it's a conceptual question FIRST (before parsing as IR)
    prompt_lower = prompt.lower()
    question_keywords = ["what is", "what's", "explain", "how does", "why", "when should", "tell me about", "how would", "how could"]
    
    if any(q in prompt_lower for q in question_keywords):
        # Use Claude to answer the question with conversation context
        return _handle_infrastructure_question(prompt, conversation, combined_context_text)
    
    try:
        # Import Terraform generator
        from app.rag.generate import generate_multi_resource_terraform_hcl
        
        # Enhance prompt with context if available
        enhanced_prompt = prompt
        if combined_context_text:
            enhanced_prompt = f"""User Request: {prompt}

Existing Codebase and Conversation Context:
{combined_context_text}

Generate Terraform code that:
1. Follows patterns from existing codebase
2. Reuses existing variables/outputs where appropriate
3. Maintains consistency with current file structure
4. References previous decisions from conversation history"""
        
        # Parse intent into IR
        result = await nl_to_multi_resource_ir(enhanced_prompt)
        ops = result.get("ops", [])
        
        if not ops:
            # No clear infrastructure action - use Claude for conversational response
            # Get conversation history for context
            conversation_history = []
            if conversation:
                try:
                    # The conversation dict already has messages from retrieve_conversation_thread
                    messages = conversation.get("messages", [])
                    # Take last 6 messages (3 exchanges) for context, excluding the current user message we just added
                    for msg in messages[-7:-1]:  # Skip the last one (current prompt)
                        conversation_history.append({
                            "role": msg["role"],
                            "content": msg["content"]
                        })
                except Exception as e:
                    # Continue without history if there's an error
                    pass
            
            # Call Claude for conversational infrastructure help
            try:
                from app.config import _anthropic_instance, CLAUDE_ASK_MODEL
                
                system_prompt = """You are an infrastructure engineering assistant. 
You help users understand infrastructure concepts, explain previous conversations, and answer questions about cloud resources and Terraform.
Be helpful and conversational. Reference previous messages in the conversation when relevant.
Do NOT use emojis in your responses."""
                
                # Inject codebase and conversation context if available
                if combined_context_text:
                    system_prompt += f"\n\nCurrent Codebase and Conversation Context:\n{combined_context_text}\n\nUse this context to provide accurate, relevant answers. Reference existing code patterns when explaining concepts."
                
                messages_for_claude = []
                # Add conversation history
                for msg in conversation_history:
                    messages_for_claude.append({
                        "role": msg["role"],
                        "content": msg["content"]
                    })
                # Add current prompt
                messages_for_claude.append({
                    "role": "user",
                    "content": prompt
                })
                
                response = _anthropic_instance.messages.create(
                    model=CLAUDE_ASK_MODEL,  # Use Sonnet 4 for Ask mode
                    max_tokens=2000,
                    system=system_prompt,
                    messages=messages_for_claude
                )
                
                return {
                    "message": response.content[0].text,
                    "ir": None,
                    "thinking": None
                }
            except Exception as e:
                return {
                    "message": "I can help you with infrastructure questions and Terraform code. What would you like to know?\n\n**Examples:**\n- \"Create an S3 bucket for logs\"\n- \"What is an S3 bucket for logs?\"\n- \"Set up a VPC with public and private subnets\"",
                    "ir": None,
                    "thinking": None
                }
        
        # Generate actual Terraform code (returns dict of files)
        hcl_files = generate_multi_resource_terraform_hcl({"ops": ops})
        
        # Consolidate for display
        consolidated_parts = []
        for filename in ["main.tf"] + [f for f in sorted(hcl_files.keys()) if f != "main.tf"]:
            if filename not in hcl_files:
                continue
            if filename == "main.tf":
                consolidated_parts.append(hcl_files[filename])
            else:
                consolidated_parts.append(f"# {filename}\n{hcl_files[filename]}")
        terraform_code = "\n\n".join(consolidated_parts)
        
        # Build detailed explanation
        message = "## Here's what I would create:\n\n"
        
        # Summary
        summary = result.get("summary", f"{len(ops)} infrastructure operation(s)")
        message += f"**Summary:** {summary}\n\n"
        
        # Resource breakdown
        message += "### Resources:\n\n"
        for i, op in enumerate(ops, 1):
            action = op["action"]
            resource_type = op["selector"]["type"]
            resource_name = op["selector"]["name"]
            
            message += f"**{i}. {action.title()}** `{resource_type}.{resource_name}`\n"
            
            # Add resource-specific context
            if resource_type == "aws_s3_bucket":
                message += "   - Purpose: Object storage for logs/files\n"
                message += "   - Security: Block public access enabled\n"
                message += "   - Versioning: Enabled for data protection\n"
            elif resource_type == "aws_vpc":
                changes = op.get("changes", [])
                cidr = next((c["value"] for c in changes if c["path"] == "cidr_block"), "N/A")
                message += f"   - CIDR Block: `{cidr}`\n"
                message += "   - DNS Support: Enabled\n"
            elif resource_type == "aws_ec2_instance":
                message += "   - Instance Type: t3.micro (cost-optimized)\n"
                message += "   - Monitoring: Enabled\n"
            
            # Show key attributes
            changes = op.get("changes", [])[:3]  # First 3
            if changes:
                for change in changes:
                    path = change["path"]
                    value = change.get("value", "")
                    if isinstance(value, (str, int, bool)) and not path.startswith("tags"):
                        message += f"   - `{path}`: `{value}`\n"
            
            message += "\n"
        
        # Show generated Terraform code (truncate to 25 lines)
        message += "### Generated Terraform Code:\n\n"
        message += "```hcl\n"
        code_lines = terraform_code.strip().split('\n')
        if len(code_lines) > 25:
            message += '\n'.join(code_lines[:25])
            message += f"\n\n... +{len(code_lines) - 25} more lines"
        else:
            message += terraform_code.strip()
        message += "\n```\n\n"
        
        # Cost estimate
        message += "### Estimated Cost:\n"
        message += "- **S3 Bucket**: ~$0.023/GB/month (first 50TB)\n" if any("s3" in op["selector"]["type"] for op in ops) else ""
        message += "- **EC2 t3.micro**: ~$7.50/month (on-demand)\n" if any("ec2" in op["selector"]["type"] for op in ops) else ""
        message += "- **VPC/Networking**: Free tier available\n" if any("vpc" in op["selector"]["type"] for op in ops) else ""
        message += "\n"
        
        # Next steps
        message += "### Next Steps:\n"
        message += "1. **Switch to agent mode** to actually create these resources\n"
        message += "2. I'll write this to your Terraform files\n"
        message += "3. Run `terraform plan` to see exact changes\n"
        message += "4. Run `terraform apply` to deploy\n\n"
        
        message += "---\n\n"
        message += "**This is ask mode** - I'm showing you what would be created without making changes.\n"
        message += "Switch to **agent mode** when you're ready to execute."
        
        return {
            "message": message,
            "ir": {"ops": ops},
            "thinking": terraform_code
        }
    
    except Exception as e:
        # Graceful fallback
        return {
            "message": f"I understand you want to: **{prompt}**\n\nLet me break this down:\n\n{str(e)}\n\nCould you provide more details about:\n- What cloud service you want to use?\n- Any specific configuration requirements?\n- Environment (dev/staging/prod)?",
            "ir": None,
            "thinking": None
        }


# ===== Streaming Mode Handlers =====

async def handle_ask_mode_stream(prompt: str, user: UserAccount, conversation: Optional[Dict], context: Optional[Dict] = None, provider: str = "claude", workspace_path: Optional[str] = None, cloud_provider: str = "aws") -> AsyncGenerator[str, None]:
    """Stream tokens from ask mode responses with user's provider preference"""
    print(f"🔵 [handle_ask_mode_stream] Received provider: {provider}, cloud_provider: {cloud_provider}, workspace_path: {workspace_path}")
    print(f"🔵 [handle_ask_mode_stream] Context: {context}, Prompt: {prompt[:100]}")
    
    # Cloud provider detection: 1) Frontend toggle, 2) Query mention, 3) Existing files, 4) Default AWS
    frontend_set_provider = cloud_provider != 'aws'  # Track if frontend explicitly set DO
    print(f"☁️  [Ask Mode Provider] Frontend selection: {cloud_provider}")
    
    # Get codebase context if available (for file read requests and general context)
    codebase_context_text = ""
    existing_file_structure = {}
    owner, repo = extract_owner_repo_from_context(workspace_path, context)
    print(f"🔵 [handle_ask_mode_stream] Extracted owner: {owner}, repo: {repo}")
    if owner and repo:
        try:
            # Smart context retrieval: uses RAG for semantic search, direct file reading for specific requests
            codebase_context = await context_service.get_codebase_context(
                user_id=user.id,
                owner=owner,
                repo=repo,
                query=prompt,
                top_k=8,
                workspace_path=workspace_path  # Pass workspace_path for direct file reading
            )
            if codebase_context:
                # Check if this is a file read request (has full_file type)
                is_file_read = any(
                    c.get('meta', {}).get('type') == 'full_file' 
                    for c in codebase_context
                )
                
                if is_file_read:
                    # For file reads, include ALL files (no limit) - they're already full files
                    codebase_context_text = "\n\n=== Current Codebase Context ===\n" + "\n".join([
                        f"File: {c.get('meta', {}).get('file', 'unknown')}\n{c.get('text', '')}\n---"
                        for c in codebase_context  # No [:10] limit for full files
                    ])
                    print(f"📚 [handle_ask_mode_stream] Retrieved {len(codebase_context)} full files ({len(codebase_context_text)} chars)")
                    
                    # Extract file structure for provider detection
                    for c in codebase_context:
                        file_path = c.get('meta', {}).get('file', '')
                        if file_path and file_path.endswith('.tf'):
                            existing_file_structure[file_path] = c.get('text', '')
                else:
                    # For semantic search, limit to top results
                    codebase_context_text = "\n\n=== Current Codebase Context ===\n" + "\n".join([
                        f"File: {c.get('meta', {}).get('file', 'unknown')}\n{c.get('text', '')}\n---"
                        for c in codebase_context[:10]  # Top 10 most relevant chunks
                    ])
                    print(f"📚 [handle_ask_mode_stream] Retrieved {len(codebase_context)} context chunks ({len(codebase_context_text)} chars)")
        except Exception as e:
            print(f"⚠️ [handle_ask_mode_stream] Error retrieving codebase context: {e}")
    
    # Auto-detect cloud provider (only if frontend didn't explicitly set DO)
    if not frontend_set_provider:
        try:
            from app.services.cloud_provider import detect_provider_from_files, detect_provider_from_query
            
            # First check if user explicitly mentioned a provider in query
            query_provider = detect_provider_from_query(prompt)
            if query_provider:
                cloud_provider = query_provider
                print(f"☁️  [Ask Mode Provider] Detected from query: {cloud_provider}")
            elif existing_file_structure:
                # Check existing terraform files
                file_provider = detect_provider_from_files(existing_file_structure)
                if file_provider:
                    cloud_provider = file_provider
                    print(f"☁️  [Ask Mode Provider] Detected from files: {cloud_provider}")
        except Exception as e:
            print(f"⚠️  [Ask Mode Provider] Detection failed, using: {cloud_provider}: {e}")
    
    prompt_lower = prompt.lower()
    question_keywords = ["what is", "what's", "explain", "how does", "why", "when should", "tell me about", "how would", "how could"]
    
    # Check if this is a file read request (use the same logic as context_service)
    # This should match vague requests like "read my repo files" or "can you read my codebase"
    # Use context_service's detection method for consistency
    is_file_read_request = context_service.detect_file_read_request(prompt)
    
    if any(q in prompt_lower for q in question_keywords) or is_file_read_request:
        # Stream conceptual question response or file read response with context
        print(f"🔵 [handle_ask_mode_stream] Detected question or file read request, calling _stream_infrastructure_question with provider: {provider}, cloud_provider: {cloud_provider}")
        async for token in _stream_infrastructure_question(prompt, conversation, provider, codebase_context_text, cloud_provider):
            yield token
    else:
        # Stream from LLM in REAL-TIME for infrastructure queries with user's provider choice
        from app.config import CLAUDE_ASK_MODEL
        
        print(f"🔵 [handle_ask_mode_stream] Detected infrastructure request, using provider: {provider}")
        
        try:
            # System prompt: ONLY show Terraform for action requests in ASK mode
            # Make it provider-aware based on cloud_provider
            if cloud_provider == "digitalocean":
                system_prompt = """You are a Terraform infrastructure assistant specializing in DigitalOcean. 

CRITICAL RULES for action requests (create, deploy, setup, etc.):
1. Show ONLY Terraform HCL syntax - NO DigitalOcean CLI, Python, Node.js, or other tools
2. Use DigitalOcean resource types: digitalocean_droplet, digitalocean_database_cluster, digitalocean_spaces_bucket, digitalocean_loadbalancer, digitalocean_vpc, digitalocean_kubernetes_cluster, digitalocean_firewall, etc.
3. Keep it concise - just the essential Terraform code
4. Include brief comments explaining key parts
5. Remind user: "💡 Switch to Agent Mode to actually create these resources"

DIGITALOCEAN-SPECIFIC NOTES:
- Droplet sizes: s-1vcpu-1gb, s-1vcpu-2gb, s-2vcpu-4gb, s-4vcpu-8gb
- Regions: nyc1, nyc3, sfo3, ams3, sgp1, lon1, fra1, blr1
- Database engines: pg (PostgreSQL), mysql, redis, mongodb
- Use proper references: ${digitalocean_resource.name.attribute}

TERRAFORM SYNTAX REQUIREMENTS:
- For nested blocks (forwarding_rule, healthcheck, inbound_rule, outbound_rule): Use BLOCK syntax WITHOUT equals sign
  CORRECT:
    forwarding_rule {
      entry_protocol = "http"
      entry_port = 80
    }
    healthcheck {
      protocol = "http"
      port = 80
    }
  WRONG:
    forwarding_rule = [{ entry_protocol = "http" }]
    healthcheck = { protocol = "http" }
- Simple list attributes (like droplet_ids) use square brackets: droplet_ids = [id1, id2]

NEVER show multiple methods. ONLY Terraform."""
            else:
                system_prompt = """You are a Terraform infrastructure assistant specializing in AWS. 

CRITICAL RULES for action requests (create, deploy, setup, etc.):
1. Show ONLY Terraform HCL syntax - NO AWS CLI, Python, Node.js, or CloudFormation
2. Use AWS resource types: aws_instance, aws_s3_bucket, aws_vpc, aws_subnet, aws_security_group, aws_lb, aws_db_instance, aws_lambda_function, etc.
3. Keep it concise - just the essential Terraform code
4. Include brief comments explaining key parts
5. Remind user: "💡 Switch to Agent Mode to actually create these resources"

TERRAFORM SYNTAX REQUIREMENTS:
- For nested blocks (ingress, egress, route): Use BLOCK syntax WITHOUT equals sign
  CORRECT:
    ingress {
      from_port = 80
      to_port = 80
      protocol = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
    route {
      cidr_block = "0.0.0.0/0"
      gateway_id = aws_internet_gateway.main.id
    }
  WRONG:
    ingress = [{ from_port = 80, to_port = 80 }]
    route = { cidr_block = "0.0.0.0/0" }
- Simple list attributes use square brackets: cidr_blocks = ["0.0.0.0/0"]

NEVER show multiple methods. ONLY Terraform."""
            
            # Add codebase context if available
            if codebase_context_text:
                system_prompt += codebase_context_text

            # Use user's provider preference, with automatic failover as backup
            print(f"🔵 [handle_ask_mode_stream] Calling llm_failover_service with force_provider={provider}, cloud_provider={cloud_provider}")
            async for token in llm_failover_service.stream_chat_completion(
                messages=[{"role": "user", "content": prompt}],
                system_prompt=system_prompt,
                model=CLAUDE_ASK_MODEL,
                max_tokens=2048,
                temperature=0.3,
                force_provider=provider if provider in ["claude", "openai"] else None
            ):
                yield token
                
        except Exception as e:
            # Last resort fallback to blocking mode
            print(f"⚠️  [Ask Mode] Both streaming providers failed, using blocking fallback: {e}")
            result = await handle_ask_mode(prompt, user, conversation, context)
            for char in result["message"]:
                yield char
                await asyncio.sleep(0.001)


async def handle_agent_mode_stream(prompt: str, workspace_path: Optional[str], user: UserAccount, conversation: Optional[Dict], context: Optional[Dict] = None) -> AsyncGenerator[str, None]:
    """Stream tokens from agent mode responses"""
    # For agent mode, generate full response then stream it
    result = await handle_agent_mode(prompt, workspace_path, user, conversation, context)
    message = result["message"]
    
    # Stream word by word
    words = message.split(' ')
    for i, word in enumerate(words):
        yield word + (' ' if i < len(words) - 1 else '')
        await asyncio.sleep(0.01)


async def _stream_infrastructure_question(prompt: str, conversation: Optional[Dict], provider: str = "claude", codebase_context: str = "", cloud_provider: str = "aws") -> AsyncGenerator[str, None]:
    """Stream LLM response token by token with user's provider preference or automatic failover"""
    print(f"🟢 [_stream_infrastructure_question] Received provider: {provider}, cloud_provider: {cloud_provider}")
    
    try:
        from app.config import CLAUDE_ASK_MODEL
        
        # Make system prompt provider-aware
        if cloud_provider == "digitalocean":
            provider_focus = "DigitalOcean"
            provider_examples = "DigitalOcean Droplets, Spaces, Managed Databases, DOKS (Kubernetes), Load Balancers, VPCs"
        else:
            provider_focus = "AWS"
            provider_examples = "EC2, S3, RDS, EKS, Lambda, CloudFront, VPCs"
        
        system_prompt = f"""You are an expert DevOps engineer and cloud architect specializing in {provider_focus}, and Terraform.

Your job is to explain infrastructure concepts clearly and concisely, like talking to a fellow engineer.

FOCUS: When discussing cloud resources, prioritize {provider_focus} services ({provider_examples}) unless the user specifically asks about another provider.

CRITICAL FILE ACCESS RULES:
- You HAVE DIRECT ACCESS to the user's codebase files through the context provided below
- When the user asks about files or code, you MUST use the file contents from the context
- NEVER say "I don't have access" or "I can't read files" - you DO have access via the context
- NEVER apologize for not having file access - the files are provided in the codebase context section
- If files are mentioned in the context below, show their contents directly using code blocks
- If the user asks about specific files that aren't in the context, you can ask them to specify which files they want to see

Guidelines:
- Use real-world examples relevant to {provider_focus}
- Mention best practices
- Include security considerations
- Suggest when to use vs not use
- Keep it practical and actionable
- Use markdown formatting for readability
- Do NOT use emojis in your responses
- When showing file contents, use code blocks with appropriate syntax highlighting

Be conversational but technical. Think of explaining to a smart colleague who's new to this specific topic."""
        
        # Add codebase context if available
        if codebase_context:
            system_prompt += f"\n\n{codebase_context}\n\nRemember: The files shown above are YOUR source of information. Use them directly when answering questions about the codebase."
        else:
            # Even if no context, make it clear we can access files if needed
            system_prompt += "\n\nNote: If the user asks about specific files in their codebase, you can access them. Ask the user which files they'd like to see if needed."

        # Build message history from conversation (if available - for instant streaming, this is None)
        messages = []
        if conversation:
            try:
                # The conversation dict already has messages from retrieve_conversation_thread
                conversation_messages = conversation.get("messages", [])
                # Take last 6 messages (3 exchanges) for context
                for msg in conversation_messages[-6:]:
                    role = "user" if msg["role"] == "user" else "assistant"
                    messages.append({
                        "role": role,
                        "content": msg["content"]
                    })
            except Exception as e:
                # Continue without history if there's an error
                pass
        
        # Add current prompt
        messages.append({"role": "user", "content": prompt})
        
        # Stream response with user's provider preference (or automatic failover if not specified)
        print(f"🟢 [_stream_infrastructure_question] Calling llm_failover_service with force_provider={provider}")
        async for token in llm_failover_service.stream_chat_completion(
            messages=messages,
            system_prompt=system_prompt,
            model=CLAUDE_ASK_MODEL,
            max_tokens=2000,
            temperature=0.7,
            force_provider=provider if provider in ["claude", "openai"] else None
        ):
            yield token
    
    except Exception as e:
        error_msg = str(e)
        if "overload" in error_msg.lower():
            yield f"⚠️  The selected AI provider is currently overloaded. Error: {error_msg}"
        else:
            yield f"Error: {error_msg}"


def _handle_infrastructure_question(prompt: str, conversation: Dict, combined_context_text: str = "") -> Dict:
    """Handle conceptual questions about infrastructure using Claude with conversation history"""
    try:
        from app.config import _anthropic_instance, CLAUDE_ASK_MODEL
        
        if not _anthropic_instance:
            return {
                "message": "Infrastructure questions require Claude API. Please configure ANTHROPIC_API_KEY.",
                "ir": None,
                "thinking": None
            }
        
        system_prompt = """You are an expert DevOps engineer and cloud architect specializing in AWS, DigitalOcean, and Terraform.
        
Your job is to explain infrastructure concepts clearly and concisely, like talking to a fellow engineer.

CRITICAL FILE ACCESS RULES:
- You HAVE DIRECT ACCESS to the user's codebase files through the context provided below
- When the user asks about files or code, you MUST use the file contents from the context
- NEVER say "I don't have access" or "I can't read files" - you DO have access via the context
- NEVER apologize for not having file access - the files are provided in the codebase context section
- If files are mentioned in the context below, show their contents directly using code blocks

Guidelines:
- Use conversation history to understand context (user may be asking follow-up questions)
- Use real-world examples
- Mention best practices
- Include security considerations
- Suggest when to use vs not use
- Keep it practical and actionable
- Use markdown formatting for readability
- Reference previous infrastructure mentioned in the conversation when relevant
- Do NOT use emojis in your responses

Be conversational but technical. Think of explaining to a smart colleague who's new to this specific topic."""
        
        # Inject codebase and conversation context if available
        if combined_context_text:
            system_prompt += f"\n\nCurrent Codebase and Conversation Context:\n{combined_context_text}\n\nRemember: The files shown above are YOUR source of information. Use them directly when answering questions about the codebase. Reference existing code patterns when explaining concepts."

        # Build message history from conversation
        messages = []
        if conversation:
            try:
                # The conversation dict already has messages from retrieve_conversation_thread
                conversation_messages = conversation.get("messages", [])
                # Take last 6 messages (3 exchanges) for context, excluding the current user message we just added
                for msg in conversation_messages[-7:-1]:  # Skip the last one (current prompt)
                    role = "user" if msg["role"] == "user" else "assistant"
                    messages.append({
                        "role": role,
                        "content": msg["content"]
                    })
            except Exception as e:
                # Continue without history if there's an error
                pass
        
        # Add current prompt
        messages.append({"role": "user", "content": prompt})
        
        response = _anthropic_instance.messages.create(
            model=CLAUDE_ASK_MODEL,  # Use Sonnet 4 for Ask mode
            max_tokens=2000,
            system=system_prompt,
            messages=messages,
            temperature=0.7,
        )
        
        explanation = ""
        for block in response.content:
            if hasattr(block, 'text'):
                explanation += block.text
        
        return {
            "message": explanation.strip(),
            "ir": None,
            "thinking": "Generated explanation using Claude with conversation context"
        }
    
    except Exception as e:
        return {
            "message": f"I can help explain infrastructure concepts, but encountered an error: {str(e)}",
            "ir": None,
            "thinking": None
        }


def determine_terraform_file_path(ops: List[Dict], workspace_path: Optional[str]) -> str:
    """
    Determine the best file path for Terraform code based on resources.
    Follows Cursor's logic of organizing files by resource category.
    """
    if not ops:
        return "main.tf"
    
    # Categorize resources
    resource_types = [op["selector"]["type"] for op in ops]
    
    # Networking resources
    networking_types = {"aws_vpc", "aws_subnet", "aws_internet_gateway", "aws_nat_gateway", "aws_route_table"}
    if any(rt in networking_types for rt in resource_types):
        return "networking.tf"
    
    # Storage resources
    storage_types = {"aws_s3_bucket", "aws_ebs_volume", "aws_efs_file_system"}
    if any(rt in storage_types for rt in resource_types):
        return "storage.tf"
    
    # Compute resources
    compute_types = {"aws_ec2_instance", "aws_autoscaling_group", "aws_launch_template"}
    if any(rt in compute_types for rt in resource_types):
        return "compute.tf"
    
    # Database resources
    database_types = {"aws_rds_instance", "aws_dynamodb_table", "aws_rds_cluster"}
    if any(rt in database_types for rt in resource_types):
        return "database.tf"
    
    # Lambda/Serverless
    serverless_types = {"aws_lambda_function", "aws_api_gateway_rest_api", "aws_apigatewayv2_api"}
    if any(rt in serverless_types for rt in resource_types):
        return "serverless.tf"
    
    # IAM resources
    iam_types = {"aws_iam_role", "aws_iam_policy", "aws_iam_user", "aws_iam_group"}
    if any(rt in iam_types for rt in resource_types):
        return "iam.tf"
    
    # Security resources
    security_types = {"aws_security_group", "aws_network_acl", "aws_waf_rule"}
    if any(rt in security_types for rt in resource_types):
        return "security.tf"
    
    # Default to main.tf
    return "main.tf"


def _generate_deep_resource_explanation(resource_type: str, resource_name: str, resource_config: dict = None, user_prompt: str = "", all_resources: list = None) -> Dict[str, str]:
    """Generate comprehensive, context-aware documentation for a resource based on its type and actual configuration."""
    
    # CONTEXT-AWARE ANALYSIS
    # Analyze the actual resource configuration to provide specific, not generic, documentation
    context_specific_info = {
        "purpose": "",
        "relationships": [],
        "security_notes": [],
        "cost_notes": []
    }
    
    if resource_config:
        attrs = resource_config.get("attributes", {})
        
        # Analyze purpose based on actual configuration
        if resource_type == "aws_s3_bucket":
            bucket_name = attrs.get("bucket", resource_name)
            context_specific_info["purpose"] = f"Storing data in bucket '{bucket_name}'"
            if "logging" in str(attrs).lower() or "log" in bucket_name.lower():
                context_specific_info["purpose"] += " - Used for log aggregation and storage"
            if "backup" in bucket_name.lower():
                context_specific_info["purpose"] += " - Used for backup storage"
        
        elif resource_type == "aws_instance":
            instance_type = attrs.get("instance_type", "unknown")
            ami = attrs.get("ami", "")
            context_specific_info["purpose"] = f"Running as {instance_type} instance"
            if "web" in resource_name.lower() or "http" in str(attrs).lower():
                context_specific_info["purpose"] += " - Serving web traffic"
            if "db" in resource_name.lower() or "database" in resource_name.lower():
                context_specific_info["purpose"] += " - Running database workload"
        
        elif resource_type == "aws_lambda_function":
            handler = attrs.get("handler", "")
            runtime = attrs.get("runtime", "")
            context_specific_info["purpose"] = f"Serverless function ({runtime})"
            if handler:
                context_specific_info["purpose"] += f" with handler: {handler}"
        
        elif resource_type == "aws_security_group":
            vpc_id = attrs.get("vpc_id", "")
            ingress = attrs.get("ingress", [])
            context_specific_info["purpose"] = f"Firewall rules for your VPC"
            if ingress:
                ports = [str(rule.get("from_port", "")) for rule in ingress if isinstance(rule, dict)]
                if ports:
                    context_specific_info["security_notes"].append(f"Allows inbound traffic on ports: {', '.join(ports)}")
    
    # Analyze relationships with other resources
    if all_resources:
        for other_res in all_resources:
            other_type = other_res.get("type", "")
            other_name = other_res.get("name", "")
            other_attrs = other_res.get("attributes", {})
            
            # Check if this resource references another
            if resource_config:
                config_str = str(resource_config)
                if f"{other_type}.{other_name}" in config_str:
                    context_specific_info["relationships"].append(f"References {other_type}.{other_name}")
            
            # Check if another resource references this one
            other_config_str = str(other_attrs)
            if f"{resource_type}.{resource_name}" in other_config_str:
                context_specific_info["relationships"].append(f"Used by {other_type}.{other_name}")
    
    # Analyze user prompt for intent
    if user_prompt:
        prompt_lower = user_prompt.lower()
        if "production" in prompt_lower or "prod" in prompt_lower:
            context_specific_info["security_notes"].append("⚠️ This is for PRODUCTION - ensure all security best practices are followed")
        if "test" in prompt_lower or "dev" in prompt_lower or "staging" in prompt_lower:
            context_specific_info["cost_notes"].append("💡 This is for testing/dev - consider using smaller/cheaper instances")
        if "secure" in prompt_lower or "encrypted" in prompt_lower:
            context_specific_info["security_notes"].append("🔒 Security is a priority - encryption and access controls are critical")
    
    # Common templates for different resource categories (with context injection)
    explanations = {
        # S3 Buckets
        "aws_s3_bucket": {
            "what": "An S3 (Simple Storage Service) bucket provides object storage with unlimited capacity. It can store and retrieve any amount of data at any time, from anywhere on the web.",
            "why": "S3 is fundamental for storing files, backups, logs, static website content, and data for analytics. It's one of the most commonly used AWS services.",
            "how": "S3 organizes data as objects within buckets. Each object consists of data, metadata, and a unique identifier (key). Data is automatically replicated across multiple availability zones for 99.999999999% (11 9's) durability.",
            "security": "- **Public access blocked by default** - Review bucket policies carefully\n- Enable versioning to protect against accidental deletions\n- Enable encryption at rest (AES-256 or KMS)\n- Use bucket policies and IAM roles to control access\n- Enable access logging for audit trails\n- Consider enabling MFA Delete for extra protection",
            "cost": "- **Storage costs** vary by storage class (Standard, IA, Glacier, etc.)\n- **Request costs** for PUT, GET, LIST operations\n- **Data transfer costs** for outbound data\n- **Typical cost**: ~$0.023/GB/month for Standard storage\n- Use lifecycle policies to automatically move old data to cheaper storage classes",
            "dependencies": "- No required dependencies (can be created standalone)\n- Often used with: CloudFront (CDN), Lambda (processing), IAM roles (access control)\n- May trigger: S3 event notifications → Lambda/SNS/SQS",
            "checklist": "- [ ] Bucket name is globally unique and follows DNS naming rules\n- [ ] Versioning enabled if you need to recover old versions\n- [ ] Encryption enabled (at rest and in transit)\n- [ ] Public access blocked unless specifically needed\n- [ ] Lifecycle policies configured for cost optimization\n- [ ] Access logging enabled for compliance\n- [ ] Replication configured if disaster recovery is needed"
        },
        
        "aws_s3_bucket_versioning": {
            "what": "S3 Versioning keeps multiple variants of an object in the same bucket. It allows you to preserve, retrieve, and restore every version of every object.",
            "why": "Versioning protects against accidental deletions and overwrites. It's essential for backup/recovery strategies and compliance requirements.",
            "how": "When enabled, S3 automatically assigns a unique version ID to each object. Deleting an object creates a 'delete marker' instead of permanently removing it. You can restore previous versions at any time.",
            "security": "- Consider enabling MFA Delete for extra protection on critical buckets\n- Version IDs are immutable and cannot be modified\n- Access controls apply to all versions\n- **Warning**: Storage costs increase as you keep more versions",
            "cost": "- You pay for storage of ALL versions (including old ones)\n- Delete markers don't incur storage costs\n- Use lifecycle policies to permanently delete old versions after X days\n- **Example**: 100GB file with 10 versions = 1TB storage cost",
            "dependencies": "- **Requires**: aws_s3_bucket (must reference bucket.id)\n- Works with: S3 Lifecycle rules, S3 Replication\n- Cannot be enabled on: buckets with object lock in governance mode",
            "checklist": "- [ ] Bucket exists before enabling versioning\n- [ ] Lifecycle policies configured to auto-delete old versions\n- [ ] Cost impact understood (paying for all versions)\n- [ ] MFA Delete considered for production buckets\n- [ ] Versioning state is 'Enabled' or 'Suspended' (cannot be fully disabled once enabled)"
        },
        
        "aws_s3_bucket_server_side_encryption_configuration": {
            "what": "Configures automatic server-side encryption for all objects stored in an S3 bucket. AWS encrypts your data at rest using industry-standard AES-256 or AWS KMS.",
            "why": "Encryption at rest is a security best practice and often required for compliance (HIPAA, PCI-DSS, GDPR). It protects data if physical storage is compromised.",
            "how": "S3 encrypts objects automatically before saving them to disk and decrypts them when you download. The encryption/decryption happens transparently - no code changes needed.",
            "security": "- **AES-256 (SSE-S3)**: AWS manages keys, simplest option, no extra cost\n- **KMS (SSE-KMS)**: You control keys via AWS KMS, audit trail, extra cost\n- **Customer-provided (SSE-C)**: You manage keys, most control, most complex\n- Encryption applies to new objects only - existing objects must be re-uploaded\n- Cannot be disabled once enabled",
            "cost": "- **SSE-S3 (AES-256)**: FREE - no additional cost\n- **SSE-KMS**: ~$0.03 per 10,000 requests + KMS key costs (~$1/month)\n- **Recommendation**: Use SSE-S3 unless you need key rotation/audit trails",
            "dependencies": "- **Requires**: aws_s3_bucket (must reference bucket.id)\n- Optional: AWS KMS key if using SSE-KMS\n- Works with: S3 bucket policies, IAM policies",
            "checklist": "- [ ] Bucket exists before configuring encryption\n- [ ] Choose AES-256 for free encryption or KMS for auditability\n- [ ] Understand that existing objects won't be encrypted automatically\n- [ ] Bucket policies don't deny encryption-related actions\n- [ ] For KMS: Ensure KMS key policy allows S3 service\n- [ ] Verify compliance requirements (some need KMS, not SSE-S3)"
        },
        
        # VPC
        "aws_vpc": {
            "what": "A Virtual Private Cloud (VPC) is your own isolated section of AWS cloud where you can launch AWS resources in a virtual network that you define.",
            "why": "VPCs provide network isolation, security, and control. They're required for most AWS services like EC2, RDS, EKS, and Lambda (in VPC mode).",
            "how": "A VPC spans all availability zones in a region. You define the IP address range (CIDR block), create subnets, configure route tables, and set up internet/NAT gateways for connectivity.",
            "security": "- VPCs are isolated by default - no communication between VPCs without explicit peering\n- Use security groups (stateful) and NACLs (stateless) for traffic control\n- Enable VPC Flow Logs to monitor traffic for security analysis\n- Never use default VPC for production workloads",
            "cost": "- **VPC itself**: FREE\n- **Cost drivers**: NAT Gateways (~$32/month + data), VPN connections (~$36/month), VPC Endpoints (~$7/month)\n- **Tip**: Use VPC endpoints instead of NAT Gateways for AWS service access (cheaper)",
            "dependencies": "- No required dependencies (foundation resource)\n- Required by: Subnets, Route Tables, Internet Gateways, Security Groups, EC2, RDS, EKS, etc.\n- Often paired with: VPC Peering, Transit Gateway, Direct Connect",
            "checklist": "- [ ] CIDR block doesn't overlap with other VPCs or on-premises networks\n- [ ] CIDR is large enough for growth (but not unnecessarily large)\n- [ ] DNS hostnames and DNS resolution enabled (usually needed)\n- [ ] Flow logs enabled for security monitoring\n- [ ] Separate VPCs for prod/staging/dev or single VPC with isolated subnets"
        },
        
        "aws_subnet": {
            "what": "A subnet is a range of IP addresses in your VPC. You can launch AWS resources into a subnet of your choosing.",
            "why": "Subnets allow you to segment your VPC for security, routing, and resource placement across availability zones.",
            "how": "Each subnet is tied to one availability zone. Resources in the subnet use IPs from the subnet's CIDR range. Route tables control traffic flow. Public subnets have routes to Internet Gateway, private subnets don't.",
            "security": "- **Public subnets**: Have route to Internet Gateway (0.0.0.0/0 → IGW)\n- **Private subnets**: No direct internet access, use NAT Gateway for outbound\n- Use NACLs for subnet-level firewall rules\n- Best practice: Put databases in private subnets, web servers in public",
            "cost": "- **Subnets**: FREE\n- **Cost impact**: NAT Gateway in public subnet for private subnet internet access (~$32/month + data)\n- **Tip**: Use single NAT Gateway shared across AZs for dev/staging (not prod)",
            "dependencies": "- **Requires**: aws_vpc (must specify vpc_id)\n- Often requires: aws_route_table, aws_internet_gateway (for public), aws_nat_gateway (for private)\n- Used by: EC2, RDS, Lambda, ALB, etc.",
            "checklist": "- [ ] CIDR block is within VPC CIDR range\n- [ ] Each subnet in different AZ for high availability\n- [ ] Public subnets have map_public_ip_on_launch = true\n- [ ] Private subnets have route to NAT Gateway (not Internet Gateway)\n- [ ] Subnet sizes account for AWS reserved IPs (first 4 + last 1)\n- [ ] Proper tagging for EKS/ECS subnet discovery"
        },
        
        # EC2
        "aws_instance": {
            "what": "An EC2 (Elastic Compute Cloud) instance is a virtual server in AWS. It provides scalable computing capacity in the cloud.",
            "why": "EC2 instances run applications, host websites, process data, and serve as general-purpose compute resources. They're the backbone of AWS infrastructure.",
            "how": "AWS launches a virtual machine with your chosen OS, CPU, memory, and storage. You have full root/admin access. Instances can be started, stopped, and terminated on demand.",
            "security": "- Use security groups to control inbound/outbound traffic\n- Disable password auth, use SSH keys only\n- Keep AMI and packages updated\n- Use IAM instance profiles instead of embedding credentials\n- Enable detailed monitoring and CloudWatch logs\n- Use AWS Systems Manager for patch management",
            "cost": "- **On-Demand**: Pay per second (~$0.0116/hr for t3.micro)\n- **Reserved Instances**: Up to 75% savings for 1-3 year commitments\n- **Spot Instances**: Up to 90% savings but can be terminated\n- **Savings Plans**: Flexible pricing for compute usage\n- Don't forget: EBS storage, data transfer, elastic IPs",
            "dependencies": "- **Requires**: aws_subnet (for VPC placement), aws_security_group\n- Recommended: aws_key_pair (SSH access), aws_iam_instance_profile\n- Often uses: aws_ebs_volume, aws_network_interface",
            "checklist": "- [ ] Instance type matches workload (CPU/memory/network)\n- [ ] Security group allows only necessary ports\n- [ ] SSH key pair configured for access\n- [ ] Subnet is in correct AZ and VPC\n- [ ] User data script tested (if used)\n- [ ] Monitoring and logging enabled\n- [ ] Termination protection enabled for production"
        },
        
        "aws_security_group": {
            "what": "Security groups act as virtual firewalls controlling inbound and outbound traffic for AWS resources (EC2, RDS, etc.).",
            "why": "Security groups are the primary network access control mechanism in AWS. They protect resources from unauthorized access.",
            "how": "Security groups are stateful - if you allow inbound traffic, the response is automatically allowed outbound. Rules specify protocol, port range, and source/destination.",
            "security": "- **Default behavior**: All outbound allowed, all inbound denied\n- Follow least privilege - only open required ports\n- Use CIDR ranges carefully (0.0.0.0/0 = entire internet)\n- Reference other security groups instead of IPs when possible\n- Separate security groups by function (web, db, app)\n- Never open SSH (22) or RDP (3389) to 0.0.0.0/0",
            "cost": "- Security groups are **FREE**\n- No limit on number of rules or groups",
            "dependencies": "- **Requires**: aws_vpc\n- Used by: EC2, RDS, ELB, Lambda (VPC), ECS, etc.",
            "checklist": "- [ ] Only necessary ports are open\n- [ ] Source IPs are restricted (not 0.0.0.0/0 unless public)\n- [ ] Separate security groups for different tiers (web/app/db)\n- [ ] Description field filled out for all rules\n- [ ] No circular dependencies between security groups\n- [ ] Egress rules reviewed (default allows all outbound)"
        },
        
        # RDS
        "aws_db_instance": {
            "what": "RDS (Relational Database Service) provides managed database instances. AWS handles backups, patching, replication, and scaling.",
            "why": "RDS eliminates database administration overhead. It provides high availability, automated backups, and easy scaling for MySQL, PostgreSQL, Oracle, SQL Server, and MariaDB.",
            "how": "AWS runs the database engine on EC2 instances with managed storage (EBS). You connect via standard database protocols. AWS handles OS updates, backups, and monitoring.",
            "security": "- **CRITICAL**: Place in private subnets, never public\n- Use security groups to restrict access to app tier only\n- Enable encryption at rest (KMS) and in transit (SSL/TLS)\n- Use IAM database authentication when possible\n- Enable automated backups (retention 7-35 days)\n- Enable deletion protection for production\n- Rotate master password regularly",
            "cost": "- **Instance cost**: Varies by size (~$0.017/hr for db.t3.micro)\n- **Storage cost**: ~$0.115/GB/month for gp2, ~$0.20/GB for io1\n- **Backup storage**: Free up to DB size, then ~$0.095/GB/month\n- **Data transfer**: Outbound data charges apply\n- **Multi-AZ**: Doubles instance cost but provides HA",
            "dependencies": "- **Requires**: aws_db_subnet_group (2+ subnets in different AZs)\n- Recommended: aws_security_group, aws_kms_key (encryption)\n- Often uses: aws_db_parameter_group, aws_db_option_group",
            "checklist": "- [ ] Instance class appropriate for workload\n- [ ] Multi-AZ enabled for production\n- [ ] Automated backups enabled with sufficient retention\n- [ ] Encryption at rest enabled\n- [ ] Database in private subnet\n- [ ] Security group allows access only from app tier\n- [ ] Parameter group configured for performance\n- [ ] Deletion protection enabled for production\n- [ ] Monitoring and Performance Insights enabled"
        },
        
        # Lambda
        "aws_lambda_function": {
            "what": "AWS Lambda runs code without provisioning servers. It executes your code only when triggered and scales automatically.",
            "why": "Lambda is perfect for event-driven architectures, APIs, data processing, and automation. You only pay for compute time used (not idle time).",
            "how": "Upload code (or container image), set triggers (API Gateway, S3, EventBridge, etc.), and Lambda executes. It auto-scales from zero to thousands of concurrent executions.",
            "security": "- Use IAM roles (execution role) for AWS service access\n- Never embed credentials in code or environment variables\n- Use VPC mode for private resource access (adds cold start latency)\n- Enable CloudWatch Logs for monitoring\n- Use Lambda layers for shared dependencies\n- Set appropriate timeout and memory limits",
            "cost": "- **FREE TIER**: 1M requests + 400,000 GB-seconds per month\n- **Requests**: $0.20 per 1M requests\n- **Compute**: $0.0000166667 per GB-second\n- **Example**: 128MB function running 1M times for 100ms = ~$0.20/month\n- **Tip**: Right-size memory - more memory = faster execution = lower cost",
            "dependencies": "- **Requires**: aws_iam_role (execution role with Lambda trust policy)\n- Optional: aws_lambda_layer_version, aws_vpc (if accessing VPC resources)\n- Common triggers: aws_api_gateway, aws_s3_bucket, aws_cloudwatch_event_rule",
            "checklist": "- [ ] IAM execution role has minimum required permissions\n- [ ] Timeout set appropriately (default 3s, max 15 minutes)\n- [ ] Memory allocated correctly (128MB-10GB)\n- [ ] Environment variables don't contain secrets (use Secrets Manager)\n- [ ] Dead letter queue configured for failed invocations\n- [ ] Reserved concurrency set if needed to prevent throttling\n- [ ] X-Ray tracing enabled for debugging\n- [ ] CloudWatch Logs retention configured"
        },
        
        # IAM
        "aws_iam_role": {
            "what": "IAM roles define permissions that AWS services or users can assume. They provide temporary credentials for secure access.",
            "why": "Roles eliminate the need to embed long-term credentials. They're essential for EC2 instances, Lambda functions, and cross-account access.",
            "how": "A role has two parts: 1) Trust policy (who can assume it), 2) Permission policies (what they can do). AWS services like EC2 or Lambda assume roles to get temporary credentials.",
            "security": "- Follow least privilege - grant only necessary permissions\n- Use managed policies when possible (AWS-maintained)\n- Regularly audit role usage with IAM Access Analyzer\n- Set maximum session duration appropriately\n- Avoid wildcard (*) permissions except for deny policies\n- Use condition keys to restrict access (IP, MFA, time)\n- Review trust policies - limit who can assume the role",
            "cost": "- IAM roles are **FREE** (no charges for roles or policies)",
            "dependencies": "- No required dependencies (standalone resource)\n- Often paired with: aws_iam_policy, aws_iam_role_policy_attachment\n- Used by: EC2, Lambda, ECS, EKS, etc.",
            "checklist": "- [ ] Trust policy correctly specifies who can assume the role\n- [ ] Permissions follow least privilege principle\n- [ ] Role name is descriptive and follows naming conventions\n- [ ] Maximum session duration is appropriate\n- [ ] Role has description for documentation\n- [ ] Tags applied for cost allocation and organization\n- [ ] No inline policies (use attachments for better management)"
        },
        
        # Load Balancers
        "aws_lb": {
            "what": "Application Load Balancer (ALB) distributes incoming HTTP/HTTPS traffic across multiple targets (EC2, containers, IPs). Operates at Layer 7.",
            "why": "ALBs provide high availability, auto-scaling, SSL termination, and advanced routing. They're essential for production web applications.",
            "how": "Traffic hits the ALB, which uses listeners and rules to route requests to target groups. Health checks ensure traffic only goes to healthy targets. ALB spans multiple AZs automatically.",
            "security": "- Use HTTPS listeners with valid SSL certificates (ACM)\n- Enable access logs to S3 for audit trails\n- Use security groups to control inbound traffic\n- Enable deletion protection for production\n- Consider AWS WAF for web application firewall protection\n- Use target group health checks\n- Drop invalid headers (security setting)",
            "cost": "- **Fixed cost**: ~$0.0225/hour (~$16/month)\n- **LCU cost**: $0.008 per LCU-hour (Load Balancer Capacity Unit)\n- **Data processing**: Varies by usage\n- **Typical cost**: $20-50/month for small applications\n- **Tip**: One ALB can route to many target groups (shared cost)",
            "dependencies": "- **Requires**: aws_subnet (2+ in different AZs), aws_security_group\n- Often uses: aws_lb_target_group, aws_lb_listener, aws_acm_certificate\n- Targets: EC2, ECS, Lambda, IP addresses",
            "checklist": "- [ ] Subnets in at least 2 availability zones\n- [ ] Security group allows HTTP/HTTPS from appropriate sources\n- [ ] HTTPS listener configured with valid certificate\n- [ ] Target groups have health checks configured\n- [ ] Access logs enabled to S3\n- [ ] Deletion protection enabled for production\n- [ ] Idle timeout set appropriately (default 60s)\n- [ ] Tags applied for cost allocation"
        },
        
        # DynamoDB
        "aws_dynamodb_table": {
            "what": "DynamoDB is a fully managed NoSQL database providing single-digit millisecond latency at any scale. It's serverless with automatic scaling.",
            "why": "Perfect for high-traffic applications, gaming leaderboards, IoT data, session storage, and any workload requiring consistent performance at scale.",
            "how": "DynamoDB stores data as items (rows) in tables. Each item has a partition key (and optional sort key). It auto-scales capacity and replicates across 3 AZs.",
            "security": "- Use IAM policies for fine-grained access control\n- Enable encryption at rest (KMS) - enabled by default\n- Enable point-in-time recovery for production tables\n- Use VPC endpoints to keep traffic off internet\n- Enable CloudWatch Contributor Insights\n- Use DynamoDB Streams for audit logs\n- Implement row-level security in application code",
            "cost": "- **On-Demand**: $1.25 per million write units, $0.25 per million read units\n- **Provisioned**: $0.00065/hr per WCU, $0.00013/hr per RCU (cheaper at scale)\n- **Storage**: $0.25/GB/month\n- **Backups**: $0.10/GB/month for on-demand backups\n- **Example**: 1M reads + 1M writes per month = ~$1.50 (on-demand)\n- **Tip**: Use provisioned capacity for predictable workloads",
            "dependencies": "- No required dependencies (serverless)\n- Often paired with: aws_dynamodb_global_table, aws_appautoscaling_target\n- Common use with: Lambda, API Gateway, AppSync",
            "checklist": "- [ ] Partition key chosen for even distribution\n- [ ] Billing mode (on-demand vs provisioned) matches workload\n- [ ] Point-in-time recovery enabled for production\n- [ ] Global tables configured if multi-region needed\n- [ ] DynamoDB Streams enabled if using CDC patterns\n- [ ] Auto-scaling configured (if provisioned mode)\n- [ ] CloudWatch alarms for throttling\n- [ ] Backup plan configured"
        },
        
        # Route 53
        "aws_route53_zone": {
            "what": "Route 53 is AWS's DNS service. A hosted zone contains DNS records for your domain (like example.com).",
            "why": "Route 53 provides highly available DNS, health checks, traffic routing policies, and integrates seamlessly with AWS services.",
            "how": "Create a hosted zone, add DNS records (A, CNAME, MX, etc.), and point your domain's nameservers to AWS. Route 53 responds to DNS queries globally.",
            "security": "- Enable DNSSEC for domain integrity\n- Use Route 53 Resolver for VPC DNS\n- Implement health checks for failover\n- Use private hosted zones for internal DNS\n- Audit DNS changes with CloudTrail\n- Protect against DNS hijacking with registrar lock",
            "cost": "- **Hosted zone**: $0.50/month per zone\n- **Queries**: $0.40 per million queries (first billion)\n- **Health checks**: $0.50/month per endpoint\n- **Example**: Small site with 10M queries = $0.50 + $4 = $4.50/month",
            "dependencies": "- No required dependencies\n- Often used with: aws_route53_record, aws_lb, aws_cloudfront_distribution",
            "checklist": "- [ ] Zone type correct (public vs private)\n- [ ] Nameservers updated at domain registrar\n- [ ] TTL values set appropriately\n- [ ] Health checks configured for critical records\n- [ ] Geolocation/latency routing configured if needed\n- [ ] DNSSEC enabled for security\n- [ ] CloudWatch alarms for health check failures"
        },
        
        # Networking
        "aws_internet_gateway": {
            "what": "An Internet Gateway (IGW) enables communication between resources in your VPC and the internet.",
            "why": "IGW is required for public subnets to access the internet and for internet users to access your public resources.",
            "how": "Attach IGW to VPC, add route (0.0.0.0/0 → IGW) to public subnet route tables. Resources with public IPs can then access internet.",
            "security": "- Only attach to route tables for public subnets\n- Use security groups to control what can accept inbound traffic\n- IGW itself doesn't filter traffic - use NACLs/security groups\n- Monitor VPC Flow Logs for suspicious activity",
            "cost": "- Internet Gateways are **FREE**\n- You only pay for data transfer out ($0.09/GB after free tier)",
            "dependencies": "- **Requires**: aws_vpc\n- Used by: Public subnets (via aws_route_table)\n- Alternative for private subnets: aws_nat_gateway",
            "checklist": "- [ ] IGW attached to correct VPC\n- [ ] Route tables for public subnets have IGW route\n- [ ] Resources in public subnets have public IPs\n- [ ] Security groups configured correctly\n- [ ] VPC Flow Logs enabled for monitoring"
        },
        
        "aws_nat_gateway": {
            "what": "NAT Gateway allows instances in private subnets to access the internet while remaining inaccessible from the internet.",
            "why": "Private subnets (databases, app servers) often need outbound internet access for updates, APIs, etc., but shouldn't be directly accessible.",
            "how": "Place NAT Gateway in public subnet with Elastic IP. Private subnet route tables point 0.0.0.0/0 to NAT Gateway. NAT Gateway forwards traffic to Internet Gateway.",
            "security": "- NAT Gateway only allows outbound connections\n- Cannot be used to initiate inbound connections to private instances\n- Use security groups on private instances to further restrict traffic\n- Consider VPC endpoints instead of NAT for AWS services (cheaper)",
            "cost": "- **Hourly charge**: ~$0.045/hour (~$32/month)\n- **Data processing**: $0.045/GB processed\n- **Example**: NAT + 100GB = $32 + $4.50 = $36.50/month\n- **Cost savings**: Use VPC endpoints for AWS services (S3, DynamoDB) to avoid NAT costs",
            "dependencies": "- **Requires**: aws_subnet (public subnet), aws_eip\n- Often paired with: aws_route_table (for private subnets)\n- Alternative: VPC endpoints (for AWS services)",
            "checklist": "- [ ] NAT Gateway in public subnet (with IGW route)\n- [ ] Elastic IP allocated and associated\n- [ ] Private subnet route tables point to NAT Gateway\n- [ ] High availability: One NAT Gateway per AZ for production\n- [ ] CloudWatch alarms for connection errors\n- [ ] Consider VPC endpoints to reduce NAT costs"
        },
        
        "aws_route_table": {
            "what": "Route tables control where network traffic is directed within your VPC. Each subnet must be associated with a route table.",
            "why": "Route tables define whether a subnet is public (routes to IGW) or private (routes to NAT or stays internal).",
            "how": "Routes specify destination CIDR and target (IGW, NAT, VPC peering, etc.). Most specific route wins. Default route (0.0.0.0/0) directs internet traffic.",
            "security": "- Minimize route table complexity\n- Avoid overly permissive routes\n- Use separate route tables for public/private subnets\n- Enable VPC Flow Logs to monitor routing\n- Review routes regularly for unnecessary entries",
            "cost": "- Route tables are **FREE**\n- No limit on number of route tables or routes",
            "dependencies": "- **Requires**: aws_vpc\n- Often references: aws_internet_gateway, aws_nat_gateway, aws_vpc_peering_connection\n- Associated with: aws_subnet",
            "checklist": "- [ ] Public subnets have route to Internet Gateway\n- [ ] Private subnets have route to NAT Gateway (if needed)\n- [ ] No unintended routes to public internet\n- [ ] Subnet associations are correct\n- [ ] Routes are documented (especially custom routes)\n- [ ] Propagated routes verified (if using VPN/Direct Connect)"
        },
        
        # ECS/EKS
        "aws_ecs_cluster": {
            "what": "ECS (Elastic Container Service) cluster is a logical grouping of EC2 instances or Fargate capacity for running containers.",
            "why": "ECS orchestrates Docker containers, handling deployment, scaling, and load balancing. It's simpler than Kubernetes for AWS-native workloads.",
            "how": "Create cluster, define task definitions (container specs), create services to maintain desired task count. ECS schedules containers on available capacity.",
            "security": "- Use task IAM roles for container permissions (not instance roles)\n- Use Fargate for better isolation (no EC2 management)\n- Enable container insights for monitoring\n- Use Secrets Manager for sensitive data (not env vars)\n- Scan container images for vulnerabilities\n- Use VPC mode (not bridge) for networking",
            "cost": "- **Cluster itself**: FREE\n- **Fargate**: $0.04048/vCPU/hour + $0.004445/GB/hour\n- **EC2 mode**: Pay for EC2 instances\n- **Example**: Fargate 0.25vCPU + 0.5GB = ~$7/month per container",
            "dependencies": "- No required dependencies for cluster itself\n- Services require: aws_ecs_task_definition, aws_iam_role\n- Often uses: aws_lb_target_group, aws_service_discovery_service",
            "checklist": "- [ ] Cluster name follows naming conventions\n- [ ] Container Insights enabled\n- [ ] Capacity provider strategy configured\n- [ ] Service discovery namespace configured (if using)\n- [ ] CloudWatch log groups created\n- [ ] Task execution role has necessary permissions"
        },
        
        # API Gateway
        "aws_api_gateway_rest_api": {
            "what": "API Gateway creates RESTful APIs that expose HTTP endpoints to trigger Lambda functions, access other AWS services, or proxy to backend services.",
            "why": "API Gateway provides authentication, rate limiting, caching, and request transformation. It's the standard way to create serverless APIs.",
            "how": "Define resources (/users, /items), methods (GET, POST), and integrations (Lambda, HTTP). Deploy to stages (dev, prod). API Gateway handles scaling automatically.",
            "security": "- Use API keys for simple authentication (not production)\n- Implement Cognito authorizers or Lambda authorizers for production\n- Enable CloudWatch logging\n- Use AWS WAF for DDoS protection\n- Implement rate limiting (throttling)\n- Validate request parameters\n- Use private API endpoints for internal APIs",
            "cost": "- **REST API**: $3.50 per million requests\n- **HTTP API**: $1.00 per million requests (cheaper, fewer features)\n- **WebSocket API**: $1.00 per million messages\n- **Data transfer**: $0.09/GB outbound\n- **Caching**: $0.02/hour per GB (optional)",
            "dependencies": "- No required dependencies for API itself\n- Often uses: aws_lambda_function, aws_lambda_permission, aws_api_gateway_deployment\n- May use: aws_acm_certificate (custom domain)",
            "checklist": "- [ ] API name is descriptive\n- [ ] Authentication/authorization configured\n- [ ] Rate limiting (throttling) enabled\n- [ ] CloudWatch logging enabled\n- [ ] CORS configured if needed for web apps\n- [ ] Custom domain configured with SSL\n- [ ] API deployed to appropriate stage\n- [ ] Request validation enabled"
        },
        
        # SNS
        "aws_sns_topic": {
            "what": "SNS (Simple Notification Service) is a pub/sub messaging service that sends notifications to multiple subscribers (email, SMS, Lambda, SQS, etc.).",
            "why": "SNS decouples publishers from subscribers, enabling fan-out patterns. Perfect for alerts, notifications, and event-driven architectures.",
            "how": "Publishers send messages to topics. Subscribers receive messages in their preferred format (push). One message can trigger multiple actions simultaneously.",
            "security": "- Use IAM policies to control who can publish/subscribe\n- Enable encryption at rest (KMS)\n- Use VPC endpoints to keep traffic private\n- Validate message signatures for HTTP/S subscriptions\n- Use topic policies for cross-account access\n- Enable CloudTrail logging",
            "cost": "- **Publishes**: $0.50 per million (after 1M free)\n- **HTTP/S delivery**: FREE\n- **Email/SMS**: $0.75 per 100k (email), varies (SMS)\n- **Mobile push**: $0.50 per million\n- **Example**: 10M notifications = $5",
            "dependencies": "- No required dependencies\n- Often triggers: Lambda, SQS, HTTP endpoints\n- Used by: CloudWatch alarms, S3 events, RDS events",
            "checklist": "- [ ] Topic name is descriptive\n- [ ] Subscriptions confirmed (email requires confirmation)\n- [ ] Encryption enabled if handling sensitive data\n- [ ] Delivery policy configured for retries\n- [ ] Dead letter queue configured for failed messages\n- [ ] CloudWatch alarms for failed deliveries\n- [ ] Tags applied for cost tracking"
        },
        
        # SQS
        "aws_sqs_queue": {
            "what": "SQS (Simple Queue Service) is a fully managed message queue for decoupling application components. Messages wait in queue until processed.",
            "why": "SQS buffers requests between components, handles traffic spikes, and ensures reliable message delivery. Perfect for async processing.",
            "how": "Producers send messages to queue. Consumers poll queue, process messages, then delete them. SQS handles scaling, retries, and reliability automatically.",
            "security": "- Use IAM policies for access control\n- Enable encryption at rest (KMS) and in transit (HTTPS)\n- Use queue policies for cross-account access\n- Set visibility timeout to prevent duplicate processing\n- Use dead letter queues for poison messages\n- Enable CloudTrail logging",
            "cost": "- **Standard queue**: $0.40 per million requests (after 1M free)\n- **FIFO queue**: $0.50 per million requests\n- **Data transfer**: FREE within AWS\n- **Example**: 10M messages = $4 (Standard) or $5 (FIFO)",
            "dependencies": "- No required dependencies\n- Often used with: Lambda (polling), EC2, ECS\n- Dead letter queue: Another aws_sqs_queue",
            "checklist": "- [ ] Queue type correct (Standard vs FIFO)\n- [ ] Visibility timeout matches processing time\n- [ ] Message retention set appropriately (1 min - 14 days)\n- [ ] Dead letter queue configured\n- [ ] Encryption enabled if handling sensitive data\n- [ ] CloudWatch alarms for queue depth\n- [ ] Consider Redrive policy (DLQ max receives)"
        },
        
        # CloudFront
        "aws_cloudfront_distribution": {
            "what": "CloudFront is AWS's CDN (Content Delivery Network) that caches content at edge locations worldwide for faster delivery to users.",
            "why": "CloudFront reduces latency, improves performance, reduces origin load, and protects against DDoS. Essential for global applications.",
            "how": "Users request content → CloudFront edge location serves cached copy (if available) or fetches from origin (S3, ALB, custom). Content cached based on TTL.",
            "security": "- Use HTTPS only (redirect HTTP to HTTPS)\n- Use signed URLs/cookies for private content\n- Enable AWS WAF for DDoS and application protection\n- Use Origin Access Identity (OAI) for S3 origins\n- Enable access logging to S3\n- Configure security headers (HSTS, CSP)\n- Use field-level encryption for sensitive data",
            "cost": "- **Data transfer out**: $0.085/GB (first 10TB, decreases with volume)\n- **HTTP/HTTPS requests**: $0.0075-$0.016 per 10,000\n- **Invalidations**: First 1,000/month free, then $0.005 per path\n- **Example**: 1TB transfer + 10M requests = ~$85-100/month\n- **Tip**: Use versioned filenames instead of invalidations (free)",
            "dependencies": "- **Requires**: Origin (S3, ALB, custom HTTP/S)\n- Recommended: aws_acm_certificate (custom domain), aws_s3_bucket (logs)\n- Often uses: aws_waf_web_acl, aws_lambda_function (Lambda@Edge)",
            "checklist": "- [ ] Origin configured correctly (S3 or HTTP/S)\n- [ ] HTTPS enabled with valid certificate\n- [ ] Cache behaviors configured for optimal performance\n- [ ] TTL values set appropriately\n- [ ] Logging enabled to S3\n- [ ] Geo-restriction configured if needed\n- [ ] Price class selected (All, 200, 100 edge locations)\n- [ ] Default root object set (index.html)"
        },
        
        # ElastiCache
        "aws_elasticache_cluster": {
            "what": "ElastiCache provides managed in-memory caching with Redis or Memcached. Sub-millisecond latency for frequently accessed data.",
            "why": "Caching reduces database load, improves response times, and lowers costs. Common for session storage, leaderboards, and query caching.",
            "how": "Applications read/write to ElastiCache instead of database for hot data. Cache miss falls back to database. AWS manages scaling, patching, backups.",
            "security": "- **CRITICAL**: Place in private subnets only\n- Use security groups to restrict access\n- Enable encryption at rest (Redis only)\n- Enable encryption in transit (Redis AUTH required)\n- Use Redis AUTH or IAM auth for access control\n- No default encryption for Memcached\n- Enable CloudWatch metrics",
            "cost": "- **Instance cost**: ~$0.017/hr for cache.t3.micro (Redis/Memcached)\n- **Backup storage**: $0.085/GB/month (Redis only)\n- **Data transfer**: Inbound free, outbound $0.09/GB\n- **Example**: cache.r6g.large (13.5GB) = ~$122/month",
            "dependencies": "- **Requires**: aws_elasticache_subnet_group (2+ subnets)\n- Recommended: aws_security_group, aws_kms_key\n- Used by: Application tier (EC2, ECS, Lambda)",
            "checklist": "- [ ] Engine (Redis vs Memcached) matches use case\n- [ ] Node type sized for memory requirements\n- [ ] Multi-AZ enabled for Redis (high availability)\n- [ ] Automatic backups enabled (Redis)\n- [ ] Cluster in private subnets\n- [ ] Security group restricts access to app tier\n- [ ] Encryption enabled (Redis)\n- [ ] Parameter group optimized for workload"
        },
        
        # EKS
        "aws_eks_cluster": {
            "what": "EKS (Elastic Kubernetes Service) is a managed Kubernetes service. AWS runs the control plane while you manage worker nodes.",
            "why": "Kubernetes for container orchestration. Perfect for microservices, batch processing, and complex containerized applications.",
            "how": "EKS runs the K8s control plane (API, etcd, scheduler). You provision worker nodes (EC2 or Fargate) that join the cluster. Deploy apps with kubectl/Helm.",
            "security": "- Enable K8s RBAC for access control\n- Use IAM roles for service accounts (IRSA)\n- Enable cluster endpoint private access\n- Use pod security policies/standards\n- Enable control plane logging to CloudWatch\n- Scan container images for vulnerabilities\n- Use network policies for pod-to-pod security\n- Enable envelope encryption for secrets (KMS)",
            "cost": "- **Control plane**: $0.10/hour (~$73/month per cluster)\n- **Worker nodes**: EC2 pricing (varies by instance type)\n- **Fargate**: $0.04048/vCPU/hour + $0.004445/GB/hour\n- **Data transfer**: Standard AWS rates\n- **Example**: Control plane + 3 t3.medium nodes = ~$150/month",
            "dependencies": "- **Requires**: aws_subnet (2+ in different AZs), aws_iam_role\n- Recommended: aws_security_group, aws_eks_node_group\n- Often uses: aws_lb_controller, aws_ebs_csi_driver",
            "checklist": "- [ ] Kubernetes version supported and up-to-date\n- [ ] Subnets in at least 2 AZs\n- [ ] IAM role has correct trust policy\n- [ ] Security groups configured correctly\n- [ ] Control plane logging enabled\n- [ ] Encryption enabled for secrets\n- [ ] Node groups configured with auto-scaling\n- [ ] VPC CNI add-on installed"
        },
        
        # ACM
        "aws_acm_certificate": {
            "what": "ACM (AWS Certificate Manager) provides free SSL/TLS certificates for securing web applications. Handles renewals automatically.",
            "why": "HTTPS is essential for security and SEO. ACM makes SSL certificate management effortless and free.",
            "how": "Request certificate, verify domain ownership (DNS or email), ACM issues and auto-renews it. Use with ALB, CloudFront, API Gateway.",
            "security": "- Certificates auto-renew 60 days before expiration\n- Use DNS validation (not email) for automation\n- Request certificates in us-east-1 for CloudFront\n- Enable Certificate Transparency logging\n- Cannot export private keys (AWS-managed)\n- Use multiple domain names in single certificate (SAN)",
            "cost": "- ACM certificates are **FREE** for AWS services\n- No cost for renewals or issuance\n- Unlimited certificates",
            "dependencies": "- **Requires**: Domain ownership verification\n- Used by: aws_lb, aws_cloudfront_distribution, aws_api_gateway\n- Often uses: aws_route53_record (DNS validation)",
            "checklist": "- [ ] Certificate requested in correct region (us-east-1 for CloudFront)\n- [ ] Validation method is DNS (not email)\n- [ ] Route 53 validation records created\n- [ ] Certificate status is ISSUED\n- [ ] All necessary domain names included (wildcards if needed)\n- [ ] Certificate applied to load balancer/distribution"
        },
        
        # CloudWatch
        "aws_cloudwatch_log_group": {
            "what": "CloudWatch Logs stores, monitors, and analyzes log data from AWS services and applications. Centralized logging solution.",
            "why": "Centralized logs enable debugging, monitoring, compliance, and security analysis. Essential for production applications.",
            "how": "Services send logs to CloudWatch. You can search, filter, create metrics, set alarms, and analyze patterns. Logs stream in real-time.",
            "security": "- Enable encryption with KMS for sensitive logs\n- Use IAM policies to control access\n- Set retention period appropriately (1 day - 10 years)\n- Export to S3 for long-term archival\n- Use VPC endpoints to keep traffic private\n- Enable CloudTrail to audit log access",
            "cost": "- **Ingestion**: $0.50/GB\n- **Storage**: $0.03/GB/month\n- **Data scanned**: $0.005/GB (Insights queries)\n- **Example**: 10GB/day = $150/month ingestion + $9/month storage\n- **Tip**: Set retention to 7-30 days to control costs",
            "dependencies": "- No required dependencies\n- Used by: Lambda, EC2, ECS, API Gateway, VPC Flow Logs\n- Often paired with: aws_cloudwatch_log_stream, aws_cloudwatch_metric_alarm",
            "checklist": "- [ ] Retention period set appropriately (not never expire)\n- [ ] Encryption enabled for sensitive data\n- [ ] Log group name follows naming convention\n- [ ] Subscription filters configured if needed\n- [ ] CloudWatch Insights enabled\n- [ ] Cost alarms configured\n- [ ] Tags applied for organization"
        },
        
        # Secrets Manager
        "aws_secretsmanager_secret": {
            "what": "Secrets Manager securely stores and rotates secrets (passwords, API keys, tokens). Automatic rotation for RDS/Redshift/DocumentDB.",
            "why": "Never hardcode secrets in code or env vars. Secrets Manager provides secure storage, rotation, and audit trails.",
            "how": "Store secret, applications retrieve it via API/SDK, Secrets Manager can auto-rotate it periodically. Encrypted with KMS.",
            "security": "- Secrets encrypted at rest with KMS\n- Enable automatic rotation for databases\n- Use IAM policies for fine-grained access\n- Enable CloudTrail to audit access\n- Use resource-based policies for cross-account access\n- Rotate secrets regularly\n- Delete secrets with recovery window (7-30 days)",
            "cost": "- **Secret storage**: $0.40/month per secret\n- **API requests**: $0.05 per 10,000 requests\n- **Example**: 10 secrets with 1M API calls/month = $4 + $5 = $9/month\n- **Tip**: Cache secrets in application to reduce API costs",
            "dependencies": "- **Requires**: aws_kms_key (optional, AWS-managed by default)\n- Often rotates: RDS passwords, API keys\n- Used by: Lambda, EC2, ECS, Fargate",
            "checklist": "- [ ] Secret name is descriptive\n- [ ] Automatic rotation enabled where possible\n- [ ] KMS key specified if needed\n- [ ] Recovery window set appropriately\n- [ ] IAM policies restrict access\n- [ ] Applications cache secrets (not on every request)\n- [ ] Tags applied for organization"
        },
        
        # KMS
        "aws_kms_key": {
            "what": "KMS (Key Management Service) creates and manages encryption keys for encrypting data at rest. FIPS 140-2 validated.",
            "why": "Centralized key management with audit trails. Required for compliance (HIPAA, PCI-DSS). Encrypts data across AWS services.",
            "how": "KMS generates keys, encrypts/decrypts data, rotates keys automatically. Integrated with S3, RDS, EBS, Secrets Manager, etc.",
            "security": "- Enable automatic key rotation (yearly)\n- Use key policies to control access (separate from IAM)\n- Enable CloudTrail to audit key usage\n- Never export keys (AWS-managed)\n- Use separate keys per environment (dev/prod)\n- Set key deletion window (7-30 days)\n- Use multi-region keys for global apps",
            "cost": "- **Customer managed keys**: $1/month per key\n- **Requests**: $0.03 per 10,000 requests\n- **Example**: 5 keys + 1M requests = $5 + $3 = $8/month\n- **AWS-managed keys**: FREE (but no control)",
            "dependencies": "- No required dependencies\n- Used by: S3, RDS, EBS, Secrets Manager, SNS, SQS, etc.\n- Often uses: aws_kms_alias (friendly name)",
            "checklist": "- [ ] Key purpose is documented in description\n- [ ] Automatic rotation enabled\n- [ ] Key policy grants necessary permissions\n- [ ] CloudTrail logging enabled\n- [ ] Deletion window set (at least 7 days)\n- [ ] Alias created for easy reference\n- [ ] Multi-region key if needed for DR\n- [ ] Tags applied for cost allocation"
        },
        
        # EBS
        "aws_ebs_volume": {
            "what": "EBS (Elastic Block Store) provides block storage volumes for EC2 instances. Persistent storage that survives instance termination.",
            "why": "EBS volumes store operating systems, databases, and application data. They provide high performance, durability, and snapshots for backups.",
            "how": "Create volume, attach to EC2 instance, format and mount like a disk. Data persists independently of instance lifecycle. Snapshots backup to S3.",
            "security": "- Enable encryption (KMS) for data at rest\n- Use separate volumes for OS and data\n- Take regular snapshots for backups\n- Restrict snapshot sharing\n- Enable CloudWatch metrics\n- Use IAM policies to control attachment\n- Delete volumes when no longer needed",
            "cost": "- **gp3 (general purpose)**: $0.08/GB/month + IOPS/throughput costs\n- **gp2**: $0.10/GB/month (baseline IOPS included)\n- **io2**: $0.125/GB/month + $0.065/IOPS/month (high performance)\n- **Snapshots**: $0.05/GB/month (incremental)\n- **Example**: 100GB gp3 = $8/month",
            "dependencies": "- No required dependencies\n- Attached to: aws_instance (EC2)\n- Backed up to: aws_ebs_snapshot",
            "checklist": "- [ ] Volume type matches workload (gp3, gp2, io2, st1, sc1)\n- [ ] Size appropriate for data requirements\n- [ ] IOPS/throughput configured for gp3/io2\n- [ ] Encryption enabled\n- [ ] Availability zone matches EC2 instance\n- [ ] Delete on termination set correctly\n- [ ] Snapshot schedule configured\n- [ ] CloudWatch alarms for space/performance"
        },
        
        # ECR
        "aws_ecr_repository": {
            "what": "ECR (Elastic Container Registry) is a managed Docker container registry. Store, manage, and deploy container images.",
            "why": "ECR integrates seamlessly with ECS/EKS, scans for vulnerabilities, and handles scaling automatically. Secure alternative to Docker Hub.",
            "how": "Push Docker images to ECR, pull them in ECS/EKS. ECR handles storage, scaling, and security. Supports both private and public repositories.",
            "security": "- Enable image scanning on push (CVE detection)\n- Use IAM policies for fine-grained access\n- Enable encryption at rest (KMS)\n- Use immutable tags to prevent overwrites\n- Enable tag-based lifecycle policies\n- Scan images regularly\n- Use VPC endpoints to keep traffic private",
            "cost": "- **Storage**: $0.10/GB/month\n- **Data transfer**: FREE to ECS/EKS in same region\n- **Data transfer out**: $0.09/GB to internet\n- **Image scanning**: FREE (basic), $0.09/image (enhanced)\n- **Example**: 50GB images = $5/month",
            "dependencies": "- No required dependencies\n- Used by: aws_ecs_task_definition, aws_eks_cluster\n- Often uses: aws_ecr_lifecycle_policy, aws_ecr_repository_policy",
            "checklist": "- [ ] Repository name follows naming convention\n- [ ] Image scanning enabled on push\n- [ ] Lifecycle policy configured to delete old images\n- [ ] Encryption enabled\n- [ ] Image tag immutability enabled for prod\n- [ ] Repository policy grants necessary access\n- [ ] CloudWatch alarms for storage costs"
        },
        
        # EventBridge
        "aws_cloudwatch_event_rule": {
            "what": "EventBridge (formerly CloudWatch Events) routes events between AWS services, SaaS apps, and custom applications. Event-driven architecture.",
            "why": "EventBridge decouples services, enables automation, and simplifies event-driven patterns. Trigger Lambda, start Step Functions, send to SQS, etc.",
            "how": "Create rules with event patterns or schedules (cron). When events match, EventBridge routes them to targets (Lambda, SNS, SQS, etc.).",
            "security": "- Use IAM roles for EventBridge to invoke targets\n- Enable CloudTrail logging for audit\n- Use event buses for multi-account architecture\n- Archive events for replay/audit\n- Use schema registry for event validation\n- Encrypt event payloads if sensitive",
            "cost": "- **Events**: $1 per million events (first 100M events/month in free tier)\n- **Schema discovery**: $0.10/ingested event (optional)\n- **Archive**: $0.023/GB/month\n- **Example**: 10M events/month = FREE (under free tier)",
            "dependencies": "- No required dependencies\n- Targets: Lambda, SNS, SQS, Step Functions, ECS, etc.\n- Often uses: aws_lambda_permission (to allow EventBridge invocation)",
            "checklist": "- [ ] Event pattern correctly matches desired events\n- [ ] Schedule expression is valid (cron/rate)\n- [ ] Target has necessary permissions\n- [ ] Dead letter queue configured for failures\n- [ ] Retry policy configured\n- [ ] CloudWatch metrics enabled\n- [ ] Event archive configured if needed for replay"
        },
        
        # Auto Scaling Group
        "aws_autoscaling_group": {
            "what": "Auto Scaling Groups automatically adjust the number of EC2 instances based on demand. Ensures capacity matches workload.",
            "why": "Auto Scaling provides high availability, cost optimization, and automatic recovery. Scale out during peaks, scale in during lulls.",
            "how": "Define min/max/desired capacity, attach scaling policies (CPU, custom metrics), ASG launches/terminates instances automatically. Integrates with ALB.",
            "security": "- Use launch templates (not launch configurations)\n- Enable instance metadata service v2 (IMDSv2)\n- Use IAM instance profiles for permissions\n- Distribute instances across multiple AZs\n- Enable CloudWatch detailed monitoring\n- Use Systems Manager for patch management",
            "cost": "- **Auto Scaling**: FREE (only pay for EC2 instances)\n- **EC2 instances**: Standard EC2 pricing\n- **Example**: 2-10 t3.medium instances = $60-300/month\n- **Tip**: Use target tracking policies for optimal cost/performance",
            "dependencies": "- **Requires**: aws_launch_template, aws_subnet (2+ AZs)\n- Recommended: aws_lb_target_group, aws_autoscaling_policy\n- Often uses: aws_cloudwatch_metric_alarm",
            "checklist": "- [ ] Min/max/desired capacity set appropriately\n- [ ] Subnets in multiple AZs for high availability\n- [ ] Launch template configured correctly\n- [ ] Health check type set (EC2 or ELB)\n- [ ] Scaling policies configured (target tracking recommended)\n- [ ] CloudWatch alarms for scaling events\n- [ ] Termination policies configured\n- [ ] Tags propagate to instances"
        },
        
        # Step Functions
        "aws_sfn_state_machine": {
            "what": "Step Functions orchestrates serverless workflows. Chain Lambda functions, integrate AWS services, handle errors, and implement complex logic.",
            "why": "Step Functions simplifies complex workflows, provides visual monitoring, handles retries/failures, and coordinates distributed applications.",
            "how": "Define workflow as state machine (Amazon States Language/ASL). Step Functions executes states, passes data, handles branching/parallelization automatically.",
            "security": "- Use IAM roles for state machine execution\n- Enable CloudWatch Logs for execution history\n- Use X-Ray for tracing\n- Encrypt state machine data (KMS)\n- Use Express workflows for high-volume (> 100k/sec)\n- Validate input/output with JSONPath",
            "cost": "- **Standard workflow**: $0.025 per 1,000 state transitions\n- **Express workflow**: $1 per 1M requests + $0.00001667/GB-second\n- **Example**: 1M standard executions (10 states each) = $250\n- **Tip**: Use Express for high-volume, short-duration workflows (cheaper)",
            "dependencies": "- No required dependencies\n- Integrates with: Lambda, DynamoDB, SNS, SQS, ECS, Batch, etc.\n- Often uses: aws_iam_role (execution role)",
            "checklist": "- [ ] State machine type correct (Standard vs Express)\n- [ ] IAM role has permissions for all integrated services\n- [ ] Error handling configured (Retry/Catch)\n- [ ] CloudWatch Logs enabled\n- [ ] X-Ray tracing enabled\n- [ ] Timeouts set appropriately\n- [ ] Input/output validation in place\n- [ ] Cost estimated based on state transitions"
        }
    }
    
    # Return explanation for resource type, or generic one if not found
    base_explanation = {}
    if resource_type in explanations:
        base_explanation = explanations[resource_type].copy()
    else:
        # Generic explanation for unknown resource types
        resource_display = resource_type.replace('aws_', '').replace('_', ' ').title()
        base_explanation = {
            "what": f"This {resource_display} is an AWS managed resource that provides specific infrastructure capabilities.",
            "why": "It was generated based on your infrastructure requirements and follows AWS best practices.",
            "how": f"AWS manages the underlying infrastructure while you configure the {resource_display} through Terraform.",
            "security": "- Review IAM policies and resource-based policies\n- Enable encryption where available\n- Follow principle of least privilege for access\n- Enable audit logging if supported",
            "cost": f"- Refer to AWS pricing documentation for {resource_display} specific costs\n- Consider Reserved Instances or Savings Plans if applicable\n- Monitor usage with AWS Cost Explorer",
            "dependencies": "- Review the Terraform code to understand required dependencies\n- Check AWS documentation for service limits and quotas\n- Ensure proper IAM permissions are in place",
            "checklist": f"- [ ] Review the generated configuration for {resource_display}\n- [ ] Verify tags match your organization's standards\n- [ ] Check that the resource name follows naming conventions\n- [ ] Ensure this doesn't duplicate existing resources\n- [ ] Review security settings and access controls\n- [ ] Understand cost implications before deploying"
        }
    
    # Inject context-specific information
    base_explanation['context_purpose'] = context_specific_info['purpose']
    base_explanation['context_relationships'] = context_specific_info['relationships']
    
    # Append context-specific notes to existing sections
    if context_specific_info['security_notes']:
        base_explanation['security'] += "\n\n**In Your Environment:**\n" + "\n".join(f"- {note}" for note in context_specific_info['security_notes'])
    
    if context_specific_info['cost_notes']:
        base_explanation['cost'] += "\n\n**For Your Use Case:**\n" + "\n".join(f"- {note}" for note in context_specific_info['cost_notes'])
    
    return base_explanation


async def handle_agent_mode(
    prompt: str, 
    workspace_path: Optional[str], 
    user: UserAccount,
    conversation: Optional[Dict],
    context: Optional[Dict] = None,
    pre_generated_ir: Optional[Dict] = None,  # Allow passing IR for streaming
    pre_generated_hcl: Optional[Dict[str, str]] = None  # Allow passing already-generated HCL files
) -> Dict:
    """
    Agent Mode: Actually execute the task.
    Like Cursor's agent mode - makes real changes and writes Terraform files.
    If pre_generated_ir is provided, skips the Claude call (for streaming).
    If pre_generated_hcl is provided, skips HCL generation (avoids duplicate work).
    """
    import time
    total_start = time.time()
    print(f"⏱️ [Agent] Starting agent mode for: {prompt[:100]}...")
    
    try:
        from app.rag.generate import generate_multi_resource_terraform_hcl
        from pathlib import Path
        import os
        
        # Get codebase context to inform generation (smart: RAG + direct file reading)
        # OPTIMIZATION: Skip context for simple creation queries (speeds up from 60s to <5s)
        codebase_context_text = ""
        owner, repo = extract_owner_repo_from_context(workspace_path, context)
        
        # SCAN EXISTING RESOURCES FIRST (before LLM call) to avoid duplicates
        print(f"⏱️ [Agent] Starting resource scan...")
        scan_start = time.time()
        existing_resources_list = []
        if workspace_path:
            workspace = Path(workspace_path)
            if workspace.exists():
                import re
                # Scan ALL .tf files recursively (including subdirectories)
                for tf_file in workspace.rglob('*.tf'):
                    try:
                        content = tf_file.read_text()
                        # Extract: resource "aws_s3_bucket" "jollyn"
                        matches = re.findall(r'resource\s+"([^"]+)"\s+"([^"]+)"', content)
                        for resource_type, resource_name in matches:
                            existing_resources_list.append(f"{resource_type}.{resource_name}")
                    except:
                        pass
                
                if existing_resources_list:
                    print(f"🔍 [Agent] Found {len(existing_resources_list)} existing resources: {existing_resources_list[:10]}")
        scan_duration = time.time() - scan_start
        print(f"⏱️ [Agent] Resource scan completed in {scan_duration:.2f}s")
        
        # Detect if this is a simple creation vs modification query
        prompt_lower = prompt.lower()
        is_simple_creation = any(word in prompt_lower for word in [
            "create a ", "create an ", "set up a ", "set up an ", "deploy a ", "deploy an ",
            "add a new ", "add an new ", "build a ", "build an "
        ]) and not any(word in prompt_lower for word in [
            "add to ", "modify ", "update ", "edit ", "change ", "existing ", 
            "current ", "my ", "the "
        ])
        
        if is_simple_creation:
            print(f"⚡ [Agent] Simple creation detected - skipping codebase context (FAST PATH)")
        elif owner and repo:
            try:
                print(f"🔍 [Agent] Fetching codebase context for modification/update query")
                # Smart context retrieval: uses RAG for semantic search, direct file reading for specific requests
                codebase_context = await context_service.get_codebase_context(
                    user_id=user.id,
                    owner=owner,
                    repo=repo,
                    query=prompt,
                    top_k=8,
                    workspace_path=workspace_path  # Pass workspace_path for direct file reading
                )
                if codebase_context:
                    # Check if this is a file read request (has full_file type)
                    is_file_read = any(
                        c.get('meta', {}).get('type') == 'full_file' 
                        for c in codebase_context
                    )
                    
                    if is_file_read:
                        # For file reads, include ALL files (no limit) - they're already full files
                        codebase_context_text = "\n".join([
                            f"From {c.get('meta', {}).get('file', 'unknown')}: {c.get('text', '')}"
                            for c in codebase_context  # No [:5] limit for full files
                        ])
                        print(f"📚 [handle_agent_mode] Retrieved {len(codebase_context)} full files ({len(codebase_context_text)} chars)")
                    else:
                        # For semantic search, limit to top results
                        codebase_context_text = "\n".join([
                            f"From {c.get('meta', {}).get('file', 'unknown')}: {c.get('text', '')}"
                            for c in codebase_context[:5]  # Top 5 most relevant chunks
                        ])
                        print(f"📚 [handle_agent_mode] Retrieved {len(codebase_context)} context chunks ({len(codebase_context_text)} chars)")
            except Exception as e:
                print(f"Error retrieving codebase context: {e}")
        
        # Get conversation history for context
        conversation_history_text = ""
        if conversation:
            try:
                conversation_messages = conversation.get("messages", [])
                # Take last 10 messages (5 exchanges) for context
                recent_messages = conversation_messages[-10:]
                if recent_messages:
                    conversation_history_text = "\n\n=== Previous Conversation History ===\n"
                    for msg in recent_messages:
                        role = "User" if msg["role"] == "user" else "Assistant"
                        conversation_history_text += f"{role}: {msg['content']}\n"
                    print(f"📝 [handle_agent_mode] Including {len(recent_messages)} messages from conversation history")
            except Exception as e:
                print(f"⚠️ [handle_agent_mode] Error retrieving conversation history: {e}")
        
        # Enhance prompt with context if available
        enhanced_prompt = prompt
        context_parts = []
        
        # Add existing resources warning to ALWAYS avoid duplicates
        if existing_resources_list:
            existing_resources_str = "\n".join(f"  - {res}" for res in existing_resources_list[:50])  # Show first 50
            context_parts.append(f"""⚠️ CRITICAL - Existing Resources in Workspace:
The following resources already exist. DO NOT create resources with these names:
{existing_resources_str}

When generating new resources, use UNIQUE names that don't conflict with the above.
For example, if "aws_vpc.main" exists, use "aws_vpc.app" or "aws_vpc.prod" instead.""")
        
        if codebase_context_text:
            context_parts.append(f"Existing Codebase Context:\n{codebase_context_text}")
        if conversation_history_text:
            context_parts.append(conversation_history_text)
        
        if context_parts:
            enhanced_prompt = f"""User Request: {prompt}

{chr(10).join(context_parts)}

Generate Terraform code that:
1. Uses UNIQUE resource names (check existing resources above!)
2. Follows patterns from existing codebase
3. Reuses existing variables/outputs where appropriate
4. Maintains consistency with current file structure
5. References previous decisions from conversation history"""
        
        # Parse intent into IR (or use pre-generated)
        import time
        if pre_generated_ir:
            result = pre_generated_ir
        else:
            print(f"⏱️ [Agent] Starting LLM call...")
            llm_start = time.time()
            result = await nl_to_multi_resource_ir(enhanced_prompt)
            llm_duration = time.time() - llm_start
            print(f"⏱️ [Agent] LLM call completed in {llm_duration:.2f}s")
        ops = result.get("ops", [])
        
        if not ops:
            return {
                "message": "I need more specific information about what infrastructure you want to create.\n\n**Examples:**\n- \"Create an S3 bucket for logs\"\n- \"Set up a VPC with CIDR 10.0.0.0/16\"\n- \"Deploy an EC2 instance with t3.micro\"",
                "actions": [],
                "ir": None
            }
        
        # STEP 1: Intent Detection - Does user explicitly mention a file?
        prompt_lower = prompt.lower()
        explicit_file_intent = None
        for op in ops:
            file_hint = op.get("file_hint", "main.tf")
            # Check if user explicitly mentioned this file
            if file_hint in prompt_lower or file_hint.replace('.tf', '') in prompt_lower:
                explicit_file_intent = file_hint
                break
        
        # Check for "add to", "update", "modify", "edit" keywords
        is_edit_intent = any(word in prompt_lower for word in [
            "add to", "update", "modify", "edit", "change", 
            "append to", "add versioning to", "enable", "configure"
        ])
        
        # STEP 2: Smart Conflict Detection - Scan workspace for existing resources
        existing_resources = set()
        if workspace_path:
            workspace = Path(workspace_path)
            if workspace.exists():
                import re
                for tf_file in workspace.glob('*.tf'):
                    try:
                        content = tf_file.read_text()
                        # Extract: resource "aws_s3_bucket" "jollyn"
                        matches = re.findall(r'resource\s+"([^"]+)"\s+"([^"]+)"', content)
                        for resource_type, resource_name in matches:
                            existing_resources.add(f"{resource_type}.{resource_name}")
                    except:
                        pass
        
        # STEP 3: Auto-rename conflicting resources (only if NOT editing)
        renamed_count = 0
        for op in ops:
            resource_type = op["selector"]["type"]
            resource_name = op["selector"]["name"]
            full_name = f"{resource_type}.{resource_name}"
            
            if full_name in existing_resources:
                # Generate unique name
                base_name = resource_name
                counter = 2
                while f"{resource_type}.{resource_name}" in existing_resources:
                    resource_name = f"{base_name}_{counter}"
                    counter += 1
                
                # Update operation
                op["selector"]["name"] = resource_name
                renamed_count += 1
                
                # Add to existing set
                existing_resources.add(f"{resource_type}.{resource_name}")
        
        # GENERATE DOCUMENTATION FILES (not code - code stays in root)
        print(f"📝 [Agent] Generating documentation for {len(ops)} resources...")
        
        # Group resources by file for documentation
        file_resources = {}
        for op in ops:
            resource_type = op["selector"]["type"]
            resource_name = op["selector"]["name"]
            file_hint = op.get("file_hint", "main.tf")
            
            if file_hint not in file_resources:
                file_resources[file_hint] = []
            
            file_resources[file_hint].append({
                "type": resource_type,
                "name": resource_name,
                "description": resource_type.replace('aws_', '').replace('_', ' ').title()
            })
        
        # Create documentation file mapping (to be generated separately)
        from datetime import datetime as dt  # Import locally to avoid scope issues
        documentation_files = {}
        for tf_file, resources in file_resources.items():
            # Create markdown doc for this file
            doc_filename = tf_file.replace('.tf', '.md')
            doc_path = workspace / "driftbox" / "docs" / doc_filename
            
            # OPTIMIZATION: Skip doc generation if it already exists (e.g., s3.md already created)
            if doc_path.exists():
                print(f"📚 [Docs] Skipping {doc_filename} - already exists")
                continue
            doc_content = f"""# Generated Infrastructure Documentation

**File:** `{tf_file}`  
**Generated by:** Driftbox AI  
**Date:** {dt.now().strftime('%Y-%m-%d %H:%M:%S')}

---

## Resources Created

"""
            for res in resources:
                # Find the full operation for this resource to get config
                res_operation = None
                for op in ops:
                    if op["selector"]["type"] == res['type'] and op["selector"]["name"] == res['name']:
                        res_operation = op
                        break
                
                # Generate deep, context-aware explanation
                resource_guide = _generate_deep_resource_explanation(
                    res['type'], 
                    res['name'],
                    resource_config=res_operation,
                    user_prompt=prompt,
                    all_resources=[{"type": op["selector"]["type"], "name": op["selector"]["name"], "attributes": op.get("attributes", {})} for op in ops]
                )
                
                doc_content += f"""### {res['type']}.{res['name']}

**Type:** `{res['type']}`  
**Name:** `{res['name']}`  

---

#### 🎯 What This Resource Does

{resource_guide['what']}

"""
                
                # Add context-specific purpose if available
                if resource_guide.get('context_purpose'):
                    doc_content += f"""**In Your Environment:**  
{resource_guide['context_purpose']}

"""
                
                # Add relationships if available
                if resource_guide.get('context_relationships'):
                    doc_content += f"""**Resource Relationships:**  
{chr(10).join('- ' + rel for rel in resource_guide['context_relationships'])}

"""
                
                doc_content += f"""
#### 🤔 Why It Was Created

This resource was generated based on your infrastructure request. {resource_guide['why']}

#### ⚙️ How It Works

{resource_guide['how']}

#### 🔒 Security Considerations

{resource_guide['security']}

#### 💰 Cost Implications

{resource_guide['cost']}

#### 🔗 Dependencies & Relationships

{resource_guide['dependencies']}

#### ✅ Review Checklist

Before deploying this resource, verify:

{resource_guide['checklist']}

#### 📚 Learn More

- [AWS {res['description']} Documentation](https://docs.aws.amazon.com/search?q={res['type'].replace('aws_', '')})
- [Terraform {res['type']} Reference](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/{res['type'].replace('aws_', '')})

---

"""
            
            documentation_files[f"driftbox/docs/{doc_filename}"] = doc_content
        
        # Generate Terraform code with renamed resources and explanations
        # Skip if pre-generated HCL was provided (avoids duplicate work in streaming flow)
        if pre_generated_hcl:
            print(f"⏱️ [Agent] Using pre-generated HCL ({len(pre_generated_hcl)} files) - skipping regeneration")
            hcl_files = pre_generated_hcl
        else:
            print(f"⏱️ [Agent] Starting HCL generation for {len(ops)} resources...")
            hcl_start = time.time()
            hcl_files = generate_multi_resource_terraform_hcl({"ops": ops})
            hcl_duration = time.time() - hcl_start
            print(f"⏱️ [Agent] HCL generation completed in {hcl_duration:.2f}s ({len(hcl_files)} files)")
        
        # STEP 4: Smart filename conflict resolution
        # CRITICAL: In desktop mode, workspace_path is a LOCAL path (e.g., /Users/...)
        # The backend (droplet) shouldn't try to create files there - that's handled by Electron
        is_desktop_mode = workspace_path and ('/Users/' in workspace_path or 'C:\\' in workspace_path)
        
        if is_desktop_mode:
            print(f"🖥️  [Agent] Desktop mode detected - skipping server-side file creation")
            print(f"🖥️  [Agent] Files will be created by Electron on client: {workspace_path}")
        
        final_hcl_files = {}
        for filename, content in hcl_files.items():
            if workspace_path and not is_desktop_mode:
                # Server mode: Create files on the backend
                workspace = Path(workspace_path)
                target_file = workspace / filename
                # Ensure parent directories exist (e.g., driftbox/docs/)
                target_file.parent.mkdir(parents=True, exist_ok=True)
                
                # Check if user explicitly wants to edit THIS file
                should_edit = (
                    explicit_file_intent == filename or  # User mentioned this specific file
                    (is_edit_intent and target_file.exists())  # User wants to edit and file exists
                )
                
                if target_file.exists() and not should_edit:
                    # File exists AND user didn't explicitly want to edit it - create new file
                    base = filename.replace('.tf', '')
                    counter = 2
                    while (workspace / f"{base}_{counter}.tf").exists():
                        counter += 1
                    new_filename = f"{base}_{counter}.tf"
                    final_hcl_files[new_filename] = content
                elif target_file.exists() and should_edit:
                    # User wants to EDIT this file - append new resources
                    existing_content = target_file.read_text()
                    # Append new resources (remove duplicate provider blocks)
                    new_content_lines = content.split('\n')
                    # Skip provider/terraform blocks if they exist
                    filtered_lines = []
                    skip_block = False
                    for line in new_content_lines:
                        if line.strip().startswith('terraform {') or line.strip().startswith('provider '):
                            skip_block = True
                        if skip_block:
                            if line.strip() == '}':
                                skip_block = False
                            continue
                        filtered_lines.append(line)
                    
                    new_resources = '\n'.join(filtered_lines).strip()
                    combined_content = f"{existing_content}\n\n{new_resources}\n"
                    final_hcl_files[filename] = combined_content
                else:
                    # File doesn't exist - create it
                    final_hcl_files[filename] = content
            else:
                final_hcl_files[filename] = content
        
        # Build consolidated terraform_code string for display
        consolidated_parts = []
        for filename in ["main.tf"] + [f for f in sorted(final_hcl_files.keys()) if f != "main.tf"]:
            if filename not in final_hcl_files:
                continue
            if filename == "main.tf":
                consolidated_parts.append(final_hcl_files[filename])
            else:
                consolidated_parts.append(f"# {filename}\n{final_hcl_files[filename]}")
        terraform_code = "\n\n".join(consolidated_parts)
        
        # Create multiple file proposals (Cursor-style)
        file_proposals = []
        file_order = ["main.tf"] + [f for f in sorted(final_hcl_files.keys()) if f != "main.tf"]
        
        for filename in file_order:
            if filename not in final_hcl_files:
                continue
            
            # Check if file exists (should only be main.tf or new files now)
            old_content = None
            action = "create"
            if workspace_path and not is_desktop_mode:
                # Server mode only: Check if files exist on backend
                workspace = Path(workspace_path)
                target_file = workspace / filename
                # Ensure parent directories exist (e.g., driftbox/dependencies/)
                target_file.parent.mkdir(parents=True, exist_ok=True)
                if target_file.exists():
                    with open(target_file, 'r') as f:
                        old_content = f.read()
                    action = "edit"
            
            # Create proposal for this file
            file_proposals.append({
                "action": action,
                "path": filename,
                "oldContent": old_content,
                "newContent": final_hcl_files[filename],
                "description": f"{action.title()} {filename}{' (conflict resolved)' if renamed_count > 0 else ''}"
            })
        
        # ADD DOCUMENTATION FILES (driftbox/docs/*.tf with educational content)
        # DISABLED: Using driftbox.md instead
        # for doc_path, doc_content in documentation_files.items():
        #     file_proposals.append({
        #         "action": "create",
        #         "path": doc_path,
        #         "oldContent": None,
        #         "newContent": doc_content,
        #         "description": f"Documentation for {doc_path.replace('driftbox/docs/', '')}"
        #     })
        
        print(f"🎯 [driftbox.md] About to generate driftbox.md (desktop_mode={is_desktop_mode}, workspace={workspace_path})")
        
        # GENERATE driftbox.md - comprehensive documentation
        try:
            print("🔍 [driftbox.md] Generating documentation...")
            driftbox_md_content = await generate_driftbox_md(
                user_prompt=prompt,
                generated_files=final_hcl_files,
                workspace_path=workspace_path,
                owner=owner,
                repo=repo
            )
            
            # Check if driftbox.md already exists (only in server mode)
            existing_driftbox_md = None
            if workspace_path and not is_desktop_mode:
                driftbox_md_path = Path(workspace_path) / "driftbox.md"
                if driftbox_md_path.exists():
                    try:
                        existing_driftbox_md = driftbox_md_path.read_text()
                    except:
                        pass
            # In desktop mode, we can't check if file exists on client, so always treat as create
            
            driftbox_proposal = {
                "action": "edit" if existing_driftbox_md else "create",
                "path": "driftbox.md",
                "oldContent": existing_driftbox_md,
                "newContent": driftbox_md_content,
                "description": "Update infrastructure documentation" if existing_driftbox_md else "Create infrastructure documentation"
            }
            file_proposals.append(driftbox_proposal)
            print(f"✅ [driftbox.md] Documentation generated ({len(driftbox_md_content)} chars)")
            print(f"✅ [driftbox.md] Added to file_proposals (total proposals: {len(file_proposals)})")
            print(f"✅ [driftbox.md] Proposal: {driftbox_proposal['path']} ({driftbox_proposal['action']})")
        
        except Exception as e:
            import traceback
            print(f"❌ [driftbox.md] Generation failed: {e}")
            print(f"❌ [driftbox.md] Traceback: {traceback.format_exc()}")
            # Continue without driftbox.md - don't fail the whole request
        
        # For backward compatibility, set file_proposal to first file
        file_proposal = file_proposals[0] if file_proposals else None
        
        file_written = None  # No file written yet - waiting for approval
        
        # Build minimal execution summary (Cursor-style - ultra minimal)
        print(f"📊 [Agent] Final file_proposals count: {len(file_proposals)}")
        print(f"📊 [Agent] Proposal paths: {[p['path'] for p in file_proposals]}")
        message = f"{len(ops)} resources • {len(file_proposals)} files"
        
        # Record actions for tracking
        actions = []
        for op in ops:
            action_result = ActionResult(
                type="terraform_resource",
                description=f"{op['action'].title()} {op['selector']['type']}.{op['selector']['name']}",
                file=op.get("file_hint", "main.tf"),
                status="success",
                details={
                    "action": op["action"],
                    "resource_type": op["selector"]["type"],
                    "resource_name": op["selector"]["name"],
                    "changes": op.get("changes", [])
                }
            )
            actions.append(action_result)
        
        total_duration = time.time() - total_start
        print(f"⏱️ [Agent] TOTAL agent mode completed in {total_duration:.2f}s")
        
        return {
            "message": message,
            "actions": [action.dict() for action in actions],
            "ir": {"ops": ops},
            "thinking": hcl_files,
            "file_proposal": file_proposal,
            "file_proposals": file_proposals
        }
    
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        return {
            "message": f"❌ Error: {str(e)}",
            "actions": [],
            "ir": None
        }


@router.get("/chat/modes", tags=["chat"])
def get_modes():
    """
    Get descriptions of available modes.
    Useful for IDE to show mode selector UI.
    """
    return {
        "modes": [
            mode_detector.get_mode_metadata("ask"),
            mode_detector.get_mode_metadata("agent")
        ],
        "default_mode": "ask",
        "recommendation": "Start in ask mode to see what the AI would do, then switch to agent mode to execute"
    }


@router.get("/metrics", tags=["monitoring"])
def get_generation_metrics():
    """
    Get infrastructure generation metrics for monitoring/observability.
    Tracks success rates, errors, performance, and resource counts.
    """
    from app.rag.metrics import get_metrics
    
    metrics = get_metrics()
    return {
        "status": "healthy" if metrics.get_success_rate() > 80 else "degraded",
        "metrics": metrics.get_summary()
    }
