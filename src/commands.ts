/**
 * CLI commands for mnemo — manual export, search, inspect, decay.
 *
 * Usage:
 *   mnemo-mcp                              Start MCP server (default)
 *   mnemo-mcp export [--md] [--ns <ns>]    Export memories as JSON or markdown
 *   mnemo-mcp search <query> [-n <limit>]  Semantic search
 *   mnemo-mcp inspect [<id>] [--ns <ns>]   View memory or stats
 *   mnemo-mcp decay                        Run decay cycle
 *   mnemo-mcp count [--ns <ns>]            Quick count
 *   mnemo-mcp help                         Show this help
 */

import { createEmbeddingProvider } from "./embeddings.js";
import { Memory } from "./memory.js";
import { VectorStore } from "./store.js";
import type { MemoryRecord } from "./types.js";
import { DECAY_TAGS, loadConfig } from "./types.js";

export interface CliDeps {
  store: VectorStore;
  memory: Memory;
}

function bootstrap(): CliDeps {
  const config = loadConfig();
  const store = new VectorStore(config.dbPath, config.dimensions);
  const embeddings = createEmbeddingProvider(config);
  const memory = new Memory(embeddings, store, config);
  return { store, memory };
}

// ── Argument parsing ──────────────────────────────────────────────

export function parseArgs(argv: string[]): {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const args = argv.slice(2); // strip node + script
  const command = args[0] ?? "";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

// ── Formatters ───────────────────────────────────────────────────

export function formatMemoryJson(mem: MemoryRecord): object {
  return {
    id: mem.id,
    content: mem.content,
    tag: mem.metadata.tag,
    weight: mem.metadata.weight,
    namespace: mem.metadata.namespace,
    author: mem.metadata.author,
    categories: mem.metadata.categories,
    source: mem.metadata.source,
    project: mem.metadata.project,
    decision: mem.metadata.decision,
    created: mem.metadata.timestamp,
  };
}

export function formatMemoryMd(mem: MemoryRecord): string {
  const lines = [
    `## ${mem.content.slice(0, 80)}${mem.content.length > 80 ? "..." : ""}`,
    "",
    `- **ID:** ${mem.id}`,
    `- **Tag:** ${mem.metadata.tag} | **Weight:** ${mem.metadata.weight.toFixed(2)}`,
    `- **Namespace:** ${mem.metadata.namespace} | **Author:** ${mem.metadata.author}`,
  ];

  if (mem.metadata.categories.length > 0) {
    lines.push(`- **Categories:** ${mem.metadata.categories.join(", ")}`);
  }
  if (mem.metadata.project) {
    lines.push(`- **Project:** ${mem.metadata.project}`);
  }
  if (mem.metadata.source) {
    lines.push(`- **Source:** ${mem.metadata.source}`);
  }
  lines.push(`- **Created:** ${mem.metadata.timestamp}`);
  lines.push("");
  lines.push(mem.content);
  lines.push("");

  return lines.join("\n");
}

// ── Commands ─────────────────────────────────────────────────────

export async function cmdExport(
  flags: Record<string, string | boolean>,
  deps?: CliDeps,
): Promise<string> {
  const { store } = deps ?? bootstrap();
  const ns = typeof flags.ns === "string" ? flags.ns : undefined;
  const asMd = flags.md === true;

  const memories = store.listAll({ namespace: ns });

  if (memories.length === 0) {
    return ns ? `No memories in namespace "${ns}".` : "No memories found.";
  }

  if (asMd) {
    const lines: string[] = [];
    const header = ns ? `# Mnemo Export — ${ns}` : "# Mnemo Export";
    lines.push(header);
    lines.push(`\n> ${memories.length} memories exported\n`);
    for (const mem of memories) {
      lines.push(formatMemoryMd(mem));
      lines.push("---\n");
    }
    return lines.join("\n");
  } else {
    return JSON.stringify(memories.map(formatMemoryJson), null, 2);
  }
}

export async function cmdSearch(
  positional: string[],
  flags: Record<string, string | boolean>,
  deps?: CliDeps,
): Promise<string> {
  const query = positional.join(" ");
  if (!query) {
    return "Usage: mnemo-mcp search <query> [-n <limit>] [--ns <namespace>]";
  }

  const { memory } = deps ?? bootstrap();
  const limit = typeof flags.n === "string" ? parseInt(flags.n, 10) : 10;
  const ns = typeof flags.ns === "string" ? flags.ns : undefined;

  const results = await memory.search(query, { namespace: ns, limit });

  if (results.length === 0) {
    return `No memories found for: ${query}`;
  }

  const lines: string[] = [];
  for (const [i, mem] of results.entries()) {
    const d = mem.distance != null ? mem.distance.toFixed(3) : "?";
    lines.push(
      `${i + 1}. [${mem.metadata.tag}, w=${mem.metadata.weight.toFixed(2)}, d=${d}]`,
    );
    lines.push(`   ${mem.content.slice(0, 200)}${mem.content.length > 200 ? "..." : ""}`);
    lines.push(`   ID: ${mem.id} | NS: ${mem.metadata.namespace}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function cmdInspect(
  positional: string[],
  flags: Record<string, string | boolean>,
  deps?: CliDeps,
): Promise<string> {
  const { store } = deps ?? bootstrap();
  const id = positional[0];

  if (id) {
    const mem = store.get(id);
    if (!mem) {
      return `Memory not found: ${id}`;
    }

    return [
      `ID:         ${mem.id}`,
      `Content:    ${mem.content}`,
      `Tag:        ${mem.metadata.tag}`,
      `Weight:     ${mem.metadata.weight.toFixed(2)}`,
      `Namespace:  ${mem.metadata.namespace}`,
      `Author:     ${mem.metadata.author}`,
      `Categories: ${mem.metadata.categories.join(", ") || "(none)"}`,
      `Source:     ${mem.metadata.source ?? "(none)"}`,
      `Project:    ${mem.metadata.project ?? "(none)"}`,
      `Decision:   ${mem.metadata.decision ? "yes" : "no"}`,
      `Created:    ${mem.metadata.timestamp}`,
    ].join("\n");
  } else {
    const ns = typeof flags.ns === "string" ? flags.ns : undefined;
    const total = store.count({ namespace: ns });

    const lines = [
      ns ? `Stats for namespace "${ns}":` : "Global stats:",
      `  Total memories: ${total}`,
      "  By tag:",
    ];
    for (const tag of DECAY_TAGS) {
      const count = store.count({ namespace: ns, tag });
      lines.push(`    ${tag}: ${count}`);
    }

    return lines.join("\n");
  }
}

export async function cmdDecay(deps?: CliDeps): Promise<string> {
  const { memory } = deps ?? bootstrap();

  const results = memory.decayAll();
  const total = Object.values(results).reduce((a, b) => a + b, 0);

  const lines = ["Decay cycle complete:"];
  for (const [tag, count] of Object.entries(results)) {
    lines.push(`  ${tag}: ${count} memories decayed`);
  }
  lines.push(`  Total: ${total}`);

  return lines.join("\n");
}

export async function cmdCount(
  flags: Record<string, string | boolean>,
  deps?: CliDeps,
): Promise<string> {
  const { store } = deps ?? bootstrap();
  const ns = typeof flags.ns === "string" ? flags.ns : undefined;
  const count = store.count({ namespace: ns });
  return String(count);
}

function showHelp(): string {
  return `mnemo-mcp — Portable cognitive memory

Usage:
  mnemo-mcp                              Start MCP server (default)
  mnemo-mcp export [--md] [--ns <ns>]    Export memories as JSON or markdown
  mnemo-mcp search <query> [-n <limit>]  Semantic search from terminal
  mnemo-mcp inspect [<id>] [--ns <ns>]   View a memory or aggregate stats
  mnemo-mcp decay                        Run a decay cycle
  mnemo-mcp count [--ns <ns>]            Quick count
  mnemo-mcp help                         Show this help

Options:
  --ns <namespace>    Filter by namespace
  --md                Export as markdown (default: JSON)
  -n <number>         Limit search results (default: 10)

Environment:
  MNEMO_DB_PATH                 Database path (default: ~/.mnemo/memory.db)
  MNEMO_EMBEDDING_PROVIDER      ollama | openai (default: ollama)
  MNEMO_EMBEDDING_MODEL         Model name
  MNEMO_EMBEDDING_BASE_URL      Provider URL
  MNEMO_EMBEDDING_API_KEY       API key (openai only)
  MNEMO_DIMENSIONS              Vector dimensions
`;
}

// ── Router ────────────────────────────────────────────────────────

export async function runCli(argv: string[], deps?: CliDeps): Promise<boolean> {
  const { command, positional, flags } = parseArgs(argv);

  let output: string | null = null;

  switch (command) {
    case "export":
      output = await cmdExport(flags, deps);
      break;
    case "search":
      output = await cmdSearch(positional, flags, deps);
      break;
    case "inspect":
      output = await cmdInspect(positional, flags, deps);
      break;
    case "decay":
      output = await cmdDecay(deps);
      break;
    case "count":
      output = await cmdCount(flags, deps);
      break;
    case "help":
    case "--help":
    case "-h":
      output = showHelp();
      break;
    default:
      return false; // No CLI command — fall through to MCP server
  }

  if (output) console.log(output);
  return true;
}
