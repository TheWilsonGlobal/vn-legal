// ============================================================================
// Storage Adapter for ConGraphRAG
// ============================================================================
// Combines GraphClient and VectorStore to implement IStorage interface

import type {
  IStorage,
  Entity,
  Chunk,
  Community,
  CommunityScope,
  Document,
  EntityGraph,
  Relationship,
} from "congraph-rag/core";
import type { GraphClient } from "../graph/client";
import type { IVectorStore } from "../embeddings/vector-store-factory";
import logger from "../shared/logger";

// Edge and node labels this adapter writes beyond the ones the graph client already knows.
const COVERS_CLAUSE = "COVERS_CLAUSE";
const REFERENCES = "REFERENCES";
const COMMUNITY_RUN = "CommunityRun";

/** Vector search is an extra on this adapter. congraph-rag's IStorage does not define it. */
export interface EmbeddingSearchable {
  searchEntitiesByEmbedding(embedding: number[], limit: number): Promise<Entity[]>;
}

function toChunk(node: any): Chunk {
  return {
    id: node.id,
    content: node.text ?? "",
    sourceId: node.article_id ?? "",
    sequenceOrder: Number(node.sequence_order ?? 0),
  };
}

function keywordsOf(query: string): string[] {
  return query
    .split(/\s+/)
    .map((k) => k.toLowerCase().trim())
    .filter((k) => k.length >= 2);
}

function keywordScore(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length;
}

// ============================================================================
// ConGraphRAG Storage Adapter
// ============================================================================

export class ConGraphStorageAdapter implements IStorage {
  constructor(
    public graph: GraphClient,
    public vectorStore: IVectorStore,
  ) {}

  // ----------------------------------------------------------------------------
  // Entity Operations
  // ----------------------------------------------------------------------------

  async saveEntity(entity: Entity): Promise<void> {
    try {
      await this.graph.addNode("Article", entity.id, {
        name: entity.name,
        description: entity.description,
        type: entity.type,
        metadata: entity.metadata,
      });

      // Note: Embeddings are added to vector store during indexing process
      // via the addArticles/addClauses methods, not here
    } catch (error) {
      logger.error(`Failed to save entity ${entity.id}:`, error);
      throw error;
    }
  }

  async getEntity(id: string): Promise<Entity | null> {
    try {
      const article = await this.graph.getFullArticle(id);
      if (!article) return null;

      return {
        id: article.id,
        name: article.title,
        type: "Article",
        description: article.content,
        metadata: {
          article_number: article.article_number,
          keywords: article.keywords,
          metadata: article.metadata,
        },
      };
    } catch (error) {
      logger.error(`Failed to get entity ${id}:`, error);
      return null;
    }
  }

