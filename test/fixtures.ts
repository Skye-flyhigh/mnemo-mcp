import type { MnemoConfig } from "../src/types.js";

/**
 * Standard mock configuration for tests.
 * Uses in-memory SQLite and mock embeddings.
 */
export const mockConfig: MnemoConfig = {
  dbPath: ":memory:",
  embeddingProvider: "ollama",
  embeddingModel: "nomic-embed-text",
  embeddingBaseUrl: "http://localhost:11434",
  embeddingApiKey: null,
  dimensions: 768,
  autoReinforce: true,
  reinforceAmount: 0.05,
};
