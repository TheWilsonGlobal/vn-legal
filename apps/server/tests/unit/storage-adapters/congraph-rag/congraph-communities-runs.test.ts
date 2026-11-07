import { describe, it, expect, beforeEach } from "vitest";
import type { ConGraphStorageAdapter } from "../../../../src/storage-adapters/congraph-rag-adapter";
import { createMockContext } from "./congraph-fixtures";

describe("ConGraphStorageAdapter communities and runs", () => {
  let mockGraph: any;
  let mockVectorStore: any;
  let adapter: ConGraphStorageAdapter;

  beforeEach(() => {
    const ctx = createMockContext();
    mockGraph = ctx.mockGraph;
    mockVectorStore = ctx.mockVectorStore;
    adapter = ctx.adapter;
  });

  describe("linkCommunityToChunk", () => {
    it("should add a COVERS_CLAUSE edge", async () => {
      await adapter.linkCommunityToChunk("comm1", "c1");
      expect(mockGraph.addEdge).toHaveBeenCalledWith({
        from: "comm1",
        to: "c1",
        type: "COVERS_CLAUSE",
        weight: 1.0,
      });
    });
  });

  describe("community runs", () => {
    it("should return communities from every run when none is active", async () => {
      mockGraph.getNodesByType.mockImplementation(async (type: string) =>
        type === "Community"
          ? [
              { id: "k1", level: 0, findings: "a,b", run_id: "run-old" },
              { id: "k2", level: 0, findings: "c" },
            ]
          : [],
      );
      const result = await adapter.getCommunitiesByLevel(0);
      expect(result.map((c) => c.id)).toEqual(["k1", "k2"]);
    });

    it("should hide run-stamped communities that are not in the active run", async () => {
      mockGraph.getNodesByType.mockImplementation(async (type: string) => {
        if (type === "CommunityRun") {
          return [
            {
              scope: "clusters",
              run_id: "run-old",
              activated_at: "2026-01-01T00:00:00.000Z",
            },
            {
              scope: "clusters",
              run_id: "run-new",
              activated_at: "2026-02-01T00:00:00.000Z",
            },
          ];
        }
        if (type === "Community") {
          return [
            { id: "old", level: 0, findings: "", run_id: "run-old" },
            { id: "new", level: 0, findings: "", run_id: "run-new" },
            { id: "legacy", level: 0, findings: "" },
          ];
        }
        return [];
      });
      const result = await adapter.getCommunitiesByLevel(0, "clusters");
      expect(result.map((c) => c.id)).toEqual(["new", "legacy"]);
    });

    it("should write the run id onto saved communities", async () => {
      await adapter.saveCommunity({
        id: "k1",
        level: 0,
        title: "t",
        summary: "s",
        entityIds: ["a"],
        runId: "run-1",
      });
      expect(mockGraph.addNode).toHaveBeenCalledWith(
        "Community",
        "k1",
        expect.objectContaining({ run_id: "run-1" }),
      );
    });

    it("should create a distinct run id on each call", () => {
      expect(adapter.newCommunityRunId()).not.toBe(adapter.newCommunityRunId());
    });

    it("should record an activation node for the scope", async () => {
      await adapter.activateCommunityRun("run-1", "tree");
      expect(mockGraph.addNode).toHaveBeenCalledWith(
        "CommunityRun",
        expect.stringContaining("activation-tree-"),
        expect.objectContaining({ run_id: "run-1", scope: "tree" }),
      );
    });
  });

  describe("saveCommunity", () => {
    it("should add community as node", async () => {
      await adapter.saveCommunity({
        id: "comm_1",
        level: 0,
        title: "Community",
        summary: "Summary",
        entityIds: ["e1", "e2"],
      });
      expect(mockGraph.addNode).toHaveBeenCalledWith(
        "Community",
        "comm_1",
        expect.objectContaining({
          title: "Community",
          findings: "e1,e2",
        }),
      );
    });

    it("should throw on error", async () => {
      mockGraph.addNode.mockRejectedValue(new Error("fail"));
      await expect(
        adapter.saveCommunity({
          id: "c",
          level: 0,
          title: "",
          summary: "",
          entityIds: [],
        }),
      ).rejects.toThrow();
    });
  });

  describe("getCommunity", () => {
    it("should return community from node", async () => {
      mockGraph.getNode.mockResolvedValue({
        id: "comm_1",
        level: 0,
        title: "Community",
        summary: "S",
        parent_id: "p1",
        findings: "e1,e2",
      });
      const community = await adapter.getCommunity("comm_1");
      expect(community).not.toBeNull();
      expect(community!.entityIds).toEqual(["e1", "e2"]);
    });

    it("should return null when not found", async () => {
      mockGraph.getNode.mockResolvedValue(null);
      expect(await adapter.getCommunity("x")).toBeNull();
    });

    it("should return null on error", async () => {
      mockGraph.getNode.mockRejectedValue(new Error("fail"));
      expect(await adapter.getCommunity("x")).toBeNull();
    });
  });

  describe("getCommunitiesByLevel", () => {
    it("should filter communities by level", async () => {
      mockGraph.getNodesByType.mockResolvedValue([
        { id: "c1", level: 0, title: "L0", summary: "S", findings: "e1" },
        { id: "c2", level: 1, title: "L1", summary: "S", findings: "e2" },
        { id: "c3", level: 0, title: "L0-2", summary: "S", findings: "e3" },
      ]);
      const communities = await adapter.getCommunitiesByLevel(0);
      expect(communities).toHaveLength(2);
    });

    it("should return empty on error", async () => {
      mockGraph.getNodesByType.mockRejectedValue(new Error("fail"));
      expect(await adapter.getCommunitiesByLevel(0)).toHaveLength(0);
    });
  });

  describe("searchCommunityReports", () => {
    it("should search and map results", async () => {
      mockVectorStore.searchCommunityReports.mockResolvedValue([
        {
          id: "r1",
          level: 0,
          title: "Report",
          summary: "S",
          findings: "F",
          rating: 8,
          score: 0.9,
        },
      ]);
      const results = await adapter.searchCommunityReports([0.1], 5);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Report");
    });

    it("should return empty on error", async () => {
      mockVectorStore.searchCommunityReports.mockRejectedValue(
        new Error("fail"),
      );
      expect(await adapter.searchCommunityReports([0.1], 5)).toHaveLength(0);
    });
  });

  describe("linkCommunityToEntity", () => {
    it("should add BELONGS_TO_COMMUNITY edge", async () => {
      await adapter.linkCommunityToEntity("comm1", "e1");
      expect(mockGraph.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "BELONGS_TO_COMMUNITY",
        }),
      );
    });

    it("should not throw on error", async () => {
      mockGraph.addEdge.mockRejectedValue(new Error("fail"));
      await expect(
        adapter.linkCommunityToEntity("c", "e"),
      ).resolves.toBeUndefined();
    });
  });

  describe("linkCommunityToCommunity", () => {
    it("should add CONTAINS edge", async () => {
      await adapter.linkCommunityToCommunity("child", "parent");
      expect(mockGraph.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "child",
          to: "parent",
          type: "CONTAINS",
        }),
      );
    });
  });
});
