// ============================================================================
// Vector Store Performance Benchmark
// ============================================================================
// Compares ConGraphDB and LanceDB performance for:
// - Single read (get by ID)
// - Batch search (vector similarity search)
// - Count operations
// - Sequential reads
// ============================================================================

import logger from "../shared/logger";
import { createConGraphVectorStore } from "../embeddings/congraph";
import { getEmbedder } from "../embeddings/embedder-factory";
import { createVectorStore as createStore } from "../embeddings/vector-store-factory";

interface BenchmarkResult {
  operation: string;
  congraphTime: number;
  lancedbTime: number;
  winner: "congraph" | "lancedb" | "tie";
  percentDiff: number;
}

// Benchmark utility
async function benchmark<T>(
  name: string,
  congraphFn: () => Promise<T>,
  lancedbFn: () => Promise<T>,
): Promise<BenchmarkResult> {
  logger.info(`\n▶ Benchmark: ${name}`);

  // Warmup runs
  await congraphFn().catch(() => {});
  await lancedbFn().catch(() => {});

  // ConGraphDB benchmark
  const congraphStart = Date.now();
  try {
    await congraphFn();
  } catch (e: any) {
    logger.warn(`ConGraphDB failed: ${e.message}`);
  }
  const congraphTime = Date.now() - congraphStart;

  // LanceDB benchmark
  const lancedbStart = Date.now();
  try {
    await lancedbFn();
  } catch (e: any) {
    logger.warn(`LanceDB failed: ${e.message}`);
  }
  const lancedbTime = Date.now() - lancedbStart;

  // Calculate winner
  let winner: "congraph" | "lancedb" | "tie";
  if (congraphTime < lancedbTime) {
    winner = "congraph";
  } else if (lancedbTime < congraphTime) {
    winner = "lancedb";
  } else {
    winner = "tie";
  }

  const percentDiff =
    lancedbTime === 0 ? 0 : ((congraphTime - lancedbTime) / lancedbTime) * 100;

  logger.info(`  ConGraphDB: ${congraphTime}ms`);
  logger.info(`  LanceDB:    ${lancedbTime}ms`);
  logger.info(
    `  Winner:     ${winner.toUpperCase()} (${percentDiff > 0 ? "+" : ""}${percentDiff.toFixed(1)}%)`,
  );

  return {
    operation: name,
    congraphTime,
    lancedbTime,
    winner,
    percentDiff,
  };
}

// ============================================================================
// Benchmark Script
// ============================================================================

