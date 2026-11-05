import type {
  AdminStats,
  Activity,
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
