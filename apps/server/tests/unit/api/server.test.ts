import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createServer,
  startServer,
  initializeServer,
} from "../../../src/api/server";
import { config } from "../../../src/shared/config";

// Mock plugins were removed as they might cause hangs in Fastify 5

describe("API Server", () => {
  let mockAgent: any;
  let mockGraph: any;
  let mockVectorStore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgent = {
      consult: vi.fn(),
    };
    mockGraph = {
      close: vi.fn().mockResolvedValue(undefined),
      getNode: vi.fn(),
      countNodes: vi.fn().mockResolvedValue(100),
    };
    mockVectorStore = {
      close: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
    };
  });

  it("should initialize the server with all routes", async () => {
    const fastify = await createServer({
      agent: mockAgent,
      graph: mockGraph,
      vectorStore: mockVectorStore,
    });

    expect(fastify).toBeDefined();

    await fastify.ready();

    const response = await fastify.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    await fastify.close();
  });

  it("should handle 404 for unknown routes", async () => {
    const fastify = await createServer({
      agent: mockAgent,
      graph: mockGraph,
      vectorStore: mockVectorStore,
    });

    await fastify.ready();

    const response = await fastify.inject({
      method: "GET",
      url: "/api/unknown-route",
    });

    expect(response.statusCode).toBe(404);
    await fastify.close();
  });

  it("should handle global errors", async () => {
    const fastify = await createServer({
      agent: mockAgent,
      graph: mockGraph,
      vectorStore: mockVectorStore,
    });

    await fastify.register(async (instance) => {
      instance.get("/api/error", (request, reply) => {
        reply.send(new Error("Custom error"));
      });
    });

    await fastify.ready();

    const response = await fastify.inject({
      method: "GET",
      url: "/api/error",
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.payload).error.message).toBe("Custom error");
    await fastify.close();
  }, 60000); // Further increase timeout

  it("should handle error without message", async () => {
    const fastify = await createServer({
      agent: mockAgent,
      graph: mockGraph,
      vectorStore: mockVectorStore,
    });

    await fastify.register(async (instance) => {
      instance.get("/api/error-no-msg", (request, reply) => {
        const error = new Error("");
        (error as any).statusCode = 503;
        (error as any).message = undefined;
        reply.send(error);
      });
    });

    await fastify.ready();

    const response = await fastify.inject({
      method: "GET",
      url: "/api/error-no-msg",
    });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.payload).error.message).toBe(
      "An unexpected error occurred",
    );
    await fastify.close();
  }, 60000); // Further increase timeout

  it("should close connections on server close", async () => {
    const fastify = await createServer({
      agent: mockAgent,
      graph: mockGraph,
      vectorStore: mockVectorStore,
    });

    await fastify.close();
    expect(mockGraph.close).toHaveBeenCalled();
  });

  describe("startServer", () => {
    it("should start the server", async () => {
      const originalPort = config.api.port;
      (config.api as any).port = 0; // Random port

      const instance = await startServer({
        agent: mockAgent,
        graph: mockGraph,
        vectorStore: mockVectorStore,
      });
      expect(instance).toBeDefined();
      await instance.close();
      (config.api as any).port = originalPort;
    });

    it("should throw if starting fails", async () => {
      const originalPort = config.api.port;
      (config.api as any).port = -1;
      await expect(
        startServer({
          agent: mockAgent,
          graph: mockGraph,
          vectorStore: mockVectorStore,
        }),
      ).rejects.toThrow();
      (config.api as any).port = originalPort;
    });
  });

  describe("initializeServer", () => {
    it("should return factory methods", () => {
      const factory = initializeServer({
        agent: mockAgent,
        graph: mockGraph,
        vectorStore: mockVectorStore,
      });
      expect(factory.create).toBeDefined();
      expect(factory.start).toBeDefined();
    });
  });
});
