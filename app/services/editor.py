# Infrastructure configuration editor - HCL manipulation utilities
import re, textwrap
from pathlib import Path
from typing import Optional,  Any, Tuple
from app.utils.schemas import HCL_RESOURCE_DECLARATION_PATTERN

def locate_resource_block_boundaries(hcl_content: str, resource_type: str, resource_name: Optional[str]) -> Tuple[int, int]:
    """
    Identify (start_index, end_index) of resource block for specified type/name.
    If name is None, returns first matching type.
    Raises ValueError if not found or malformed HCL.
    """
    matched_block = None
    for pattern_match in HCL_RESOURCE_DECLARATION_PATTERN.finditer(hcl_content):
        if pattern_match.group("type") == resource_type and (resource_name is None or pattern_match.group("name") == resource_name):
            block_start_index = pattern_match.end()
            brace_depth = 1
            while block_start_index < len(hcl_content) and brace_depth > 0:
                if hcl_content[block_start_index] == "{": brace_depth += 1
                elif hcl_content[block_start_index] == "}": brace_depth -= 1
                block_start_index += 1
            if brace_depth != 0:
                raise ValueError("Unbalanced braces detected in resource block")
            matched_block = (pattern_match.start(), block_start_index)
            break
    if not matched_block:
        raise ValueError("Resource block not found in HCL content")
    return matched_block

def _serialize_scalar_value(config_value) -> str:
    if isinstance(config_value, bool):
        return "true" if config_value else "false"
    if isinstance(config_value, (int, float)):
        return str(config_value)
    if config_value is None:
        return "null"
    return f'"{config_value}"'

def _inject_configuration_path_in_block(block_content: str, config_path: str, config_value: Any) -> Tuple[str, bool]:
    """
    Inject configuration at dot-notation path:
      - Supports nested paths: 'versioning.enabled', 'tags.env'
      - Creates nested blocks if absent
    Returns (modified_block, was_modified).
    """
    path_segments = config_path.split(".")
    content_modified = False

    # Handle tags.<key> special case
    if path_segments[0] == "tags" and len(path_segments) == 2:
        tag_key = path_segments[1]
        tags_block_pattern = re.compile(r'(?m)^\s*tags\s*=\s*\{(?P<body>.*?)^\s*\}', re.DOTALL)
        tags_match = tags_block_pattern.search(block_content)
        if tags_match:
            tags_body = tags_match.group("body")
            tag_key_pattern = re.compile(rf'(?m)^\s*{re.escape(tag_key)}\s*=\s*".*?"\s*$')
            if tag_key_pattern.search(tags_body):
                updated_tags_body = tag_key_pattern.sub(f'  {tag_key} = "{config_value}"', tags_body)
            else:
                updated_tags_body = tags_body + f'\n  {tag_key} = "{config_value}"\n'
            block_content = block_content[:tags_match.start("body")] + updated_tags_body + block_content[tags_match.end("body"):]
        else:
            tags_insertion = textwrap.dedent(f"""
                tags = {{
                  {tag_key} = "{config_value}"
                }}
            """)
            block_content = block_content[:-1] + tags_insertion + "\n}"
        return block_content, True

    # Handle two-level nested block + leaf attribute (e.g., "versioning.enabled")
    if len(path_segments) == 2:
        nested_block_name, leaf_attribute = path_segments
        nested_block_pattern = re.compile(rf'(?ms)^\s*{re.escape(nested_block_name)}\s*\{{(?P<body>.*?)^\s*\}}')
        nested_match = nested_block_pattern.search(block_content)
        attribute_line = f'  {leaf_attribute} = {_serialize_scalar_value(config_value)}'
        if nested_match:
            nested_body = nested_match.group("body")
            attribute_pattern = re.compile(rf'(?m)^\s*{re.escape(leaf_attribute)}\s*=\s*.*$')
            if attribute_pattern.search(nested_body):
                updated_nested_body = attribute_pattern.sub(attribute_line, nested_body)
            else:
                updated_nested_body = nested_body + "\n" + attribute_line + "\n"
            block_content = block_content[:nested_match.start("body")] + updated_nested_body + block_content[nested_match.end("body"):]
        else:
            nested_insertion = textwrap.dedent(f"""
                {nested_block_name} {{
                {attribute_line}
                }}
            """)
            block_content = block_content[:-1] + nested_insertion + "\n}"
        return block_content, True

    # Handle flat top-level attribute
    if len(path_segments) == 1:
        leaf_attribute = path_segments[0]
        attribute_pattern = re.compile(rf'(?m)^\s*{re.escape(leaf_attribute)}\s*=\s*.*$')
        attribute_line = f'  {leaf_attribute} = {_serialize_scalar_value(config_value)}'
        if attribute_pattern.search(block_content):
            block_content = attribute_pattern.sub(attribute_line, block_content)
        else:
            block_content = block_content[:-1] + "\n" + attribute_line + "\n}"
        return block_content, True

    # Deeper nesting unsupported in MVP
    return block_content, False

