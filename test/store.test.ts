import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VectorStore } from "../src/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let store: VectorStore;
let tmpDir: string;

function makeVector(seed: number, dims = 768): number[] {
  const vec = new Array(dims);
  for (let i = 0; i < dims; i++) {
    vec[i] = Math.sin(seed * (i + 1));
  }
  return vec;
}

function makeRecord(id: string, content: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content,
    metadata: {
      tag: (overrides.tag as string) ?? "default",
      weight: (overrides.weight as number) ?? 0.5,
      timestamp: new Date().toISOString(),
      author: (overrides.author as string) ?? "test",
      namespace: (overrides.namespace as string) ?? "default",
      categories: (overrides.categories as string[]) ?? [],
      contentHash: `hash_${id}`,
      source: undefined,
      project: (overrides.project as string) ?? undefined,
      decision: false,
    },
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mnemo-test-"));
  store = new VectorStore(join(tmpDir, "test.db"), 768);
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("VectorStore", () => {
  it("insert and get", () => {
    const record = makeRecord("r1", "Hello world");
    store.insert(record, makeVector(1));

    const got = store.get("r1");
    expect(got).not.toBeNull();
    expect(got!.content).toBe("Hello world");
    expect(got!.metadata.tag).toBe("default");
    expect(got!.metadata.weight).toBe(0.5);
  });

  it("get returns null for missing ID", () => {
    expect(store.get("nonexistent")).toBeNull();
  });

  it("getByHash", () => {
    const record = makeRecord("r1", "test content");
    store.insert(record, makeVector(1));

    const got = store.getByHash("hash_r1");
    expect(got).not.toBeNull();
    expect(got!.id).toBe("r1");

    expect(store.getByHash("no_such_hash")).toBeNull();
  });

  it("delete", () => {
    const record = makeRecord("r1", "to delete");
    store.insert(record, makeVector(1));

    expect(store.delete("r1")).toBe(true);
    expect(store.get("r1")).toBeNull();
    expect(store.delete("r1")).toBe(false);
  });

  it("updateWeight", () => {
    const record = makeRecord("r1", "test");
    store.insert(record, makeVector(1));

    expect(store.updateWeight("r1", 0.9)).toBe(true);

    const got = store.get("r1");
    expect(got!.metadata.weight).toBe(0.9);
  });

  it("update fields", () => {
    const record = makeRecord("r1", "original content", { tag: "default", namespace: "ns1" });
    store.insert(record, makeVector(1));

    store.update("r1", { tag: "core", namespace: "ns2" });

    const got = store.get("r1");
    expect(got!.metadata.tag).toBe("core");
    expect(got!.metadata.namespace).toBe("ns2");
    expect(got!.content).toBe("original content");
  });

  it("update content rehashes", () => {
    const record = makeRecord("r1", "old text");
    store.insert(record, makeVector(1));

    store.update("r1", { content: "new text" }, makeVector(2));

    const got = store.get("r1");
    expect(got!.content).toBe("new text");
    expect(got!.metadata.contentHash).not.toBe("hash_r1");
  });

  it("search returns nearest vectors", () => {
    store.insert(makeRecord("r1", "apples"), makeVector(1));
    store.insert(makeRecord("r2", "oranges"), makeVector(100));
    store.insert(makeRecord("r3", "apples too"), makeVector(1.01));

    const results = store.search(makeVector(1), { limit: 2 });
    expect(results.length).toBe(2);
    expect(results[0].id).toBe("r1");
    expect(results[0].distance).toBeDefined();
  });

  it("search filters by namespace", () => {
    store.insert(makeRecord("r1", "a", { namespace: "echo" }), makeVector(1));
    store.insert(makeRecord("r2", "b", { namespace: "nyx" }), makeVector(1.01));

    const results = store.search(makeVector(1), { namespace: "echo" });
    expect(results.every((r) => r.metadata.namespace === "echo")).toBe(true);
  });

  it("search filters by minWeight", () => {
    store.insert(makeRecord("r1", "heavy", { weight: 0.8 }), makeVector(1));
    store.insert(makeRecord("r2", "light", { weight: 0.2 }), makeVector(1.01));

    const results = store.search(makeVector(1), { minWeight: 0.5 });
    expect(results.every((r) => r.metadata.weight >= 0.5)).toBe(true);
  });

  it("findNearest", () => {
    store.insert(makeRecord("r1", "near"), makeVector(1));
    store.insert(makeRecord("r2", "far"), makeVector(100));

    const nearest = store.findNearest(makeVector(1.001));
    expect(nearest).not.toBeNull();
    expect(nearest!.record.id).toBe("r1");
    expect(nearest!.distance).toBeGreaterThanOrEqual(0);
  });

  it("findNearest returns null on empty store", () => {
    expect(store.findNearest(makeVector(1))).toBeNull();
  });

  it("count with filters", () => {
    store.insert(makeRecord("r1", "a", { tag: "core", namespace: "echo" }), makeVector(1));
    store.insert(makeRecord("r2", "b", { tag: "default", namespace: "echo" }), makeVector(2));
    store.insert(makeRecord("r3", "c", { tag: "core", namespace: "nyx" }), makeVector(3));

    expect(store.count()).toBe(3);
    expect(store.count({ tag: "core" })).toBe(2);
    expect(store.count({ namespace: "echo" })).toBe(2);
    expect(store.count({ tag: "core", namespace: "echo" })).toBe(1);
  });

  it("decayWeights", () => {
    store.insert(makeRecord("r1", "core", { tag: "core", weight: 0.5 }), makeVector(1));
    store.insert(makeRecord("r2", "crucial", { tag: "crucial", weight: 0.5 }), makeVector(2));
    store.insert(makeRecord("r3", "default", { tag: "default", weight: 0.5 }), makeVector(3));

    const results = store.decayWeights();

    expect(results.core).toBe(0);    // core never decays
    expect(results.crucial).toBe(1); // crucial decayed
    expect(results.default).toBe(1); // default decayed

    expect(store.get("r1")!.metadata.weight).toBe(0.5);   // unchanged
    expect(store.get("r2")!.metadata.weight).toBe(0.49);   // -0.01
    expect(store.get("r3")!.metadata.weight).toBe(0.45);   // -0.05
  });

  it("decay respects weight floor", () => {
    store.insert(makeRecord("r1", "low", { tag: "default", weight: 0.12 }), makeVector(1));

    store.decayWeights();

    const got = store.get("r1");
    expect(got!.metadata.weight).toBeGreaterThanOrEqual(0.1);
  });
});
