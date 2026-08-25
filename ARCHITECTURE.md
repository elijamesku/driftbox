# Architecture Deep Dive

This document covers the internals of Driftbox's three core systems: the real-time collaboration protocol, the HCL programmatic editor, and the cursor rendering pipeline.

## 1. Real-Time Collaboration Protocol

### Connection Lifecycle

```
Client                           Server
  │                                │
  │── WebSocket CONNECT ──────────▶│
  │   ?user_id=X&token=T&         │
  │    user_name=Name             │
  │                                │
  │◀── initial_state ─────────────│  (online_users, file_activity,
  │                                │   recent_changes, chat_messages,
  │                                │   cursor_positions)
  │                                │
  │── broadcast to others ────────▶│  "user_joined"
  │                                │
  │   ┌─── message loop ─────┐    │
  │   │                      │    │
  │── │ file_open            │───▶│── broadcast "file_editing_started"
  │── │ text_change          │───▶│── broadcast "text_changed" (full content)
  │── │ cursor_move          │───▶│── broadcast "cursor_moved"
  │── │ chat_message         │───▶│── broadcast to all
  │── │ acquire_lock         │───▶│── grant/deny + broadcast "file_locked"
  │── │ ping                 │───▶│◀── pong (update last_seen)
  │   │                      │    │
  │   └──────────────────────┘    │
  │                                │
  │── leave / disconnect ─────────▶│── cleanup + broadcast "user_left"
```

### Message Types (25 total)

**Presence (4)**
| Message | Direction | Payload |
|---|---|---|
| `file_open` | client → server | `{repo, file_path}` |
| `file_close` | client → server | `{repo, file_path}` |
| `ping` | client → server | `{}` (heartbeat every 30s) |
| `leave` | client → server | `{}` (explicit disconnect) |

**Editing (3)**
| Message | Direction | Payload |
|---|---|---|
| `text_change` | client → server → all | `{repo, file_path, full_content}` |
| `cursor_move` | client → server → all | `{file_path, line, column, repo}` |
| `file_change` | client → server → all | `{repo, file_path, change: {action, lines_changed}}` |

**File Sync (2)**
| Message | Direction | Payload |
|---|---|---|
| `files_updated` | client → server → all | `{repo, files: [{path, content, action}]}` |
| `files_discarded` | client → server → all | `{repo, files: [{path, action}]}` |

**Locking (6)**
| Message | Direction | Payload |
|---|---|---|
| `acquire_lock` | client → server | `{repo, file_path, lock_type}` |
| `release_lock` | client → server | `{repo, file_path}` |
| `request_lock` | client → server | `{repo, file_path}` |
| `get_lock_status` | client → server | `{repo, file_path}` |
| `lock_files_for_pr` | client → server → all | `{files: [paths], activity_status}` |
| `unlock_files_from_pr` | client → server → all | `{}` |

**Intent (3)**
| Message | Direction | Payload |
|---|---|---|
| `intent_change` | client → server → all | `{intent}` (exploring/implementing/debugging/...) |
| `pr_intent_change` | client → server → all | `{pr_intent}` (work-in-progress/ready-for-pr) |
| `activity_status_change` | client → server → all | `{activity_status}` (idle/editing/generating/creating_pr) |

**Team (3)**
| Message | Direction | Payload |
|---|---|---|
| `chat_message` | client → server → all | `{message, code_ref?}` |
| `typing` | client → server → all | `{is_typing}` |
| `create_team_pr` | client → server → all | `{contributors, title, description}` |

**Dependencies (4)**
| Message | Direction | Payload |
|---|---|---|
| `update_dependencies` | client → server | `{repo, resources: [{address, type, name, file, references}]}` |
| `resource_changed` | client → server → affected | `{repo, resource, change_type}` |
| `get_dependents` | client → server | `{repo, resource}` |
| `get_dependency_graph` | client → server | `{repo}` |

### State Management

All collaboration state lives in-memory on the server in a single `TeamCollaborationManager` instance. This is intentional for the MVP — it means zero database latency for cursor updates and broadcasts.

```python
class TeamCollaborationManager:
    team_connections:       {team_id: {user_id: websocket}}
    team_presence:          {team_id: {user_id: {name, email, status, ...}}}
    file_activity:          {team_id: {"repo:path": {user_id, user_name, ...}}}
    cursor_positions:       {team_id: {user_id: {file_path, line, column}}}
    file_locks:             {team_id: {"repo:path": {user_id, lock_type, ...}}}
    lock_requests:          {team_id: {"repo:path": [{user_id, ...}]}}
    chat_messages:          {team_id: [messages]}  # last 100
    resource_dependencies:  {team_id: {repo: {resource: [dependents]}}}
```

Trade-offs:
- **Pro:** Sub-millisecond broadcast latency. No DB round-trip for cursor moves.
- **Con:** State is lost on server restart. Horizontal scaling requires shared state (Redis/NATS).
- **Future:** Move to Redis pub/sub for multi-instance deployments while keeping the in-memory hot path.

### File Locking Protocol