def _remove_configuration_path_from_block(block_content: str, config_path: str) -> Tuple[str, bool]:
    path_segments = config_path.split(".")
    if len(path_segments) == 1:
        leaf_attribute = path_segments[0]
        attribute_pattern = re.compile(rf'(?m)^\s*{re.escape(leaf_attribute)}\s*=\s*.*$\n?')
        modified_block, substitution_count = attribute_pattern.subn("", block_content)
        return modified_block, (substitution_count > 0)
    return block_content, False

def apply_ir_operation_to_terraform_file(terraform_file_path: Path, ir_operation: dict, resource_target: Optional[dict]) -> bool:
    """
    Apply single EDIT IR operation to Terraform configuration file. Returns True if file modified.
    """
    file_content = terraform_file_path.read_text() if terraform_file_path.exists() else ""
    if ir_operation["action"] == "create" and not file_content:
        file_content = 'terraform {}\n'  # Minimal terraform block placeholder

    resource_selector = ir_operation.get("selector") or {}
    target_resource_type = resource_selector.get("type") or (resource_target and resource_target.get("type"))
    target_resource_name = resource_selector.get("name") or (resource_target and resource_target.get("name"))

    if not target_resource_type:
        raise ValueError("selector.type is required in IR operation")

    # Locate or create resource block
    try:
        block_start, block_end = locate_resource_block_boundaries(file_content, target_resource_type, target_resource_name)
        resource_block = file_content[block_start:block_end]
    except ValueError:
        # Check if this operation has an explanation comment (auto-generated dependency)
        explanation_comment = ir_operation.get("explanation_comment", "")
        if explanation_comment:
            # Add comment block BEFORE the resource
            new_resource_block = f'{explanation_comment}\n\nresource "{target_resource_type}" "{target_resource_name or "auto"}" {{\n}}\n'
        else:
            new_resource_block = f'resource "{target_resource_type}" "{target_resource_name or "auto"}" {{\n}}\n'
        file_content = file_content + ("\n" if not file_content.endswith("\n") else "") + new_resource_block
        block_start, block_end = locate_resource_block_boundaries(file_content, target_resource_type, target_resource_name or "auto")
        resource_block = file_content[block_start:block_end]

    file_was_modified = False
    for modification in ir_operation.get("changes", []):
        if modification["op"] in ("set", "ensure_block"):
            modified_block, was_changed = _inject_configuration_path_in_block(resource_block, modification["path"], modification.get("value"))
        elif modification["op"] == "remove":
            modified_block, was_changed = _remove_configuration_path_from_block(resource_block, modification["path"])
        else:
            raise ValueError(f"unsupported IR change operation: {modification['op']}")
        if was_changed:
            file_content = file_content[:block_start] + modified_block + file_content[block_end:]
            block_length_delta = len(modified_block) - len(resource_block)
            block_end = block_end + block_length_delta
            resource_block = modified_block
            file_was_modified = True

    if file_was_modified:
        terraform_file_path.write_text(file_content)
    return file_was_modified

# Backwards-compatibility shim for older imports
def apply_op_to_file(terraform_file_path: Path, ir_operation: dict, resource_target: Optional[dict]) -> bool:
    return apply_ir_operation_to_terraform_file(terraform_file_path, ir_operation, resource_target)