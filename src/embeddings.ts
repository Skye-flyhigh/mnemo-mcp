/**
 * Embedding providers for mnemo.
 *
 * Two backends:
 * - OllamaEmbedding: local Ollama /api/embed endpoint
 * - OpenAIEmbedding: any OpenAI-compatible /v1/embeddings API
 *     (OpenAI, Azure, Together, Voyage, Jina, etc.)
 */

import type { EmbeddingProvider, MnemoConfig } from "./types.js";

// ── Ollama ─────────────────────────────────────────────────────

export class OllamaEmbedding implements EmbeddingProvider {
  private model: string;
  private baseUrl: string;

  constructor(model: string, baseUrl: string) {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embedding failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    if (!data.embeddings?.length) {
      throw new Error("Ollama returned empty embeddings");
    }
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama batch embedding failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings;
  }
}

// ── OpenAI-compatible ──────────────────────────────────────────

export class OpenAIEmbedding implements EmbeddingProvider {
  private model: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(model: string, baseUrl: string, apiKey: string) {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.request([text]);
    return result[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.request(texts);
  }

  private async request(input: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI embedding failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    if (!data.data?.length) {
      throw new Error("OpenAI returned empty embeddings");
    }

    // Sort by index — API spec says order is not guaranteed
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

// ── Factory ────────────────────────────────────────────────────

export function createEmbeddingProvider(config: MnemoConfig): EmbeddingProvider {
  switch (config.embeddingProvider) {
    case "openai":
      if (!config.embeddingApiKey) {
        throw new Error("MNEMO_EMBEDDING_API_KEY is required for the openai provider");
      }
      return new OpenAIEmbedding(
        config.embeddingModel,
        config.embeddingBaseUrl,
        config.embeddingApiKey,
      );

    case "ollama":
    default:
      return new OllamaEmbedding(config.embeddingModel, config.embeddingBaseUrl);
  }
}
