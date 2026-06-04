// ============================================================================
// Vector Store Factory - Supports both LanceDB and ConGraphDB
// ============================================================================

import { config } from "../shared/config";
import {
  createVectorStore as createLanceDBVectorStore,
  type VectorStore as LanceDBVectorStore,
} from "./lancedb";
import {
  createConGraphVectorStore,
  type ConGraphVectorStore,
} from "./congraph";
import { VectorResult } from "../shared/types";
import logger from "../shared/logger";

// ----------------------------------------------------------------------------
// Common Vector Store Interface
// ----------------------------------------------------------------------------

export interface IVectorStore {
  initialize(): Promise<void>;
  addArticles(embeddings: any[]): Promise<void>;
  addClauses(embeddings: any[]): Promise<void>;
  addCommunityReports(embeddings: any[]): Promise<void>;
  searchArticles(
    queryVector: number[],
    limit?: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorResult[]>;
  searchArticlesBatch(
    queryVectors: number[][],
    limit?: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorResult[][]>;
  searchClauses(
    queryVector: number[],
    limit?: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorResult[]>;
  searchCommunityReports(
    queryVector: number[],
    limit?: number,
  ): Promise<VectorResult[]>;
  getArticle(articleId: string): Promise<VectorResult | null>;
  getClause(clauseId: string): Promise<VectorResult | null>;
  getStats(): Promise<{ articleCount: number; clauseCount: number }>;
  getCommunityReportCount(): Promise<number>;
  clearAll(): Promise<void>;
  checkpoint(): Promise<void>;
  close(): Promise<void>;
  isReady(): boolean;
  getType(): string;
  getStore(): any;
}

// ----------------------------------------------------------------------------
// LanceDB Adapter
// ----------------------------------------------------------------------------

class LanceDBAdapter implements IVectorStore {
  private store: LanceDBVectorStore | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (!this.store) {
      this.store = await createLanceDBVectorStore();
      await this.store.initialize();
      this.initialized = true;
    }
  }

  async addArticles(embeddings: any[]): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");
    await this.store.addArticles(embeddings);
  }

  async addClauses(embeddings: any[]): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");
    await this.store.addClauses(embeddings);
  }

  async addCommunityReports(embeddings: any[]): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");
    await this.store.addCommunityReports(embeddings);
  }

  async searchArticles(
    queryVector: number[],
    limit = 10,
    filter?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.searchArticles(queryVector, limit, filter);
  }

  async searchArticlesBatch(
    queryVectors: number[][],
    limit = 10,
    filter?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[][]> {
    if (!this.store) throw new Error("Vector store not initialized");
    return Promise.all(
      queryVectors.map((v) => this.store!.searchArticles(v, limit, filter)),
    );
  }

  async searchClauses(
    queryVector: number[],
    limit = 10,
    filter?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.searchClauses(queryVector, limit, filter);
  }

  async searchCommunityReports(
    queryVector: number[],
    limit = 3,
  ): Promise<Record<string, unknown>[]> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.searchCommunityReports(queryVector, limit);
  }

  async getArticle(articleId: string): Promise<Record<string, unknown> | null> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.getArticle(articleId);
  }

  async getClause(clauseId: string): Promise<Record<string, unknown> | null> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.getClause(clauseId);
  }

  async getStats(): Promise<{ articleCount: number; clauseCount: number }> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.getStats();
  }

  async getCommunityReportCount(): Promise<number> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.getCommunityReportCount();
  }

  async clearAll(): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");
    await this.store.clearAll();
  }

  async checkpoint(): Promise<void> {
    // LanceDB doesn't require manual checkpointing like ConGraphDB
    return;
  }

  async close(): Promise<void> {
    if (this.store) {
      await this.store.close();
      this.store = null;
      this.initialized = false;
    }
  }

  isReady(): boolean {
    return this.initialized && this.store !== null && this.store.isReady();
  }

  getType(): string {
    return "lancedb";
  }

  getStore(): any {
    return this.store;
  }
}

// ----------------------------------------------------------------------------
// ConGraphDB Adapter
// ----------------------------------------------------------------------------

class ConGraphDBAdapter implements IVectorStore {
  private store: ConGraphVectorStore | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (!this.store) {
      this.store = await createConGraphVectorStore();
      this.initialized = true;
    }
  }

  async addArticles(embeddings: any[]): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");
    await this.store.addArticles(embeddings);
  }

  async addClauses(embeddings: any[]): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");
    await this.store.addClauses(embeddings);
  }

  async addCommunityReports(embeddings: any[]): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");
    await this.store.addCommunityReports(embeddings);
  }

  async searchArticles(
    queryVector: number[],
    limit = 10,
    filter?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.searchArticles(queryVector, limit, filter);
  }

  async searchArticlesBatch(
    queryVectors: number[][],
    limit = 10,
    filter?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[][]> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await (
      this.store as unknown as {
        searchArticlesBatch: (
          v: number[][],
          l: number,
          f?: any,
        ) => Promise<any[][]>;
      }
    ).searchArticlesBatch(queryVectors, limit, filter);
  }

  async searchClauses(
    queryVector: number[],
    limit = 10,
    filter?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.searchClauses(queryVector, limit, filter);
  }

  async searchCommunityReports(
    queryVector: number[],
    limit = 3,
  ): Promise<Record<string, unknown>[]> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.searchCommunityReports(queryVector, limit);
  }

  async getArticle(articleId: string): Promise<Record<string, unknown> | null> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.getArticle(articleId);
  }

  async getClause(clauseId: string): Promise<Record<string, unknown> | null> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.getClause(clauseId);
  }

  async getStats(): Promise<{ articleCount: number; clauseCount: number }> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.getStats();
  }

  async getCommunityReportCount(): Promise<number> {
    if (!this.store) throw new Error("Vector store not initialized");
    return await this.store.getCommunityReportCount();
  }

  async clearAll(): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");
    await this.store.clearAll();
  }

  async checkpoint(): Promise<void> {
    if (!this.store) throw new Error("Vector store not initialized");
    await this.store.checkpoint();
  }

  async close(): Promise<void> {
    if (this.store) {
      await this.store.close();
      this.store = null;
      this.initialized = false;
    }
  }

  isReady(): boolean {
    return this.initialized && this.store !== null && this.store.isReady();
  }

  getType(): string {
    return "congraph";
  }

  getStore(): any {
    return this.store;
  }
}

// ----------------------------------------------------------------------------
// Factory Function
// ----------------------------------------------------------------------------

export async function createVectorStore(type?: string): Promise<IVectorStore> {
  const storeType = type || config.vectorStoreType;

  logger.info(`Creating vector store of type: ${storeType}`);

  let adapter: IVectorStore;
  switch (storeType) {
    case "lancedb":
      adapter = new LanceDBAdapter();
      break;
    case "congraph":
      adapter = new ConGraphDBAdapter();
      break;
    default:
      throw new Error(`Unknown vector store type: ${storeType}`);
  }

  await adapter.initialize();
  return adapter;
}
