import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { hasManifest, manifestPathFor } from "../../embeddings/index-manifest";
import {
  type Kind,
  OLD_STORE,
  type Progress,
  SCRIPT_NAME,
} from "./constants-types";
import { fingerprint, writeFileAtomic } from "./fingerprint-old-store";
import { log } from "./logger";

export function readProgressFile(
  path: string,
  text: string,
  target: string,
): Progress {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`progress file ${path} is not valid JSON`);
  }
  const p = parsed as Partial<Progress>;
  const arrays = [p.articles, p.clauses, p.community_reports];
  if (
    p.written_by !== SCRIPT_NAME ||
    !arrays.every(
      (a) => Array.isArray(a) && a.every((x) => typeof x === "string"),
    )
  ) {
    throw new Error(
      `progress file ${path} was not written by ${SCRIPT_NAME}; refusing to use it`,
    );
  }
  if (p.target !== target) {
    throw new Error(
      `progress file ${path} is for ${p.target}, not ${target}; refusing to use it`,
    );
  }
  return p as Progress;
}

export function progressPathFor(target: string): string {
  return `${target}.progress.json`;
}

export function progressIds(progress: Progress, kind: Kind): string[] {
  if (kind === "article") return progress.articles;
  if (kind === "clause") return progress.clauses;
  return progress.community_reports;
}

export async function saveProgress(path: string, progress: Progress): Promise<void> {
  progress.updated_at = new Date().toISOString();
  await writeFileAtomic(path, `${JSON.stringify(progress, null, 2)}\n`);
}

export async function buildGuard(target: string): Promise<void> {
  if (target === OLD_STORE) {
    throw new Error(
      "CONGRAPH_VECTOR_DB_PATH points at the old 384-d store; refusing",
    );
  }
  if (hasManifest(target)) {
    throw new Error(
      `target has an index manifest: ${manifestPathFor(target)}. It is already built or locked; refusing to build`,
    );
  }
  const dir = dirname(target);
  const stem = basename(target).replace(/\.cgraph$/, "");
  const leftovers: string[] = [];
  for (const name of await readdir(dir)) {
    if (!name.startsWith(`${stem}.`)) continue;
    if (name.endsWith(".progress.json") || name.endsWith(".manifest.json"))
      continue;
    leftovers.push(name);
  }
  for (const name of leftovers) {
    const rec = await fingerprint(dir, name);
    log(
      `GUARD leftover ${join(dir, rec.name)}\tsize=${rec.size}\tsha256=${rec.sha256}`,
    );
  }
  const progressPath = progressPathFor(target);
  if (existsSync(progressPath)) {
    readProgressFile(
      progressPath,
      await readFile(progressPath, "utf-8"),
      target,
    );
    return;
  }
  if (leftovers.length > 0) {
    throw new Error(
      `refusing --build: target store files already exist without a .progress.json written by ${SCRIPT_NAME}: ` +
        `${leftovers.map((n) => join(dir, n)).join(", ")}. ` +
        "Nothing was written, deleted or opened in them.",
    );
  }
}
