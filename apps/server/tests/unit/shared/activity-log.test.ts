import { describe, it, expect, vi, beforeEach } from "vitest";
import { activityLog } from "../../../src/shared/activity-log";

describe("ActivityLog", () => {
  beforeEach(() => {
    // Accessing private property for testing/resetting
    (activityLog as any).entries = [];
  });

  it("should add an entry and emit event", () => {
    const spy = vi.fn();
    activityLog.on("entryAdded", spy);

    activityLog.addEntry("query", "Test message", { foo: "bar" });

    expect(spy).toHaveBeenCalledTimes(1);
    const entry = spy.mock.calls[0][0];
    expect(entry.type).toBe("query");
    expect(entry.message).toBe("Test message");
    expect(entry.details).toEqual({ foo: "bar" });
    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
  });

  it("should limit entries to maxEntries", () => {
    const max = (activityLog as any).maxEntries;
    for (let i = 0; i < max + 10; i++) {
      activityLog.addEntry("system", `Message ${i}`);
    }

    const entries = activityLog.getEntries(100);
    expect(entries.length).toBe(max);
    expect(entries[0].message).toBe(`Message ${max + 9}`);
  });

  it("should return limited entries", () => {
    activityLog.addEntry("system", "1");
    activityLog.addEntry("system", "2");
    activityLog.addEntry("system", "3");

    const entries = activityLog.getEntries(2);
    expect(entries.length).toBe(2);
    expect(entries[0].message).toBe("3");
    expect(entries[1].message).toBe("2");
  });
});
