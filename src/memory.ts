/**
 * Memory manager — orchestrates embeddings, storage, dedup, and decay.
 *
 * Ported from black-cat-py memory_manager.py.
 */

import type { DecayTag, EmbeddingProvider, MemoryRecord, SearchOptions, UpdateFields } from "./types.js";
import { DEDUP_COOLDOWN_MS, SEMANTIC_DEDUP_THRESHOLD } from "./types.js";
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

    // Semantic dedup — bump weight if a very similar memory already exists
    const nearest = this.store.findNearest(embedding, namespace);
    if (nearest && nearest.distance < SEMANTIC_DEDUP_THRESHOLD) {
      const newWeight = Math.min(1.0, nearest.record.metadata.weight + 0.1);
      this.store.updateWeight(nearest.record.id, newWeight);
      nearest.record.metadata.weight = newWeight;
      return nearest.record;
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

  // ── Batch add ───────────────────────────────────────────────────

  async addBatch(items: Array<{
    content: string;
    author: string;
    namespace?: string;
    tag?: DecayTag;
    categories?: string[];
    source?: string;
    project?: string;
    decision?: boolean;
    weight?: number;
  }>): Promise<{ added: number; deduped: number; failed: number }> {
    if (items.length === 0) return { added: 0, deduped: 0, failed: 0 };

    // Filter empties and dedup by hash within the batch
    const seenHashes = new Set<string>();
    const candidates: Array<typeof items[0] & { hash: string }> = [];

    for (const item of items) {
      if (!item.content?.trim()) continue;
      const hash = contentHash(item.content);
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);
      candidates.push({ ...item, hash });
    }

    // Check hash-based dedup against DB + filter timing dupes
    const toEmbed: typeof candidates = [];
    let deduped = 0;

    for (const item of candidates) {
      if (this.isRecentDuplicate(item.hash)) {
        deduped++;
        continue;
      }
      const existing = this.store.getByHash(item.hash);
      if (existing) {
        const newWeight = Math.min(1.0, existing.metadata.weight + 0.1);
        this.store.updateWeight(existing.id, newWeight);
        deduped++;
        continue;
      }
      toEmbed.push(item);
    }

    if (toEmbed.length === 0) return { added: 0, deduped, failed: 0 };

    // Batch embed all at once
    let embeddings: number[][];
    try {
      embeddings = await this.embeddings.embedBatch(toEmbed.map((i) => i.content));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mnemo] Batch embedding failed: ${msg}`);
      return { added: 0, deduped, failed: toEmbed.length };
    }

    // Semantic dedup + insert
    let added = 0;
    for (let i = 0; i < toEmbed.length; i++) {
      const item = toEmbed[i];
      const embedding = embeddings[i];
      const namespace = item.namespace ?? "default";

      // Semantic dedup check
      const nearest = this.store.findNearest(embedding, namespace);
      if (nearest && nearest.distance < SEMANTIC_DEDUP_THRESHOLD) {
        const newWeight = Math.min(1.0, nearest.record.metadata.weight + 0.1);
        this.store.updateWeight(nearest.record.id, newWeight);
        deduped++;
        continue;
      }

      const id = generateId(item.content, item.project);
      const record: MemoryRecord = {
        id,
        content: item.content,
        metadata: {
          tag: item.tag ?? "default",
          weight: item.weight ?? 0.5,
          timestamp: isoNow(),
          author: item.author,
          namespace,
          categories: item.categories ?? [],
          contentHash: item.hash,
          source: item.source,
          project: item.project,
          decision: item.decision ?? false,
        },
      };

      this.store.insert(record, embedding);
      added++;
    }

    return { added, deduped, failed: 0 };
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

  // ── Update ──────────────────────────────────────────────────────

  async update(
    id: string,
    fields: UpdateFields
  ): Promise<MemoryRecord | null> {
    const existing = this.store.get(id);
    if (!existing) return null;

    // If content changed, re-embed
    let newEmbedding: number[] | undefined;
    if (fields.content && fields.content !== existing.content) {
      try {
        newEmbedding = await this.embeddings.embed(fields.content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[mnemo] Re-embedding failed: ${msg}`);
        return null;
      }
    }

    const success = this.store.update(id, fields, newEmbedding);
    if (!success) return null;

    return this.store.get(id);
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
