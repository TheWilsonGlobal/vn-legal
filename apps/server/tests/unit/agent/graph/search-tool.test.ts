// search_legal_articles must return both sides of local retrieval: semantic seeds
// and the articles reached over reference links (path_context).
import { describe, it, expect } from "vitest";
import { createAgentTools } from "../../../../src/agent/graph/tools";

const art = (id: string, n: number, title: string) => ({
  id,
  article_number: n,
  title,
  content: `Nội dung Điều ${n}`,
  metadata: { part: "Phần thứ nhất", chapter: "Chương II" },
});

function tool(ctx: any) {
  const [search] = createAgentTools({
    retrieval: { retrieve: async () => ctx },
    memory: { recall: async () => ({ fresh_session: true, items: [] }) } as any,
    sessionId: "s",
    runId: "r",
  });
  return search;
}

describe("search_legal_articles returns semantic and graph results", () => {
  it("includes path_context articles that are not seeds, with path citations", async () => {
    const t = tool({
      seed_articles: [
        { article_id: "article_21", score: 0.71, article: art("article_21", 21, "Người chưa thành niên") },
      ],
      path_context: [
        { article: art("article_21", 21, "Người chưa thành niên"), relationship: "seed", depth: 0, path: [] },
        { article: art("article_25", 25, "Quyền nhân thân"), relationship: "REFERENCES", depth: 1, path: [] },
        { article: art("article_25", 25, "Quyền nhân thân"), relationship: "REFERENCES", depth: 1, path: [] },
      ],
    });
    const res = await t.run({ query: "quyền của người chưa thành niên" });
    expect(res.content).toContain("Điều 21");
    expect(res.content).toContain("Điều liên quan qua tham chiếu");
    expect(res.content).toContain("Điều 25");
    // Seed is not repeated in the graph block, and the duplicate is dropped.
    expect(res.content.match(/Điều 25:/g)?.length).toBe(1);
    expect(res.citations.map((c) => [c.article_id, c.via])).toEqual([
      ["article_21", "vector"],
      ["article_25", "path"],
    ]);
    expect(res.summary).toContain("qua đồ thị");
  });

  it("returns only seeds when there are no linked articles", async () => {
    const t = tool({
      seed_articles: [{ article_id: "article_21", score: 0.7, article: art("article_21", 21, "A") }],
      path_context: [],
    });
    const res = await t.run({ query: "x" });
    expect(res.content).not.toContain("đồ thị");
    expect(res.citations).toHaveLength(1);
  });

  const byMode = (global: () => Promise<any>) =>
    createAgentTools({
      retrieval: {
        retrieve: async (_q: string, mode: string) =>
          mode === "global"
            ? global()
            : {
                seed_articles: [
                  { article_id: "article_21", score: 0.7, article: art("article_21", 21, "A") },
                ],
                path_context: [],
              },
      },
      memory: { recall: async () => ({ fresh_session: true, items: [] }) } as any,
      sessionId: "s",
      runId: "r",
    })[0];

  it("adds community reports from the global retrieval", async () => {
    const t = byMode(async () => ({
      community_reports: [
        { title: "Năng lực hành vi", summary: "Tóm tắt chủ đề", findings: ["Ý một"] },
      ],
    }));
    const res = await t.run({ query: "x" });
    expect(res.content).toContain("Báo cáo tổng quan cộng đồng");
    expect(res.content).toContain("Năng lực hành vi");
    expect(res.content).toContain("Điều 21");
    expect(res.summary).toContain("báo cáo tổng quan");
  });

  it("keeps local results when the community step fails", async () => {
    const t = byMode(async () => {
      throw new Error("embedder down");
    });
    const res = await t.run({ query: "x" });
    expect(res.ok).toBe(true);
    expect(res.content).toContain("Điều 21");
    expect(res.content).not.toContain("cộng đồng");
  });

  it("returns graph nodes and reference edges for the graph tab", async () => {
    const t = tool({
      seed_articles: [
        { article_id: "article_21", score: 0.7, article: art("article_21", 21, "A") },
      ],
      path_context: [
        { article: art("article_21", 21, "A"), relationship: "seed", depth: 0, path: ["article_21"] },
        { article: art("article_25", 25, "B"), relationship: "REFERENCES", depth: 1, path: ["article_21", "article_25"] },
        { article: art("article_47", 47, "C"), relationship: "REFERENCES", depth: 2, path: ["article_21", "article_25", "article_47"] },
      ],
    });
    const res = await t.run({ query: "x" });
    expect(res.graph?.nodes.map((n) => [n.id, n.kind, n.depth])).toEqual([
      ["article_21", "vector", 0],
      ["article_25", "path", 1],
      ["article_47", "path", 2],
    ]);
    expect(res.graph?.edges).toEqual([
      { from: "article_21", to: "article_25" },
      { from: "article_25", to: "article_47" },
    ]);
  });
});
