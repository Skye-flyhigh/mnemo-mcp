# CLAUDE.md — Mnemo

## What is Mnemo

A standalone MCP server that provides persistent, decaying, associative memory to any MCP-compatible AI agent. Local-first, zero cloud dependency.

Part of the Black Cat ecosystem by Skye, but designed to work independently with any MCP client (Claude Code, Cursor, VS Code, etc.).

### Key differentiator
Cognitive decay. Memories fade unless reinforced. Core memories persist. This isn't a flat database — it's a portable hippocampus.

## Quick Reference

### Build & Run
```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm start            # Run the MCP server (stdio)
npm run dev          # Watch mode
```

### Test with MCP Inspector
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### Environment Variables
```bash
MNEMO_DB_PATH=~/.mnemo/memory.db       # SQLite database path
MNEMO_EMBEDDING_MODEL=nomic-embed-text  # Ollama model
MNEMO_OLLAMA_URL=http://localhost:11434 # Ollama base URL
MNEMO_DIMENSIONS=768                    # Embedding dimensions
```

## Architecture

```
src/
  index.ts        # MCP server entry (stdio transport, 6 tools)
  store.ts        # VectorStore (better-sqlite3 + sqlite-vec)
  embeddings.ts   # Ollama embedding client
  memory.ts       # Memory manager (add, search, delete, bump, decay)
  types.ts        # Types, constants, config
  utils.ts        # Hash, ID generation helpers
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `remember` | Store a memory with tag, categories, namespace |
| `recall` | Semantic search by query |
| `forget` | Delete a memory by ID |
| `bump` | Reinforce a memory's weight |
| `decay` | Trigger decay cycle (tag-based weight reduction) |
| `inspect` | View a specific memory or aggregate stats |

## Key Concepts

- **Decay tags**: `core` (never decays), `crucial` (0.01/cycle), `default` (0.05/cycle)
- **Weight floor**: 0.1 — memories never fully disappear
- **Namespaces**: Agent isolation (e.g., "echo", "cat", "shared")
- **Deduplication**: Timing-based (10s cooldown) + hash-based (bumps weight instead of duplicating)

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `better-sqlite3` — Sync SQLite bindings
- `sqlite-vec` — Vector similarity search extension
- `zod` — Schema validation (MCP SDK requirement)

Requires Ollama running locally for embedding generation.

## Design Principles

1. **Local-first** — SQLite file, local embeddings, no cloud
2. **Agent-agnostic** — Any MCP client connects and gets memory
3. **Cognitive** — Memories decay, get reinforced, and self-organize
4. **Small by conviction** — Minimal core, maximal intent
