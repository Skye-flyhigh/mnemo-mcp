import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VectorStore } from "../src/store.js";
import { Memory } from "../src/memory.js";
import { MockEmbedding } from "./mock-embeddings.js";
import {
  parseArgs,
  formatMemoryJson,
  formatMemoryMd,
  cmdExport,
  cmdSearch,
  cmdInspect,
  cmdDecay,
  cmdCount,
  runCli,
} from "../src/commands.js";
import type { CliDeps } from "../src/commands.js";

let tmpDir: string;
let store: VectorStore;
let memory: Memory;
let deps: CliDeps;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "mnemo-cli-test-"));
  const dbPath = join(tmpDir, "test.db");
  store = new VectorStore(dbPath, 768);
  const embeddings = new MockEmbedding();
  memory = new Memory(embeddings, store);
  deps = { store, memory };

  // Seed some test data
  await memory.add({
    content: "The cat sits on the mat",
    author: "echo",
    namespace: "test",
    tag: "core",
    categories: ["animals", "test"],
    project: "black-cat",
    source: "unit-test",
  });

  await memory.add({
    content: "Memory systems need decay mechanisms",
    author: "nyx",
    namespace: "test",
    tag: "crucial",
    categories: ["architecture"],
    project: "mnemo",
  });

  await memory.add({
    content: "Simple observation about weather",
    author: "echo",
    namespace: "other",
    tag: "default",
  });
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── parseArgs ─────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("parses command with no args", () => {
    const result = parseArgs(["node", "cli.js", "count"]);
    expect(result.command).toBe("count");
    expect(result.positional).toEqual([]);
    expect(result.flags).toEqual({});
  });

  it("parses positional arguments", () => {
    const result = parseArgs(["node", "cli.js", "search", "hello", "world"]);
    expect(result.command).toBe("search");
    expect(result.positional).toEqual(["hello", "world"]);
  });

  it("parses long flags with values", () => {
    const result = parseArgs(["node", "cli.js", "export", "--ns", "echo", "--md"]);
    expect(result.flags.ns).toBe("echo");
    expect(result.flags.md).toBe(true);
  });

  it("parses short flags with values", () => {
    const result = parseArgs(["node", "cli.js", "search", "query", "-n", "5"]);
    expect(result.flags.n).toBe("5");
    expect(result.positional).toEqual(["query"]);
  });

  it("returns empty command for no args", () => {
    const result = parseArgs(["node", "cli.js"]);
    expect(result.command).toBe("");
  });

  it("handles mixed positional and flags", () => {
    const result = parseArgs(["node", "cli.js", "search", "telos", "planning", "-n", "3", "--ns", "echo"]);
    expect(result.command).toBe("search");
    expect(result.positional).toEqual(["telos", "planning"]);
    expect(result.flags.n).toBe("3");
    expect(result.flags.ns).toBe("echo");
  });
});

// ── formatMemoryJson ──────────────────────────────────────────────

describe("formatMemoryJson", () => {
  it("formats a memory record as a flat object", () => {
    const mem = store.get(store.listAll()[0].id)!;
    const json = formatMemoryJson(mem) as Record<string, unknown>;

    expect(json.id).toBe(mem.id);
    expect(json.content).toBe(mem.content);
    expect(json.tag).toBe(mem.metadata.tag);
    expect(json.weight).toBe(mem.metadata.weight);
    expect(json.namespace).toBe(mem.metadata.namespace);
    expect(json.author).toBe(mem.metadata.author);
    expect(json.categories).toEqual(mem.metadata.categories);
    expect(json.created).toBe(mem.metadata.timestamp);
  });
});

// ── formatMemoryMd ────────────────────────────────────────────────

describe("formatMemoryMd", () => {
  it("formats a memory as markdown", () => {
    const mem = store.get(store.listAll()[0].id)!;
    const md = formatMemoryMd(mem);

    expect(md).toContain("##");
    expect(md).toContain(`**ID:** ${mem.id}`);
    expect(md).toContain(`**Tag:** ${mem.metadata.tag}`);
    expect(md).toContain(`**Namespace:** ${mem.metadata.namespace}`);
    expect(md).toContain(mem.content);
  });

  it("includes categories when present", () => {
    const mem = store.get(store.listAll()[0].id)!;
    mem.metadata.categories = ["test", "cat"];
    const md = formatMemoryMd(mem);
    expect(md).toContain("**Categories:** test, cat");
  });

  it("includes project when present", () => {
    const mem = store.get(store.listAll()[0].id)!;
    mem.metadata.project = "my-project";
    const md = formatMemoryMd(mem);
    expect(md).toContain("**Project:** my-project");
  });

  it("truncates long content in heading", () => {
    const longContent = "A".repeat(200);
    const mem = store.get(store.listAll()[0].id)!;
    mem.content = longContent;
    const md = formatMemoryMd(mem);

    const heading = md.split("\n")[0];
    expect(heading).toContain("...");
    expect(heading.length).toBeLessThan(200);
  });
});

// ── cmdCount ──────────────────────────────────────────────────────

