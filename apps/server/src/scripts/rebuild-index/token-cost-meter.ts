import { GoogleGenAI } from "@google/genai";
import { config } from "../../shared/config";
import type { IEmbedder } from "../../embeddings/embedder-factory";
import {
  type GeminiEmbedder,
  estimateInputTokens,
  GEMINI_MAX_INPUT_TOKENS,
} from "../../embeddings/embedder-gemini";
import {
  COUNT_TOKENS_TIMEOUT_MS,
  type Doc,
  KINDS,
  PRICE_PER_MILLION_TOKENS_USD,
} from "./constants-types";
import { embeddedText } from "./document-builder";
import { log } from "./logger";

export function checkEstimatedLimits(docs: Doc[]): number {
  let largest = 0;
  for (const doc of docs) {
    const estimate = estimateInputTokens(embeddedText(doc));
    if (estimate > GEMINI_MAX_INPUT_TOKENS) {
      throw new Error(
        `input ${doc.id} is over the ${GEMINI_MAX_INPUT_TOKENS}-token embedding limit: ` +
          `estimated ${estimate} tokens (an estimate, not a tokenizer count; ` +
          "the text is not truncated)",
      );
    }
    largest = Math.max(largest, estimate);
  }
  return largest;
}

export function plannedRequests(docs: Doc[]): number {
  const batch = config.embedding.batchSize;
  return KINDS.reduce(
    (n, kind) =>
      n + Math.ceil(docs.filter((d) => d.kind === kind).length / batch),
    0,
  );
}

export function asDocumentEmbedder(embedder: IEmbedder): GeminiEmbedder {
  if (
    typeof (embedder as Partial<GeminiEmbedder>).embedDocuments !== "function"
  ) {
    throw new Error(
      "embedder has no embedDocuments; EMBEDDING_PROVIDER must be gemini",
    );
  }
  return embedder as GeminiEmbedder;
}

export async function countExactTokens(docs: Doc[]): Promise<number> {
  const ai = new GoogleGenAI({
    apiKey: config.embedding.apiKey,
    httpOptions: { timeout: COUNT_TOKENS_TIMEOUT_MS },
  });
  const texts = docs.map(embeddedText);
  const batch = config.embedding.batchSize;
  let total = 0;
  for (let i = 0; i < texts.length; i += batch) {
    const chunk = texts.slice(i, i + batch);
    const response = await ai.models.countTokens({
      model: config.embedding.model,
      contents: chunk.map((text) => ({ parts: [{ text }] })),
    });
    if (typeof response.totalTokens !== "number") {
      throw new Error("countTokens returned no totalTokens");
    }
    total += response.totalTokens;
  }
  return total;
}

export function approximateTokens(docs: Doc[]): number {
  let chars = 0;
  for (const doc of docs) chars += [...embeddedText(doc)].length;
  return Math.ceil(chars / 4);
}

export function costUsd(tokens: number): number {
  return (tokens * PRICE_PER_MILLION_TOKENS_USD) / 1_000_000;
}

export async function dryRun(docs: Doc[], offline: boolean): Promise<void> {
  const articles = docs.filter((d) => d.kind === "article").length;
  const clauses = docs.filter((d) => d.kind === "clause").length;
  const reports = docs.filter((d) => d.kind === "report").length;
  const inputs = docs.length;
  const largestEstimate = checkEstimatedLimits(docs);
  const requests = plannedRequests(docs);
  const budget = config.embedding.maxTokensBudget;
  const batch = config.embedding.batchSize;

  if (offline) {
    const approx = approximateTokens(docs);
    log(
      `DRY RUN (OFFLINE, NOT A GEMINI COUNT): inputs=${inputs} articles=${articles} ` +
        `clauses=${clauses} reports=${reports} batch=${batch} requests_planned=${requests}`,
    );
    log(
      `DRY RUN (OFFLINE): tokens_approx=${approx} (char-based approximation: chars/4, heuristic) ` +
        `est_cost_usd_approx=${costUsd(approx).toFixed(4)} budget=${budget}`,
    );
    log(
      `DRY RUN (OFFLINE): max_input_estimate_tokens=${largestEstimate} ` +
        `(limit ${GEMINI_MAX_INPUT_TOKENS}; char-based estimate, not a tokenizer count)`,
    );
    return;
  }

  let tokens: number;
  try {
    tokens = await countExactTokens(docs);
  } catch (error) {
    const approx = approximateTokens(docs);
    log(
      `DRY RUN: exact token count failed; char-based approximation for reference only: ` +
        `tokens_approx=${approx} (chars/4, heuristic, not a Gemini count)`,
    );
    throw error;
  }
  log(
    `DRY RUN: inputs=${inputs} articles=${articles} clauses=${clauses} ` +
      `reports=${reports} batch=${batch} requests_planned=${requests} tokens=${tokens} ` +
      `est_cost_usd=${costUsd(tokens).toFixed(4)} (at $${PRICE_PER_MILLION_TOKENS_USD}/1M input tokens, standard price; free tier may apply) ` +
      `budget=${budget}`,
  );
  log(
    `DRY RUN: max_input_estimate_tokens=${largestEstimate} ` +
      `(limit ${GEMINI_MAX_INPUT_TOKENS}; char-based estimate, not a tokenizer count)`,
  );
  if (tokens > budget) {
    throw new Error(
      `token total ${tokens} exceeds EMBED_MAX_TOKENS_BUDGET=${budget}; aborting`,
    );
  }
}
