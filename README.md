# Mnemo — Portable Memory MCP Server

## Context

AI agents have amnesia. Every session starts from zero. The black cat's memory system (sqlite-vec, decay, dedup, weight bumping) solves this — but it's embedded inside the cat. Other agents (Claude Code, Cursor, etc.) can't use it.

**Mnemo** is a standalone MCP server that extracts the cat's cognitive memory into a shared service. Any MCP-compatible client connects and gets persistent, decaying, associative memory. The cat becomes a client instead of owning the memory internally.

Inspired by Open Brain, brain-mcp, and similar projects — but with a key differentiator: **cognitive decay**. Memories fade unless reinforced. Core memories persist. This isn't a flat database, it's a portable hippocampus.

**Location**: `/Users/skye/Documents/Coding/Nyx/black-cat/mnemo`
**Language**: TypeScript (reusing patterns from black-cat-ts)
**Dependencies**: `@modelcontextprotocol/sdk`, `better-sqlite3`, `sqlite-vec`, `zod`

---

## Architecture

```
mnemo/
├── src/
│   ├── index.ts              # MCP server entry point (stdio transport)
│   ├── store.ts              # SqliteVecStore (sqlite-vec + better-sqlite3)
│   ├── embeddings.ts         # Ollama embedding generation
│   ├── memory.ts             # Memory manager (add, search, delete, bump, decay)
│   ├── types.ts              # MemoryRecord, MemoryMetadata, DecayTag types
│   └── utils.ts              # Hash, ID generation helpers
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── README.md
```

---

## Plan

### 1. Scaffold the project

Create `/Users/skye/Documents/Coding/Nyx/black-cat/mnemo` with:

**package.json**:
- `name`: `mnemo`
- `type`: `module`
- `bin`: `dist/index.js`
- Dependencies: `@modelcontextprotocol/sdk`, `better-sqlite3`, `sqlite-vec`, `zod`
- Dev: `@types/better-sqlite3`, `@types/node`, `typescript`
- Scripts: `build` (tsc), `start` (node dist/index.js)

**tsconfig.json**:
- Target: ES2022, module: Node16
- Strict mode, outDir: dist, rootDir: src

### 2. Define types — `src/types.ts`

Port from both Python (`vector_store.py`) and TS (`memory.types.ts`):

```typescript
type DecayTag = "core" | "crucial" | "default";

interface MemoryMetadata {
  tag: DecayTag;
  weight: number;          // 0.0-1.0 salience
  timestamp: string;       // ISO 8601
  author: string;          // Who created it (agent name, user, system)
  namespace: string;       // Agent/scope isolation (e.g., "echo", "cat", "shared")
  categories: string[];    // Semantic categories
  contentHash: string;     // SHA256 dedup key
  source?: string;         // Origin (tool, conversation, consolidation)
  project?: string;        // Project scope
  decision?: boolean;      // Decision memory for reflection
}

interface MemoryRecord {
  id: string;
  content: string;
  metadata: MemoryMetadata;
  distance?: number;       // Populated by search
}
```

Constants:
```typescript
const DECAY_RATES = { core: 0.0, crucial: 0.01, default: 0.05 };
const WEIGHT_FLOOR = 0.1;
const DEDUP_COOLDOWN_MS = 10_000;
```

### 3. Implement VectorStore — `src/store.ts`

Reuse patterns from `black-cat-ts/app/lib/memory/core/SqliteVecStore.ts`:
- `better-sqlite3` for sync SQLite operations
- `sqlite-vec` extension loaded via `sqliteVec.load(db)`
- Embedding serialized as `Buffer.from(new Float32Array(embedding).buffer)`

**SQL Schema** (from Python, enhanced with namespace):
```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tag TEXT NOT NULL DEFAULT 'default',
  weight REAL NOT NULL DEFAULT 0.5,
  timestamp TEXT NOT NULL,
  author TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  categories TEXT NOT NULL DEFAULT '[]',  -- JSON array
  content_hash TEXT NOT NULL,
  source TEXT,
  project TEXT,
  decision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE VIRTUAL TABLE memory_vectors USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[768]
);

-- Indexes: tag, namespace, project, content_hash
```

