import logger from "../shared/logger";

/**
 * Interface representing the required client capabilities for batch operations
 */
export interface BatchOperationsClient {
  conn: any;
  idToOffset: Map<string, number>;
  query(pattern: string, params?: any[]): Promise<any[]>;
}

/**
 * Batch create nodes for better performance
 * @returns Array of created node offsets
 */
export async function createNodesBatch(
  client: BatchOperationsClient,
  type: string,
  nodes: Array<{ id: string; [key: string]: any }>,
): Promise<number[]> {
  if (!client.conn) throw new Error("Connection not initialized");
  if (nodes.length === 0) return [];

  // Try native batchCreateNodes for better performance (10-50x faster)
  if (typeof client.conn.batchCreateNodes === "function") {
    return createNodesBatchNative(client, type, nodes);
  }

  // Fallback to UNWIND for MERGE logic (upsert) which is required for incremental updates
  return createNodesBatchUnwind(client, type, nodes);
}

/**
 * Native batch node creation using ConGraphDB's batchCreateNodes API
 * 10-50x faster than UNWIND but only supports CREATE (no upsert)
 */
async function createNodesBatchNative(
  client: BatchOperationsClient,
  type: string,
  nodes: Array<{ id: string; [key: string]: any }>,
): Promise<number[]> {
  logger.debug(
    `Creating ${nodes.length} ${type} nodes via native batch API...`,
  );

  try {
    // Prepare nodes for batch creation (remove id from properties as it's the primary key)
    const nodesData = nodes.map((node) => {
      const { id, ...props } = node;
      return { id, ...props };
    });

    const offsets = await client.conn.batchCreateNodes(type, nodesData);

    // Map IDs to offsets
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id && offsets[i] !== undefined) {
        client.idToOffset.set(nodes[i].id, offsets[i]);
      }
    }

    return offsets;
  } catch (error) {
    logger.error(
      `Native batch node creation failed for ${type}: ${error}. Falling back to UNWIND...`,
    );
    return createNodesBatchUnwind(client, type, nodes);
  }
}

/**
 * Original UNWIND-based node creation (fallback)
 */
export async function createNodesBatchUnwind(
  client: BatchOperationsClient,
  type: string,
  nodes: Array<{ id: string; [key: string]: any }>,
): Promise<number[]> {
  logger.debug(
    `Creating/Updating ${nodes.length} ${type} nodes via batch logic...`,
  );

  // Pass 1: Ensure nodes exist (Simulation of MERGE without property maps)
  const createMissingQuery = `
    UNWIND $0 AS item
    OPTIONAL MATCH (n:${type}) WHERE n.id = item.id
    WITH item, n
    WHERE n IS NULL
    CREATE (m:${type})
    SET m.id = item.id
  `;
  await client.query(createMissingQuery, [nodes]);

  // Pass 2: Update properties and get offsets
  const updateQuery = `
    UNWIND $0 AS item
    MATCH (n:${type}) WHERE n.id = item.id
    SET n += item
    RETURN id(n) AS offset
  `;

  const rows = await client.query(updateQuery, [nodes]);
  const offsets = rows.map((r) => Number(r.offset));

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id) {
      client.idToOffset.set(nodes[i].id, offsets[i]);
    }
  }
  return offsets;
}

/**
 * Batch create edges for maximum performance
 *
 * Tries to use native batchCreateRelationships if offsets are available in idToOffset.
 * Falls back to UNWIND Cypher if offsets are missing.
 */
