import { createHybridRetrieval } from "../retrieval/hybrid-congraph";
import { createVectorStore } from "../embeddings/lancedb";
import { getEmbedder } from "../embeddings/embedder";
import { createLegalConsultationAgent } from "../agent/setup";
import { AnthropicLLMAdapter } from "../agent/anthropic-llm";

async function testGlobalSearch() {
  const storage = {
    graph: { getFullArticle: async () => null },
    searchCommunityReports: async (v, l) => {
      const vs = await createVectorStore();
      const res = await vs.searchCommunityReports(v, l);
      await vs.close();
      return res;
    },
    searchEntitiesByEmbedding: async () => [],
    initialize: async () => {},
  };

  const embedder = await getEmbedder();
  const llm = new AnthropicLLMAdapter("dummy-key");
  const retrieval = createHybridRetrieval(storage as any, llm, embedder);
  const agent = createLegalConsultationAgent(retrieval);

  const query =
    "Tóm tắt các quy định về cá nhân và pháp nhân trong Bộ luật Dân sự";
  console.log(`\n=== Testing Global Search for: "${query}" ===\n`);

  const result = await agent.consult(query, {}, "global");

  console.log("Response Preview:\n");
  console.log(result.response.substring(0, 500) + "...");

  console.log("\nContext Details:");
  console.log(`Reports found: ${result.context.community_reports?.length}`);
  result.context.community_reports?.forEach((r) => {
    console.log(`- [Level ${r.level}] ${r.title}`);
  });

  await embedder.dispose();
}

testGlobalSearch().catch(console.error);
