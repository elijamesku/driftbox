"""
Terraform Auto-Heal Service
Analyzes terraform validation errors and uses AI to generate fixes.
"""
import re
from typing import Dict, List, Optional
from pathlib import Path


def parse_llm_fixes(llm_response: str) -> List[Dict[str, str]]:
    """
    Parse LLM response into file sections.
    Handles multiple formats:
    - FILENAME: path/to/file.tf
    - ```hcl or ```terraform code blocks
    """
    file_sections = []
    current_file = None
    current_code = []
    in_code_block = False
    
    lines = llm_response.split('\n')
    
    for line in lines:
        stripped = line.strip()
        
        # Detect filename markers (case insensitive)
        if stripped.upper().startswith('FILENAME:'):
            # Save previous file
            if current_file and current_code:
                content = '\n'.join(current_code).strip()
                if content:  # Only add if there's actual content
                    file_sections.append({
                        'path': current_file,
                        'content': content
                    })
                    print(f"✅ [Auto-Heal Parser] Extracted {current_file} ({len(content)} chars)")
            
            # Start new file
            current_file = stripped[9:].strip()  # Remove "FILENAME:"
            current_code = []
            in_code_block = False
            continue
        
        # Handle markdown code fences
        if stripped in ['```hcl', '```terraform', '```tf', '```']:
            in_code_block = not in_code_block
            continue
        
        # Collect code lines
        if current_file is not None:
            # Skip leading empty lines
            if not current_code and not stripped:
                continue
            current_code.append(line)
    
    # Don't forget the last file
    if current_file and current_code:
        content = '\n'.join(current_code).strip()
        if content:
            file_sections.append({
                'path': current_file,
                'content': content
            })
            print(f"✅ [Auto-Heal Parser] Extracted {current_file} ({len(content)} chars)")
    
    return file_sections


def clean_terraform_code(code: str) -> str:
    """Remove any remaining markdown or formatting from HCL code."""
    # Remove markdown code fences that might have been missed
    code = re.sub(r'```(?:hcl|terraform|tf)?\n?', '', code)
    # Remove leading/trailing whitespace
    code = code.strip()
    return code

