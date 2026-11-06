// BL2 retrieval metrics. Pure. Ranked list = seed articles in retrieval order,
// then path-context articles, de-duplicated (what HybridRetrieval.retrieve returns).

import { mean } from "./stats";

export interface BundleLike {
  seed_articles: { article: { article_number: number } }[];
  path_context: { article: { article_number: number } }[];
}

export function rankedArticles(bundle: BundleLike): number[] {
  const out: number[] = [];
  for (const x of [...bundle.seed_articles, ...bundle.path_context]) {
    const n = x.article.article_number;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** |gold ∩ top-k| / |gold|. */
export function recallAtK(
  gold: readonly number[],
  ranked: readonly number[],
  k: number,
): number {
  if (gold.length === 0)
    throw new Error("recallAtK needs at least one gold id");
  const top = new Set(ranked.slice(0, k));
  return gold.filter((g) => top.has(g)).length / gold.length;
}

/** 1 / rank of the first relevant hit (later hits do not count); 0 when none. */
export function reciprocalRank(
  gold: readonly number[],
  ranked: readonly number[],
): number {
  const i = ranked.findIndex((r) => gold.includes(r));
  return i < 0 ? 0 : 1 / (i + 1);
}

export interface Bl2CaseResult {
  case_id: string;
  gold: number[];
  old_ranked: number[];
  new_ranked: number[];
  old_recall5: number;
  new_recall5: number;
  old_recall10: number;
  new_recall10: number;
  old_rr: number;
  new_rr: number;
}

export interface Bl2Arm {
  recall5: number;
  recall10: number;
  mrr: number;
}

export interface Bl2Summary {
  n: number;
  old: Bl2Arm;
  new: Bl2Arm;
  delta_recall5: number;
  delta_recall10: number;
  delta_mrr: number;
  mean_ranked_length_old: number;
  mean_ranked_length_new: number;
}

export function scoreBl2Case(
  case_id: string,
  gold: number[],
  oldRanked: number[],
  newRanked: number[],
): Bl2CaseResult {
  return {
    case_id,
    gold,
    old_ranked: oldRanked,
    new_ranked: newRanked,
    old_recall5: recallAtK(gold, oldRanked, 5),
    new_recall5: recallAtK(gold, newRanked, 5),
    old_recall10: recallAtK(gold, oldRanked, 10),
    new_recall10: recallAtK(gold, newRanked, 10),
    old_rr: reciprocalRank(gold, oldRanked),
    new_rr: reciprocalRank(gold, newRanked),
  };
}

export function summarizeBl2(rs: readonly Bl2CaseResult[]): Bl2Summary {
  if (rs.length === 0) throw new Error("BL2 has no cases");
  const m = (f: (r: Bl2CaseResult) => number) => mean(rs.map(f)) as number;
  const old: Bl2Arm = {
    recall5: m((r) => r.old_recall5),
    recall10: m((r) => r.old_recall10),
    mrr: m((r) => r.old_rr),
  };
  const neu: Bl2Arm = {
    recall5: m((r) => r.new_recall5),
    recall10: m((r) => r.new_recall10),
    mrr: m((r) => r.new_rr),
  };
  return {
    n: rs.length,
    old,
    new: neu,
    delta_recall5: neu.recall5 - old.recall5,
    delta_recall10: neu.recall10 - old.recall10,
    delta_mrr: neu.mrr - old.mrr,
    mean_ranked_length_old: m((r) => r.old_ranked.length),
    mean_ranked_length_new: m((r) => r.new_ranked.length),
  };
}
