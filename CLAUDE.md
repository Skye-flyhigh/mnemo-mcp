# CLAUDE.md — mnemo-mcp

## What is mnemo-mcp

A standalone MCP server that provides persistent, decaying, associative memory to any MCP-compatible AI agent. Local-first, pluggable embeddings, zero mandatory cloud dependency.

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
MNEMO_EMBEDDING_PROVIDER=ollama          # ollama (default) or openai
MNEMO_EMBEDDING_MODEL=nomic-embed-text   # Model name (provider-aware defaults)
MNEMO_EMBEDDING_BASE_URL=                # API base URL (provider-aware defaults)
MNEMO_EMBEDDING_API_KEY=                 # Required for openai provider
MNEMO_DIMENSIONS=768                     # Embedding dimensions
MNEMO_DB_PATH=~/.mnemo/memory.db         # SQLite database path
```

## Architecture

```
src/
  index.ts        # MCP server entry (stdio transport, 6 tools)
  store.ts        # VectorStore (better-sqlite3 + sqlite-vec)
  embeddings.ts   # Embedding providers (Ollama + OpenAI-compatible) + factory
  memory.ts       # Memory manager (add, search, delete, bump, decay)
  types.ts        # Types, interfaces, constants, config
  utils.ts        # Hash, ID generation helpers
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `remember` | Store a memory with tag, categories, namespace |
| `remember_batch` | Store multiple memories in one call (batch embedding) |
| `recall` | Semantic search by query (default 10 results) |
| `forget` | Delete a memory by ID |
| `update` | Patch content or metadata of an existing memory |
| `bump` | Reinforce a memory's weight |
| `decay` | Trigger decay cycle (tag-based weight reduction) |
| `inspect` | View a specific memory or aggregate stats |

## Key Concepts

- **Decay tags**: `core` (never decays), `crucial` (0.01/cycle), `default` (0.05/cycle)
- **Weight floor**: 0.1 — memories never fully disappear
- **Namespaces**: Agent isolation (e.g., "echo", "cat", "shared")
- **Deduplication**: Timing-based (10s cooldown) + hash-based (exact match) + semantic (vector distance < 0.12)
- **EmbeddingProvider interface**: `embed(text)` + `embedBatch(texts)` — implemented by OllamaEmbedding and OpenAIEmbedding
- **Factory**: `createEmbeddingProvider(config)` selects provider based on `MNEMO_EMBEDDING_PROVIDER` env var

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `better-sqlite3` — Sync SQLite bindings (native addon, Node <23)
- `sqlite-vec` — Vector similarity search extension
- `zod` — Schema validation (MCP SDK requirement)

## Design Principles

1. **Local-first** — SQLite file, local embeddings by default, no cloud required
2. **Agent-agnostic** — Any MCP client connects and gets memory
3. **Cognitive** — Memories decay, get reinforced, and self-organize
4. **Small by conviction** — Minimal core, maximal intent
5. **No new deps** — Native `fetch()` for all HTTP, no SDK bloat
