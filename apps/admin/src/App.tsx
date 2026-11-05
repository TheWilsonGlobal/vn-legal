import { useState, useEffect } from "react";
import "./index.css";
import { Sidebar } from "./components/layout/Sidebar.tsx";
import { Header } from "./components/layout/Header.tsx";
import { ConfigSavedModal } from "./components/modals/ConfigSavedModal.tsx";
import { ArticlePreviewModal } from "./components/modals/ArticlePreviewModal.tsx";
import { useGraphState } from "./hooks/useGraphState.ts";
import { useAdminData } from "./hooks/useAdminData.ts";
import { useCommunityState } from "./hooks/useCommunityState.ts";
import { useLlmMonitor } from "./hooks/useLlmMonitor.ts";
import { useKnowledgeState } from "./hooks/useKnowledgeState.ts";
import { useVectorState } from "./hooks/useVectorState.ts";
import { OverviewView } from "./views/OverviewView.tsx";
import { GraphExplorerView } from "./views/GraphExplorerView.tsx";
import { CommunityView } from "./views/CommunityView.tsx";
import { VectorStoreView } from "./views/VectorStoreView.tsx";
import { LlmMonitorView } from "./views/LlmMonitorView.tsx";
import { KnowledgeDataView } from "./views/KnowledgeDataView.tsx";
import { ActivitiesView } from "./views/ActivitiesView.tsx";
import { SettingsView } from "./views/SettingsView.tsx";

