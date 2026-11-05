import type React from "react";
import type {
  AdminStats,
  GraphData,
  GraphNode,
  Relation,
  RelationsLeaderboard,
} from "../types/index.ts";
import { KnowledgeGeneralsTab } from "../components/knowledge/KnowledgeGeneralsTab.tsx";
import { KnowledgeGraphsTab } from "../components/knowledge/KnowledgeGraphsTab.tsx";
import { KnowledgeRelationsTab } from "../components/knowledge/KnowledgeRelationsTab.tsx";
import {
  KnowledgeNodesTab,
  type ProcessedGraphNode,
} from "../components/knowledge/KnowledgeNodesTab.tsx";
import { EgoGraphModal } from "../components/modals/EgoGraphModal.tsx";

interface KnowledgeDataViewProps {
  knowledgeTab: string;
  setKnowledgeTab: (tab: string) => void;
  // Generals tab props
  stats: AdminStats | null;
  handleFileUpload: (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  uploadLoading: boolean;
  uploadMessage: string;
  // Graphs tab props
  isFullScreen: boolean;
  setIsFullScreen: (fs: boolean) => void;
  fetchGraphData: () => Promise<void>;
  graphData: GraphData | null;
  visibleTypes: string[];
  visibleEdgeTypes: string[];
  setSelectedNode: (node: GraphNode | null) => void;
  selectedNode: GraphNode | null;
  toggleTypeVisibility: (type: string) => void;
  toggleEdgeTypeVisibility: (type: string) => void;
  graphTypeCounts: Record<string, number>;
  graphEdgeCounts: Record<string, number>;
  visibleNodesCount: number;
  visibleEdgesCount: number;
  // Relations tab props
  relationsLeaderboard: RelationsLeaderboard;
  setSelectedRelationNode: (nodeId: string | null) => void;
  relationsTotalItems: number;
  tempRelationsSearch: string;
  setTempRelationsSearch: (search: string) => void;
  setRelationsSearch: (search: string) => void;
  relationsType: string;
  setRelationsType: (type: string) => void;
  relationsLoading: boolean;
  relations: Relation[];
  selectedRelationNode: string | null;
  relationsPage: number;
  relationsTotalPages: number;
  setRelationsPage: (page: number | ((prev: number) => number)) => void;
  // Nodes tab props
  processedNodes: ProcessedGraphNode[];
  paginatedNodes: ProcessedGraphNode[];
  nodesTotalPages: number;
  nodesPage: number;
  setNodesPage: (page: number | ((prev: number) => number)) => void;
  nodesType: string;
  setNodesType: (type: string) => void;
  tempNodesSearch: string;
  setTempNodesSearch: (search: string) => void;
  setNodesSearch: (search: string) => void;
  // Ego graph modal props
  relationsModalReady: boolean;
  computeEgoGraph: (nodeId: string) => GraphData | null;
  setZoomLevel: (level: number) => void;
}

export function KnowledgeDataView({
  knowledgeTab,
  setKnowledgeTab,
  stats,
  handleFileUpload,
  uploadLoading,
  uploadMessage,
  isFullScreen,
  setIsFullScreen,
  fetchGraphData,
  graphData,
  visibleTypes,
  visibleEdgeTypes,
  setSelectedNode,
  selectedNode,
  toggleTypeVisibility,
  toggleEdgeTypeVisibility,
  graphTypeCounts,
  graphEdgeCounts,
  visibleNodesCount,
  visibleEdgesCount,
  relationsLeaderboard,
  setSelectedRelationNode,
  relationsTotalItems,
  tempRelationsSearch,
  setTempRelationsSearch,
  setRelationsSearch,
  relationsType,
  setRelationsType,
  relationsLoading,
  relations,
  selectedRelationNode,
  relationsPage,
  relationsTotalPages,
  setRelationsPage,
  processedNodes,
  paginatedNodes,
  nodesTotalPages,
  nodesPage,
  setNodesPage,
  nodesType,
  setNodesType,
  tempNodesSearch,
  setTempNodesSearch,
  setNodesSearch,
  relationsModalReady,
  computeEgoGraph,
  setZoomLevel,
}: KnowledgeDataViewProps) {
  return (
    <div className="view-section" key="knowledge">
      <div className="view-header">
        <h2>Dữ liệu Tri thức (Knowledge Data)</h2>
      </div>

      <div className="tabs-navigation">
        <button
          className={`tab-btn ${knowledgeTab === "generals" ? "active" : ""}`}
          onClick={() => setKnowledgeTab("generals")}
        >
          <i className="fas fa-layer-group"></i> Generals Tab
        </button>
        <button
          className={`tab-btn ${knowledgeTab === "graphs" ? "active" : ""}`}
          onClick={() => setKnowledgeTab("graphs")}
        >
          <i className="fas fa-project-diagram"></i> Graphs Tab
        </button>
        <button
          className={`tab-btn ${knowledgeTab === "relations" ? "active" : ""}`}
          onClick={() => setKnowledgeTab("relations")}
        >
          <i className="fas fa-network-wired"></i> Relations Tab
        </button>
        <button
          className={`tab-btn ${knowledgeTab === "nodes" ? "active" : ""}`}
          onClick={() => setKnowledgeTab("nodes")}
        >
          <i className="fas fa-circle-nodes"></i> Nodes Tab
        </button>
      </div>

      {knowledgeTab === "generals" && (
        <KnowledgeGeneralsTab
          stats={stats}
          handleFileUpload={handleFileUpload}
          uploadLoading={uploadLoading}
          uploadMessage={uploadMessage}
        />
      )}

      {knowledgeTab === "graphs" && (
        <KnowledgeGraphsTab
          isFullScreen={isFullScreen}
          setIsFullScreen={setIsFullScreen}
          fetchGraphData={fetchGraphData}
          graphData={graphData}
          visibleTypes={visibleTypes}
          visibleEdgeTypes={visibleEdgeTypes}
          setSelectedNode={setSelectedNode}
          selectedNode={selectedNode}
          toggleTypeVisibility={toggleTypeVisibility}
          toggleEdgeTypeVisibility={toggleEdgeTypeVisibility}
          graphTypeCounts={graphTypeCounts}
          graphEdgeCounts={graphEdgeCounts}
          visibleNodesCount={visibleNodesCount}
          visibleEdgesCount={visibleEdgesCount}
        />
      )}

      {knowledgeTab === "relations" && (
        <KnowledgeRelationsTab
          relationsLeaderboard={relationsLeaderboard}
          setSelectedRelationNode={setSelectedRelationNode}
          relationsTotalItems={relationsTotalItems}
          tempRelationsSearch={tempRelationsSearch}
          setTempRelationsSearch={setTempRelationsSearch}
          setRelationsSearch={setRelationsSearch}
          relationsType={relationsType}
          setRelationsType={setRelationsType}
          relationsLoading={relationsLoading}
          relations={relations}
          selectedRelationNode={selectedRelationNode}
          relationsPage={relationsPage}
          relationsTotalPages={relationsTotalPages}
          setRelationsPage={setRelationsPage}
        />
      )}

      {knowledgeTab === "nodes" && (
        <KnowledgeNodesTab
          graphData={graphData}
          processedNodes={processedNodes}
          paginatedNodes={paginatedNodes}
          nodesTotalPages={nodesTotalPages}
          nodesPage={nodesPage}
          setNodesPage={setNodesPage}
          nodesType={nodesType}
          setNodesType={setNodesType}
          tempNodesSearch={tempNodesSearch}
          setTempNodesSearch={setTempNodesSearch}
          setNodesSearch={setNodesSearch}
          selectedRelationNode={selectedRelationNode}
          setSelectedRelationNode={setSelectedRelationNode}
        />
      )}

      <EgoGraphModal
        selectedRelationNode={selectedRelationNode}
        onClose={() => setSelectedRelationNode(null)}
        graphData={graphData}
        relationsModalReady={relationsModalReady}
        computeEgoGraph={computeEgoGraph}
        visibleTypes={visibleTypes}
        setSelectedRelationNode={setSelectedRelationNode}
        setZoomLevel={setZoomLevel}
      />
    </div>
  );
}
