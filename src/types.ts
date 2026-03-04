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

// ── Config ──────────────────────────────────────────────────────

export interface MnemoConfig {
  dbPath: string;
  embeddingModel: string;
  ollamaUrl: string;
  dimensions: number;
}

export function loadConfig(): MnemoConfig {
  return {
    dbPath: process.env.MNEMO_DB_PATH
      ?? joinHome(".mnemo", "memory.db"),
    embeddingModel: process.env.MNEMO_EMBEDDING_MODEL
      ?? "nomic-embed-text",
    ollamaUrl: process.env.MNEMO_OLLAMA_URL
      ?? "http://localhost:11434",
    dimensions: parseInt(process.env.MNEMO_DIMENSIONS ?? "768", 10),
  };
}

function joinHome(...parts: string[]): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return [home, ...parts].join("/");
}
