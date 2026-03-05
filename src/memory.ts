/**
 * Memory manager — orchestrates embeddings, storage, dedup, and decay.
 *
 * Ported from black-cat-py memory_manager.py.
 */

import type { DecayTag, EmbeddingProvider, MemoryRecord, SearchOptions } from "./types.js";
import { DEDUP_COOLDOWN_MS } from "./types.js";
import { contentHash, generateId, isoNow } from "./utils.js";
import type { VectorStore } from "./store.js";

export class Memory {
  private embeddings: EmbeddingProvider;
  private store: VectorStore;

  /** Timing-based dedup cache: contentHash -> timestamp (ms). */
  private recentHashes = new Map<string, number>();

  constructor(embeddings: EmbeddingProvider, store: VectorStore) {
    this.embeddings = embeddings;
    this.store = store;
  }

  // ── Add ───────────────────────────────────────────────────────

  async add(opts: {
    content: string;
    author: string;
    namespace?: string;
    tag?: DecayTag;
    categories?: string[];
    source?: string;
    project?: string;
    decision?: boolean;
    weight?: number;
  }): Promise<MemoryRecord | null> {
    const {
      content,
      author,
      namespace = "default",
      tag = "default",
      categories = [],
      source,
      project,
      decision = false,
      weight = 0.5,
    } = opts;

    // Reject empty content
    if (!content || !content.trim()) {
      return null;
    }

    const hash = contentHash(content);

    // Timing-based dedup
    if (this.isRecentDuplicate(hash)) {
      return null;
    }

    // Persistent hash-based dedup — bump weight instead of duplicating
    const existing = this.store.getByHash(hash);
    if (existing) {
      const newWeight = Math.min(1.0, existing.metadata.weight + 0.1);
      this.store.updateWeight(existing.id, newWeight);
      return existing;
    }

    // Generate embedding
    let embedding: number[];
    try {
      embedding = await this.embeddings.embed(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mnemo] Embedding failed: ${msg}`);
      return null;
    }

    // Create record
    const id = generateId(content, project);
    const record: MemoryRecord = {
      id,
      content,
      metadata: {
        tag,
        weight,
        timestamp: isoNow(),
        author,
        namespace,
        categories,
        contentHash: hash,
        source,
        project,
        decision,
      },
    };

    this.store.insert(record, embedding);
    return record;
  }

  // ── Search ────────────────────────────────────────────────────

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<MemoryRecord[]> {
    let embedding: number[];
    try {
      embedding = await this.embeddings.embed(query);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mnemo] Query embedding failed: ${msg}`);
      return [];
    }

    return this.store.search(embedding, options);
  }

  // ── Single-record operations ──────────────────────────────────

  get(id: string): MemoryRecord | null {
    return this.store.get(id);
  }

  delete(id: string): boolean {
    return this.store.delete(id);
  }

  bumpWeight(id: string, amount: number = 0.1): boolean {
    const record = this.store.get(id);
    if (!record) return false;

    const newWeight = Math.min(1.0, record.metadata.weight + amount);
    return this.store.updateWeight(id, newWeight);
  }

  // ── Decay ─────────────────────────────────────────────────────

  decayAll(): Record<DecayTag, number> {
    return this.store.decayWeights();
  }

  // ── Stats ─────────────────────────────────────────────────────

  count(filters?: { namespace?: string; tag?: DecayTag; project?: string }): number {
    return this.store.count(filters);
  }

  // ── Dedup internals ───────────────────────────────────────────

  private isRecentDuplicate(hash: string): boolean {
    const now = Date.now();
    const lastTime = this.recentHashes.get(hash);

    if (lastTime != null && now - lastTime < DEDUP_COOLDOWN_MS) {
      return true;
    }

    this.recentHashes.set(hash, now);
    return false;
  }
}
