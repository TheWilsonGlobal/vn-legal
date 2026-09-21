/**
 * Setup file for unit tests
 * Note: congraphdb mocking is done per-test-file to avoid interference with integration tests
 */

import { vi } from "vitest";

// Mock config
//
// The `llm` block is not optional padding: routes/admin.ts reads
// `config.llm.apiUrl` at MODULE scope, so a mock missing it throws during
// import and fails the whole suite with "Cannot read properties of undefined"
// rather than a single assertion. Anything read at import time has to exist
// here, even when the test under it never touches the LLM.
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
    llm: {
      provider: "template",
      model: "test-model",
      temperature: 0.3,
      maxTokens: 2000,
      apiKey: "",
      apiUrl: "http://127.0.0.1:5814",
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
