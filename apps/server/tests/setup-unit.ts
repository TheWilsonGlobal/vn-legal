/**
 * Setup file for unit tests
 * Note: congraphdb mocking is done per-test-file to avoid interference with integration tests
 */

import { vi } from "vitest";

// Mock config
vi.mock("../src/shared/config", () => ({
  config: {
    graphDbPath: "/test/db/path",
    vectorDbPath: "/test/vectors",
    api: {
      port: 3000,
      host: "127.0.0.1",
    },
    logging: {
      level: "info",
    },
  },
}));

// Mock logger - but not for logger.test.ts which tests the real logger
const loggerMock = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../src/shared/logger", () => ({
  logger: loggerMock,
  default: loggerMock,
}));
