/**
 * Utility helpers for mnemo — hashing, ID generation.
 */

import { createHash } from "node:crypto";

/**
 * Generate a content hash for deduplication.
 * Case-insensitive, whitespace-trimmed.
 */
export function contentHash(content: string): string {
  const normalized = content.toLowerCase().trim();
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Generate a unique memory ID from content + timestamp.
 * Optionally scoped with a prefix (e.g., project name).
 */
export function generateId(content: string, prefix?: string): string {
  const hash = contentHash(content).slice(0, 16);
  const ts = Date.now();
  return prefix ? `${prefix}_${hash}_${ts}` : `${hash}_${ts}`;
}

/**
 * Current ISO 8601 timestamp.
 */
export function isoNow(): string {
  return new Date().toISOString();
}