export async function runVectorStoreBenchmark(): Promise<void> {
  logger.info(
    "╔════════════════════════════════════════════════════════════════╗",
  );
  logger.info(
    "║  Vector Store Performance Benchmark - ConGraphDB vs LanceDB  ║",
  );
  logger.info(
    "╚════════════════════════════════════════════════════════════════╝",
  );

  const results: BenchmarkResult[] = [];

  // Initialize stores
  logger.info("\n📦 Initializing vector stores...");

  const congraphStore = await createConGraphVectorStore();
  const lancedbStore = await createStore("lancedb");

  // Explicitly initialize both stores
  logger.info("Initializing ConGraphDB...");
  await congraphStore.initialize();

  logger.info("Initializing LanceDB...");
  await lancedbStore.initialize();

  const embedder = await getEmbedder();

  // Get sample data for testing
  const queryVector = await embedder.embed("đất đai quyền sử dụng");
  logger.info(`Using query vector (384 dimensions) for search benchmarks`);

  // ========================================================================
  // BENCHMARK 1: Single Article Read (by ID)
  // ========================================================================

  results.push(
    await benchmark(
      "Single Article Read (by ID)",
      async () => {
        const article = await congraphStore.getArticle("article_1");
        if (!article) throw new Error("Article not found");
        return article;
      },
      async () => {
        const article = await lancedbStore.getArticle("article_1");
        if (!article) throw new Error("Article not found");
        return article;
      },
    ),
  );

  // ========================================================================
  // BENCHMARK 2: Single Clause Read (by ID)
  // ========================================================================

  results.push(
    await benchmark(
      "Single Clause Read (by ID)",
      async () => {
        const clause = await congraphStore.getClause("clause_1");
        if (!clause) throw new Error("Clause not found");
        return clause;
      },
      async () => {
        const clause = await lancedbStore.getClause("clause_1");
        if (!clause) throw new Error("Clause not found");
        return clause;
      },
    ),
  );

  // ========================================================================
  // BENCHMARK 3: Vector Search - Articles (Top 10)
  // ========================================================================

  results.push(
    await benchmark(
      "Vector Search - Articles (Top 10)",
      async () => {
        const results = await congraphStore.searchArticles(queryVector, 10);
        if (results.length === 0) throw new Error("No results");
        return results;
      },
      async () => {
        const results = await lancedbStore.searchArticles(queryVector, 10);
        if (results.length === 0) throw new Error("No results");
        return results;
      },
    ),
  );

  // ========================================================================
  // BENCHMARK 4: Vector Search - Articles (Top 50)
  // ========================================================================

  results.push(
    await benchmark(
      "Vector Search - Articles (Top 50)",
      async () => {
        const results = await congraphStore.searchArticles(queryVector, 50);
        if (results.length === 0) throw new Error("No results");
        return results;
      },
      async () => {
        const results = await lancedbStore.searchArticles(queryVector, 50);
        if (results.length === 0) throw new Error("No results");
        return results;
      },
    ),
  );

  // ========================================================================
  // BENCHMARK 5: Vector Search - Clauses (Top 10)
  // ========================================================================

  results.push(
    await benchmark(
      "Vector Search - Clauses (Top 10)",
      async () => {
        const results = await congraphStore.searchClauses(queryVector, 10);
        if (results.length === 0) throw new Error("No results");
        return results;
      },
      async () => {
        const results = await lancedbStore.searchClauses(queryVector, 10);
        if (results.length === 0) throw new Error("No results");
        return results;
      },
    ),
  );

  // ========================================================================
  // BENCHMARK 6: Vector Search - Clauses (Top 50)
  // ========================================================================

  results.push(
    await benchmark(
      "Vector Search - Clauses (Top 50)",
      async () => {
        const results = await congraphStore.searchClauses(queryVector, 50);
        if (results.length === 0) throw new Error("No results");
        return results;
      },
      async () => {
        const results = await lancedbStore.searchClauses(queryVector, 50);
        if (results.length === 0) throw new Error("No results");
        return results;
      },
    ),
  );

  // ========================================================================
  // BENCHMARK 7: Vector Search - Community Reports (Top 5)
  // ========================================================================

  results.push(
    await benchmark(
      "Vector Search - Community Reports (Top 5)",
      async () => {
        const results = await congraphStore.searchCommunityReports(
          queryVector,
          5,
        );
        return results; // May be empty
      },
      async () => {
        const results = await lancedbStore.searchCommunityReports(
          queryVector,
          5,
        );
        return results; // May be empty
      },
    ),
  );

  // ========================================================================
  // BENCHMARK 8: Count Articles
  // ========================================================================

  results.push(
    await benchmark(
      "Count Articles",
      async () => {
        const count = await congraphStore.getStats();
        return count.articleCount;
      },
      async () => {
        const count = await lancedbStore.getStats();
        return count.articleCount;
      },
    ),
  );

  // ========================================================================
  // BENCHMARK 9: Count Clauses
  // ========================================================================

  results.push(
    await benchmark(
      "Count Clauses",
      async () => {
        const count = await congraphStore.getStats();
        return count.clauseCount;
      },
      async () => {
        const count = await lancedbStore.getStats();
        return count.clauseCount;
      },
    ),
  );

  // ========================================================================
  // BENCHMARK 10: Vector Search with Filter (Articles by Chapter)
  // ========================================================================

  results.push(
    await benchmark(
      "Vector Search - Articles with Filter (Top 10)",
      async () => {
        const results = await congraphStore.searchArticles(queryVector, 10, {
          chapter: "CHƯNG II",
        });
        return results;
      },
      async () => {
        const results = await lancedbStore.searchArticles(queryVector, 10, {
          chapter: "CHƯNG II",
        });
        return results;
      },
    ),
  );

  // ========================================================================
  // BENCHMARK 11: Sequential Reads (10 Articles)
  // ========================================================================

  results.push(
    await benchmark(
      "Sequential Reads (10 Articles)",
      async () => {
        for (let i = 1; i <= 10; i++) {
          await congraphStore.getArticle(`article_${i}`);
        }
        return true;
      },
      async () => {
        for (let i = 1; i <= 10; i++) {
          await lancedbStore.getArticle(`article_${i}`);
        }
        return true;
      },
    ),
  );

  // ========================================================================
  // BENCHMARK 12: Multiple Vector Searches (5 queries)
  // ========================================================================

  const queries = [
    await embedder.embed("quyền sử dụng đất"),
    await embedder.embed("hợp đồng dân sự"),
    await embedder.embed("kỷ luật hành chính"),
    await embedder.embed("bồi thường thiệt hại"),
    await embedder.embed("thừa kế"),
  ];

  results.push(
    await benchmark(
      "Multiple Vector Searches (5 queries, Top 10 each)",
      async () => {
        // Parallel search using the new searchArticlesBatch API
        return await congraphStore.searchArticlesBatch(queries, 10);
      },
      async () => {
        // Standard Node.js parallel execution via adapter's Promise.all implementation
        return await lancedbStore.searchArticlesBatch(queries, 10);
      },
    ),
  );

  // ========================================================================
  // Close connections
  // ========================================================================

  await congraphStore.close();
  await lancedbStore.close();
  await embedder.dispose();

  // ========================================================================
  // Print Summary
  // ========================================================================

  const congraphTotal = results.reduce((sum, r) => sum + r.congraphTime, 0);
  const lancedbTotal = results.reduce((sum, r) => sum + r.lancedbTime, 0);

  const overallWinner: "congraph" | "lancedb" | "tie" =
    congraphTotal < lancedbTotal
      ? "congraph"
      : lancedbTotal < congraphTotal
        ? "lancedb"
        : "tie";

  logger.info(
    "\n╔════════════════════════════════════════════════════════════════╗",
  );
  logger.info(
    "║                    BENCHMARK SUMMARY                          ║",
  );
  logger.info(
    "╚════════════════════════════════════════════════════════════════╝",
  );

  logger.info(`\n📊 Total Time:`);
  logger.info(`  ConGraphDB: ${congraphTotal}ms`);
  logger.info(`  LanceDB:    ${lancedbTotal}ms`);
  logger.info(
    `  Winner:     ${overallWinner.toUpperCase()} (${overallWinner === "congraph" ? "ConGraphDB is " : overallWinner === "lancedb" ? "LanceDB is " : ""}faster by ${Math.abs(((congraphTotal - lancedbTotal) / lancedbTotal) * 100).toFixed(1)}%)`,
  );

  logger.info(`\n🏆 Results by Operation:`);
  const table = results.map((r) => ({
    Operation: r.operation.padEnd(50),
    ConGraphDB: `${r.congraphTime}ms`.padStart(10),
    LanceDB: `${r.lancedbTime}ms`.padStart(10),
    Winner:
      r.winner === "congraph"
        ? "🔵 ConGraphDB"
        : r.winner === "lancedb"
          ? "🟢 LanceDB"
          : "🟡 Tie",
    Diff: `${r.percentDiff > 0 ? "+" : ""}${r.percentDiff.toFixed(1)}%`.padStart(
      8,
    ),
  }));

  for (const row of table) {
    logger.info(
      `  ${row.Operation} | ${row.ConGraphDB} | ${row.LanceDB} | ${row.Winner} | ${row.Diff}`,
    );
  }

  const congraphWins = results.filter((r) => r.winner === "congraph").length;
  const lancedbWins = results.filter((r) => r.winner === "lancedb").length;
  const ties = results.filter((r) => r.winner === "tie").length;

  logger.info(`\n📈 Win Count:`);
  logger.info(`  ConGraphDB: ${congraphWins} wins`);
  logger.info(`  LanceDB:    ${lancedbWins} wins`);
  logger.info(`  Ties:       ${ties} ties`);

  // Performance categorization
  logger.info(`\n📋 Performance Categories:`);

  const congraphFaster = results.filter((r) => r.winner === "congraph");
  const lancedbFaster = results.filter((r) => r.winner === "lancedb");

  if (congraphFaster.length > 0) {
    logger.info(`\n  ✅ ConGraphDB excels at:`);
    congraphFaster.forEach((r) => {
      logger.info(
        `     • ${r.operation} (${r.percentDiff.toFixed(1)}% faster)`,
      );
    });
  }

  if (lancedbFaster.length > 0) {
    logger.info(`\n  ✅ LanceDB excels at:`);
    lancedbFaster.forEach((r) => {
      logger.info(
        `     • ${r.operation} (${Math.abs(r.percentDiff).toFixed(1)}% faster)`,
      );
    });
  }

  // Recommendation
  logger.info(`\n💡 Recommendation:`);
  if (congraphWins >= lancedbWins) {
    logger.info(
      `  ConGraphDB shows better overall performance (${congraphWins} vs ${lancedbWins} wins).`,
    );
    logger.info(`  Recommended for production use with this workload.`);
  } else if (lancedbWins > congraphWins + 2) {
    logger.info(
      `  LanceDB shows significantly better performance (${lancedbWins} vs ${congraphWins} wins).`,
    );
    logger.info(
      `  Consider using LanceDB if these operations are critical for your use case.`,
    );
  } else {
    logger.info(`  Performance is comparable. Either store would work well.`);
    logger.info(`  ConGraphDB recommended for simpler architecture.`);
  }

  logger.info("\n✅ Benchmark complete!");
}

// Run the script if executed directly
if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  runVectorStoreBenchmark()
    .then(() => {
      logger.info("Benchmark completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Benchmark failed", error);
      process.exit(1);
    });
}
