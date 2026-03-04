/**
 * SqliteVecStore — vector store backed by better-sqlite3 + sqlite-vec.
 *
 * Ported from black-cat-py VectorStore and black-cat-ts SqliteVecStore.
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type {
  CountFilters,
  DecayTag,
  MemoryMetadata,
  MemoryRecord,
  SearchOptions,
} from "./types.js";
import { DECAY_RATES, WEIGHT_FLOOR } from "./types.js";
import { isoNow } from "./utils.js";

export class VectorStore {
  private db: Database.Database;
  private dimensions: number;

  constructor(dbPath: string, dimensions: number = 768) {
    this.dimensions = dimensions;

    // Ensure parent directory exists
    mkdirSync(dirname(dbPath), { recursive: true });

    // Open database and load sqlite-vec
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);

    this.createTables();
  }

  // ── Schema ──────────────────────────────────────────────────────

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tag TEXT NOT NULL DEFAULT 'default',
        weight REAL NOT NULL DEFAULT 0.5,
        timestamp TEXT NOT NULL,
        author TEXT NOT NULL,
        namespace TEXT NOT NULL DEFAULT 'default',
        categories TEXT NOT NULL DEFAULT '[]',
        content_hash TEXT NOT NULL,
        source TEXT,
        project TEXT,
        decision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_tag ON memories(tag);
      CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
      CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[${this.dimensions}]
      )
    `);
  }

  // ── Write operations ──────────────────────────────────────────

  insert(record: MemoryRecord, embedding: number[]): void {
    const meta = record.metadata;

    const insertMeta = this.db.prepare(`
      INSERT OR REPLACE INTO memories
      (id, content, tag, weight, timestamp, author, namespace, categories,
       content_hash, source, project, decision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertVec = this.db.prepare(
      "INSERT OR REPLACE INTO memory_vectors (id, embedding) VALUES (?, ?)"
    );

    const txn = this.db.transaction(() => {
      insertMeta.run(
        record.id,
        record.content,
        meta.tag,
        meta.weight,
        meta.timestamp,
        meta.author,
        meta.namespace,
        JSON.stringify(meta.categories),
        meta.contentHash,
        meta.source ?? null,
        meta.project ?? null,
        meta.decision ? 1 : 0
      );

      const buffer = Buffer.from(new Float32Array(embedding).buffer);
      insertVec.run(record.id, buffer);
    });

    txn();
  }

  updateWeight(id: string, weight: number): boolean {
    const stmt = this.db.prepare(
      "UPDATE memories SET weight = ?, updated_at = ? WHERE id = ?"
    );
    const result = stmt.run(weight, isoNow(), id);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const txn = this.db.transaction(() => {
      const result = this.db
        .prepare("DELETE FROM memories WHERE id = ?")
        .run(id);
      this.db.prepare("DELETE FROM memory_vectors WHERE id = ?").run(id);
      return result.changes > 0;
    });
    return txn();
  }

  // ── Read operations ───────────────────────────────────────────

  get(id: string): MemoryRecord | null {
    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;

    return row ? this.rowToRecord(row) : null;
  }

  getByHash(hash: string): MemoryRecord | null {
    const row = this.db
      .prepare("SELECT * FROM memories WHERE content_hash = ?")
      .get(hash) as Record<string, unknown> | undefined;

    return row ? this.rowToRecord(row) : null;
  }

  search(queryEmbedding: number[], options: SearchOptions = {}): MemoryRecord[] {
    const limit = options.limit ?? 5;
    const buffer = Buffer.from(new Float32Array(queryEmbedding).buffer);

    let sql = `
      SELECT m.*, v.distance
      FROM memory_vectors v
      JOIN memories m ON v.id = m.id
      WHERE v.embedding MATCH ?
        AND k = ?
    `;
    const params: unknown[] = [buffer, limit * 2];

    if (options.namespace) {
      sql += " AND m.namespace = ?";
      params.push(options.namespace);
    }

    if (options.project) {
      sql += " AND m.project = ?";
      params.push(options.project);
    }

    if (options.minWeight != null && options.minWeight > 0) {
      sql += " AND m.weight >= ?";
      params.push(options.minWeight);
    }

    if (!options.includeDecisions) {
      sql += " AND m.decision = 0";
    }

    sql += " ORDER BY v.distance LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];

    let results = rows.map((row) => this.rowToRecord(row));

    // Category filtering (done in JS because categories are JSON)
    if (options.categories?.length) {
      const cats = new Set(options.categories);
      results = results.filter((r) =>
        r.metadata.categories.some((c) => cats.has(c))
      );
    }

    return results.slice(0, limit);
  }

  count(filters: CountFilters = {}): number {
    let sql = "SELECT COUNT(*) as cnt FROM memories WHERE 1=1";
    const params: unknown[] = [];

    if (filters.namespace) {
      sql += " AND namespace = ?";
      params.push(filters.namespace);
    }
    if (filters.tag) {
      sql += " AND tag = ?";
      params.push(filters.tag);
    }
    if (filters.project) {
      sql += " AND project = ?";
      params.push(filters.project);
    }

    const row = this.db.prepare(sql).get(...params) as { cnt: number };
    return row.cnt;
  }

  listDecisions(limit: number = 50): MemoryRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM memories WHERE decision = 1 ORDER BY timestamp DESC LIMIT ?"
      )
      .all(limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToRecord(r));
  }

  // ── Decay ─────────────────────────────────────────────────────

  decayWeights(): Record<DecayTag, number> {
    const results: Record<string, number> = {};
    const now = isoNow();

    for (const [tag, rate] of Object.entries(DECAY_RATES)) {
      if (rate === 0) {
        results[tag] = 0;
        continue;
      }

      const stmt = this.db.prepare(`
        UPDATE memories
        SET weight = MAX(?, weight - ?),
            updated_at = ?
        WHERE tag = ? AND weight > ?
      `);

      const result = stmt.run(WEIGHT_FLOOR, rate, now, tag, WEIGHT_FLOOR);
      results[tag] = result.changes;
    }

    return results as Record<DecayTag, number>;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  // ── Helpers ───────────────────────────────────────────────────

  private rowToRecord(row: Record<string, unknown>): MemoryRecord {
    const metadata: MemoryMetadata = {
      tag: row.tag as DecayTag,
      weight: row.weight as number,
      timestamp: row.timestamp as string,
      author: row.author as string,
      namespace: row.namespace as string,
      categories: JSON.parse((row.categories as string) || "[]"),
      contentHash: row.content_hash as string,
      source: (row.source as string) ?? undefined,
      project: (row.project as string) ?? undefined,
      decision: (row.decision as number) === 1,
    };

    return {
      id: row.id as string,
      content: row.content as string,
      metadata,
      distance: (row.distance as number) ?? undefined,
    };
  }
}
