// ============================================================================
// ConGraphDB Client Wrapper
// ============================================================================

import { Database } from "congraphdb";
import { config } from "../shared/config";
import logger from "../shared/logger";
import type { ArticleNode, ArticleClause } from "../shared/types";
import { createNodesBatch, createEdgesBatch } from "./client-batch-ops";

// ----------------------------------------------------------------------------
// ConGraphDB Client
// ----------------------------------------------------------------------------

export class GraphClient {
  private db: Database | null = null;
  public conn: any = null;
  private isInitialized = false;
  public idToOffset: Map<string, number> = new Map();

  constructor(private dbPath: string) {}

  /**
   * Initialize the graph database
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    logger.info(`Initializing ConGraphDB at ${this.dbPath}`);

    try {
      this.db = new Database(this.dbPath);
      // init() is synchronous in ConGraphDB
      this.db.init();

      this.conn = (this.db as any).createConnection();
      this.isInitialized = true;

      // Create node tables if they don't exist
      await this.ensureSchema();

      logger.info("ConGraphDB initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize ConGraphDB", error);
      throw error;
    }
  }

  /**
   * Ensure schema exists
   */
  private async ensureSchema(): Promise<void> {
    if (!this.conn) throw new Error("Connection not initialized");

    // Create node tables using Cypher
    const tables = [
      "CREATE NODE TABLE Part(id STRING, name STRING, name_short STRING, part_number INT64, chapter_count INT64, article_count INT64, PRIMARY KEY (id))",
      "CREATE NODE TABLE Chapter(id STRING, name STRING, name_short STRING, chapter_roman STRING, part_id STRING, article_count INT64, section_count INT64, summary STRING, PRIMARY KEY (id))",
      "CREATE NODE TABLE Section(id STRING, name STRING, name_short STRING, section_number INT64, chapter_id STRING, article_count INT64, subsection_count INT64, PRIMARY KEY (id))",
      "CREATE NODE TABLE Subsection(id STRING, name STRING, name_short STRING, subsection_number INT64, section_id STRING, article_count INT64, PRIMARY KEY (id))",
      "CREATE NODE TABLE Article(id STRING, article_number INT64, title STRING, content STRING, metadata STRING, keywords STRING, hierarchical_path STRING, clause_count INT64, PRIMARY KEY (id))",
      "CREATE NODE TABLE Clause(id STRING, clause_number INT64, text STRING, article_id STRING, point_count INT64, PRIMARY KEY (id))",
      "CREATE NODE TABLE ClausePoint(id STRING, point_letter STRING, text STRING, clause_id STRING, PRIMARY KEY (id))",
      "CREATE NODE TABLE LegalConcept(id STRING, name STRING, name_variants STRING, definition STRING, category STRING, source_articles STRING, source_clauses STRING, related_concepts STRING, PRIMARY KEY (id))",
      "CREATE NODE TABLE Community(id STRING, level INT64, title STRING, summary STRING, findings STRING, rating FLOAT, principles STRING, article_count INT64, PRIMARY KEY (id))",
    ];

    // Create relationship tables
    const relTables = [
      "CREATE REL TABLE HAS_CHAPTER(FROM Part TO Chapter, order INT64)",
      "CREATE REL TABLE HAS_SECTION(FROM Chapter TO Section, order INT64)",
      "CREATE REL TABLE HAS_SUBSECTION(FROM Section TO Subsection, order INT64)",
      "CREATE REL TABLE BELONGS_TO_SUBSECTION(FROM Article TO Subsection, level STRING)",
      "CREATE REL TABLE BELONGS_TO_SECTION(FROM Article TO Section, level STRING)",
      "CREATE REL TABLE BELONGS_TO_CHAPTER(FROM Article TO Chapter, level STRING)",
      "CREATE REL TABLE HAS_CLAUSE(FROM Article TO Clause, order INT64)",
      "CREATE REL TABLE HAS_POINT(FROM Clause TO ClausePoint, order INT64)",
      "CREATE REL TABLE REFERENCES(FROM Article TO Article, reference_type STRING, context STRING, reference_text STRING, strength FLOAT)",
      "CREATE REL TABLE REFERENCED_BY(FROM Article TO Article)",
      "CREATE REL TABLE NEXT_ARTICLE(FROM Article TO Article, same_context BOOL)",
      "CREATE REL TABLE CONTAINS(FROM Community TO Community)",
      "CREATE REL TABLE BELONGS_TO_COMMUNITY(FROM Article TO Community)",
    ];

    for (const query of [...tables, ...relTables]) {
      try {
        const result = await this.conn.query(query);
        if (result && typeof result === "object" && (result as any).err) {
          const err = (result as any).err;
          if (!err.message?.includes("already exists")) {
            logger.debug(`Schema query note: ${err.message}`);
          }
        }
      } catch (e: any) {
        // Table might already exist, ignore
        if (!e.message?.includes("already exists")) {
          logger.debug(`Schema query note: ${e.message}`);
        }
      }
    }
  }

