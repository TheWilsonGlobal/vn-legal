import { describe, it, expect, vi } from "vitest";

// Use the real logger for this test, not the mock
vi.unmock("../../../src/shared/logger");
vi.resetModules();

const { logger } = await import("../../../src/shared/logger");

describe("Logger", () => {
  it("should log info messages", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("Test info message");
    expect(spy).toHaveBeenCalledWith("[INFO] Test info message");
    spy.mockRestore();
  });

  it("should log info with additional args", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("Test", { key: "val" });
    expect(spy).toHaveBeenCalledWith("[INFO] Test", { key: "val" });
    spy.mockRestore();
  });

  it("should filter undefined args", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("Test", undefined, "real");
    expect(spy).toHaveBeenCalledWith("[INFO] Test", "real");
    spy.mockRestore();
  });

  it("should log error messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("Test error");
    expect(spy).toHaveBeenCalledWith("[ERROR] Test error");
    spy.mockRestore();
  });

  it("should log warn messages", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("Test warn");
    expect(spy).toHaveBeenCalledWith("[WARN] Test warn");
    spy.mockRestore();
  });

  it("should log debug messages", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.debug("Test debug");
    expect(spy).toHaveBeenCalledWith("[DEBUG] Test debug");
    spy.mockRestore();
  });

  it("should filter undefined from error args", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("Error", undefined, { detail: "x" });
    expect(spy).toHaveBeenCalledWith("[ERROR] Error", { detail: "x" });
    spy.mockRestore();
  });

  it("should filter undefined from warn args", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("Warn", undefined);
    expect(spy).toHaveBeenCalledWith("[WARN] Warn");
    spy.mockRestore();
  });

  it("should filter undefined from debug args", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.debug("Debug", undefined, "valid");
    expect(spy).toHaveBeenCalledWith("[DEBUG] Debug", "valid");
    spy.mockRestore();
  });
});
