/**
 * Setup file for integration tests
 * Ensures real congraphdb is used, not mocks from unit tests
 */

import { vi } from "vitest";

// Unmock congraphdb to ensure integration tests use the real implementation
vi.unmock("congraphdb");
vi.resetModules();