describe("cmdCount", () => {
  it("counts all memories", async () => {
    const result = await cmdCount({}, deps);
    expect(result).toBe("3");
  });

  it("counts by namespace", async () => {
    const result = await cmdCount({ ns: "test" }, deps);
    expect(result).toBe("2");
  });

  it("returns 0 for empty namespace", async () => {
    const result = await cmdCount({ ns: "nonexistent" }, deps);
    expect(result).toBe("0");
  });
});

// ── cmdInspect ────────────────────────────────────────────────────

describe("cmdInspect", () => {
  it("shows global stats with no args", async () => {
    const result = await cmdInspect([], {}, deps);

    expect(result).toContain("Global stats:");
    expect(result).toContain("Total memories: 3");
    expect(result).toContain("core:");
    expect(result).toContain("crucial:");
    expect(result).toContain("default:");
  });

  it("shows namespace stats", async () => {
    const result = await cmdInspect([], { ns: "test" }, deps);

    expect(result).toContain('Stats for namespace "test":');
    expect(result).toContain("Total memories: 2");
  });

  it("shows single memory by ID", async () => {
    const all = store.listAll();
    const id = all[0].id;

    const result = await cmdInspect([id], {}, deps);

    expect(result).toContain(`ID:         ${id}`);
    expect(result).toContain("Content:");
    expect(result).toContain("Tag:");
    expect(result).toContain("Weight:");
    expect(result).toContain("Namespace:");
    expect(result).toContain("Author:");
  });

  it("returns error for missing ID", async () => {
    const result = await cmdInspect(["nonexistent_id"], {}, deps);
    expect(result).toContain("Memory not found: nonexistent_id");
  });
});

// ── cmdExport ─────────────────────────────────────────────────────

describe("cmdExport", () => {
  it("exports all memories as JSON", async () => {
    const result = await cmdExport({}, deps);
    const parsed = JSON.parse(result);

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toHaveProperty("id");
    expect(parsed[0]).toHaveProperty("content");
    expect(parsed[0]).toHaveProperty("tag");
  });

  it("exports filtered by namespace", async () => {
    const result = await cmdExport({ ns: "test" }, deps);
    const parsed = JSON.parse(result);

    expect(parsed).toHaveLength(2);
    expect(parsed.every((m: { namespace: string }) => m.namespace === "test")).toBe(true);
  });

  it("exports as markdown", async () => {
    const result = await cmdExport({ md: true }, deps);

    expect(result).toContain("# Mnemo Export");
    expect(result).toContain("3 memories exported");
    expect(result).toContain("##");
    expect(result).toContain("**ID:**");
    expect(result).toContain("---");
  });

  it("exports markdown filtered by namespace", async () => {
    const result = await cmdExport({ md: true, ns: "test" }, deps);

    expect(result).toContain("# Mnemo Export — test");
    expect(result).toContain("2 memories exported");
  });

  it("returns message for empty results", async () => {
    const result = await cmdExport({ ns: "nonexistent" }, deps);
    expect(result).toContain('No memories in namespace "nonexistent"');
  });
});

// ── cmdSearch ─────────────────────────────────────────────────────

describe("cmdSearch", () => {
  it("searches and returns results", async () => {
    const result = await cmdSearch(["cat", "mat"], {}, deps);

    expect(result).toContain("1.");
    expect(result).toContain("ID:");
    expect(result).toContain("NS:");
  });

  it("returns usage for empty query", async () => {
    const result = await cmdSearch([], {}, deps);
    expect(result).toContain("Usage:");
  });

  it("respects namespace filter", async () => {
    const result = await cmdSearch(["memory"], { ns: "test" }, deps);
    expect(result).not.toContain("NS: other");
  });

  it("returns message for no results", async () => {
    const result = await cmdSearch(["xyznonexistent"], { ns: "nonexistent" }, deps);
    expect(result).toContain("No memories found for: xyznonexistent");
  });
});

// ── cmdDecay ──────────────────────────────────────────────────────

describe("cmdDecay", () => {
  it("runs decay cycle", async () => {
    const result = await cmdDecay(deps);

    expect(result).toContain("Decay cycle complete:");
    expect(result).toContain("core:");
    expect(result).toContain("crucial:");
    expect(result).toContain("default:");
    expect(result).toContain("Total:");
  });
});

// ── runCli router ─────────────────────────────────────────────────

describe("runCli", () => {
  it("returns true for known commands", async () => {
    expect(await runCli(["node", "cli.js", "count"], deps)).toBe(true);
    expect(await runCli(["node", "cli.js", "inspect"], deps)).toBe(true);
    expect(await runCli(["node", "cli.js", "export"], deps)).toBe(true);
    expect(await runCli(["node", "cli.js", "decay"], deps)).toBe(true);
    expect(await runCli(["node", "cli.js", "help"], deps)).toBe(true);
    expect(await runCli(["node", "cli.js", "--help"], deps)).toBe(true);
    expect(await runCli(["node", "cli.js", "-h"], deps)).toBe(true);
  });

  it("returns false for no command (MCP server mode)", async () => {
    expect(await runCli(["node", "cli.js"], deps)).toBe(false);
  });

  it("returns false for unknown commands", async () => {
    expect(await runCli(["node", "cli.js", "unknown"], deps)).toBe(false);
  });
});
