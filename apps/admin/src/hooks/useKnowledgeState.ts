import { useState, useMemo, useEffect } from "react";
import type {
  GraphData,
  Relation,
  RelationsLeaderboard,
} from "../types/index.ts";

export function useKnowledgeState(
  activeView: string,
  graphData: GraphData | null,
  fetchGraphData: () => Promise<void>,
) {
  const [knowledgeTab, setKnowledgeTab] = useState("generals");

  // Relations tab states
  const [relations, setRelations] = useState<Relation[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [relationsPage, setRelationsPage] = useState(1);
  const [relationsTotalPages, setRelationsTotalPages] = useState(1);
  const [relationsTotalItems, setRelationsTotalItems] = useState(0);
  const [relationsSearch, setRelationsSearch] = useState("");
  const [tempRelationsSearch, setTempRelationsSearch] = useState("");
  const [relationsType, setRelationsType] = useState("all");
  const [relationsLeaderboard, setRelationsLeaderboard] =
    useState<RelationsLeaderboard>({ topReferenced: [], topReferring: [] });
  const [selectedRelationNode, setSelectedRelationNode] = useState<
    string | null
  >(null);
  const [relationsModalReady, setRelationsModalReady] = useState(false);

  // Nodes tab states
  const [nodesSearch, setNodesSearch] = useState("");
  const [tempNodesSearch, setTempNodesSearch] = useState("");
  const [nodesType, setNodesType] = useState("all");
  const [nodesPage, setNodesPage] = useState(1);
  const nodesPerPage = 15;

  const processedNodes = useMemo(() => {
    if (!graphData?.nodes) return [];

    const degreeMap: Record<string, number> = {};
    if (graphData.edges) {
      graphData.edges.forEach((edge) => {
        if (edge.source) {
          degreeMap[edge.source] = (degreeMap[edge.source] || 0) + 1;
        }
        if (edge.target) {
          degreeMap[edge.target] = (degreeMap[edge.target] || 0) + 1;
        }
      });
    }

    let list = graphData.nodes.map((node) => ({
      ...node,
      degree: degreeMap[node.id] || 0,
    }));

    if (nodesSearch.trim()) {
      const searchLower = nodesSearch.toLowerCase();
      list = list.filter(
        (n) =>
          n.id.toLowerCase().includes(searchLower) ||
          (n.label && n.label.toLowerCase().includes(searchLower)),
      );
    }

    if (nodesType !== "all") {
      list = list.filter((n) => n.type === nodesType);
    }

    // Sort by degree descending, then by ID
    list.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));

    return list;
  }, [graphData, nodesSearch, nodesType]);

  const paginatedNodes = useMemo(() => {
    const startIndex = (nodesPage - 1) * nodesPerPage;
    return processedNodes.slice(startIndex, startIndex + nodesPerPage);
  }, [processedNodes, nodesPage, nodesPerPage]);

  const nodesTotalPages = Math.ceil(processedNodes.length / nodesPerPage);

  const fetchRelations = async (
    page = 1,
    search = relationsSearch,
    type = relationsType,
  ) => {
    setRelationsLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: "15",
        search,
        type,
      });
      const response = await fetch(
        `/api/admin/graph/relations?${queryParams.toString()}`,
      );
      const data = await response.json();
      setRelations(data.relations || []);
      setRelationsPage(data.pagination.page);
      setRelationsTotalPages(data.pagination.pages);
      setRelationsTotalItems(data.pagination.total);
    } catch (err) {
      console.error("Error fetching relations:", err);
    } finally {
      setRelationsLoading(false);
    }
  };

  const fetchRelationsLeaderboard = async () => {
    try {
      const response = await fetch("/api/admin/graph/relations/leaderboard");
      const data = await response.json();
      setRelationsLeaderboard(data);
    } catch (err) {
      console.error("Error fetching relations leaderboard:", err);
    }
  };

  const computeEgoGraph = (nodeId: string) => {
    if (!graphData) return null;
    const targetNode = graphData.nodes.find((n) => n.id === nodeId);
    if (!targetNode) return null;
    const connectedEdges = graphData.edges.filter(
      (e) => e.source === nodeId || e.target === nodeId,
    );
    const connectedNodeIds = new Set<string>([nodeId]);
    connectedEdges.forEach((e) => {
      connectedNodeIds.add(e.source);
      connectedNodeIds.add(e.target);
    });
    const connectedNodes = graphData.nodes.filter((n) =>
      connectedNodeIds.has(n.id),
    );
    return {
      nodes: connectedNodes,
      edges: connectedEdges,
    };
  };

  useEffect(() => {
    if (activeView === "knowledge" && knowledgeTab === "relations") {
      fetchRelations(relationsPage, relationsSearch, relationsType);
      fetchRelationsLeaderboard();
      if (!graphData) {
        fetchGraphData();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, knowledgeTab, relationsPage, relationsSearch, relationsType]);

  useEffect(() => {
    if (selectedRelationNode) {
      const timer = setTimeout(() => {
        setRelationsModalReady(true);
      }, 350);
      return () => clearTimeout(timer);
    } else {
      setRelationsModalReady(false);
    }
  }, [selectedRelationNode]);

  return {
    knowledgeTab,
    setKnowledgeTab,
    relations,
    relationsLoading,
    relationsPage,
    relationsTotalPages,
    relationsTotalItems,
    relationsSearch,
    setRelationsSearch,
    tempRelationsSearch,
    setTempRelationsSearch,
    relationsType,
    setRelationsType,
    relationsLeaderboard,
    selectedRelationNode,
    setSelectedRelationNode,
    relationsModalReady,
    nodesSearch,
    setNodesSearch,
    tempNodesSearch,
    setTempNodesSearch,
    nodesType,
    setNodesType,
    nodesPage,
    setNodesPage,
    processedNodes,
    paginatedNodes,
    nodesTotalPages,
    fetchRelations,
    fetchRelationsLeaderboard,
    computeEgoGraph,
    setRelationsPage,
  };
}
