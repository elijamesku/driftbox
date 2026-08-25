"""
Intelligent file merging service for Terraform HCL files.
Handles appending resources to existing files vs creating new files.
"""
from pathlib import Path
from typing import Dict, List, Any
import re


def merge_hcl_into_workspace(
    hcl_files: Dict[str, str],  # Generated HCL: {filepath: content}
    workspace_path: str          # Workspace directory path
) -> List[Dict[str, Any]]:
    """
    Intelligently merge new HCL resources into existing workspace files.
    
    Returns:
        List of file proposals with action='create' or action='update'
    """
    workspace = Path(workspace_path)
    proposals = []
    
    # Track which files we've seen (for deduplication)
    processed_files = set()
    
    for file_path, new_hcl_content in hcl_files.items():
        full_path = workspace / file_path
        
        # Skip duplicate file paths (in case AI generates same file twice)
        if file_path in processed_files:
            print(f"⚠️  [FileMerger] Skipping duplicate file path: {file_path}")
            continue
        processed_files.add(file_path)
        
        # Check if file already exists
        if full_path.exists():
            # File exists - create UPDATE proposal (append new resources)
            try:
                old_content = full_path.read_text()
                
                # Intelligently merge: append new resources after existing ones
                merged_content = _merge_terraform_content(old_content, new_hcl_content)
                
                # Only create proposal if content actually changed
                if merged_content.strip() != old_content.strip():
                    proposals.append({
                        "action": "update",
                        "path": file_path,
                        "oldContent": old_content,
                        "newContent": merged_content,
                        "description": f"Add resources to {file_path}"
                    })
                    print(f"✅ [FileMerger] UPDATE: {file_path} (+{_count_resources(new_hcl_content)} resources)")
                else:
                    print(f"ℹ️  [FileMerger] SKIP: {file_path} (no changes)")
            except Exception as e:
                print(f"❌ [FileMerger] Error reading {file_path}: {e}")
                # Fallback: treat as create
                proposals.append({
                    "action": "create",
                    "path": file_path,
                    "oldContent": None,
                    "newContent": new_hcl_content,
                    "description": f"Create {file_path}"
                })
        else:
            # New file - create CREATE proposal
            # Ensure parent directories exist (for nested structures like networking/vpc.tf)
            parent_dir = full_path.parent
            
            proposals.append({
                "action": "create",
                "path": file_path,
                "oldContent": None,
                "newContent": new_hcl_content,
                "description": f"Create {file_path}" + (f" in {parent_dir.name}/" if str(parent_dir) != '.' else "")
            })
            print(f"✅ [FileMerger] CREATE: {file_path} ({_count_resources(new_hcl_content)} resources)")
    
    return proposals


def _merge_terraform_content(existing_content: str, new_content: str) -> str:
    """
    Intelligently merge new Terraform resources into existing file content.
    
    Strategy:
    1. Preserve existing provider/terraform blocks
    2. Append new resources after existing resources
    3. Handle whitespace properly
    """
    # Clean up content
    existing = existing_content.rstrip()
    new = new_content.strip()
    
    # Extract new resources (skip provider/terraform blocks if they exist)
    new_resources_only = _extract_resources_only(new)
    
    # If no new resources to add, return existing
    if not new_resources_only.strip():
        return existing
    
    # Append new resources with proper spacing
    merged = existing
    if not merged.endswith('\n\n'):
        if not merged.endswith('\n'):
            merged += '\n'
        merged += '\n'
    
    merged += new_resources_only
    
    # Ensure file ends with single newline
    merged = merged.rstrip() + '\n'
    
    return merged


def _extract_resources_only(content: str) -> str:
    """
    Extract only resource blocks from Terraform content.
    Removes terraform{}, provider{}, and variable{} blocks.
    """
    lines = content.split('\n')
    result_lines = []
    in_block = False
    block_type = None
    brace_count = 0
    
    # Block types to skip
    skip_blocks = {'terraform', 'provider', 'variable', 'locals', 'output'}
    
    for line in lines:
        stripped = line.strip()
        
        # Check if starting a new block
        if not in_block:
            # Match: terraform {...}, provider "..." {...}, resource "..." "..." {...}
            block_match = re.match(r'^(terraform|provider|variable|locals|output|resource|data|module)\s+', stripped)
            if block_match:
                block_type = block_match.group(1)
                in_block = True
                brace_count = stripped.count('{') - stripped.count('}')
                
                # Only add line if it's NOT a skip block
                if block_type not in skip_blocks:
                    result_lines.append(line)
            else:
                # Blank lines or comments outside blocks
                if stripped == '' or stripped.startswith('#'):
                    result_lines.append(line)
        else:
            # Inside a block
            brace_count += stripped.count('{') - stripped.count('}')
            
            # Only add line if it's NOT a skip block
            if block_type not in skip_blocks:
                result_lines.append(line)
            
            # Check if block ended
            if brace_count <= 0:
                in_block = False
                block_type = None
    
    return '\n'.join(result_lines).strip() + '\n' if result_lines else ''


def _count_resources(content: str) -> int:
    """Count number of resource blocks in Terraform content."""
    return len(re.findall(r'resource\s+"[^"]+"\s+"[^"]+"', content))

