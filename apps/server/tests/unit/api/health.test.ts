import { describe, it, expect, vi, beforeEach } from "vitest";
import { healthRoutes } from "../../../src/api/routes/health";

describe("Health Routes", () => {
  let fastify: any;
  let mockGraph: any;
  let mockVectorStore: any;

  beforeEach(() => {
    fastify = {
      get: vi.fn(),
      log: {
        error: vi.fn(),
      },
    };
    mockGraph = {
      countNodes: vi.fn(),
      getStats: vi.fn(),
    };
    mockVectorStore = {
      isReady: vi.fn(),
      getStats: vi.fn(),
    };
  });

  it("should register health routes", async () => {
    await healthRoutes(fastify, {
      graph: mockGraph,
      vectorStore: mockVectorStore,
    });
    expect(fastify.get).toHaveBeenCalledWith(
      "/health",
      expect.any(Object),
      expect.any(Function),
    );
    expect(fastify.get).toHaveBeenCalledWith(
      "/health/stats",
      expect.any(Object),
      expect.any(Function),
    );
    expect(fastify.get).toHaveBeenCalledWith(
      "/health/ready",
      expect.any(Object),
      expect.any(Function),
    );
  });

  describe("GET /health handler", () => {
    it("should return ok when both DBs are healthy", async () => {
      await healthRoutes(fastify, {
        graph: mockGraph,
        vectorStore: mockVectorStore,
      });
      const handler = fastify.get.mock.calls.find(
        (call) => call[0] === "/health",
      )[2];

      mockGraph.countNodes.mockResolvedValue(100);
      mockVectorStore.isReady.mockReturnValue(true);

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await handler({}, reply);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "ok",
          databases: { graph: "ready", vector: "ready" },
        }),
      );
    });

    it("should return degraded when one DB is unhealthy", async () => {
      await healthRoutes(fastify, {
        graph: mockGraph,
        vectorStore: mockVectorStore,
      });
      const handler = fastify.get.mock.calls.find(
        (call) => call[0] === "/health",
      )[2];

      mockGraph.countNodes.mockResolvedValue(0); // unhealthy
      mockVectorStore.isReady.mockReturnValue(true);

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await handler({}, reply);

      expect(reply.status).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "degraded",
          databases: { graph: "not ready", vector: "ready" },
        }),
      );
    });

    it("should return error on exception", async () => {
      await healthRoutes(fastify, {
        graph: mockGraph,
        vectorStore: mockVectorStore,
      });
      const handler = fastify.get.mock.calls.find(
        (call) => call[0] === "/health",
      )[2];

      // Make checkVectorHealth throw by making isReady throw
      mockVectorStore.isReady.mockImplementation(() => {
        throw new Error("Fatal error");
      });

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await handler({}, reply);

      expect(reply.status).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
        }),
      );
    });
  });

  describe("GET /health/stats handler", () => {
    it("should return statistics", async () => {
      await healthRoutes(fastify, {
        graph: mockGraph,
        vectorStore: mockVectorStore,
      });
      const handler = fastify.get.mock.calls.find(
        (call) => call[0] === "/health/stats",
      )[2];

      mockGraph.getStats.mockResolvedValue({ article: 10, "edge:refs": 5 });
      mockVectorStore.getStats.mockResolvedValue({ count: 10 });

      const reply = {
        send: vi.fn().mockReturnThis(),
      };

      await handler({}, reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          graph: expect.objectContaining({
            total_nodes: 10,
            total_edges: 5,
          }),
          vector: { count: 10 },
        }),
      );
    });

    it("should return 500 on error", async () => {
      await healthRoutes(fastify, {
        graph: mockGraph,
        vectorStore: mockVectorStore,
      });
      const handler = fastify.get.mock.calls.find(
        (call) => call[0] === "/health/stats",
      )[2];

      mockGraph.getStats.mockRejectedValue(new Error("Stats failed"));

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await handler({}, reply);

      expect(reply.status).toHaveBeenCalledWith(500);
    });
  });

  describe("GET /health/ready handler", () => {
    it("should return ready when all healthy", async () => {
      await healthRoutes(fastify, {
        graph: mockGraph,
        vectorStore: mockVectorStore,
      });
      const handler = fastify.get.mock.calls.find(
        (call) => call[0] === "/health/ready",
      )[2];

      mockGraph.countNodes.mockResolvedValue(10);
      mockVectorStore.isReady.mockReturnValue(true);

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await handler({}, reply);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith({ status: "ready" });
    });

    it("should return 503 when not ready", async () => {
      await healthRoutes(fastify, {
        graph: mockGraph,
        vectorStore: mockVectorStore,
      });
      const handler = fastify.get.mock.calls.find(
        (call) => call[0] === "/health/ready",
      )[2];

      mockGraph.countNodes.mockResolvedValue(0);
      mockVectorStore.isReady.mockReturnValue(true);

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await handler({}, reply);

      expect(reply.status).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ status: "not ready" }),
      );
    });
  });
});
