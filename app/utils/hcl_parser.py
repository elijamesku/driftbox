from pathlib import Path 
from typing import Dict, Any, List
import hcl2
import re

# ------------------------------------------------------------------------------
# Safe HCL parsing and indexing utility functions
# ------------------------------------------------------------------------------
def parse_hcl_safely(file_path: Path) -> Dict[str, Any]:
    """Safely parse HCL file with error handling"""
    with open(file_path, "r") as hcl_file:
        try:
            return hcl2.load(hcl_file) if hcl2 else {}
        except Exception as parsing_error:
            return {"_parse_error": str(parsing_error)}

def get_resource_line_numbers(file_path: Path) -> Dict[str, int]:
    """
    Parse a Terraform file to find the line number where each resource is declared.
    Returns a dict mapping "resource_type.resource_name" to line number.
    """
    line_map = {}
    try:
        with open(file_path, "r") as f:
            lines = f.readlines()
            for line_num, line in enumerate(lines, start=1):
                # Match: resource "aws_s3_bucket" "my_bucket" {
                match = re.match(r'^\s*resource\s+"([^"]+)"\s+"([^"]+)"\s*\{', line)
                if match:
                    resource_type = match.group(1)
                    resource_name = match.group(2)
                    key = f"{resource_type}.{resource_name}"
                    line_map[key] = line_num
    except Exception as e:
        print(f"Error parsing line numbers from {file_path}: {e}")
    return line_map

def extract_blocks(parsed_hcl: Dict[str, Any], block_type: str) -> Dict[str, Dict[str, Any]]:
    """Extract specific block types (module, variable, output, etc.) from parsed HCL"""
    extracted_blocks: Dict[str, Dict[str, Any]] = {}
    target_block = parsed_hcl.get(block_type)
    if not target_block:
        return extracted_blocks
    if isinstance(target_block, list):
        for block_item in target_block:
            if isinstance(block_item, dict):
                for block_name, block_attributes in block_item.items():
                    if isinstance(block_attributes, list) and block_attributes and isinstance(block_attributes[0], dict):
                        block_attributes = block_attributes[0]
                    extracted_blocks[block_name] = block_attributes if isinstance(block_attributes, dict) else {}
    elif isinstance(target_block, dict):
        for block_name, block_attributes in target_block.items():
            if isinstance(block_attributes, list) and block_attributes and isinstance(block_attributes[0], dict):
                block_attributes = block_attributes[0]
            extracted_blocks[block_name] = block_attributes if isinstance(block_attributes, dict) else {}
    return extracted_blocks

def extract_resources(parsed_hcl: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract all resource declarations from parsed HCL"""
    discovered_resources: List[Dict[str, Any]] = []
    resource_block = parsed_hcl.get("resource")
    if not resource_block:
        return discovered_resources

    def _add_resource(resource_type: str, resource_name: str, resource_attributes_raw):
        """Helper to add resource to discovered list"""
        normalized_attributes = resource_attributes_raw
        if isinstance(resource_attributes_raw, list) and resource_attributes_raw and isinstance(resource_attributes_raw[0], dict):
            normalized_attributes = resource_attributes_raw[0]
        if not isinstance(normalized_attributes, dict):
            normalized_attributes = {}
        discovered_resources.append({"address": f"{resource_type}.{resource_name}", "type": resource_type, "name": resource_name, "attrs": normalized_attributes})

    if isinstance(resource_block, dict):
        for resource_type, resource_items in resource_block.items():
            if isinstance(resource_items, dict):
                for resource_name, resource_attributes in resource_items.items():
                    _add_resource(resource_type, resource_name, resource_attributes)
            elif isinstance(resource_items, list):
                for resource_entry in resource_items:
                    if isinstance(resource_entry, dict):
                        for resource_name, resource_attributes in resource_entry.items():
                            _add_resource(resource_type, resource_name, resource_attributes)
    elif isinstance(resource_block, list):
        for block_item in resource_block:
            if isinstance(block_item, dict):
                for resource_type, resource_array in block_item.items():
                    if isinstance(resource_array, list):
                        for resource_entry in resource_array:
                            if isinstance(resource_entry, dict):
                                for resource_name, resource_attributes in resource_entry.items():
                                    _add_resource(resource_type, resource_name, resource_attributes)
                    elif isinstance(resource_array, dict):
                        for resource_name, resource_attributes in resource_array.items():
                            _add_resource(resource_type, resource_name, resource_attributes)
    return discovered_resources
