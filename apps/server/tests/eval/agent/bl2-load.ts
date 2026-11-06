// Loads the BL2 summary for the runner, refusing a report that belongs to another index
// or another dataset. Separate from runner.ts so the self-test can import it.

import { readFileSync } from "node:fs";
import type { Bl2Summary } from "./bl2-metrics";

/**
 * Load the BL2 summary. A report from another index or another dataset is not this run's
 * BL2: it is refused with the reason and the KPI stays NOT MEASURED.
 */
export function loadBl2(
  path: string,
  expect: { index_id: string | null; dataset_sha256: string },
): { summary: Bl2Summary | null; refused: string | null } {
  const j = JSON.parse(readFileSync(path, "utf8")) as {
    header?: { new_index_id?: string; dataset_sha256?: string };
    summary?: Bl2Summary;
  };
  if (!j.summary || typeof j.summary.delta_recall5 !== "number")
    throw new Error(`${path} is not an old-index-compare report (no summary)`);
  const reasons: string[] = [];
  if (j.header?.new_index_id !== expect.index_id)
    reasons.push(
      `new_index_id ${j.header?.new_index_id ?? "absent"} != C9 index_id ${expect.index_id ?? "absent"}`,
    );
  if (j.header?.dataset_sha256 !== expect.dataset_sha256)
    reasons.push(
      `dataset_sha256 ${j.header?.dataset_sha256 ?? "absent"} != current ${expect.dataset_sha256}`,
    );
  return reasons.length > 0
    ? {
        summary: null,
        refused: `BL2 report ${path} refused: ${reasons.join("; ")}`,
      }
    : { summary: j.summary, refused: null };
}
