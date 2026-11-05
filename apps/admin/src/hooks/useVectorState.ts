import { useState, useEffect } from "react";
import type { VectorResult } from "../types/index.ts";
import type { ChunkItem } from "../components/vector/VectorChunksTab.tsx";

export function useVectorState(activeView: string) {
  const [activeTab, setActiveTab] = useState("general");
  const [vectorResults, setVectorResults] = useState<VectorResult[]>([]);
  const [vectorLoading, setVectorLoading] = useState(false);
  const [vectorQuery, setVectorQuery] = useState("");
  const [previewArticle, setPreviewArticle] = useState<VectorResult | null>(
    null,
  );
  const [chunks, setChunks] = useState<ChunkItem[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [chunksPage, setChunksPage] = useState(1);
  const [chunksTotalPages, setChunksTotalPages] = useState(1);
  const [chunksTotalItems, setChunksTotalItems] = useState(0);
  const [chunksSearch, setChunksSearch] = useState("");
  const [tempChunksSearch, setTempChunksSearch] = useState("");
  const [chunksType, setChunksType] = useState("all");

  const fetchChunks = async (
    page = 1,
    search = chunksSearch,
    type = chunksType,
  ) => {
    setChunksLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: "20",
        search,
        type,
      });
      const response = await fetch(
        `/api/admin/vector/chunks?${queryParams.toString()}`,
      );
      const data = await response.json();
      setChunks(data.chunks || []);
      setChunksPage(data.pagination.page);
      setChunksTotalPages(data.pagination.pages);
      setChunksTotalItems(data.pagination.total);
    } catch (err) {
      console.error("Error fetching chunks:", err);
    } finally {
      setChunksLoading(false);
    }
  };

  const handleVectorSearch = async () => {
    if (!vectorQuery.trim()) return;

    setVectorLoading(true);
    try {
      const response = await fetch("/api/admin/vector/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: vectorQuery, limit: 10 }),
      });
      const data = await response.json();
      setVectorResults(data.results || []);
    } catch (error) {
      console.error("Vector search failed:", error);
    } finally {
      setVectorLoading(false);
    }
  };

  useEffect(() => {
    if (activeView === "vector" && activeTab === "chunks") {
      fetchChunks(chunksPage, chunksSearch, chunksType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, activeTab, chunksPage, chunksSearch, chunksType]);

  return {
    activeTab,
    setActiveTab,
    vectorResults,
    vectorLoading,
    vectorQuery,
    setVectorQuery,
    previewArticle,
    setPreviewArticle,
    chunks,
    chunksLoading,
    chunksPage,
    setChunksPage,
    chunksTotalPages,
    chunksTotalItems,
    chunksSearch,
    setChunksSearch,
    tempChunksSearch,
    setTempChunksSearch,
    chunksType,
    setChunksType,
    fetchChunks,
    handleVectorSearch,
  };
}
