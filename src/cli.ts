#!/usr/bin/env node
/**
 * Mnemo launcher — pre-flight check for native addon compatibility.
 *
 * better-sqlite3 is a native C++ addon locked to a specific Node ABI version.
 * npx caches old builds that break after Node upgrades. This launcher detects
 * the mismatch and auto-rebuilds before starting the server.
 */

import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(__dirname); // one level up from dist/

async function preflight(): Promise<boolean> {
  try {
    // Importing better-sqlite3 only loads the JS wrapper.
    // The native .node addon is lazily loaded when new Database() is called.
    // We must instantiate to trigger the actual dlopen check.
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
    return true;
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "ERR_DLOPEN_FAILED") {
      return false;
    }
    throw e; // unexpected error, let it crash
  }
}

async function rebuild(): Promise<void> {
  console.error("[mnemo] Native module ABI mismatch detected — rebuilding better-sqlite3...");
  try {
    execSync("npm rebuild better-sqlite3", {
      cwd: packageDir,
      stdio: ["ignore", "ignore", "pipe"],
    });
    console.error("[mnemo] Rebuild complete.");
  } catch {
    console.error("[mnemo] Rebuild failed. Try: rm -rf ~/.npm/_npx/ && npx -y mnemo-mcp");
    process.exit(1);
  }
}

// Pre-flight → rebuild if needed → start server
if (!(await preflight())) {
  await rebuild();
  // Verify the rebuild actually fixed it
  if (!(await preflight())) {
    console.error("[mnemo] Rebuild did not fix the native module. Try reinstalling:");
    console.error("  rm -rf ~/.npm/_npx/ && npx -y mnemo-mcp");
    process.exit(1);
  }
}

await import("./index.js");