```
Engineer A                Server              Engineer B
    │                       │                     │
    │── acquire_lock ──────▶│                     │
    │◀── lock_result ───────│                     │
    │   {success: true}     │── file_locked ─────▶│
    │                       │                     │
    │                       │◀── acquire_lock ────│
    │                       │── lock_result ──────▶│
    │                       │   {success: false,   │
    │                       │    locked_by: "A"}   │
    │                       │                     │
    │                       │◀── request_lock ────│
    │◀── lock_requested ───│                     │
    │   "B is waiting"      │                     │
    │                       │                     │
    │── release_lock ──────▶│                     │
    │                       │── lock_available ──▶│
    │                       │   "Lock is free!"    │
```

Two lock types:
- **Exclusive** — nobody else can edit the file until released
- **Soft** — others get a warning but can still edit (for advisory locking)

## 2. HCL Programmatic Editor

### Pipeline

```
Natural language prompt
        │
        ▼
   LLM (Claude/GPT-4o)
        │
        ▼
   Edit IR (JSON operations)
        │
        ▼
   editor.py :: apply_op_to_file()
        │
        ├── find_resource_block()     # Locate resource by type/name
        ├── _ensure_path_in_block()   # Set attributes, nested blocks
        ├── _upsert_named_block()     # Create/replace named blocks
        └── _remove_path_in_block()   # Delete attributes/blocks
        │
        ▼
   Modified .tf file (valid HCL)
```

### Edit IR Format

The AI generates operations in this intermediate representation:

```json
{
  "action": "modify",
  "selector": {"type": "aws_s3_bucket", "name": "data"},
  "changes": [
    {"op": "set", "path": "versioning.enabled", "value": true},
    {"op": "set", "path": "tags.Environment", "value": "production"},
    {"op": "ensure_block", "path": "lifecycle_rule", "value": {
      "enabled": true,
      "transition": {"days": 30, "storage_class": "GLACIER"}
    }},
    {"op": "remove", "path": "acl"}
  ]
}
```

### Block Finding Algorithm

`find_resource_block()` uses regex to find `resource "type" "name" {` and then walks the text character-by-character counting brace depth to find the matching `}`. This handles nested blocks correctly.

```python
for m in RESOURCE_RE.finditer(text):
    if m.group("type") == rtype:
        i = m.end()
        depth = 1
        while i < len(text) and depth > 0:
            if text[i] == "{": depth += 1
            elif text[i] == "}": depth -= 1
            i += 1
        return (m.start(), i)
```

### Value Rendering

The editor handles the full HCL value space:

| Python Type | HCL Output |
|---|---|
| `bool` | `true` / `false` |
| `int`, `float` | `42`, `3.14` |
| `str` | `"quoted and escaped"` |
| `None` | `null` |
| `list` | `[ "a", "b", "c" ]` |
| `dict` | Rendered as a nested block |
| `list[dict]` | Repeated blocks (e.g., multiple `ingress {}`) |

## 3. Cursor Rendering Pipeline

### Data Flow

```
User A types                User B's editor
    │                           │
    │ onCursorPositionChange    │
    ▼                           │
useTeamCollaboration            │
    │ notifyCursorMove()        │
    │ (debounced 150ms)         │
    ▼                           │
WebSocket ──────────────────▶ WebSocket
    │                           │
    │                     handleMessage()
    │                     case 'cursor_moved':
    │                           │
    │                     setCursorPositions()
    │                           │
    │                     IDELayout passes
    │                     remoteCursors prop
    │                           │
    │                     MonacoEditor useEffect
    │                           │
    │                     ┌─────┴─────┐
    │                     │           │
    │              deltaDecorations  addContentWidget
    │              (cursor bar)      (name label)
    │                     │           │
    │                     ▼           ▼
    │                  ┌─────────────────┐
    │                  │  Rendered in    │
    │                  │  Monaco Editor  │
    │                  │                 │
    │                  │  Alice|         │
    │                  │  █ let vpc =    │
    │                  └─────────────────┘
```

### Cursor Colors

Each remote user gets a deterministic color. The cursor bar is a 2px-wide vertical line rendered as a CSS `::before` pseudo-element on a Monaco decoration. The name label is a Monaco content widget positioned above the cursor with `ContentWidgetPositionPreference.ABOVE`.

### Cross-Machine File Sync (Desktop)

When User A's AI agent creates files, the sync flow is:

```
User A (AI generates files)
    │
    ├── Files written to A's local disk
    │
    ├── notifyFilesUpdated(repo, [{path, content, action}])
    │       │
    │       ▼
    │   WebSocket → Server → broadcast "files_updated"
    │                              │
    │                              ▼
    │                         User B's hook
    │                         case 'files_updated':
    │                              │
    │                    electronAPI.writeFile(owner, repo, path, content)
    │                              │
    │                    await Promise.all(writePromises)
    │                              │
    │                    onFilesUpdatedRef.current()  // refresh file tree
    │                              │
    │                         User B sees new files
```

This is the "multiplayer AI" flow — one person asks the AI to generate infrastructure code, and the generated files appear on every teammate's machine.

## Scaling Considerations

The current architecture is designed for small teams (2–10 engineers). To scale:

1. **Collaboration state → Redis** — Replace the in-memory dicts with Redis hashes and pub/sub for cross-instance broadcasting
2. **Text sync → CRDT** — Replace full-content broadcast with Yjs or Automerge for character-level OT
3. **WebSocket → NATS/Redis Streams** — Fan-out via message broker instead of direct WebSocket loops
4. **Database → connection pooling** — Add PgBouncer or Supavisor for high-concurrency
5. **File sync → delta compression** — Send diffs instead of full file content for large files