function App() {
  const [activeView, setActiveView] = useState("overview");
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({});

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const graph = useGraphState();
  const adminData = useAdminData();
  const community = useCommunityState(adminData.fetchActivities);
  const llmMonitor = useLlmMonitor(activeView);
  const knowledge = useKnowledgeState(
    activeView,
    graph.graphData,
    graph.fetchGraphData,
  );
  const vector = useVectorState(activeView);

  const { fetchGraphData, graphData } = graph;
  const { fetchCommunities, communities } = community;

  useEffect(() => {
    if ((activeView === "graph" || activeView === "knowledge") && !graphData) {
      fetchGraphData();
    }
    if (activeView === "community" && communities.length === 0) {
      fetchCommunities();
    }
  }, [activeView, graphData, communities, fetchGraphData, fetchCommunities]);

  const renderView = () => {
    switch (activeView) {
      case "llm":
        return <LlmMonitorView {...llmMonitor} />;
      case "overview":
        return (
          <OverviewView
            stats={adminData.stats}
            collapsedSections={collapsedSections}
            toggleSection={toggleSection}
          />
        );
      case "graph":
        return (
          <GraphExplorerView
            isFullScreen={graph.isFullScreen}
            setIsFullScreen={graph.setIsFullScreen}
            zoomLevel={graph.zoomLevel}
            setZoomLevel={graph.setZoomLevel}
            graphLayout={graph.graphLayout}
            setGraphLayout={graph.setGraphLayout}
            graphData={graph.graphData}
            graphRendering={graph.graphRendering}
            setGraphRendering={graph.setGraphRendering}
            visibleTypes={graph.visibleTypes}
            toggleTypeVisibility={graph.toggleTypeVisibility}
            selectedNode={graph.selectedNode}
            setSelectedNode={graph.setSelectedNode}
            fetchGraphData={graph.fetchGraphData}
            cyRef={graph.cyRef}
            graphTypeCounts={graph.graphTypeCounts}
            visibleNodesCount={graph.visibleNodesCount}
            visibleEdgesCount={graph.visibleEdgesCount}
          />
        );
      case "community":
        return (
          <CommunityView
            communities={community.communities}
            communitiesLoading={community.communitiesLoading}
            selectedCommunity={community.selectedCommunity}
            setSelectedCommunity={community.setSelectedCommunity}
            showAddCommunityModal={community.showAddCommunityModal}
            setShowAddCommunityModal={community.setShowAddCommunityModal}
            newCommunity={community.newCommunity}
            setNewCommunity={community.setNewCommunity}
            handleAddCommunity={community.handleAddCommunity}
            uploadLoading={community.communityUploadLoading}
            fetchCommunities={community.fetchCommunities}
          />
        );
      case "vector":
        return (
          <VectorStoreView
            vectorStoreStatus={adminData.vectorStoreStatus}
            handleRebuildVector={adminData.handleRebuildVector}
            activeTab={vector.activeTab}
            setActiveTab={vector.setActiveTab}
            config={adminData.config}
            stats={adminData.stats}
            handleFileUpload={adminData.handleFileUpload}
            uploadLoading={adminData.uploadLoading}
            uploadMessage={adminData.uploadMessage}
            chunksTotalItems={vector.chunksTotalItems}
            tempChunksSearch={vector.tempChunksSearch}
            setTempChunksSearch={vector.setTempChunksSearch}
            setChunksSearch={vector.setChunksSearch}
            chunksType={vector.chunksType}
            setChunksType={vector.setChunksType}
            chunksLoading={vector.chunksLoading}
            chunks={vector.chunks}
            chunksPage={vector.chunksPage}
            chunksTotalPages={vector.chunksTotalPages}
            setChunksPage={vector.setChunksPage}
            setPreviewArticle={vector.setPreviewArticle}
            vectorQuery={vector.vectorQuery}
            setVectorQuery={vector.setVectorQuery}
            handleVectorSearch={vector.handleVectorSearch}
            vectorLoading={vector.vectorLoading}
            vectorResults={vector.vectorResults}
          />
        );
      case "settings":
        return (
          <SettingsView
            tempClientGraphMode={adminData.tempClientGraphMode}
            setTempClientGraphMode={adminData.setTempClientGraphMode}
            tempVectorStoreType={adminData.tempVectorStoreType}
            setTempVectorStoreType={adminData.setTempVectorStoreType}
            config={adminData.config}
            handleSaveConfig={adminData.handleSaveConfig}
          />
        );
      case "knowledge":
        return (
          <KnowledgeDataView
            knowledgeTab={knowledge.knowledgeTab}
            setKnowledgeTab={knowledge.setKnowledgeTab}
            stats={adminData.stats}
            handleFileUpload={adminData.handleFileUpload}
            uploadLoading={adminData.uploadLoading}
            uploadMessage={adminData.uploadMessage}
            isFullScreen={graph.isFullScreen}
            setIsFullScreen={graph.setIsFullScreen}
            fetchGraphData={graph.fetchGraphData}
            graphData={graph.graphData}
            visibleTypes={graph.visibleTypes}
            visibleEdgeTypes={graph.visibleEdgeTypes}
            setSelectedNode={graph.setSelectedNode}
            selectedNode={graph.selectedNode}
            toggleTypeVisibility={graph.toggleTypeVisibility}
            toggleEdgeTypeVisibility={graph.toggleEdgeTypeVisibility}
            graphTypeCounts={graph.graphTypeCounts}
            graphEdgeCounts={graph.graphEdgeCounts}
            visibleNodesCount={graph.visibleNodesCount}
            visibleEdgesCount={graph.visibleEdgesCount}
            relationsLeaderboard={knowledge.relationsLeaderboard}
            setSelectedRelationNode={knowledge.setSelectedRelationNode}
            relationsTotalItems={knowledge.relationsTotalItems}
            tempRelationsSearch={knowledge.tempRelationsSearch}
            setTempRelationsSearch={knowledge.setTempRelationsSearch}
            setRelationsSearch={knowledge.setRelationsSearch}
            relationsType={knowledge.relationsType}
            setRelationsType={knowledge.setRelationsType}
            relationsLoading={knowledge.relationsLoading}
            relations={knowledge.relations}
            selectedRelationNode={knowledge.selectedRelationNode}
            relationsPage={knowledge.relationsPage}
            relationsTotalPages={knowledge.relationsTotalPages}
            setRelationsPage={knowledge.setRelationsPage}
            processedNodes={knowledge.processedNodes}
            paginatedNodes={knowledge.paginatedNodes}
            nodesTotalPages={knowledge.nodesTotalPages}
            nodesPage={knowledge.nodesPage}
            setNodesPage={knowledge.setNodesPage}
            nodesType={knowledge.nodesType}
            setNodesType={knowledge.setNodesType}
            tempNodesSearch={knowledge.tempNodesSearch}
            setTempNodesSearch={knowledge.setTempNodesSearch}
            setNodesSearch={knowledge.setNodesSearch}
            relationsModalReady={knowledge.relationsModalReady}
            computeEgoGraph={knowledge.computeEgoGraph}
            setZoomLevel={graph.setZoomLevel}
          />
        );
      case "activities":
        return (
          <ActivitiesView
            activities={adminData.activities}
            fetchActivities={adminData.fetchActivities}
            handleOpenActivityJSON={adminData.handleOpenActivityJSON}
            handleDownloadActivityJSON={adminData.handleDownloadActivityJSON}
          />
        );
      default:
        return <div>View {activeView} is under construction.</div>;
    }
  };

  return (
    <div className="app-container">
      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        loading={adminData.loading}
      />

      <main className="main-content">
        <Header />
        <section className="dashboard-content">{renderView()}</section>
      </main>

      <ConfigSavedModal
        show={adminData.showConfigSavedModal}
        onClose={() => adminData.setShowConfigSavedModal(false)}
        tempVectorStoreType={adminData.tempVectorStoreType}
        config={adminData.config}
      />

      <ArticlePreviewModal
        previewArticle={vector.previewArticle}
        onClose={() => vector.setPreviewArticle(null)}
      />
    </div>
  );
}

export default App;
