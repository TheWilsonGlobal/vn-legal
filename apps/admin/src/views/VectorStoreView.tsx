import type React from "react";
import type {
  VectorStoreStatus,
  AppConfig,
  AdminStats,
  VectorResult,
} from "../types/index.ts";
import { VectorGeneralTab } from "../components/vector/VectorGeneralTab.tsx";
import {
  VectorChunksTab,
  type ChunkItem,
} from "../components/vector/VectorChunksTab.tsx";
import { VectorSearchTab } from "../components/vector/VectorSearchTab.tsx";

interface VectorStoreViewProps {
  vectorStoreStatus: VectorStoreStatus | null;
  handleRebuildVector: () => Promise<void>;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  // General tab props
  config: AppConfig | null;
  stats: AdminStats | null;
  handleFileUpload: (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  uploadLoading: boolean;
  uploadMessage: string;
  // Chunks tab props
  chunksTotalItems: number;
  tempChunksSearch: string;
  setTempChunksSearch: (search: string) => void;
  setChunksSearch: (search: string) => void;
  chunksType: string;
  setChunksType: (type: string) => void;
  chunksLoading: boolean;
  chunks: ChunkItem[];
  chunksPage: number;
  chunksTotalPages: number;
  setChunksPage: (page: number | ((prev: number) => number)) => void;
  setPreviewArticle: (article: VectorResult | null) => void;
  // Search tab props
  vectorQuery: string;
  setVectorQuery: (q: string) => void;
  handleVectorSearch: () => Promise<void>;
  vectorLoading: boolean;
  vectorResults: VectorResult[];
}

export function VectorStoreView({
  vectorStoreStatus,
  handleRebuildVector,
  activeTab,
  setActiveTab,
  config,
  stats,
  handleFileUpload,
  uploadLoading,
  uploadMessage,
  chunksTotalItems,
  tempChunksSearch,
  setTempChunksSearch,
  setChunksSearch,
  chunksType,
  setChunksType,
  chunksLoading,
  chunks,
  chunksPage,
  chunksTotalPages,
  setChunksPage,
  setPreviewArticle,
  vectorQuery,
  setVectorQuery,
  handleVectorSearch,
  vectorLoading,
  vectorResults,
}: VectorStoreViewProps) {
  return (
    <div className="view-section" key="vector">
      <div className="view-header">
        <h2>
          Quản lý Vector Store (
          {!vectorStoreStatus
            ? "..."
            : vectorStoreStatus.type === "congraph"
              ? "ConGraphDB"
              : "LanceDB"}
          )
        </h2>
        <button className="btn-primary" onClick={handleRebuildVector}>
          <i className="fas fa-vector-square"></i> Re-index Vector
        </button>
      </div>

      <div className="tabs-navigation">
        <button
          className={`tab-btn ${activeTab === "general" ? "active" : ""}`}
          onClick={() => setActiveTab("general")}
        >
          <i className="fas fa-info-circle"></i> General Tab
        </button>
        <button
          className={`tab-btn ${activeTab === "chunks" ? "active" : ""}`}
          onClick={() => setActiveTab("chunks")}
        >
          <i className="fas fa-list"></i> View all Chunks Tab
        </button>
        <button
          className={`tab-btn ${activeTab === "search" ? "active" : ""}`}
          onClick={() => setActiveTab("search")}
        >
          <i className="fas fa-search"></i> Thử nghiệm tìm kiếm Vector Tab
        </button>
      </div>

      {activeTab === "general" && (
        <VectorGeneralTab
          vectorStoreStatus={vectorStoreStatus}
          config={config}
          stats={stats}
          handleFileUpload={handleFileUpload}
          uploadLoading={uploadLoading}
          uploadMessage={uploadMessage}
        />
      )}

      {activeTab === "chunks" && (
        <VectorChunksTab
          chunksTotalItems={chunksTotalItems}
          tempChunksSearch={tempChunksSearch}
          setTempChunksSearch={setTempChunksSearch}
          setChunksSearch={setChunksSearch}
          chunksType={chunksType}
          setChunksType={setChunksType}
          chunksLoading={chunksLoading}
          chunks={chunks}
          chunksPage={chunksPage}
          chunksTotalPages={chunksTotalPages}
          setChunksPage={setChunksPage}
          setPreviewArticle={setPreviewArticle}
        />
      )}

      {activeTab === "search" && (
        <VectorSearchTab
          vectorQuery={vectorQuery}
          setVectorQuery={setVectorQuery}
          handleVectorSearch={handleVectorSearch}
          vectorLoading={vectorLoading}
          vectorResults={vectorResults}
          setPreviewArticle={setPreviewArticle}
        />
      )}
    </div>
  );
}
