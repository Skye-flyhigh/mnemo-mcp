import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Memory } from "../src/memory.js";
import { VectorStore } from "../src/store.js";
import { MockEmbedding } from "./mock-embeddings.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let memory: Memory;
let store: VectorStore;
let embeddings: MockEmbedding;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mnemo-test-"));
  store = new VectorStore(join(tmpDir, "test.db"), 768);
  embeddings = new MockEmbedding();
  memory = new Memory(embeddings, store);
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Memory", () => {
  // ── Add ────────────────────────────────────────────────────────

  it("add stores a memory", async () => {
    const record = await memory.add({ content: "test memory", author: "echo" });

    expect(record).not.toBeNull();
    expect(record!.content).toBe("test memory");
    expect(record!.metadata.author).toBe("echo");
    expect(record!.metadata.tag).toBe("default");
    expect(record!.metadata.weight).toBe(0.5);
  });

  it("add rejects empty content", async () => {
    expect(await memory.add({ content: "", author: "echo" })).toBeNull();
    expect(await memory.add({ content: "   ", author: "echo" })).toBeNull();
  });

  it("add deduplicates by content hash", async () => {
    const first = await memory.add({ content: "duplicate", author: "echo" });
    const originalWeight = first!.metadata.weight;
    // Clear timing cache so the second add hits the hash dedup path
    (memory as unknown as { recentHashes: Map<string, number> }).recentHashes.clear();
    const second = await memory.add({ content: "duplicate", author: "echo" });

    // Second call should return the existing record with bumped weight
    expect(second).not.toBeNull();
    expect(second!.id).toBe(first!.id);
    // Verify weight was bumped in the store
    const fromStore = memory.get(first!.id);
    expect(fromStore!.metadata.weight).toBeGreaterThan(originalWeight);
  });

  it("add rejects timing duplicates", async () => {
    await memory.add({ content: "quick dupe", author: "echo" });
    const second = await memory.add({ content: "quick dupe", author: "echo" });

    // Within cooldown window → rejected
    expect(second).toBeNull();
  });

  it("add with custom tag and namespace", async () => {
    const record = await memory.add({
      content: "important",
      author: "echo",
      tag: "core",
      namespace: "echo",
      categories: ["preference"],
    });

    expect(record!.metadata.tag).toBe("core");
    expect(record!.metadata.namespace).toBe("echo");
    expect(record!.metadata.categories).toEqual(["preference"]);
  });

  // ── Batch ──────────────────────────────────────────────────────

  it("addBatch stores multiple memories", async () => {
    const result = await memory.addBatch([
      { content: "memory one", author: "echo" },
      { content: "memory two", author: "echo" },
      { content: "memory three", author: "echo" },
    ]);

    expect(result.added).toBe(3);
    expect(result.deduped).toBe(0);
    expect(result.failed).toBe(0);
    expect(memory.count()).toBe(3);
  });

  it("addBatch deduplicates within batch", async () => {
    const result = await memory.addBatch([
      { content: "same", author: "echo" },
      { content: "same", author: "echo" },
      { content: "different", author: "echo" },
    ]);

    expect(result.added).toBe(2);
    expect(memory.count()).toBe(2);
  });

  it("addBatch deduplicates against existing", async () => {
    await memory.add({ content: "exists already", author: "echo" });
    (memory as unknown as { recentHashes: Map<string, number> }).recentHashes.clear();

    const result = await memory.addBatch([
      { content: "exists already", author: "echo" },
      { content: "brand new", author: "echo" },
    ]);

    expect(result.added).toBe(1);
    expect(result.deduped).toBe(1);
  });

  it("addBatch skips empty content", async () => {
    const result = await memory.addBatch([
      { content: "", author: "echo" },
      { content: "valid", author: "echo" },
    ]);

    expect(result.added).toBe(1);
  });

  // ── Search ─────────────────────────────────────────────────────

  it("search returns results", async () => {
    await memory.add({ content: "cats are great", author: "echo" });
    await memory.add({ content: "dogs are loyal", author: "echo" });

    const results = await memory.search("cats");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].distance).toBeDefined();
  });

  // ── Get / Delete ───────────────────────────────────────────────

  it("get and delete", async () => {
    const record = await memory.add({ content: "deleteme", author: "echo" });
    expect(memory.get(record!.id)).not.toBeNull();

    expect(memory.delete(record!.id)).toBe(true);
    expect(memory.get(record!.id)).toBeNull();
  });

  // ── Bump ───────────────────────────────────────────────────────

  it("bumpWeight increases weight", async () => {
    const record = await memory.add({ content: "bump me", author: "echo" });

    expect(memory.bumpWeight(record!.id, 0.2)).toBe(true);
    expect(memory.get(record!.id)!.metadata.weight).toBeCloseTo(0.7);
  });

  it("bumpWeight caps at 1.0", async () => {
    const record = await memory.add({ content: "max me", author: "echo", weight: 0.9 });

    memory.bumpWeight(record!.id, 0.5);
    expect(memory.get(record!.id)!.metadata.weight).toBe(1.0);
  });

  it("bumpWeight returns false for missing ID", () => {
    expect(memory.bumpWeight("nope")).toBe(false);
  });

  // ── Update ─────────────────────────────────────────────────────

  it("update changes fields", async () => {
    const record = await memory.add({ content: "original", author: "echo", tag: "default" });

    const updated = await memory.update(record!.id, { tag: "core" });
    expect(updated).not.toBeNull();
    expect(updated!.metadata.tag).toBe("core");
  });

  it("update content triggers re-embedding", async () => {
    const record = await memory.add({ content: "old content", author: "echo" });
    const callsBefore = embeddings.calls.length;

    await memory.update(record!.id, { content: "new content" });
    expect(embeddings.calls.length).toBeGreaterThan(callsBefore);

    const got = memory.get(record!.id);
    expect(got!.content).toBe("new content");
  });

  it("update returns null for missing ID", async () => {
    expect(await memory.update("nope", { tag: "core" })).toBeNull();
  });

  // ── Decay ──────────────────────────────────────────────────────

  it("decayAll reduces weights by tag tier", async () => {
    await memory.add({ content: "core mem", author: "echo", tag: "core" });
    await memory.add({ content: "default mem", author: "echo", tag: "default" });

    const results = memory.decayAll();
    expect(results.core).toBe(0);
    expect(results.default).toBe(1);
  });

  // ── Count ──────────────────────────────────────────────────────

  it("count with filters", async () => {
    await memory.add({ content: "a", author: "echo", namespace: "echo" });
    await memory.add({ content: "b", author: "echo", namespace: "nyx" });

    expect(memory.count()).toBe(2);
    expect(memory.count({ namespace: "echo" })).toBe(1);
  });
});
