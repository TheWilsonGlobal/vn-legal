import type {
  AdminStats,
  Activity,
  AdminSession,
  TraceRecord,
  TracesPage,
  Community,
  VectorStoreStatus,
  AppConfig,
  GraphData,
  Relation,
  RelationsLeaderboard,
  VectorResult,
} from "../types/index.ts";

export async function fetchStatsApi(): Promise<AdminStats> {
  const response = await fetch("/api/admin/stats");
  return response.json();
}

export async function fetchActivitiesApi(
  limit = 50,
): Promise<{ activities: Activity[] }> {
  const response = await fetch(`/api/admin/activity?limit=${limit}`);
  return response.json();
}

export async function fetchAdminSessionsApi(): Promise<{
  sessions: AdminSession[];
  total: number;
}> {
  const response = await fetch("/api/admin/sessions");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function fetchAdminTracesApi(params: {
  sessionId?: string;
  kind?: string;
  q?: string;
  offset: number;
  limit: number;
}): Promise<TracesPage> {
  const qs = new URLSearchParams({
    offset: String(params.offset),
    limit: String(params.limit),
  });
  if (params.sessionId) qs.set("session_id", params.sessionId);
  if (params.kind) qs.set("kind", params.kind);
  if (params.q) qs.set("q", params.q);
  const response = await fetch(`/api/admin/traces?${qs.toString()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Every record of one session, paged until the server's total is reached. */
export async function fetchAllSessionRecordsApi(
  sessionId: string,
): Promise<TraceRecord[]> {
  const PAGE_SIZE = 100;
  const all: TraceRecord[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchAdminTracesApi({
      sessionId,
      offset,
      limit: PAGE_SIZE,
    });
    all.push(...page.records);
    offset += page.records.length;
    if (page.records.length === 0 || offset >= page.total) break;
  }
  return all;
}

export async function fetchVectorStoreStatusApi(): Promise<VectorStoreStatus> {
  const response = await fetch("/api/admin/vector-store/status");
  return response.json();
}

export async function fetchConfigApi(): Promise<AppConfig> {
  const response = await fetch("/api/admin/config");
  return response.json();
}

export async function saveConfigApi(
  clientGraphMode: string,
): Promise<Response> {
  return fetch("/api/admin/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientGraphMode }),
  });
}

export async function fetchGraphDataApi(): Promise<GraphData> {
  const response = await fetch("/api/admin/graph/data");
  return response.json();
}

export async function fetchCommunitiesApi(): Promise<{
  communities: Community[];
}> {
  const response = await fetch("/api/admin/communities");
  return response.json();
}

export async function addCommunityApi(
  community: Community,
): Promise<{ ok: boolean; data: { error?: string } }> {
  const response = await fetch("/api/admin/community/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...community,
      findings: community.findings.filter((f: unknown) =>
        typeof f === "string" ? f.trim() !== "" : true,
      ),
    }),
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

export async function fetchChunksApi(
  page: number,
  search: string,
  type: string,
): Promise<{
  chunks: unknown[];
  pagination: { page: number; pages: number; total: number };
}> {
  const queryParams = new URLSearchParams({
    page: page.toString(),
    limit: "20",
    search,
    type,
  });
  const response = await fetch(
    `/api/admin/vector/chunks?${queryParams.toString()}`,
  );
  return response.json();
}

export async function searchVectorApi(
  query: string,
): Promise<{ results: VectorResult[] }> {
  const response = await fetch("/api/admin/vector/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 10 }),
  });
  return response.json();
}

export async function fetchRelationsApi(
  page: number,
  search: string,
  type: string,
): Promise<{
  relations: Relation[];
  pagination: { page: number; pages: number; total: number };
}> {
  const queryParams = new URLSearchParams({
    page: page.toString(),
    limit: "15",
    search,
    type,
  });
  const response = await fetch(
    `/api/admin/graph/relations?${queryParams.toString()}`,
  );
  return response.json();
}

export async function fetchRelationsLeaderboardApi(): Promise<RelationsLeaderboard> {
  const response = await fetch("/api/admin/graph/relations/leaderboard");
  return response.json();
}

export async function uploadKnowledgeJsonApi(
  filename: string,
  content: unknown,
): Promise<{ ok: boolean; data: { message?: string; error?: string } }> {
  const response = await fetch("/api/admin/knowledge/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content }),
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

export async function rebuildVectorApi(): Promise<{
  ok: boolean;
  data: { error?: string };
}> {
  const response = await fetch("/api/admin/rebuild-vector", {
    method: "POST",
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

// LLM endpoints
export async function fetchLlmStatusApi(): Promise<unknown> {
  const response = await fetch("/api/admin/llm/status");
  return response.json();
}

export async function fetchLlmLastPromptApi(): Promise<unknown> {
  const response = await fetch("/api/admin/llm/last-prompt");
  return response.json();
}

export async function updateLlmEndpointApi(
  apiUrl: string,
): Promise<{
  ok: boolean;
  data: { success?: boolean; message?: string; error?: string };
}> {
  const response = await fetch("/api/admin/llm/endpoint", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiUrl }),
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

export async function testLlmApi(
  prompt: string,
): Promise<{
  success: boolean;
  response?: string;
  duration_ms?: number;
  error?: string;
}> {
  const response = await fetch("/api/admin/llm/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  return response.json();
}
