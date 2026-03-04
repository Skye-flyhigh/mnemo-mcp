/**
 * Minimal Ollama embedding client.
 *
 * Calls the Ollama /api/embed endpoint directly — no litellm or heavy deps.
 * Local-first: assumes Ollama is running on the same machine.
 */

export class EmbeddingClient {
  private model: string;
  private baseUrl: string;

  constructor(model: string = "nomic-embed-text", baseUrl: string = "http://localhost:11434") {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Generate an embedding vector for a single text.
   */
  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Ollama embedding failed (${response.status}): ${body}`
      );
    }

    const data = (await response.json()) as { embeddings: number[][] };

    if (!data.embeddings?.length) {
      throw new Error("Ollama returned empty embeddings");
    }

    return data.embeddings[0];
  }

  /**
   * Generate embeddings for multiple texts in a single call.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Ollama batch embedding failed (${response.status}): ${body}`
      );
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings;
  }
}
