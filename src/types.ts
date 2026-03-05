/**
 * Core types for mnemo — portable cognitive memory.
 */


// ── Decay tags ──────────────────────────────────────────────────

export const DECAY_TAGS = ["core", "crucial", "default"] as const;
export type DecayTag = (typeof DECAY_TAGS)[number];

/** Tag-based decay rates applied once per cycle. */
export const DECAY_RATES: Record<DecayTag, number> = {
  core: 0.0,      // Never decays (identity, fundamental values)
  crucial: 0.01,  // Slow decay (important relationships, key facts)
  default: 0.05,  // Normal decay
};

/** Minimum weight — memories never drop below this. */
export const WEIGHT_FLOOR = 0.1;

/** Timing-based deduplication cooldown (milliseconds). */
export const DEDUP_COOLDOWN_MS = 10_000;

// ── Memory data structures ──────────────────────────────────────

export interface MemoryMetadata {
  tag: DecayTag;
  weight: number;          // 0.0–1.0 salience
  timestamp: string;       // ISO 8601
  author: string;          // Who created it (agent name, user, system)
  namespace: string;       // Agent/scope isolation ("echo", "cat", "shared")
  categories: string[];    // Semantic categories
  contentHash: string;     // SHA256 dedup key
  source?: string;         // Origin (tool, conversation, consolidation)
  project?: string;        // Project scope
  decision?: boolean;      // Decision memory for reflection
}

export interface MemoryRecord {
  id: string;
  content: string;
  metadata: MemoryMetadata;
  distance?: number;       // Populated by search results
}

// ── Search options ──────────────────────────────────────────────

export interface SearchOptions {
  namespace?: string;
  limit?: number;
  project?: string;
  categories?: string[];
  minWeight?: number;
  includeDecisions?: boolean;
}

// ── Store filter options ────────────────────────────────────────

export interface CountFilters {
  namespace?: string;
  tag?: DecayTag;
  project?: string;
}

// ── Embedding provider ─────────────────────────────────────────

export interface EmbeddingProvider {
  /** Generate an embedding vector for a single text. */
  embed(text: string): Promise<number[]>;
  /** Generate embeddings for multiple texts. */
  embedBatch(texts: string[]): Promise<number[][]>;
}

export type EmbeddingProviderType = "ollama" | "openai";

// ── Config ──────────────────────────────────────────────────────

export interface MnemoConfig {
  dbPath: string;
  embeddingProvider: EmbeddingProviderType;
  embeddingModel: string;
  embeddingBaseUrl: string;
  embeddingApiKey: string | null;
  dimensions: number;
}

/**
 * Load config from environment variables.
 * MCP clients pass env vars through their config — no .env file needed.
 * Provider-aware defaults: switching provider auto-adjusts model, URL, and dimensions.
 */
export function loadConfig(): MnemoConfig {
  const provider = (process.env.MNEMO_EMBEDDING_PROVIDER ?? "ollama") as EmbeddingProviderType;

  const defaultBaseUrl = provider === "openai"
    ? "https://api.openai.com"
    : "http://localhost:11434";

  const defaultModel = provider === "openai"
    ? "text-embedding-3-small"
    : "nomic-embed-text";

  const defaultDimensions = provider === "openai" ? "1536" : "768";

  return {
    dbPath: process.env.MNEMO_DB_PATH
      ?? joinHome(".mnemo", "memory.db"),
    embeddingProvider: provider,
    embeddingModel: process.env.MNEMO_EMBEDDING_MODEL
      ?? defaultModel,
    embeddingBaseUrl: (
      process.env.MNEMO_EMBEDDING_BASE_URL
      ?? process.env.MNEMO_OLLAMA_URL
      ?? defaultBaseUrl
    ).replace(/\/$/, ""),
    embeddingApiKey: process.env.MNEMO_EMBEDDING_API_KEY ?? null,
    dimensions: parseInt(process.env.MNEMO_DIMENSIONS ?? defaultDimensions, 10),
  };
}

function joinHome(...parts: string[]): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return [home, ...parts].join("/");
}
