// findSeedArticles merges article and clause hits. Two clauses of one article must
// yield one seed, the highest-scoring one.
import { describe, it, expect } from "vitest";
import { createHybridRetrieval } from "../../../src/retrieval/hybrid-congraph";

function storageWith(entities: any[]) {
  const articles: Record<string, any> = {
    article_21: { id: "article_21", article_number: 21, title: "Người chưa thành niên", content: "…", metadata: {} },
    article_25: { id: "article_25", article_number: 25, title: "Quyền nhân thân", content: "…", metadata: {} },
  };
  return {
    searchEntitiesByEmbedding: async () => entities,
    graph: { getFullArticle: async (id: string) => articles[id] ?? null },
  } as any;
}

const embedder = { embed: async () => [0.1, 0.2] } as any;

describe("findSeedArticles", () => {
  it("keeps one seed per article, the first (highest-scoring) hit", async () => {
    const r = createHybridRetrieval(
      storageWith([
        // Sorted by score descending, as the adapter returns them.
        { id: "article_21_clause_4", name: "k4", metadata: { score: 0.78 } },
        { id: "article_21_clause_2", name: "k2", metadata: { score: 0.71 } },
        { id: "article_25", name: "A25", metadata: { score: 0.6 } },
      ]),
      undefined,
      embedder,
    );
    // Explicit limit: the default reads config, which this unit test does not load.
    const seeds = await r.findSeedArticles("q", 10);
    expect(seeds.map((s) => s.article_id)).toEqual(["article_21", "article_25"]);
    expect(seeds[0].score).toBe(0.78);
  });
});
