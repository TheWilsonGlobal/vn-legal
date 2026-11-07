import type {
  SessionMeta,
  SessionRecord,
  SessionStore,
  Turn,
} from "../../../../../src/agent/contract";
import {
  createSessionMemory,
  type MemoryLimits,
} from "../../../../../src/agent/memory/session-memory";

// ----------------------------------------------------------------------------
// In-test fake of the SessionStore port. Only `turns` is implemented: it is the
// only method SessionMemory may call, and `calls` lets tests assert that.
// ----------------------------------------------------------------------------

export class FakeStore implements SessionStore {
  readonly sessions = new Map<string, { owner: string; turns: Turn[] }>();
  readonly calls: string[] = [];
  failNextTurns: Error | null = null;

  seed(owner: string, id: string, turns: Turn[]): void {
    this.sessions.set(id, { owner, turns: [...turns] });
  }

  addTurn(turn: Turn, id: string, owner: string): void {
    const s = this.sessions.get(id) ?? { owner, turns: [] };
    s.turns.push(turn);
    this.sessions.set(id, s);
  }

  async turns(owner: string, id: string): Promise<Turn[]> {
    this.calls.push("turns");
    if (this.failNextTurns !== null) {
      const err = this.failNextTurns;
      this.failNextTurns = null;
      throw err;
    }
    const s = this.sessions.get(id);
    if (s === undefined || s.owner !== owner) return [];
    return [...s.turns];
  }

  async create(_owner: string): Promise<SessionMeta> {
    this.calls.push("create");
    throw new Error("FakeStore.create is not used by SessionMemory");
  }
  async list(_owner: string): Promise<SessionMeta[]> {
    this.calls.push("list");
    throw new Error("FakeStore.list is not used by SessionMemory");
  }
  async get(_owner: string, _id: string): Promise<SessionMeta | null> {
    this.calls.push("get");
    throw new Error("FakeStore.get is not used by SessionMemory");
  }
  async append(_id: string, _rec: SessionRecord): Promise<void> {
    this.calls.push("append");
    throw new Error("FakeStore.append is not used by SessionMemory");
  }
  async records(): Promise<{ records: SessionRecord[]; total: number }> {
    this.calls.push("records");
    throw new Error("FakeStore.records is not used by SessionMemory");
  }
  async softDelete(_owner: string, _id: string): Promise<boolean> {
    this.calls.push("softDelete");
    throw new Error("FakeStore.softDelete is not used by SessionMemory");
  }
  async verify(): Promise<never> {
    this.calls.push("verify");
    throw new Error("FakeStore.verify is not used by SessionMemory");
  }
  async counts(): Promise<{
    sessions: number;
    records: number;
    hidden: number;
  }> {
    this.calls.push("counts");
    throw new Error("FakeStore.counts is not used by SessionMemory");
  }
}

export const OWNER = "owner-1";

export const LIMITS: MemoryLimits = {
  shortTermMaxTurns: 8,
  shortTermMaxTokens: 512,
  historyMaxTokens: 1500,
  maxObservationTokens: 6000,
  maxSessions: 1000,
  sessionTtlS: 3600,
};

export function makeTurn(i: number, query: string, answer: string): Turn {
  return {
    run_id: `run-${i}`,
    query,
    answer,
    steps: [],
    created_at: new Date(Date.UTC(2026, 10, 6, 0, 0, i)).toISOString(),
    ok: true,
    trace_id: null,
    trace_url: null,
  };
}

export const QUERY_1 =
  "Thời hạn báo trước khi đơn phương chấm dứt hợp đồng lao động là bao lâu?";
export const OTHER_QUERIES = [
  "Di chúc bằng văn bản cần có những nội dung gì?",
  "Điều kiện kết hôn của công dân Việt Nam là gì?",
  "Quyền thừa kế của con nuôi được quy định thế nào?",
  "Giao dịch dân sự vô hiệu do nhầm lẫn có hậu quả gì?",
  "Thời hiệu khởi kiện đòi nợ là bao nhiêu năm?",
  "Tài sản chung của vợ chồng gồm những gì?",
  "Đại diện theo ủy quyền có phải lập văn bản không?",
  "Bồi thường thiệt hại ngoài hợp đồng cần những yếu tố nào?",
  "Lãi suất chậm trả theo quy định hiện hành là bao nhiêu?",
  "Hiệu lực của di chúc miệng được xác định ra sao?",
  "Quyền sở hữu nhà ở hình thành trong tương lai thế nào?",
];

/** Turn i (1-based) of the 12-turn fixture. Turn 1 is the lao-dong question. */
export function fixtureTurn(i: number): Turn {
  if (i === 1) {
    return makeTurn(
      1,
      QUERY_1,
      "Theo Điều 35, người lao động phải báo trước ít nhất 45 ngày.",
    );
  }
  return makeTurn(
    i,
    OTHER_QUERIES[i - 2],
    `Câu trả lời số ${i}: nội dung tham chiếu tới điều ${i + 20} của bộ luật.`,
  );
}

export function fixtureTurns(n: number): Turn[] {
  return Array.from({ length: n }, (_, k) => fixtureTurn(k + 1));
}

export function setup(opts: { maxSessions?: number; now?: () => number } = {}) {
  const store = new FakeStore();
  const memory = createSessionMemory({
    store,
    limits: { ...LIMITS, maxSessions: opts.maxSessions ?? LIMITS.maxSessions },
    now: opts.now,
  });
  return { store, memory };
}

/** Lines of the window's older turns, as the summary renders them. */
export function olderLinesOf(turns: Turn[], olderCount: number): string[] {
  const lines: string[] = [];
  for (const t of turns.slice(0, olderCount)) {
    lines.push(`User: ${t.query}`);
    for (const l of t.answer.split(/\r?\n/)) {
      if (l.trim().length > 0) lines.push(`Assistant: ${l.trim()}`);
    }
  }
  return lines;
}
