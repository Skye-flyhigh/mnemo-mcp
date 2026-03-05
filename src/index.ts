#!/usr/bin/env node
/**
 * Mnemo — Portable cognitive memory MCP server.
 *
 * Provides persistent, decaying, associative memory to any MCP client.
 * Tools: remember, recall, forget, bump, decay, inspect.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { readFileSync } from "node:fs";

import { createEmbeddingProvider } from "./embeddings.js";
import { Memory } from "./memory.js";
import { VectorStore } from "./store.js";
import { loadConfig, DECAY_TAGS } from "./types.js";

// ── Bootstrap ───────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
const config = loadConfig();
const store = new VectorStore(config.dbPath, config.dimensions);
const embeddings = createEmbeddingProvider(config);
const memory = new Memory(embeddings, store);

const server = new McpServer({
  name: "mnemo-mcp",
  version: pkg.version,
});

// ── Tool: remember ──────────────────────────────────────────────

server.registerTool(
  "remember",
  {
    description: "Store a memory with optional tag, categories, and namespace",
    inputSchema: {
      content: z.string().describe("The text content to remember"),
      namespace: z.string().optional().describe("Scope isolation (e.g., 'echo', 'cat', 'shared')"),
      tag: z.enum(["core", "crucial", "default"]).optional()
        .describe("Decay tier: core=permanent, crucial=slow decay, default=normal decay"),
      categories: z.array(z.string()).optional()
        .describe("Semantic categories (e.g., ['preference', 'user'])"),
      project: z.string().optional().describe("Project scope for filtered retrieval"),
      author: z.string().optional().describe("Who created this memory"),
      source: z.string().optional().describe("Origin context (tool, conversation, consolidation)"),
    },
  },
  async (params) => {
    const record = await memory.add({
      content: params.content,
      author: params.author ?? "unknown",
      namespace: params.namespace,
      tag: params.tag,
      categories: params.categories,
      source: params.source,
      project: params.project,
    });

    if (!record) {
      return {
        content: [{ type: "text" as const, text: "Memory was deduplicated or rejected (empty/duplicate)." }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: [
          `Remembered: ${record.content.slice(0, 100)}${record.content.length > 100 ? "..." : ""}`,
          `ID: ${record.id}`,
          `Tag: ${record.metadata.tag} | Weight: ${record.metadata.weight} | Namespace: ${record.metadata.namespace}`,
        ].join("\n"),
      }],
    };
  }
);

// ── Tool: remember_batch ─────────────────────────────────────────

server.registerTool(
  "remember_batch",
  {
    description: "Store multiple memories in a single call. Embeds all at once for efficiency. Deduplicates automatically.",
    inputSchema: {
      memories: z.array(z.object({
        content: z.string().describe("The text content to remember"),
        namespace: z.string().optional().describe("Scope isolation"),
        tag: z.enum(["core", "crucial", "default"]).optional().describe("Decay tier (default: 'default')"),
        categories: z.array(z.string()).optional().describe("Semantic categories"),
        project: z.string().optional().describe("Project scope"),
        author: z.string().optional().describe("Who created this memory"),
        source: z.string().optional().describe("Origin context"),
      })).describe("Array of memories to store"),
    },
  },
  async (params) => {
    const items = params.memories.map((m) => ({
      content: m.content,
      author: m.author ?? "unknown",
      namespace: m.namespace,
      tag: m.tag,
      categories: m.categories,
      source: m.source,
      project: m.project,
    }));

    const result = await memory.addBatch(items);

    return {
      content: [{
        type: "text" as const,
        text: [
          `Batch complete:`,
          `  Added: ${result.added}`,
          `  Deduplicated: ${result.deduped}`,
          result.failed > 0 ? `  Failed: ${result.failed}` : null,
          `  Total submitted: ${params.memories.length}`,
        ].filter(Boolean).join("\n"),
      }],
    };
  }
);

// ── Tool: recall ────────────────────────────────────────────────

server.registerTool(
  "recall",
  {
    description: "Search memories semantically by query",
    inputSchema: {
      query: z.string().describe("The search query"),
      namespace: z.string().optional().describe("Filter by namespace"),
      limit: z.number().optional().describe("Max results (default 10, no hard cap)"),
      project: z.string().optional().describe("Filter by project"),
      categories: z.array(z.string()).optional().describe("Filter by categories"),
      minWeight: z.number().optional().describe("Minimum weight threshold"),
    },
  },
  async (params) => {
    const results = await memory.search(params.query, {
      namespace: params.namespace,
      limit: params.limit,
      project: params.project,
      categories: params.categories,
      minWeight: params.minWeight,
    });

    if (results.length === 0) {
      return {
        content: [{ type: "text" as const, text: `No memories found for: ${params.query}` }],
      };
    }

    const lines = [`Found ${results.length} memories:\n`];
    for (const [i, mem] of results.entries()) {
      const distance = mem.distance != null ? mem.distance.toFixed(3) : "?";
      lines.push(
        `${i + 1}. [${mem.metadata.tag}, w=${mem.metadata.weight.toFixed(2)}, d=${distance}]`,
        `   ${mem.content.slice(0, 200)}${mem.content.length > 200 ? "..." : ""}`,
        `   ID: ${mem.id} | NS: ${mem.metadata.namespace}`,
        ""
      );
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// ── Tool: forget ────────────────────────────────────────────────

server.registerTool(
  "forget",
  {
    description: "Delete a memory by ID",
    inputSchema: {
      id: z.string().describe("The memory ID to delete"),
    },
    annotations: { destructiveHint: true },
  },
  async (params) => {
    const deleted = memory.delete(params.id);
    return {
      content: [{
        type: "text" as const,
        text: deleted
          ? `Deleted memory: ${params.id}`
          : `Memory not found: ${params.id}`,
      }],
    };
  }
);

// ── Tool: update ────────────────────────────────────────────────

server.registerTool(
  "update",
  {
    description: "Update an existing memory's content or metadata. Re-embeds automatically if content changes.",
    inputSchema: {
      id: z.string().describe("The memory ID to update"),
      content: z.string().optional().describe("New content (triggers re-embedding)"),
      tag: z.enum(["core", "crucial", "default"]).optional().describe("New decay tier"),
      categories: z.array(z.string()).optional().describe("New categories (replaces existing)"),
      namespace: z.string().optional().describe("New namespace"),
      project: z.string().optional().describe("New project scope"),
      source: z.string().optional().describe("New source context"),
    },
  },
  async (params) => {
    const { id, ...fields } = params;

    // Check at least one field is being updated
    const updates = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(updates).length === 0) {
      return {
        content: [{ type: "text" as const, text: "No fields to update. Provide at least one field to change." }],
      };
    }

    const record = await memory.update(id, updates);
    if (!record) {
      return {
        content: [{ type: "text" as const, text: `Memory not found or update failed: ${id}` }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: [
          `Updated: ${record.content.slice(0, 100)}${record.content.length > 100 ? "..." : ""}`,
          `ID: ${record.id}`,
          `Tag: ${record.metadata.tag} | Weight: ${record.metadata.weight.toFixed(2)} | Namespace: ${record.metadata.namespace}`,
        ].join("\n"),
      }],
    };
  }
);

// ── Tool: bump ──────────────────────────────────────────────────

server.registerTool(
  "bump",
  {
    description: "Reinforce a memory's weight (recall reinforcement)",
    inputSchema: {
      id: z.string().describe("The memory ID to reinforce"),
      amount: z.number().optional().describe("Weight increase amount (default 0.1)"),
    },
  },
  async (params) => {
    const success = memory.bumpWeight(params.id, params.amount ?? 0.1);

    if (!success) {
      return {
        content: [{ type: "text" as const, text: `Memory not found: ${params.id}` }],
      };
    }

    const record = memory.get(params.id);
    return {
      content: [{
        type: "text" as const,
        text: `Bumped weight of ${params.id} to ${record?.metadata.weight.toFixed(2) ?? "?"}`,
      }],
    };
  }
);

// ── Tool: decay ─────────────────────────────────────────────────

server.registerTool(
  "decay",
  {
    description: "Trigger a decay cycle — reduces memory weights based on tag tiers",
  },
  async () => {
    const results = memory.decayAll();
    const total = Object.values(results).reduce((a, b) => a + b, 0);

    const lines = ["Decay cycle complete:"];
    for (const [tag, count] of Object.entries(results)) {
      lines.push(`  ${tag}: ${count} memories decayed`);
    }
    lines.push(`  Total: ${total}`);

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// ── Tool: inspect ───────────────────────────────────────────────

server.registerTool(
  "inspect",
  {
    description: "View a specific memory or aggregate stats",
    inputSchema: {
      id: z.string().optional().describe("Memory ID to inspect (omit for stats)"),
      namespace: z.string().optional().describe("Filter stats by namespace"),
    },
    annotations: { readOnlyHint: true },
  },
  async (params) => {
    // Single memory inspection
    if (params.id) {
      const record = memory.get(params.id);
      if (!record) {
        return {
          content: [{ type: "text" as const, text: `Memory not found: ${params.id}` }],
        };
      }

      const lines = [
        `ID: ${record.id}`,
        `Content: ${record.content}`,
        `Tag: ${record.metadata.tag}`,
        `Weight: ${record.metadata.weight.toFixed(2)}`,
        `Namespace: ${record.metadata.namespace}`,
        `Author: ${record.metadata.author}`,
        `Categories: ${record.metadata.categories.join(", ") || "(none)"}`,
        `Source: ${record.metadata.source ?? "(none)"}`,
        `Project: ${record.metadata.project ?? "(none)"}`,
        `Decision: ${record.metadata.decision ? "yes" : "no"}`,
        `Created: ${record.metadata.timestamp}`,
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }

    // Aggregate stats
    const ns = params.namespace;
    const total = memory.count({ namespace: ns });
    const byTag: Record<string, number> = {};
    for (const tag of DECAY_TAGS) {
      byTag[tag] = memory.count({ namespace: ns, tag });
    }

    const lines = [
      ns ? `Stats for namespace "${ns}":` : "Global stats:",
      `  Total memories: ${total}`,
      `  By tag:`,
    ];
    for (const [tag, count] of Object.entries(byTag)) {
      lines.push(`    ${tag}: ${count}`);
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// ── Start ───────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mnemo] Memory server running on stdio");
}

main().catch((err) => {
  console.error("[mnemo] Fatal error:", err);
  process.exit(1);
});