**Methods** (mirror Python VectorStore):
- `insert(record, embedding)` — upsert metadata + vector
- `get(id)` / `getByHash(hash)` — single record lookup
- `search(embedding, options)` — vector similarity with filters (namespace, project, minWeight, categories)
- `updateWeight(id, weight)` — weight modification
- `delete(id)` — remove from both tables
- `decayWeights()` — tag-based decay with floor at 0.1
- `count(filters)` — count with optional namespace/tag/project filters
- `close()` — cleanup

### 4. Implement embeddings — `src/embeddings.ts`

Minimal Ollama embedding client (no litellm dependency):
- HTTP POST to `http://localhost:11434/api/embed` (Ollama native endpoint)
- Model: `nomic-embed-text` (768 dims, configurable)
- Configurable via env vars: `MNEMO_EMBEDDING_MODEL`, `MNEMO_OLLAMA_URL`
- Returns `number[]`

### 5. Implement Memory manager — `src/memory.ts`

Port from Python `memory_manager.py`:
- `add(content, author, namespace, tag, categories, ...)` — with dual dedup (timing + hash-based bump)
- `search(query, namespace, limit, ...)` — embed query then vector search
- `get(id)` / `delete(id)` / `bumpWeight(id, amount)`
- `decayAll()` — daily decay trigger
- In-memory `Map<string, number>` for timing-based dedup cache

### 6. Wire MCP server — `src/index.ts`

Using `@modelcontextprotocol/sdk`:

```typescript
const server = new McpServer({ name: "mnemo", version: "0.1.0" });
```

**Tools** (6 total):

1. **`remember`** — Store a memory
   - Params: `content` (required), `namespace`, `tag`, `categories`, `project`, `author`
   - Returns: stored record ID + metadata, or dedup message

2. **`recall`** — Search memories semantically
   - Params: `query` (required), `namespace`, `limit`, `project`, `categories`, `minWeight`
   - Returns: ranked list of matching memories with weight/distance

3. **`forget`** — Delete a memory
   - Params: `id` (required)
   - Returns: success/not found

4. **`bump`** — Reinforce a memory's weight
   - Params: `id` (required), `amount` (default 0.1)
   - Returns: new weight

5. **`decay`** — Trigger decay cycle
   - No required params
   - Returns: count of memories decayed per tag

6. **`inspect`** — View memory stats or a specific memory
   - Params: `id` (optional), `namespace` (optional)
   - Returns: single record details, or aggregate stats (count by tag, namespace, project)

**Transport**: stdio (standard for local MCP servers)

**Config via env vars**:
- `MNEMO_DB_PATH` — SQLite database path (default: `~/.mnemo/memory.db`)
- `MNEMO_EMBEDDING_MODEL` — Ollama model (default: `nomic-embed-text`)
- `MNEMO_OLLAMA_URL` — Ollama base URL (default: `http://localhost:11434`)
- `MNEMO_DIMENSIONS` — Embedding dimensions (default: 768)

### 7. Add CLAUDE.md

Project context file so any AI working on mnemo understands the codebase.

---

## Integration

### Claude Code (claude_desktop_config.json or .claude settings)
```json
{
  "mcpServers": {
    "mnemo": {
      "command": "node",
      "args": ["/path/to/mnemo/dist/index.js"],
      "env": {
        "MNEMO_DB_PATH": "~/.mnemo/memory.db"
      }
    }
  }
}
```

### Black Cat (future)
The cat connects as an MCP client, replacing its internal `Memory` class with mnemo calls. The existing `MemoryTool` routes through MCP instead of direct store access.

---

## Reusable Code from black-cat-ts

- **`SqliteVecStore.ts`** — sqlite-vec loading pattern, `Float32Array` → `Buffer` serialization, search query structure
- **`memory.types.ts`** — `MemoryTag`, `SearchOptions`, `SearchResult` type patterns
- **`DecayService.ts`** — decay tag classification patterns
- **`EmbeddingGenerator.ts`** — Ollama embedding call pattern

---

## Verification

```bash
cd /Users/skye/Documents/Coding/Nyx/black-cat/mnemo
npm install && npm run build

# Test with MCP inspector
npx @modelcontextprotocol/inspector node dist/index.js

# Manual: remember → recall → bump → decay → forget
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```
