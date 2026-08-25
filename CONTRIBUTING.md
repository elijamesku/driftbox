# Contributing to Driftbox

Thanks for wanting to contribute. This guide covers local setup, the architecture, and how to submit changes.

## Local Development Setup

### Backend

```bash
# Clone and install
git clone https://github.com/elijamesku/driftbox.git
cd driftbox
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configure
cp .env.example .env
# Edit .env with your Supabase, LLM, and GitHub OAuth credentials

# Run database migrations
# Execute supabase_auth_schema.sql in your Supabase SQL editor

# Start
uvicorn app.main:application --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on http://localhost:3000 and proxies API requests to port 8000.

### Desktop App (optional)

```bash
cd frontend
npm run electron
```

See [BUILD_DESKTOP_APPS.md](BUILD_DESKTOP_APPS.md) for packaging.

## Architecture Overview

If you're going to contribute, understanding these three subsystems will cover 80% of the codebase:

### 1. The Collaboration Engine

**Backend:** `app/services/team_collaboration.py` (943 lines)
**WebSocket endpoint:** `app/api/v1/endpoints/team_collab.py` (464 lines)
**Frontend hook:** `frontend/hooks/useTeamCollaboration.ts` (972 lines)

This is the core of Driftbox. A single `TeamCollaborationManager` class maintains all in-memory state:

- `team_connections` — WebSocket refs keyed by `{team_id: {user_id: ws}}`
- `team_presence` — who's online, their name/email/avatar/status
- `file_activity` — which files are being edited and by whom
- `cursor_positions` — line/column for each user's cursor
- `file_locks` — exclusive and soft locks with a request queue
- `chat_messages` — last 100 messages per team
- `resource_dependencies` — dependency graph built from HCL references

The WebSocket endpoint at `/{team_id}/collaborate` handles 25 message types. The frontend hook manages the connection lifecycle, reconnection, message dispatch, and exposes the full collaboration API to React components.

**Key pattern:** The frontend broadcasts changes via `sendMessage()`, the backend routes them through the manager, and the manager calls `broadcast_to_team()` to fan out to all connected clients (excluding the sender).

### 2. The HCL Editor

**File:** `editor.py` (293 lines)

This is a programmatic Terraform editor. It can:

- Find a resource block by type/name in HCL text
- Set/update scalar attributes, lists, tags
- Create/replace nested blocks (e.g., `versioning { enabled = true }`)
- Upsert named blocks with full dict → HCL rendering
- Remove attributes and blocks

The entry point is `apply_op_to_file(tf_file, op, target)` which takes an "edit IR" operation and applies it to a `.tf` file. The AI generates these operations; the editor applies them safely.

### 3. Monaco + Remote Cursors

**File:** `frontend/components/IDE/editor/MonacoEditor.tsx` (1735 lines)

The editor renders remote cursors using Monaco's decoration and content widget APIs:

```typescript
// Each remote cursor gets:
// 1. A decoration (colored vertical bar at their cursor position)
decorations.push({
  range: new monaco.Range(cursor.line, cursor.column, ...),
  options: { beforeContentClassName: 'remote-cursor-bar' }
})

// 2. A content widget (floating name label above the cursor)
editor.addContentWidget({
  getDomNode: () => /* <div> with user name, colored background */,
  getPosition: () => ({ position: { lineNumber, column } })
})
```

Cursor positions are broadcast via WebSocket on every cursor move (throttled on the client side). The decorations update via a `useEffect` that watches the `remoteCursors` prop.

## Making Changes

### Branch naming

```
feature/description    # new features
fix/description        # bug fixes
docs/description       # documentation
refactor/description   # code improvements
```

### Code style

**Python:** Follow existing patterns. Use type hints. The codebase uses `async/await` throughout the backend.

**TypeScript/React:** Functional components with hooks. State management via React context (`IDEContext`, `AuthContext`, `GitHubContext`). Tailwind for styling.

**No comments unless the "why" is non-obvious.** Don't explain what the code does — name things well instead.

### Testing

```bash
# Backend
pytest

# Frontend
cd frontend && npm test
```

### Pull Requests

1. Fork the repo
2. Create a feature branch from `main`
3. Make your changes
4. Ensure tests pass
5. Open a PR with a clear description of what changed and why

## Areas That Need Work

These are real gaps, not busywork. Pick one and make it great:

### CRDT Text Sync
The current text sync broadcasts the full file content on every change (debounced at 150ms). This works but doesn't scale to large files or many simultaneous editors. Replacing it with Yjs or Automerge would give character-level collaborative editing like Google Docs.

### More Cloud Providers
`app/core/providers/` currently has AWS and DigitalOcean. Adding GCP and Azure resource templates + cost estimation would make Driftbox useful to a much wider audience.

### Terraform Plan Visualization
The validation pipeline runs `fmt` → `init` → `validate` → `plan`. The plan output is text. Rendering it as a visual diff of infrastructure (nodes being added/changed/destroyed) would be a killer feature.

### Plugin System
The IDE currently has hardcoded panels (chat, staging, dependency graph, terminal). A plugin API that lets users add custom panels, actions, and providers would open up extensibility.

### OpenTofu Support
Driftbox should work with OpenTofu with minimal changes (it shells out to `terraform` CLI). Testing and documenting this would help the community.

## Questions?

Open an issue or start a discussion. We're friendly.
