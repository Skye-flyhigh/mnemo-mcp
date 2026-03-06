/**
 * Mock embedding provider for tests.
 * Produces deterministic vectors from content — no Ollama needed.
 */

import type { EmbeddingProvider } from "../src/types.js";
import { createHash } from "node:crypto";

const DIMS = 768;

/** Deterministic vector from text: hash → normalized float array. */
function textToVector(text: string): number[] {
  const hash = createHash("sha256").update(text).digest();
  const vec = new Array(DIMS);
  for (let i = 0; i < DIMS; i++) {
    vec[i] = (hash[i % hash.length] / 255) * 2 - 1;
  }
  // Normalize
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map((v) => v / norm);
}

export class MockEmbedding implements EmbeddingProvider {
  calls: string[] = [];

  async embed(text: string): Promise<number[]> {
    this.calls.push(text);
    return textToVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    this.calls.push(...texts);
    return texts.map(textToVector);
  }
}

/** Create a vector very close to another (for semantic dedup testing). */
export function nearVector(text: string, noise = 0.001): number[] {
  const base = textToVector(text);
  return base.map((v) => v + (Math.random() - 0.5) * noise);
}
