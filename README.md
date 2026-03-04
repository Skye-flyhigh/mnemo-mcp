# Mnemo

Portable cognitive memory MCP server. Local-first, with semantic search and decay.

## What it does

Gives any MCP-compatible AI agent persistent memory that behaves like human memory:
- **Memories decay** unless reinforced — noise fades, important things stick
- **Deduplication** — same content bumps weight instead of duplicating
- **Namespaced** — multiple agents can share or isolate their memories
- **Semantic search** — find memories by meaning, not keywords

## Setup

```bash
npm install
npm run build
```

Requires [Ollama](https://ollama.ai) running locally with an embedding model:

```bash
ollama pull nomic-embed-text
```

## Configuration

Copy `.env.example` to `.env` or pass env vars through your MCP client config:

| Variable | Default | Description |
|----------|---------|-------------|
| `MNEMO_DB_PATH` | `~/.mnemo/memory.db` | SQLite database path |
| `MNEMO_EMBEDDING_MODEL` | `nomic-embed-text` | Ollama embedding model |
| `MNEMO_OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `MNEMO_DIMENSIONS` | `768` | Embedding vector dimensions |

## MCP Client Integration

### Claude Code

Add to your MCP settings (`.claude.json` or project settings):

```json
{
  "mcpServers": {
    "mnemo": {
      "command": "node",
      "args": ["/path/to/mnemo/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `remember` | Store a memory with tag, categories, and namespace |
| `recall` | Semantic search by query |
| `forget` | Delete a memory by ID |
| `bump` | Reinforce a memory's weight (+0.1 default) |
| `decay` | Run a decay cycle (tag-based weight reduction) |
| `inspect` | View a specific memory or aggregate stats |

## Decay System

Memories have a **tag** that controls how fast they fade:

| Tag | Rate | Use case |
|-----|------|----------|
| `core` | 0.0 | Never decays — identity, values |
| `crucial` | 0.01/cycle | Slow decay — relationships, key facts |
| `default` | 0.05/cycle | Normal decay — conversations, observations |

Weight floor is **0.1** — memories never fully disappear.

## License

MIT