export async function createEdgesBatch(
  client: BatchOperationsClient,
  edges: any[],
): Promise<void> {
  if (!client.conn) throw new Error("Connection not initialized");
  if (edges.length === 0) return;

  // Check if we can use native batching (requires all offsets to be known)
  let canUseNative = true;
  const nativeRels: any[] = [];

  for (const edge of edges) {
    const fromOffset = client.idToOffset.get(edge.from);
    const toOffset = client.idToOffset.get(edge.to);

    if (fromOffset !== undefined && toOffset !== undefined) {
      const props = { ...(edge.properties || {}) };
      // Add other non-system properties
      for (const [k, v] of Object.entries(edge)) {
        if (
          ![
            "from",
            "to",
            "type",
            "_from",
            "_to",
            "_type",
            "properties",
          ].includes(k)
        ) {
          props[k] = v;
        }
      }
      nativeRels.push({
        from: fromOffset,
        to: toOffset,
        properties: props,
      });
    } else {
      canUseNative = false;
      break;
    }
  }

  // FORCE UNWIND for now as native batch is currently not materializing edges correctly on Windows
  // in this specific pipeline context.
  if (canUseNative && nativeRels.length > 0) {
    // Group by type as native API handles one table at a time
    const typeGroups = new Map<string, any[]>();
    for (let i = 0; i < edges.length; i++) {
      const type = edges[i].type || edges[i]._type;
      if (!type) {
        canUseNative = false;
        break;
      }
      if (!typeGroups.has(type)) typeGroups.set(type, []);
      typeGroups.get(type)!.push(nativeRels[i]);
    }

    if (canUseNative) {
      for (const [type, rels] of typeGroups) {
        logger.debug(`Creating ${rels.length} ${type} native relationships...`);
        if (rels.length > 0) {
          logger.debug(`Sample rel: from=${rels[0].from}, to=${rels[0].to}`);
        }
        try {
          await client.conn.batchCreateRelationships(type, rels);
        } catch (error) {
          logger.error(
            `Native batch relationship creation failed for ${type}: ${error}. Falling back to UNWIND...`,
          );
          await createEdgesBatchUnwind(
            client,
            edges.filter((e) => (e.type || e._type) === type),
          );
        }
      }
      return;
    }
  }

  // Fallback to UNWIND
  await createEdgesBatchUnwind(client, edges);
}

/**
 * Original UNWIND-based edge creation (fallback or for when offsets are unknown)
 */
export async function createEdgesBatchUnwind(
  client: BatchOperationsClient,
  edges: any[],
): Promise<void> {
  logger.debug(`Creating ${edges.length} edges via UNWIND batching...`);

  // Group by type and labels for UNWIND optimization
  const groups = new Map<string, any[]>();
  for (const edge of edges) {
    const type = edge.type || edge._type;
    if (!type) continue;

    const fromLabel = getLabelForEdgeType(type, "from");
    let toLabel = getLabelForEdgeType(type, "to");

    // Refined label logic for BELONGS_TO
    if (type === "BELONGS_TO" && (edge as any).level) {
      const level = (edge as any).level.toLowerCase();
      if (level === "chapter") toLabel = "Chapter";
      else if (level === "section") toLabel = "Section";
      else if (level === "subsection") toLabel = "Subsection";
    }

    const key = `${type}:${fromLabel}:${toLabel}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(edge);
  }

  for (const [key, groupEdges] of groups) {
    const [type, fromLabel, toLabel] = key.split(":");

    const batchSize = 1000;
    for (let i = 0; i < groupEdges.length; i += batchSize) {
      const chunk = groupEdges.slice(i, i + batchSize);

      const paramData = chunk.map((e) => {
        const props = { ...(e.properties || {}) };
        for (const [k, v] of Object.entries(e)) {
          if (
            ![
              "from",
              "to",
              "type",
              "_from",
              "_to",
              "_type",
              "properties",
            ].includes(k)
          ) {
            props[k] = v;
          }
        }
        return {
          from: e.from,
          to: e.to,
          props,
        };
      });

      if (paramData.length > 0) {
        logger.debug(
          `UNWIND paramData sample for ${type}: ${JSON.stringify(paramData.slice(0, 2))}`,
        );
      }

      const query = `
        UNWIND $0 AS item
        MATCH (f:${fromLabel}) WHERE f.id = item.from
        MATCH (t:${toLabel}) WHERE t.id = item.to
        MERGE (f)-[r:${type}]->(t)
        SET r += item.props
      `;

      try {
        await client.query(query, [paramData]);
      } catch (error) {
        logger.error(`UNWIND batch edge creation failed for ${type}:`, error);
        throw error;
      }
    }
  }
}

/**
 * Helper to determine labels for a given edge type
 */
export function getLabelForEdgeType(
  type: string,
  direction: "from" | "to",
): string {
  const map: Record<string, [string, string]> = {
    HAS_CHAPTER: ["Part", "Chapter"],
    HAS_SECTION: ["Chapter", "Section"],
    HAS_SUBSECTION: ["Section", "Subsection"],
    HAS_CLAUSE: ["Article", "Clause"],
    HAS_POINT: ["Clause", "ClausePoint"],
    REFERENCES: ["Article", "Article"],
    REFERENCED_BY: ["Article", "Article"],
    NEXT_ARTICLE: ["Article", "Article"],
    BELONGS_TO: ["Article", "Chapter"],
  };

  const entry = map[type];
  if (!entry) return "";
  return direction === "from" ? entry[0] : entry[1];
}
