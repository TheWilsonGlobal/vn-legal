// ============================================================================
// Storage Adapter for ConGraphRAG
// ============================================================================
// Combines GraphClient and VectorStore to implement IStorage interface

import type {
  IStorage,
  Entity,
  Chunk,
  Fact,
  Community,
  Document,
  Relationship,
} from "congraph-rag/core";
import type { GraphClient } from "../graph/client";
import type { IVectorStore } from "../embeddings/vector-store-factory";
import logger from "../shared/logger";

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

  // ----------------------------------------------------------------------------
  // Fact Operations
  // ----------------------------------------------------------------------------

  async saveFact(fact: Fact): Promise<void> {
    // Facts are stored as metadata in the graph
    logger.debug(`Saving fact ${fact.id} for chunk ${fact.chunkId}`);
    // No-op for now - facts can be stored as node metadata
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
        parent_id: community.parentId,
        findings: findingsStr,
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
        parentId: node.parent_id,
        entityIds: node.findings?.split(",") || [],
      };
    } catch (error) {
      logger.error(`Failed to get community ${id}:`, error);
      return null;
    }
  }

  async getCommunitiesByLevel(level: number): Promise<Community[]> {
    try {
      const nodes = await this.graph.getNodesByType("Community");
      return nodes
        .filter((n) => n.level === level)
        .map((n) => ({
          id: n.id,
          level: n.level,
          title: n.title,
          summary: n.summary,
          parentId: n.parent_id,
          entityIds: n.findings?.split(",") || [],
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

  async linkChunkToFact(chunkId: string, factId: string): Promise<void> {
    // No-op for now
    logger.debug(`Linking chunk ${chunkId} to fact ${factId}`);
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