  async searchEntities(query: string, limit: number): Promise<Entity[]> {
    try {
      // For legal-rag, we use a manual in-memory scan for better accuracy with Vietnamese
      // similar to the previous PathRAG.findSeedArticles implementation
      const keywords = query
        .split(/\s+/)
        .map((k) => k.toLowerCase().trim())
        .filter((k) => k.length >= 2);
      if (keywords.length === 0) return [];

      const allArticles = await this.graph.getNodesByType("Article");
      const scored: Array<{ entity: Entity; score: number }> = [];

      for (const node of allArticles) {
        const text =
          `${node.title ?? ""} ${node.content ?? ""} ${node.keywords ?? ""}`.toLowerCase();
        let score = 0;
        for (const kw of keywords) {
          if (text.includes(kw)) score++;
        }

        if (score > 0) {
          scored.push({
            entity: {
              id: node.id || node._id,
              name: node.title,
              type: "Article",
              description: node.content,
              metadata: {
                article_number: node.article_number,
                keywords: node.keywords,
                metadata: node.metadata,
                score,
              },
            },
            score,
          });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((s) => s.entity);
    } catch (error) {
      logger.error(`Failed to search entities for query "${query}":`, error);
      return [];
    }
  }

  async searchEntitiesByEmbedding(
    embedding: number[],
    limit: number,
  ): Promise<Entity[]> {
    try {
      const [articleResults, clauseResults] = await Promise.all([
        this.vectorStore.searchArticles(embedding, limit),
        this.vectorStore.searchClauses(embedding, limit),
      ]);

      const combined = [
        ...articleResults.map((r: any) => ({ ...r, entity_type: "Article" })),
        ...clauseResults.map((r: any) => ({ ...r, entity_type: "Clause" })),
      ];

      const mapped = combined.map((r: any) => {
        // ConGraphDB HNSW returns similarity scores that may be >1.
        // The frontend displays score*100 as a percentage, so normalize to 0-1.
        const rawScore = r.score ?? r._score ?? 0;
        let normalizedScore: number;
        if (rawScore > 1) {
          // Raw score is a large similarity value (e.g. 73.02) — treat as percentage
          normalizedScore = Math.min(1.0, rawScore / 100.0);
        } else {
          normalizedScore = rawScore;
        }

        const id =
          r.entity_type === "Article"
            ? r.article_id || r.id
            : r.clause_id || r.id;

        const name =
          r.entity_type === "Article"
            ? r.title || r.name
            : r.text || r.name || "";

        const description =
          r.entity_type === "Article"
            ? r.content || r.description
            : r.text || r.description || "";

        return {
          id,
          name,
          type: r.entity_type,
          description,
          metadata: {
            ...r,
            score: normalizedScore,
          },
        };
      });

      // Sort combined results by similarity score descending
      mapped.sort((a, b) => (b.metadata.score ?? 0) - (a.metadata.score ?? 0));

      return mapped.slice(0, limit);
    } catch (error) {
      logger.error("Failed to search entities by embedding:", error);
      return [];
    }
  }

  // ----------------------------------------------------------------------------
  // Chunk Operations
  // ----------------------------------------------------------------------------

  async saveChunk(chunk: Chunk): Promise<void> {
    try {
      // Store chunk content in graph as a Clause
      await this.graph.addNode("Clause", chunk.id, {
        text: chunk.content,
        article_id: chunk.sourceId,
        sequence_order: chunk.sequenceOrder,
      });

      // Note: Embeddings are added to vector store during indexing process
      // via the addClauses method, not here
    } catch (error) {
      logger.error(`Failed to save chunk ${chunk.id}:`, error);
      throw error;
    }
  }

  async getChunksByEntity(entityId: string): Promise<Chunk[]> {
    try {
      const article = await this.graph.getFullArticle(entityId);
      if (!article) return [];

      return article.clauses.map((clause, idx) => ({
        id: clause.id,
        content: clause.text,
        sourceId: entityId,
        sequenceOrder: idx,
      }));
    } catch (error) {
      logger.error(`Failed to get chunks for entity ${entityId}:`, error);
      return [];
    }
  }

  async getChunk(id: string): Promise<Chunk | null> {
    try {
      const node = await this.graph.getNode("Clause", id);
      return node ? toChunk(node) : null;
    } catch (error) {
      logger.error(`Failed to get chunk ${id}:`, error);
      return null;
    }
  }

  async listChunks(): Promise<Chunk[]> {
    try {
      const nodes = await this.graph.getNodesByType("Clause");
      return nodes.map(toChunk);
    } catch (error) {
      logger.error("Failed to list chunks:", error);
      return [];
    }
  }

  async searchChunks(query: string, limit: number): Promise<Chunk[]> {
    try {
      const keywords = keywordsOf(query);
      if (keywords.length === 0) return [];

      const nodes = await this.graph.getNodesByType("Clause");
      return nodes
        .map((node) => ({
          chunk: toChunk(node),
          score: keywordScore(node.text ?? "", keywords),
        }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((s) => s.chunk);
    } catch (error) {
      logger.error(`Failed to search chunks for query "${query}":`, error);
      return [];
    }
  }

  async getChunksByCommunity(communityId: string): Promise<Chunk[]> {
    try {
      const edges = await this.graph.getOutgoingEdges(communityId, COVERS_CLAUSE);
      const nodes = await Promise.all(
        edges.map((edge) => this.graph.getNode("Clause", edge.to)),
      );
      return nodes.filter((n) => n !== null).map(toChunk);
    } catch (error) {
      logger.error(`Failed to get chunks for community ${communityId}:`, error);
      return [];
    }
  }

  // ----------------------------------------------------------------------------
  // Community Operations
  // ----------------------------------------------------------------------------

  async saveCommunity(community: Community): Promise<void> {
    try {
      const findingsStr = community.entityIds.join(",");
      await this.graph.addNode("Community", community.id, {
        level: community.level,
        title: community.title,
        summary: community.summary,
        findings: findingsStr,
        run_id: community.runId,
      });
    } catch (error) {
      logger.error(`Failed to save community ${community.id}:`, error);
      throw error;
    }
  }

  async getCommunity(id: string): Promise<Community | null> {
    try {
      const node = await this.graph.getNode("Community", id);
      if (!node) return null;

      return {
        id: node.id,
        level: node.level,
        title: node.title,
        summary: node.summary,
        entityIds: node.findings?.split(",") || [],
        runId: node.run_id ?? undefined,
      };
    } catch (error) {
      logger.error(`Failed to get community ${id}:`, error);
      return null;
    }
  }

  async getCommunitiesByLevel(
    level: number,
    scope: CommunityScope = "clusters",
  ): Promise<Community[]> {
    try {
      const activeRun = await this.activeRunId(scope);
      const nodes = await this.graph.getNodesByType("Community");
      // Communities written without a run (the builder's output) are always visible.
      // Scope is not stored on community nodes, so a run-stamped community from
      // another scope is hidden while a run is active here.
      return nodes
        .filter((n) => n.level === level)
        .filter((n) => activeRun === null || !n.run_id || n.run_id === activeRun)
        .map((n) => ({
          id: n.id,
          level: n.level,
          title: n.title,
          summary: n.summary,
          entityIds: n.findings?.split(",") || [],
          runId: n.run_id ?? undefined,
        }));
    } catch (error) {
      logger.error(`Failed to get communities at level ${level}:`, error);
      return [];
    }
  }

  async searchCommunityReports(
    embedding: number[],
    limit: number,
  ): Promise<any[]> {
    try {
      // Search vector store for community reports
      const results = await this.vectorStore.searchCommunityReports(
        embedding,
        limit,
      );

      return results.map((r: any) => ({
        id: r.id,
        level: r.level || 0,
        title: r.title || "",
        summary: r.summary || "",
        findings: r.findings || "",
        rating: r.rating || 0,
        parent_id: r.parent_id,
        score: r.score || r._score,
      }));
    } catch (error) {
      logger.error("Failed to search community reports:", error);
      return [];
    }
  }

  // ----------------------------------------------------------------------------
  // Document Operations
  // ----------------------------------------------------------------------------

  async saveDocument(doc: Document): Promise<void> {
    // Documents are stored as metadata in the graph
    logger.debug(`Saving document ${doc.id}`);
    // No-op for now
  }

  // ----------------------------------------------------------------------------
  // Relationship Operations
  // ----------------------------------------------------------------------------

  async linkEntities(
    sourceId: string,
    targetId: string,
    type: string,
    weight: number,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.graph.addEdge({
        from: sourceId,
        to: targetId,
        type,
        weight,
        ...meta,
      });
    } catch (error) {
      logger.error(
        `Failed to link entities ${sourceId} -> ${targetId}:`,
        error,
      );
      throw error;
    }
  }

  async linkChunkToEntity(chunkId: string, entityId: string): Promise<void> {
    // Link chunk to entity (HAS_CLAUSE relationship)
    try {
      await this.graph.addEdge({
        from: entityId,
        to: chunkId,
        type: "HAS_CLAUSE",
        weight: 1.0,
      });
    } catch (error) {
      logger.error(
        `Failed to link chunk ${chunkId} to entity ${entityId}:`,
        error,
      );
    }
  }

  async linkCommunityToEntity(
    communityId: string,
    entityId: string,
  ): Promise<void> {
    try {
      await this.graph.addEdge({
        from: entityId,
        to: communityId,
        type: "BELONGS_TO_COMMUNITY",
        weight: 1.0,
      });
    } catch (error) {
      logger.error(
        `Failed to link community ${communityId} to entity ${entityId}:`,
        error,
      );
    }
  }

  async linkCommunityToCommunity(
    childId: string,
    parentId: string,
  ): Promise<void> {
    try {
      await this.graph.addEdge({
        from: childId,
        to: parentId,
        type: "CONTAINS",
        weight: 1.0,
      });
    } catch (error) {
      logger.error(
        `Failed to link community ${childId} to parent ${parentId}:`,
        error,
      );
    }
  }

  async linkCommunityToChunk(communityId: string, chunkId: string): Promise<void> {
    try {
      await this.graph.addEdge({
        from: communityId,
        to: chunkId,
        type: COVERS_CLAUSE,
        weight: 1.0,
      });
    } catch (error) {
      logger.error(
        `Failed to link community ${communityId} to chunk ${chunkId}:`,
        error,
      );
    }
  }

  async linkDocumentToChunk(docId: string, chunkId: string): Promise<void> {
    // Documents are not stored in the graph (see saveDocument)
    logger.debug(`Document ${docId} not linked to chunk ${chunkId}: documents are not stored`);
  }

  // ----------------------------------------------------------------------------
  // Advanced Retrieval
  // ----------------------------------------------------------------------------

  async getNeighbors(
    id: string,
    hops: number,
  ): Promise<{ entities: Entity[]; relations: Relationship[] }> {
    const entities: Entity[] = [];
    const relations: Relationship[] = [];

    try {
      const outgoingEdges = await this.graph.getOutgoingEdges(id);

      for (const edge of outgoingEdges) {
        relations.push({
          id: `${edge.from}-${edge.to}`,
          source: edge.from,
          target: edge.to,
          type: edge._type,
          weight: edge.weight,
        });

        const neighbor = await this.getEntity(edge.to);
        if (neighbor) {
          entities.push(neighbor);
        }
      }
    } catch (error) {
      logger.error(`Failed to get neighbors for ${id}:`, error);
    }

    return { entities, relations };
  }

  async searchRelationships(
    query: string,
    limit: number,
  ): Promise<Relationship[]> {
    logger.warn(
      `searchRelationships not fully implemented, returning empty array`,
    );
    return [];
  }

  async searchRelationshipsByEmbedding(
    embedding: number[],
    limit: number,
  ): Promise<Relationship[]> {
    logger.warn(
      `searchRelationshipsByEmbedding not fully implemented, returning empty array`,
    );
    return [];
  }

  async getHierarchicalParent(
    childId: string,
    type: "community" | "entity",
  ): Promise<string | null> {
    try {
      const incomingEdges = await this.graph.getIncomingEdges(childId);
      if (incomingEdges.length > 0) {
        return incomingEdges[0].from;
      }
      return null;
    } catch (error) {
      logger.error(`Failed to get hierarchical parent for ${childId}:`, error);
      return null;
    }
  }

  async findPaths(
    sourceNodes: string[],
    options: { maxHops?: number; threshold?: number; alpha?: number },
  ): Promise<Array<{ path: string[]; weight: number; types?: string[] }>> {
    const maxHops = options.maxHops || 2;
    const results: Array<{ path: string[]; weight: number; types?: string[] }> =
      [];

    if (sourceNodes.length === 0) return results;

    try {
      logger.debug(
        `findPaths BFS starting with ${sourceNodes.length} seeds, maxHops=${maxHops}`,
      );
      // Simple BFS for path finding since congraphdb findPaths isn't fully exposed yet
      const queue: Array<[string, string[], number, string[]]> =
        sourceNodes.map((id) => [id, [id], 0, []]);
      const visited = new Set<string>(sourceNodes);

      while (queue.length > 0) {
        const [currentId, currentPath, depth, currentTypes] = queue.shift()!;

        if (depth > 0) {
          results.push({
            path: currentPath,
            weight: 1.0 / depth, // Simple depth-based weight
            types: currentTypes,
          });
        }

        if (depth < maxHops) {
          const edges = await this.graph.getOutgoingEdges(currentId);
          for (const edge of edges) {
            if (!visited.has(edge.to)) {
              visited.add(edge.to);
              queue.push([
                edge.to,
                [...currentPath, edge.to],
                depth + 1,
                [...currentTypes, edge._type || "RELATED"],
              ]);
            }
          }
        }
      }
      logger.debug(`findPaths BFS found ${results.length} paths`);
    } catch (error) {
      logger.error("Error in findPaths BFS:", error);
    }

    return results;
  }

  async runPageRank(
    seedNodes?: string[],
    dampingFactor?: number,
    maxIterations?: number,
  ): Promise<Map<string, number>> {
    logger.warn(`runPageRank not fully implemented, returning empty map`);
    return new Map();
  }

  // ----------------------------------------------------------------------------
  // Community runs and entity graph (community detection input)
  // ----------------------------------------------------------------------------

  newCommunityRunId(): string {
    return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Record a run as the active one for a scope. Each activation is a new node,
   * because addNode only creates; the newest activation for a scope wins.
   */
  async activateCommunityRun(
    runId: string,
    scope: CommunityScope = "clusters",
  ): Promise<void> {
    const activatedAt = new Date().toISOString();
    await this.graph.addNode(COMMUNITY_RUN, `activation-${scope}-${activatedAt}-${runId}`, {
      run_id: runId,
      scope,
      activated_at: activatedAt,
    });
  }

  private async activeRunId(scope: CommunityScope): Promise<string | null> {
    const activations = (await this.graph.getNodesByType(COMMUNITY_RUN)).filter(
      (n) => n.scope === scope,
    );
    if (activations.length === 0) return null;
    activations.sort((a, b) =>
      String(b.activated_at).localeCompare(String(a.activated_at)),
    );
    return activations[0].run_id ?? null;
  }

  async loadEntityGraph(): Promise<EntityGraph> {
    const nodes = (await this.graph.getNodesByType("Article")).map((n) => n.id || n._id);
    const known = new Set(nodes);
    const seen = new Set<string>();
    const edges: EntityGraph["edges"] = [];

    for (const id of nodes) {
      const outgoing = await this.graph.getOutgoingEdges(id, REFERENCES);
      for (const edge of outgoing) {
        if (!known.has(edge.to) || edge.to === id) continue;
        const key = [id, edge.to].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source: id, target: edge.to, weight: Number(edge.weight ?? 1) });
      }
    }

    return { nodes, edges };
  }
}

// ----------------------------------------------------------------------------
// Factory Function
// ----------------------------------------------------------------------------

export function createStorageAdapter(
  graph: GraphClient,
  vectorStore: IVectorStore,
): ConGraphStorageAdapter {
  return new ConGraphStorageAdapter(graph, vectorStore);
}
