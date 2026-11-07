import { randomUUID } from "node:crypto";
import type {
  SessionMeta,
  SessionRecord,
  SessionStore,
  Turn,
} from "../../../../../src/agent/contract";

export class FakeStore implements SessionStore {
  readonly sessions = new Map<
    string,
    { owner: string; meta: SessionMeta; hidden: boolean; turns: Turn[] }
  >();
  readonly rows: SessionRecord[] = [];
  readonly calls: string[] = [];
  readonly recordQueries: {
    session_id?: string;
    kind?: string;
    q?: string;
    offset: number;
    limit: number;
  }[] = [];

  seed(
    owner: string,
    over: Partial<SessionMeta> = {},
    turns: Turn[] = [],
  ): string {
    const id = randomUUID();
    const now = "2026-05-01T00:00:00.000Z";
    this.sessions.set(id, {
      owner,
      hidden: false,
      turns,
      meta: {
        session_id: id,
        title: "Tiêu đề",
        created_at: now,
        last_active_at: now,
        turns: 0,
        record_count: 0,
        tokens: 0,
        active: false,
        ...over,
      },
    });
    return id;
  }

  private visibleIds(owner: string): Set<string> {
    const ids = new Set<string>();
    for (const [id, s] of this.sessions)
      if (s.owner === owner && !s.hidden) ids.add(id);
    return ids;
  }

  async create(owner: string): Promise<SessionMeta> {
    this.calls.push("create");
    const id = this.seed(owner, { created_at: new Date().toISOString() });
    return { ...this.sessions.get(id)!.meta };
  }

  async list(owner: string): Promise<SessionMeta[]> {
    this.calls.push("list");
    return [...this.sessions.values()]
      .filter((s) => s.owner === owner && !s.hidden)
      .map((s) => ({ ...s.meta }));
  }

  async get(owner: string, id: string): Promise<SessionMeta | null> {
    this.calls.push(`get:${id}`);
    const s = this.sessions.get(id);
    return s && s.owner === owner && !s.hidden ? { ...s.meta } : null;
  }

  async append(id: string, rec: SessionRecord): Promise<void> {
    this.calls.push(`append:${id}`);
    this.rows.push(rec);
  }

  async turns(owner: string, id: string): Promise<Turn[]> {
    this.calls.push(`turns:${id}`);
    const s = this.sessions.get(id);
    return s && s.owner === owner && !s.hidden ? s.turns : [];
  }

  async records(
    owner: string,
    q: {
      session_id?: string;
      kind?: string;
      q?: string;
      offset: number;
      limit: number;
    },
  ): Promise<{ records: SessionRecord[]; total: number }> {
    this.calls.push("records");
    this.recordQueries.push({ ...q });
    const ids = this.visibleIds(owner);
    const matched = this.rows
      .filter(
        (r) =>
          ids.has(r.session_id) &&
          (q.session_id === undefined || r.session_id === q.session_id) &&
          (q.kind === undefined || r.kind === q.kind) &&
          (q.q === undefined || r.content.includes(q.q)),
      )
      .reverse();
    return {
      records: matched.slice(q.offset, q.offset + q.limit),
      total: matched.length,
    };
  }

  async softDelete(owner: string, id: string): Promise<boolean> {
    this.calls.push(`softDelete:${id}`);
    const s = this.sessions.get(id);
    if (!s || s.owner !== owner || s.hidden) return false;
    s.hidden = true;
    return true;
  }

  async counts() {
    this.calls.push("counts");
    const hidden = [...this.sessions.values()].filter((s) => s.hidden).length;
    return {
      sessions: this.sessions.size - hidden,
      records: this.rows.length,
      hidden,
    };
  }

  async verify(owner: string) {
    this.calls.push("verify");
    const n = this.rows.filter((r) =>
      this.visibleIds(owner).has(r.session_id),
    ).length;
    return { ok: true, records: n, first_bad: null };
  }
}
