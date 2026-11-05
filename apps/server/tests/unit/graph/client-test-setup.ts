import { vi } from "vitest";

// Mock congraphdb - shared across GraphClient unit test files
vi.mock("congraphdb", () => {
  const createMockConnection = () => ({
    query: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    }),
    queryWithParams: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    }),
    queryBatch: vi.fn().mockReturnValue(0),
    batchCreateNodes: vi.fn().mockResolvedValue([1, 2, 3]),
    batchCreateRelationships: vi.fn().mockResolvedValue(undefined),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    inTransaction: vi.fn().mockReturnValue(false),
    createNodeTable: vi
      .fn()
      .mockResolvedValue({ name: "test", tableType: "NODE", properties: [] }),
    createRelTable: vi
      .fn()
      .mockResolvedValue({ name: "test", tableType: "REL", properties: [] }),
    dropTable: vi.fn().mockResolvedValue(true),
    getTables: vi.fn().mockResolvedValue([]),
    createIndex: vi.fn().mockResolvedValue(true),
    dropIndex: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  });

  return {
    Database: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockReturnValue(undefined),
      close: vi.fn().mockReturnValue(undefined),
      checkpoint: vi.fn().mockReturnValue(undefined),
      createConnection: createMockConnection,
    })),
    VectorStore: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      createTable: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockReturnValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      clear: vi.fn().mockResolvedValue(undefined),
      dropTable: vi.fn().mockResolvedValue(undefined),
      getTables: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
    })),
  };
});

export function createMockConn() {
  return {
    query: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    }),
    queryWithParams: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    }),
  };
}

export { GraphClient, createGraphClient } from "../../../src/graph/client";
