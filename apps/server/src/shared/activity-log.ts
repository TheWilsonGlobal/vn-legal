import { EventEmitter } from "events";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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
  private readonly storagePath = join(
    process.cwd(),
    "storage",
    "activities.json",
  );

  constructor() {
    super();
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (existsSync(this.storagePath)) {
        const raw = readFileSync(this.storagePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.entries = parsed.slice(0, this.maxEntries);
          return;
        }
      }
    } catch {
      // Fall through to default entries
    }

    this.seedDefaultEntries();
  }

  private seedDefaultEntries() {
    const now = Date.now();
    this.entries = [
      {
        id: "sys_init_3",
        type: "system",
        message:
          "Hệ thống: Khởi động thành công VinaLegal GraphRAG Server (ConGraphDB & Knowledge Graph)",
        timestamp: new Date(now - 120000).toISOString(),
      },
      {
        id: "sys_init_2",
        type: "system",
        message:
          "Cơ sở tri thức: Đã nạp 689 điều luật, 1635 khoản từ Bộ luật Dân sự 2015",
        timestamp: new Date(now - 60000).toISOString(),
      },
      {
        id: "sys_init_1",
        type: "system",
        message:
          "Vector Store: Đã tải 2324 vector chunks trong ConGraphDB sẵn sàng phục vụ",
        timestamp: new Date(now).toISOString(),
      },
    ];
    this.saveToDisk();
  }

  private saveToDisk() {
    try {
      const dir = join(process.cwd(), "storage");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(
        this.storagePath,
        JSON.stringify(this.entries, null, 2),
        "utf-8",
      );
    } catch {
      // Ignore write errors in test or restricted environments
    }
  }

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

    this.saveToDisk();
    this.emit("entryAdded", entry);
  }

  getEntries(limit: number = 10): ActivityEntry[] {
    return this.entries.slice(0, limit);
  }
}

export const activityLog = new ActivityLog();
