import { vi } from "vitest";
import {
  GeminiEmbedder,
  type GeminiEmbedderOptions,
} from "../../../../src/embeddings/embedder-gemini";
import type { ArticleNode } from "../../../../src/shared/types";

export const KEY = "test-key-not-real";
export const DIM = 768;
export const MODEL = "gemini-embedding-2";

export const vec = (seed: number): number[] =>
  Array.from({ length: DIM }, (_, i) => (((i + seed) % 7) + 1) / 10);

export const okFor = (count: number, seed = 1) => ({
  embeddings: Array.from({ length: count }, (_, i) => ({
    values: vec(seed + i),
  })),
});

export const httpError = (status: number) =>
  Object.assign(new Error("upstream"), { status });

export function make(overrides: Partial<GeminiEmbedderOptions> = {}) {
  const sleep = vi.fn(async (_ms: number) => {});
  const embedder = new GeminiEmbedder({
    apiKey: KEY,
    model: MODEL,
    dim: DIM,
    batchSize: 50,
    maxConcurrency: 2,
    sleep,
    ...overrides,
  });
  return { embedder, sleep };
}

export async function ready(overrides: Partial<GeminiEmbedderOptions> = {}) {
  const made = make(overrides);
  await made.embedder.initialize();
  return made;
}

export const article = {
  id: "a1",
  title: "Điều 1. Phạm vi",
  content: "Nội dung $& {content}",
  clauses: [
    { id: "c1", clause_number: 1, text: "Khoản một" },
    { id: "c2", clause_number: 2, text: "Khoản hai" },
    { id: "c3", clause_number: 3, text: "Khoản ba" },
  ],
} as unknown as ArticleNode;

export const VI_SENTENCE =
  "Người có quyền sở hữu tài sản được định đoạt, sử dụng và hưởng lợi ích từ tài sản đó. ";

export function sentTexts(
  embedContentSpy: ReturnType<typeof vi.fn>,
  callIndex: number,
): string[] {
  const request = embedContentSpy.mock.calls[callIndex][0] as {
    contents: Array<{ parts: Array<{ text: string }> }>;
  };
  return request.contents.map((c) => c.parts[0].text);
}