  /**
   * Close the graph database connection
   */
  async close(): Promise<void> {
    logger.info("Closing ConGraphDB");
    if (this.db) {
      // close() is synchronous in ConGraphDB
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }

  /**
   * Checkpoint the database (flush WAL to main storage)
   */
  async checkpoint(): Promise<void> {
    if (this.db) {
      this.db.checkpoint();
    }
  }

  /**
   * Refresh the database connection (close and re-initialize)
   */
  async refresh(): Promise<void> {
    await this.close();
    await this.initialize();
  }

  /**
   * Add a node to the graph
   */
  async addNode(
    type: string,
    id: string,
    properties: Record<string, any>,
  ): Promise<void> {
    if (!this.conn) throw new Error("Connection not initialized");

    // Handle complex properties that need serialization
    const props: Record<string, any> = { ...properties, id };

    // Serialize arrays and objects
    if (props.clauses) {
      props.clauses = JSON.stringify(props.clauses);
    }
    if (props.points) {
      props.points = JSON.stringify(props.points);
    }
    if (props.keywords) {
      props.keywords = JSON.stringify(props.keywords);
    }
    if (props.metadata) {
      props.metadata = JSON.stringify(props.metadata);
    }
    if (props.name_variants) {
      props.name_variants = JSON.stringify(props.name_variants);
    }
    if (props.source_articles) {
      props.source_articles = JSON.stringify(props.source_articles);
    }
    if (props.source_clauses) {
      props.source_clauses = JSON.stringify(props.source_clauses);
    }
    if (props.related_concepts) {
      props.related_concepts = JSON.stringify(props.related_concepts);
    }
    if (props.findings) {
      props.findings = JSON.stringify(props.findings);
    }

    try {
      const propEntries = Object.entries(props).filter(
        ([, v]) => v !== undefined && v !== null,
      );
      let propsStr = "";
      if (propEntries.length > 0) {
        propsStr =
          " { " +
          propEntries
            .map(([_k, v]) => {
              if (typeof v === "string")
                return `${_k}: '${v.replace(/'/g, "\\'")}'`;
              if (typeof v === "number" || typeof v === "boolean")
                return `${_k}: ${v}`;
              return `${_k}: '${JSON.stringify(v).replace(/'/g, "\\'")}'`;
            })
            .join(", ") +
          " }";
      }
      await this.query(`CREATE (n:${type}${propsStr})`);
    } catch (e: any) {
      // Node might exist, update it
      logger.debug(`Node create note for ${id}: ${e.message}`);
    }
  }

  /**
   * Add an edge to the graph using Cypher
   */
  async addEdge(edge: any): Promise<void> {
    if (!this.conn) throw new Error("Connection not initialized");

    try {
      // Build properties string
      const propEntries = Object.entries(edge).filter(
        ([k]) => !["from", "to", "type", "_from", "_to", "_type"].includes(k),
      );

      let propsStr = "";
      if (propEntries.length > 0) {
        propsStr =
          " { " +
          propEntries
            .map(([k, v]) => {
              if (typeof v === "string")
                return `${k}: '${v.replace(/'/g, "\\'")}'`;
              if (typeof v === "number") return `${k}: ${v}`;
              if (typeof v === "boolean") return `${k}: ${v}`;
              return `${k}: ${JSON.stringify(v)}`;
            })
            .join(", ") +
          " }";
      }

      // Try different node label combinations based on edge type
      const edgeType = edge.type;
      let fromLabel, toLabel;

      switch (edgeType) {
        case "HAS_CHAPTER":
          fromLabel = "Part";
          toLabel = "Chapter";
          break;
        case "HAS_SECTION":
          fromLabel = "Chapter";
          toLabel = "Section";
          break;
        case "HAS_SUBSECTION":
          fromLabel = "Section";
          toLabel = "Subsection";
          break;
        case "BELONGS_TO":
          fromLabel = "Article";
          toLabel = "Subsection";
          break;
        case "HAS_CLAUSE":
          fromLabel = "Article";
          toLabel = "Clause";
          break;
        case "HAS_POINT":
          fromLabel = "Clause";
          toLabel = "ClausePoint";
          break;
        case "REFERENCES":
        case "REFERENCED_BY":
        case "NEXT_ARTICLE":
          fromLabel = "Article";
          toLabel = "Article";
          break;
        case "CONTAINS":
          fromLabel = "Community";
          toLabel = "Community";
          break;
        case "BELONGS_TO_COMMUNITY":
          fromLabel = "Article";
          toLabel = "Community";
          break;
        default:
          fromLabel = "";
          toLabel = "";
      }

      let query;
      if (fromLabel && toLabel) {
        query = `MATCH (from:${fromLabel} {id: '${edge.from}'}), (to:${toLabel} {id: '${edge.to}'}) CREATE (from)-[r:${edgeType}${propsStr}]->(to)`;
      } else {
        query = `MATCH (from {id: '${edge.from}'}), (to {id: '${edge.to}'}) CREATE (from)-[r:${edgeType}${propsStr}]->(to)`;
      }

      await this.query(query);
    } catch (e: any) {
      logger.debug(
        `Edge create note (${edge.type} ${edge.from}->${edge.to}): ${e.message}`,
      );
    }
  }

  /**
   * Get a full article with all its clauses and points
   */
  async getFullArticle(articleId: string): Promise<ArticleNode | null> {
    if (!this.conn) throw new Error("Connection not initialized");

    try {
      // Use a single Cypher query to fetch everything hierarchically
      const query = `
        MATCH (a:Article {id: '${articleId}'})
        OPTIONAL MATCH (a)-[:BELONGS_TO_SUBSECTION|BELONGS_TO_SECTION|BELONGS_TO_CHAPTER|BELONGS_TO_PART*1..3]->(p:Part)
        OPTIONAL MATCH (a)-[:BELONGS_TO_SUBSECTION|BELONGS_TO_SECTION|BELONGS_TO_CHAPTER|BELONGS_TO_PART*1..2]->(ch:Chapter)
        OPTIONAL MATCH (a)-[:HAS_CLAUSE]->(c:Clause)
        OPTIONAL MATCH (c)-[:HAS_POINT]->(p_point:ClausePoint)
        RETURN a, 
               p.name as part_name, 
               ch.name as chapter_name, 
               c as clause, 
               p_point as point
        ORDER BY clause.clause_number, point.point_letter
      `;

      const rows = await this.query(query);
      logger.debug(
        `getFullArticle ${articleId} returned ${rows?.length || 0} rows`,
      );

      if (!rows || rows.length === 0) return null;

      // Group rows by article and clause
      const articleRaw = rows[0].a;
      if (!articleRaw) return null;

      const article: ArticleNode = this.deserializeNode({
        ...articleRaw,
        clauses: [],
      });

      // 4. Populate metadata with a fail-safe approach
      if (article.metadata) {
        if (!article.metadata.part || article.metadata.part === "N/A") {
          article.metadata.part =
            rows[0].part_name || article.metadata.part || "";
        }
        if (!article.metadata.chapter || article.metadata.chapter === "N/A") {
          article.metadata.chapter =
            rows[0].chapter_name || article.metadata.chapter || "";
        }
      } else {
        article.metadata = {
          part: rows[0].part_name || "",
          chapter: rows[0].chapter_name || "",
          section: "",
          subsection: "",
          source: "",
        };
      }

      // Final Check: If metadata is still empty string, try to infer from path as last resort
      if (
        (!article.metadata.part || article.metadata.part === "") &&
        article.hierarchical_path
      ) {
        // IDs are structured like "part_1/chapter_p1_c3"
      }

      const clausesMap = new Map<string, ArticleClause>();

      for (const row of rows) {
        if (row.clause) {
          const clauseId = row.clause.id;
          if (!clausesMap.has(clauseId)) {
            const clause: ArticleClause = {
              ...row.clause,
              points: [],
            };
            clausesMap.set(clauseId, clause);
            article.clauses.push(clause);
          }

          if (row.point) {
            clausesMap.get(clauseId)!.points.push(row.point);
          }
        }
      }

      return article;
    } catch (error) {
      logger.error(`Failed to get full article ${articleId}`, error);
      return null;
    }
  }

  /**
   * Get a node by type and ID (matches on the string `id` primary key)
   */
  async getNode(type: string, id: string): Promise<any | null> {
    if (!this.conn) throw new Error("Connection not initialized");

    try {
      let query: string;
      if (type) {
        query = `MATCH (n:${type} {id: '${id}'}) RETURN n LIMIT 1`;
      } else {
        query = `MATCH (n) WHERE n.id = '${id}' RETURN n LIMIT 1`;
      }
      const rows = await this.query(query);
      if (!rows || rows.length === 0) return null;
      const raw = rows[0].n ?? rows[0];
      return this.deserializeNode(raw);
    } catch {
      return null;
    }
  }

  /**
   * Get all nodes of a specific type
   */
  async getNodesByType(type: string): Promise<any[]> {
    if (!this.conn) throw new Error("Connection not initialized");

    try {
      const rows = await this.query(`MATCH (n:${type}) RETURN n`);
      const nodes = rows.map((r: any) => r.n ?? r);

      return nodes.map((n) => this.deserializeNode(n));
    } catch {
      return [];
    }
  }

  /**
   * Get outgoing edges from a node via direct Cypher query.
   * Using Cypher avoids the broken label-lookup in EdgeAPI.get().
   */
  async getOutgoingEdges(nodeId: string, edgeType?: string): Promise<any[]> {
    if (!this.conn) throw new Error("Connection not initialized");

    try {
      const relPattern = edgeType ? `[r:${edgeType}]` : `[r]`;
      const query = `MATCH (from {id: '${nodeId}'})-${relPattern}->(to) RETURN r, to.id AS toId`;
      const rows = await this.query(query);
      return (rows ?? []).map((row: any) => ({
        ...(row.r ?? {}),
        from: nodeId,
        to: row.toId ?? row.r?._to ?? "",
        _type: edgeType ?? row.r?._type ?? "",
        weight: row.r?.weight ?? 1.0,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get incoming edges to a node via direct Cypher query.
   */
  async getIncomingEdges(nodeId: string, edgeType?: string): Promise<any[]> {
    if (!this.conn) throw new Error("Connection not initialized");

    try {
      const relPattern = edgeType ? `[r:${edgeType}]` : `[r]`;
      const query = `MATCH (from)-${relPattern}->(to {id: '${nodeId}'}) RETURN r, from.id AS fromId`;
      const rows = await this.query(query);
      return (rows ?? []).map((row: any) => ({
        ...(row.r ?? {}),
        from: row.fromId ?? row.r?._from ?? "",
        to: nodeId,
        _type: edgeType ?? row.r?._type ?? "",
        weight: row.r?.weight ?? 1.0,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Execute a Cypher query
   */
  async query(pattern: string, params?: any[]): Promise<any[]> {
    if (!this.conn) throw new Error("Connection not initialized");

    let result: any = null;
    try {
      if (params && params.length > 0) {
        result = await this.conn.queryWithParams(pattern, params);
      } else {
        result = await this.conn.query(pattern);
      }

      if (result && typeof result === "object" && (result as any).err) {
        throw (result as any).err;
      }
      const rows = (await result.getAll()) || [];
      return rows;
    } catch (e) {
      logger.error(`Query error for [${pattern.substring(0, 50)}...]:`, e);
      throw e;
    } finally {
      if (result && typeof result.close === "function") {
        result.close();
      }
    }
  }

  /**
   * Count nodes by type
   */
  async countNodes(type?: string): Promise<number> {
    if (!this.conn) throw new Error("Connection not initialized");

    const countQuery = type
      ? `MATCH (n:${type}) RETURN count(n) as count`
      : "MATCH (n) RETURN count(n) as count";
    const rows = await this.query(countQuery);
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Count edges by type
   */
  async countEdges(type?: string): Promise<number> {
    if (!this.conn) throw new Error("Connection not initialized");

    const relSchema: Record<string, [string, string]> = {
      HAS_CHAPTER: ["Part", "Chapter"],
      HAS_SECTION: ["Chapter", "Section"],
      HAS_SUBSECTION: ["Section", "Subsection"],
      BELONGS_TO_SUBSECTION: ["Article", "Subsection"],
      BELONGS_TO_SECTION: ["Article", "Section"],
      BELONGS_TO_CHAPTER: ["Article", "Chapter"],
      HAS_CLAUSE: ["Article", "Clause"],
      HAS_POINT: ["Clause", "ClausePoint"],
      REFERENCES: ["Article", "Article"],
      REFERENCED_BY: ["Article", "Article"],
      NEXT_ARTICLE: ["Article", "Article"],
    };

    if (type && relSchema[type]) {
      const [from, to] = relSchema[type];
      const query = `MATCH (:${from})-[r:${type}]->(:${to}) RETURN count(r) as count`;
      const rows = await this.query(query);
      const val = rows[0]?.count;
      return typeof val === "bigint" ? Number(val) : Number(val ?? 0);
    }

    if (type === "BELONGS_TO") {
      let total = 0;
      for (const target of ["SUBSECTION", "SECTION", "CHAPTER"]) {
        total += await this.countEdges(`BELONGS_TO_${target}`);
      }
      return total;
    }

    const query = type
      ? `MATCH ()-[r:${type}]->() RETURN count(r) as count`
      : "MATCH ()-[r]->() RETURN count(r) as count";

    const rows = await this.query(query);
    if (!rows || rows.length === 0) return 0;

    const val = rows[0]?.count;
    return typeof val === "bigint" ? Number(val) : Number(val ?? 0);
  }

  /**
   * Get statistics about the graph
   */
  async getStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};

    const nodeTypes = [
      "Part",
      "Chapter",
      "Section",
      "Subsection",
      "Article",
      "Clause",
      "ClausePoint",
      "LegalConcept",
    ];
    const edgeTypes = [
      "HAS_CHAPTER",
      "HAS_SECTION",
      "HAS_SUBSECTION",
      "BELONGS_TO_SUBSECTION",
      "BELONGS_TO_SECTION",
      "BELONGS_TO_CHAPTER",
      "HAS_CLAUSE",
      "HAS_POINT",
      "REFERENCES",
      "REFERENCED_BY",
      "NEXT_ARTICLE",
    ];

    for (const type of nodeTypes) {
      stats[type] = await this.countNodes(type);
    }

    for (const type of edgeTypes) {
      stats[`edge:${type}`] = await this.countEdges(type);
    }

    return stats;
  }

  /**
   * Deserialize node properties (convert JSON strings back to objects)
   */
  private deserializeNode(node: any): any {
    const deserialized = { ...node };

    if (deserialized.clauses && typeof deserialized.clauses === "string") {
      try {
        deserialized.clauses = JSON.parse(deserialized.clauses);
      } catch {
        deserialized.clauses = [];
      }
    }

    if (deserialized.points && typeof deserialized.points === "string") {
      try {
        deserialized.points = JSON.parse(deserialized.points);
      } catch {
        deserialized.points = [];
      }
    }

    if (deserialized.keywords && typeof deserialized.keywords === "string") {
      try {
        deserialized.keywords = JSON.parse(deserialized.keywords);
      } catch {
        deserialized.keywords = [];
      }
    }

    if (deserialized.metadata && typeof deserialized.metadata === "string") {
      try {
        deserialized.metadata = JSON.parse(deserialized.metadata);
      } catch {
        deserialized.metadata = {};
      }
    }

    if (
      deserialized.name_variants &&
      typeof deserialized.name_variants === "string"
    ) {
      try {
        deserialized.name_variants = JSON.parse(deserialized.name_variants);
      } catch {
        deserialized.name_variants = [];
      }
    }

    if (
      deserialized.source_articles &&
      typeof deserialized.source_articles === "string"
    ) {
      try {
        deserialized.source_articles = JSON.parse(deserialized.source_articles);
      } catch {
        deserialized.source_articles = [];
      }
    }

    if (
      deserialized.source_clauses &&
      typeof deserialized.source_clauses === "string"
    ) {
      try {
        deserialized.source_clauses = JSON.parse(deserialized.source_clauses);
      } catch {
        deserialized.source_clauses = [];
      }
    }

    if (
      deserialized.related_concepts &&
      typeof deserialized.related_concepts === "string"
    ) {
      try {
        deserialized.related_concepts = JSON.parse(
          deserialized.related_concepts,
        );
      } catch {
        deserialized.related_concepts = [];
      }
    }

    return deserialized;
  }

  /**
   * Batch create nodes for better performance
   * @returns Array of created node offsets
   */
  async createNodesBatch(
    type: string,
    nodes: Array<{ id: string; [key: string]: any }>,
  ): Promise<number[]> {
    return createNodesBatch(this, type, nodes);
  }

  /**
   * Batch create edges for maximum performance
   *
   * Tries to use native batchCreateRelationships if offsets are available in idToOffset.
   * Falls back to UNWIND Cypher if offsets are missing.
   */
  async createEdgesBatch(edges: any[]): Promise<void> {
    return createEdgesBatch(this, edges);
  }
}

// ----------------------------------------------------------------------------
// Factory Functions
// ----------------------------------------------------------------------------

export async function createGraphClient(): Promise<GraphClient> {
  const client = new GraphClient(config.graphDbPath);
  await client.initialize();
  return client;
}
