"""
Terraform Chunker - Parses Terraform files into semantic chunks for RAG indexing
Ports the frontend codebaseParser.ts logic to Python
"""
import re
from typing import List, Dict, Any, Optional, Tuple


def find_block_end(content: str, start_index: int) -> int:
    """
    Find the end of a block using bracket matching (handles nested blocks)
    Returns the index of the closing brace, or -1 if not found
    """
    depth = 0
    in_string = False
    string_char = ''
    i = start_index
    
    while i < len(content):
        char = content[i]
        prev_char = content[i - 1] if i > 0 else ''
        
        # Handle string literals (skip brackets inside strings)
        if not in_string and (char == '"' or char == "'"):
            in_string = True
            string_char = char
        elif in_string and char == string_char and prev_char != '\\':
            in_string = False
        
        if not in_string:
            if char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    return i
        
        i += 1
    
    return -1  # Block not properly closed


def get_line_number(content: str, char_index: int) -> int:
    """Calculate line number from character index"""
    return content[:char_index].count('\n') + 1


def extract_block(content: str, start_index: int, block_type: str, block_name: str, type_name: Optional[str] = None) -> Optional[Tuple[str, int]]:
    """
    Extract block content using bracket matching
    
    Returns: (body: str, end_index: int) or None if block not found
    """
    # Find the opening brace
    brace_index = content.find('{', start_index)
    if brace_index == -1:
        return None
    
    # Find the matching closing brace
    end_index = find_block_end(content, brace_index)
    if end_index == -1:
        return None
    
    # Extract block body (content between braces, excluding the braces themselves)
    body = content[brace_index + 1:end_index].strip()
    
    return (body, end_index)


def parse_terraform_file(file_path: str, content: str) -> List[Dict[str, Any]]:
    """
    Parse a single Terraform file into semantic chunks
    Uses bracket matching to properly handle nested blocks
    
    Returns list of chunks in format:
    {
        "text": str,
        "meta": {
            "file": str,
            "type": str,
            ... (type-specific fields)
        }
    }
    """
    chunks: List[Dict[str, Any]] = []
    
    # Extract resources: resource "type" "name" { ... }
    resource_pattern = re.compile(r'resource\s+"([^"]+)"\s+"([^"]+)"\s*')
    for match in resource_pattern.finditer(content):
        resource_type = match.group(1)
        resource_name = match.group(2)
        block_result = extract_block(content, match.end(), 'resource', resource_name, resource_type)
        
        if block_result:
            body, end_index = block_result
            line_start = get_line_number(content, match.start())
            line_end = get_line_number(content, end_index)
            
            chunks.append({
                "text": f"resource {resource_type} {resource_name}:\n{body}",
                "meta": {
                    "file": file_path,
                    "type": "resource",
                    "resource_type": resource_type,
                    "resource_name": resource_name,
                    "line_start": line_start,
                    "line_end": line_end
                }
            })
    
    # Extract variables: variable "name" { ... }
    variable_pattern = re.compile(r'variable\s+"([^"]+)"\s*')
    for match in variable_pattern.finditer(content):
        var_name = match.group(1)
        block_result = extract_block(content, match.end(), 'variable', var_name)
        
        if block_result:
            body, end_index = block_result
            line_start = get_line_number(content, match.start())
            line_end = get_line_number(content, end_index)
            
            chunks.append({
                "text": f"variable {var_name}:\n{body}",
                "meta": {
                    "file": file_path,
                    "type": "variable",
                    "variable_name": var_name,
                    "line_start": line_start,
                    "line_end": line_end
                }
            })
    
    # Extract outputs: output "name" { ... }
    output_pattern = re.compile(r'output\s+"([^"]+)"\s*')
    for match in output_pattern.finditer(content):
        output_name = match.group(1)
        block_result = extract_block(content, match.end(), 'output', output_name)
        
        if block_result:
            body, end_index = block_result
            line_start = get_line_number(content, match.start())
            line_end = get_line_number(content, end_index)
            
            chunks.append({
                "text": f"output {output_name}:\n{body}",
                "meta": {
                    "file": file_path,
                    "type": "output",
                    "output_name": output_name,
                    "line_start": line_start,
                    "line_end": line_end
                }
            })
    
    # Extract data sources: data "type" "name" { ... }
    data_pattern = re.compile(r'data\s+"([^"]+)"\s+"([^"]+)"\s*')
    for match in data_pattern.finditer(content):
        data_type = match.group(1)
        data_name = match.group(2)
        block_result = extract_block(content, match.end(), 'data', data_name, data_type)
        
        if block_result:
            body, end_index = block_result
            line_start = get_line_number(content, match.start())
            line_end = get_line_number(content, end_index)
            
            chunks.append({
                "text": f"data {data_type} {data_name}:\n{body}",
                "meta": {
                    "file": file_path,
                    "type": "data",
                    "data_type": data_type,
                    "data_name": data_name,
                    "line_start": line_start,
                    "line_end": line_end
                }
            })
    
    # Extract modules: module "name" { ... }
    module_pattern = re.compile(r'module\s+"([^"]+)"\s*')
    for match in module_pattern.finditer(content):
        module_name = match.group(1)
        block_result = extract_block(content, match.end(), 'module', module_name)
        
        if block_result:
            body, end_index = block_result
            line_start = get_line_number(content, match.start())
            line_end = get_line_number(content, end_index)
            
            chunks.append({
                "text": f"module {module_name}:\n{body}",
                "meta": {
                    "file": file_path,
                    "type": "module",
                    "module_name": module_name,
                    "line_start": line_start,
                    "line_end": line_end
                }
            })
    
    # Add file overview chunk (first 500 chars for context)
    file_name = file_path.split('/')[-1] if '/' in file_path else file_path
    overview_text = content[:500] + ('...' if len(content) > 500 else '')
    chunks.append({
        "text": f"File {file_name} contains:\n{overview_text}",
        "meta": {
            "file": file_path,
            "type": "file_overview"
        }
    })
    
    return chunks

