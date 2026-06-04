import { EventEmitter } from "events";

export interface ActivityEntry {
  id: string;
  type: "query" | "update" | "error" | "system";
  message: string;
  timestamp: string;
  details?: any;
}

class ActivityLog extends EventEmitter {
  private entries: ActivityEntry[] = [];
  private readonly maxEntries = 50;

  addEntry(type: ActivityEntry["type"], message: string, details?: any) {
    const entry: ActivityEntry = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      message,
      timestamp: new Date().toISOString(),
      details,
    };

    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }

    this.emit("entryAdded", entry);
  }

  getEntries(limit: number = 10): ActivityEntry[] {
    return this.entries.slice(0, limit);
  }
}

export const activityLog = new ActivityLog();
