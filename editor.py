# editor.py
import re, textwrap, json
from pathlib import Path
from typing import Optional, Any, Tuple
from app.utils.schemas import RESOURCE_RE

# ---------------- Core helpers ----------------

def find_resource_block(text: str, rtype: str, rname: Optional[str]) -> Tuple[int, int]:
    """
    Return (start_idx, end_idx) of resource block of type/name.
    If name is None, returns the first block of that type.
    Raises ValueError if not found or malformed.
    """
    best = None
    for m in RESOURCE_RE.finditer(text):
        if m.group("type") == rtype and (rname is None or m.group("name") == rname):
            i = m.end()
            depth = 1
            while i < len(text) and depth > 0:
                if text[i] == "{":
                    depth += 1
                elif text[i] == "}":
                    depth -= 1
                i += 1
            if depth != 0:
                raise ValueError("Unbalanced braces in resource block")
            best = (m.start(), i)
            break
    if not best:
        raise ValueError("Resource block not found")
    return best

def _to_hcl_scalar(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        # Properly quoted/escaped HCL string
        return json.dumps(v)
    if v is None:
        return "null"
    raise TypeError(f"Unsupported scalar type: {type(v)}")

def _to_hcl_list(lst: list) -> str:
    return "[ " + ", ".join(_to_hcl_scalar(x) for x in lst) + " ]"

def _render_value(v: Any) -> str:
    """
    Render a value suitable for a plain 'attr = value' assignment.
    Lists render to HCL lists. Dicts are NOT allowed here (must be blocks).
    """
    if isinstance(v, list):
        return _to_hcl_list(v)
    if isinstance(v, dict):
        # Dicts should be rendered as blocks; caller must handle that.
        raise ValueError("Cannot set dict as attribute value; use ensure_block semantics.")
    return _to_hcl_scalar(v)

# ----- Block rendering (supports nested dicts and lists-of-dicts) -----

def _render_block_body_from_obj(obj: dict, indent: str = "  ") -> str:
    """
    Render key/value pairs as either:
      - attr = scalar/list
      - nested_block { ... }
      - repeated nested_block { ... } for list-of-dicts
    """
    lines = []
    for k, v in obj.items():
        if isinstance(v, dict):
            lines.append(f"{indent}{k} {{")
            lines.append(_render_block_body_from_obj(v, indent + "  "))
            lines.append(f"{indent}}}")
        elif isinstance(v, list) and v and all(isinstance(i, dict) for i in v):
            for item in v:
                lines.append(f"{indent}{k} {{")
                lines.append(_render_block_body_from_obj(item, indent + "  "))
                lines.append(f"{indent}}}")
        elif isinstance(v, list):
            lines.append(f"{indent}{k} = {_to_hcl_list(v)}")
        else:
            lines.append(f"{indent}{k} = {_to_hcl_scalar(v)}")
    return "\n".join(lines)

def _upsert_named_block(parent_block: str, block_name: str, value_obj: dict) -> Tuple[str, bool]:
    """
    Create or replace a single-named block inside parent_block:
      block_name { ...rendered from value_obj... }
    If the block exists once, replace its body. If it does not exist, append before closing brace.
    If multiple exist, append another instance (safe for repeatable blocks).
    Returns (new_parent_block, changed).
    """
    # Regex for the block: start of line 'block_name { ... }'
    blk_re = re.compile(rf'(?ms)^\s*{re.escape(block_name)}\s*\{{(?P<body>.*?)^\s*\}}')
    m = blk_re.search(parent_block)
    rendered_body = _render_block_body_from_obj(value_obj, indent="  ")
    rendered_block = f"{block_name} {{\n{rendered_body}\n}}"

    if m:
        # Replace body
        new_block = parent_block[:m.start()] + rendered_block + parent_block[m.end():]
        return new_block, new_block != parent_block
    else:
        # Append before the closing brace of the parent block
        if not parent_block.endswith("}"):
            # not expected, but avoid corrupting
            return parent_block, False
        new_parent = parent_block[:-1] + "\n" + rendered_block + "\n}"
        return new_parent, True

# ---------------- Path writer/remover ----------------

def _ensure_path_in_block(block: str, path: str, value: Any) -> Tuple[str, bool]:
    """
    Naive injection with support for:
      - tags.Key updates
      - attr = scalar/list
      - one-level nested block + leaf (e.g., "versioning.enabled")
      - ensure_block-like behavior: path == "blockname" with dict -> create/replace that block's contents
      - repeated blocks: path == "blockname" with list-of-dicts -> append multiple blocks
    Returns (new_block, changed).
    """
    parts = path.split(".")
    changed = False

    # Special-case: tags.<k>
    if parts[0] == "tags" and len(parts) == 2:
        key = parts[1]
        tag_re = re.compile(r'(?ms)^\s*tags\s*=\s*\{(?P<body>.*?)^\s*\}')
        m = tag_re.search(block)
        if m:
            body = m.group("body")
            kv_re = re.compile(rf'(?m)^\s*{re.escape(key)}\s*=\s*".*?"\s*$')
            if kv_re.search(body):
                body2 = kv_re.sub(f'  {key} = {json.dumps(str(value))}', body)
            else:
                body2 = body.rstrip() + f'\n  {key} = {json.dumps(str(value))}\n'
            block = block[:m.start("body")] + body2 + block[m.end("body"):]
        else:
            insert = textwrap.dedent(f"""
                tags = {{
                  {key} = {json.dumps(str(value))}
                }}
            """).strip("\n")
            block = block[:-1] + "\n" + insert + "\n}"
        return block, True

    # One-level nested block + leaf (e.g., "versioning.enabled")
    if len(parts) == 2:
        block_name, leaf = parts
        blk_re = re.compile(rf'(?ms)^\s*{re.escape(block_name)}\s*\{{(?P<body>.*?)^\s*\}}')
        m = blk_re.search(block)
        if isinstance(value, dict):
            # If dict given at leaf, we cannot assign dict to leaf; require block semantics.
            # We will render/replace the whole nested block using the dict (with leaf as nested block name).
            # E.g., path="network_configuration.awsvpc_configuration", value={...}
            # -> network_configuration { awsvpc_configuration { ... } }
            nested_obj = {leaf: value}
            if m:
                # Replace full nested block body
                rendered_body = _render_block_body_from_obj(nested_obj, indent="  ")
                new_nested = f"{block_name} {{\n{rendered_body}\n}}"
                block = block[:m.start()] + new_nested + block[m.end():]
                return block, True
            else:
                # Create new nested block
                new_nested = f"{block_name} {{\n{_render_block_body_from_obj(nested_obj, indent='  ')}\n}}"
                block = block[:-1] + "\n" + new_nested + "\n}"
                return block, True
        else:
            # Set or replace leaf attribute inside nested block
            line = f'  {leaf} = {_render_value(value)}'
            if m:
                body = m.group("body")
                attr_re = re.compile(rf'(?m)^\s*{re.escape(leaf)}\s*=\s*.*$')
                if attr_re.search(body):
                    body2 = attr_re.sub(line, body)
                else:
                    body2 = body.rstrip() + "\n" + line + "\n"
                block = block[:m.start("body")] + body2 + block[m.end("body"):]
            else:
                insert = f"{block_name} {{\n{line}\n}}"
                block = block[:-1] + "\n" + insert + "\n}"
            return block, True

    # Flat attribute or top-level block insertion
    if len(parts) == 1:
        leaf_or_block = parts[0]

        # If dict → create/replace a named block with dict-rendered attributes/children
        if isinstance(value, dict):
            block2, changed = _upsert_named_block(block, leaf_or_block, value)
            return block2, changed

        # If list-of-dicts → create multiple blocks of same name
        if isinstance(value, list) and value and all(isinstance(i, dict) for i in value):
            changed_any = False
            block2 = block
            for item in value:
                block2_new, ch = _upsert_named_block(block2, leaf_or_block, item)
                changed_any = changed_any or ch
                block2 = block2_new
            return block2, changed_any

        # Else treat as plain attr assignment (scalar or list)
        attr_re = re.compile(rf'(?m)^\s*{re.escape(leaf_or_block)}\s*=\s*.*$')
        line = f'  {leaf_or_block} = {_render_value(value)}'
        if attr_re.search(block):
            block = attr_re.sub(line, block)
        else:
            block = block[:-1] + "\n" + line + "\n}"
        return block, True

    # deeper nesting not supported in this MVP
    return block, False

def _remove_path_in_block(block: str, path: str) -> Tuple[str, bool]:
    parts = path.split(".")
    if len(parts) == 1:
        leaf = parts[0]
        # Remove either an attribute or a single block with that name (best-effort)
        attr_re = re.compile(rf'(?m)^\s*{re.escape(leaf)}\s*=\s*.*$\n?')
        new_block, n1 = attr_re.subn("", block)

        blk_re = re.compile(rf'(?ms)^\s*{re.escape(leaf)}\s*\{{.*?^\s*\}}\s*')
        new_block2, n2 = blk_re.subn("", new_block)
        return new_block2, (n1 + n2) > 0
    # Deleting nested attrs/blocks not supported yet
    return block, False

# ---------------- Main entry ----------------

def apply_op_to_file(tf_file: Path, op: dict, target: Optional[dict]) -> bool:
    """
    Apply a single EDIT IR op to tf_file. Returns True if file modified.
    - set: supports scalar and list values; dict is rejected (use ensure_block semantics)
    - ensure_block: handled by passing a dict (or list-of-dicts) to _ensure_path_in_block
    """
    text = tf_file.read_text() if tf_file.exists() else ""
    if op["action"] == "create" and not text:
        text = 'terraform {}\n'  # minimal placeholder to keep file valid

    sel = op.get("selector") or {}
    rtype = sel.get("type") or (target and target.get("type"))
    rname = sel.get("name") or (target and target.get("name"))

    if not rtype:
        raise ValueError("selector.type required")

    # locate or create resource block
    try:
        rs, re_ = find_resource_block(text, rtype, rname)
        block = text[rs:re_]
    except ValueError:
        new_block = f'resource "{rtype}" "{rname or "auto"}" {{\n}}\n'
        text = text + ("\n" if not text.endswith("\n") else "") + new_block
        rs, re_ = find_resource_block(text, rtype, rname or "auto")
        block = text[rs:re_]

    changed_any = False
    for ch in op.get("changes", []):
        c_op = ch.get("op")
        path = ch.get("path")
        val = ch.get("value")

        if c_op == "set":
            # If dict arrives to 'set', refuse (must be a block)
            if isinstance(val, dict):
                raise ValueError(f"Cannot set dict at '{path}'. Use ensure_block instead.")
            block2, changed = _ensure_path_in_block(block, path, val)

        elif c_op == "ensure_block":
            # Accept dict or list-of-dicts (and even scalars/lists for lax callers)
            block2, changed = _ensure_path_in_block(block, path, val)

        elif c_op == "remove":
            block2, changed = _remove_path_in_block(block, path)

        else:
            raise ValueError(f"unsupported change op: {c_op}")

        if changed:
            text = text[:rs] + block2 + text[re_:]
            delta = len(block2) - len(block)
            re_ = re_ + delta
            block = block2
            changed_any = True

    if changed_any:
        tf_file.write_text(text)
    return changed_any
