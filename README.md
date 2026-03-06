# mnemo-mcp

Portable cognitive memory for AI agents. An MCP server with semantic search and decay.

## What it does

Gives any MCP-compatible AI agent persistent memory that behaves like human memory:
- **Memories decay** unless reinforced — noise fades, important things stick
- **Deduplication** — same content bumps weight instead of duplicating
- **Namespaced** — multiple agents can share or isolate their memories
- **Semantic search** — find memories by meaning, not keywords
- **Pluggable embeddings** — Ollama (local) or any OpenAI-compatible API
- **Multi-agent** — author tracking so you know who remembered what

## Quick start

```bash
npx mnemo-mcp
```

> **Node version note**: mnemo uses native addons (`better-sqlite3`, `sqlite-vec`) that are compiled for a specific Node ABI version. If you switch Node versions (e.g. via nvm), the cached npx install may break. Fix: `rm -rf ~/.npm/_npx/ && npx -y mnemo-mcp`, or use one of the stable install methods below.

### Stable install (recommended for MCP clients)

For MCP clients like Claude Code or Claude Desktop, a global install avoids npx cache issues:

```bash
npm install -g mnemo-mcp
```

Then configure your client with `"command": "mnemo-mcp"` instead of npx.

Alternatively, run from source:

```bash
git clone https://github.com/skye-flyhigh/mnemo-mcp.git
cd mnemo-mcp && npm install && npm run build
```

Then point your client to `"command": "node", "args": ["/path/to/mnemo-mcp/dist/cli.js"]`.

### Embedding provider

**Ollama (default, local)** — no API key needed, fully offline:

```bash
ollama pull nomic-embed-text
```

**OpenAI-compatible (cloud)** — set provider + API key in your MCP client config:

```
MNEMO_EMBEDDING_PROVIDER=openai
MNEMO_EMBEDDING_API_KEY=sk-...
```

This covers OpenAI, Azure OpenAI, Together AI, Voyage AI, Jina, and any service that speaks the `/v1/embeddings` format.

## Configuration

All config is passed via env vars through your MCP client config. Defaults work out of the box with Ollama.

| Variable | Default (ollama) | Default (openai) | Description |
|----------|-----------------|-------------------|-------------|
| `MNEMO_EMBEDDING_PROVIDER` | `ollama` | — | `ollama` or `openai` |
| `MNEMO_EMBEDDING_MODEL` | `nomic-embed-text` | `text-embedding-3-small` | Model name |
| `MNEMO_EMBEDDING_BASE_URL` | `http://localhost:11434` | `https://api.openai.com` | API base URL |
| `MNEMO_EMBEDDING_API_KEY` | — | (required) | API key for cloud providers |
| `MNEMO_DIMENSIONS` | `768` | `1536` | Embedding vector dimensions |
| `MNEMO_DB_PATH` | `~/.mnemo/memory.db` | `~/.mnemo/memory.db` | SQLite database path |

## Supported Clients

Works with any app that supports the [Model Context Protocol](https://modelcontextprotocol.io/clients):

| Client | Platform | Notes |
|--------|----------|-------|
| **Claude Desktop** | Mac, Windows | Local + remote MCP servers |
| **Claude Code** | Terminal | Full MCP support |
| **Claude.ai** | Web | Remote MCP servers |
| **ChatGPT** | Web | Developer Mode (Pro/Plus/Business/Enterprise) |
| **Cursor** | Mac, Windows, Linux | AI code editor |
| **Windsurf** | Mac, Windows, Linux | AI code editor |
| **VS Code** | Mac, Windows, Linux | Via Continue, Cline, or Copilot-MCP extensions |
| **Codex** (OpenAI) | Terminal | CLI coding agent |
| **Amazon Q** | Terminal, IDEs | AWS coding assistant |
| **Zed** | Mac, Linux | Code editor with MCP support |
| **BoltAI** | Mac, iOS | Multi-provider AI chat |
| **Chatbox** | Mac, Windows, Linux, Web | Open-source AI chat (37K+ stars) |

And [500+ more MCP clients](https://www.pulsemcp.com/clients). If your app supports MCP, mnemo works with it.

## Client Setup Examples

### Claude Code

Add to `.claude.json` (globally under `"/Users/you"` or per-project):

```json
{
  "mcpServers": {
    "mnemo": {
      "type": "stdio",
      "command": "npx",
      "args": ["mnemo-mcp"],
      "env": {}
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mnemo": {
      "command": "npx",
      "args": ["mnemo-mcp"]
    }
  }
}
```

### With OpenAI embeddings

Pass provider config through the `env` block:

```json
{
  "mcpServers": {
    "mnemo": {
      "command": "npx",
      "args": ["mnemo-mcp"],
      "env": {
        "MNEMO_EMBEDDING_PROVIDER": "openai",
        "MNEMO_EMBEDDING_API_KEY": "sk-..."
      }
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `remember` | Store a memory with tag, categories, and namespace |
| `remember_batch` | Store multiple memories in a single call (batch embedding) |
| `recall` | Semantic search by query (default 10 results, no hard cap) |
| `forget` | Delete a memory by ID |
| `update` | Patch an existing memory's content or metadata (re-embeds if content changes) |
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

## Deduplication

Mnemo prevents memory drift with three layers of dedup:

1. **Timing-based** — identical content within 10 seconds is silently dropped
2. **Hash-based** — exact duplicate content bumps the existing memory's weight instead of duplicating
3. **Semantic** — if new content is very similar to an existing memory (vector distance < 0.12), the existing memory's weight is bumped instead

## Roadmap

- [x] Pluggable embedding backends (Ollama local, OpenAI-compatible API)
- [x] Published to npm (`npx mnemo-mcp`)
- [ ] Register on MCP directories (Smithery, mcp.run)
- [ ] CLI companion for manual memory inspection/export
- [ ] Memory export/import (JSON)

## License

MIT
