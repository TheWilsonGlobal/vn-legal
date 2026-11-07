import { vi } from "vitest";
import {
  ConGraphStorageAdapter,
} from "../../../../src/storage-adapters/congraph-rag-adapter";

// Mock logger
vi.mock("../../../../src/shared/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

export function createMockContext() {
  const mockGraph: any = {
    addNode: vi.fn().mockResolvedValue(undefined),
    getFullArticle: vi.fn(),
    getNode: vi.fn(),
    getNodesByType: vi.fn().mockResolvedValue([]),
    addEdge: vi.fn().mockResolvedValue(undefined),
    getOutgoingEdges: vi.fn().mockResolvedValue([]),
    getIncomingEdges: vi.fn().mockResolvedValue([]),
  };
  const mockVectorStore: any = {
    searchArticles: vi.fn().mockResolvedValue([]),
    searchClauses: vi.fn().mockResolvedValue([]),
    searchCommunityReports: vi.fn().mockResolvedValue([]),
  };
  const adapter = new ConGraphStorageAdapter(mockGraph, mockVectorStore);
  return { mockGraph, mockVectorStore, adapter };
}
