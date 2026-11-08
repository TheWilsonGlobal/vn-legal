import { z } from "zod";
import type {
  Citation,
  ObservationGraph,
  ObservationReport,
  StepKind,
} from "../contract";

/** Checked before any path is built. Anything else is refused without touching the disk. */
export const SESSION_ID_PATTERN = /^[a-f0-9-]{36}$/;

const STEP_KINDS = [
  "thought",
  "action",
  "observation",
  "reflection",
  "final",
] as const;
const RECORD_KINDS = [
  "session_created",
  "query",
  "step",
  "answer",
  "error",
  "deleted",
] as const;
/** Kinds the caller may append. `session_created` and `deleted` are written by the store only. */
const APPEND_KINDS = ["query", "step", "answer", "error"] as const;

/**
 * Size caps on appended records (R7-01). Counted in UTF-16 units (JS string length).
 *
 * MAX_RECORD_CONTENT_CHARS = 32000. Measured: the largest article in
 * data/Docs/Vietnam Civil Law.json is 2660 characters (689 articles, mean 484),
 * so this is 12x margin. It also exceeds 24000 = 4 x MAX_OBSERVATION_TOKENS (6000),
 * the most characters any text can hold and still fit the observation budget,
 * because countTokens(t) >= ceil(chars / 4). Nothing the LLM budget admits is refused.
 *
 * MAX_CITATIONS_PER_STEP = 50. The largest result limit in apps/server/src is 20
 * (admin graph-relations route); vector search defaults are 3 to 10. 50 is 2.5x that.
 *
 * Only the append path is capped. Records already on disk are not re-checked on load.
 */
export const MAX_RECORD_CONTENT_CHARS = 32000;
export const MAX_CITATIONS_PER_STEP = 50;

const isoUtc = z.string().refine((s) => {
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString() === s;
}, "must be an ISO 8601 UTC timestamp as produced by toISOString()");

const hash64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex");

const citationSchema = z
  .object({
    article_id: z.string(),
    article_number: z.number().int(),
    clause_id: z.string().optional(),
    breadcrumb: z.array(z.string()),
    via: z.enum(["vector", "path", "community", "lookup"]),
    score: z.number().optional(),
  })
  .strict();

// Graph tab data for an observation step. Bounded so a record stays small.
const graphSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id: z.string(),
            number: z.number().int(),
            title: z.string().max(300),
            kind: z.enum(["vector", "path"]),
            // Optional: graph records written before `depth` existed must still load.
            depth: z.number().int().min(0).max(10).optional(),
          })
          .strict(),
      )
      .max(40),
    edges: z
      .array(z.object({ from: z.string(), to: z.string() }).strict())
      .max(120),
  })
  .strict();

// Synthesis tab data: community reports shown beside an observation step.
const reportsSchema = z
  .array(
    z
      .object({
        title: z.string().max(300),
        summary: z.string().max(600),
        rating: z.number().optional(),
      })
      .strict(),
  )
  .max(10);

const recordBase = z
  .object({
    session_id: z.string().regex(SESSION_ID_PATTERN),
    run_id: z.string().nullable(),
    seq: z.number().int().positive(),
    created_at: isoUtc,
    kind: z.enum(RECORD_KINDS),
    step_kind: z.enum(STEP_KINDS).optional(),
    tool: z.string().nullable().optional(),
    content: z.string(),
    ok: z.boolean().optional(),
    trace_id: z.string().nullable().optional(),
    // Step fields (AgentStep). Written by the runner on every step record.
    index: z.number().int().nonnegative().optional(),
    tool_input: z.string().nullable().optional(),
    duration_ms: z.number().finite().nonnegative().optional(),
    citations: z.array(citationSchema).optional(),
    graph: graphSchema.optional(),
    reports: reportsSchema.optional(),
    // Written on answer and error records. Null means the run had no trace.
    trace_url: z.string().nullable().optional(),
  })
  .strict();

type RunFields = { kind?: string; run_id?: string | null; step_kind?: unknown };

/**
 * Write-time rule (append only). A step must carry every AgentStep field the
 * replay returns, and an answer must carry the fields its Turn reports. An
 * omitted field is refused here, never filled in later. Error records may
 * omit trace_id and trace_url; replay reads an omitted value as null.
 */
function checkWriteRequired(
  rec: RunFields & Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  const require = (field: string, present: boolean, message: string): void => {
    if (!present) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    }
  };
  if (rec.kind === "step") {
    require("index", rec.index !== undefined, "required for step records");
    require("tool", rec.tool !== undefined, "required for step records");
    require("tool_input", rec.tool_input !==
      undefined, "required for step records");
    require("ok", rec.ok !== undefined, "required for step records");
    require("duration_ms", rec.duration_ms !==
      undefined, "required for step records");
    require("citations", rec.citations !==
      undefined, "required for step records");
  } else if (rec.kind === "answer") {
    require("ok", rec.ok !== undefined, "required for answer records");
    require("trace_id", rec.trace_id !==
      undefined, "required for answer records");
    require("trace_url", rec.trace_url !==
      undefined, "required for answer records");
  }
}

function checkRunFields(rec: RunFields, ctx: z.RefinementCtx): void {
  const runless = rec.kind === "session_created" || rec.kind === "deleted";
  const hasRun = typeof rec.run_id === "string";
  if (runless && hasRun) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["run_id"],
      message: "must be null for this kind",
    });
  }
  if (!runless && !hasRun) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["run_id"],
      message: "required for this kind",
    });
  }
  if (rec.kind === "step" && rec.step_kind === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["step_kind"],
      message: "required for step records",
    });
  }
}

/** Input of `SessionStore.append`: no hash fields, no store-owned kinds, within the size caps. */
export const appendRecordSchema = recordBase
  .extend({
    kind: z.enum(APPEND_KINDS),
    content: z
      .string()
      .max(
        MAX_RECORD_CONTENT_CHARS,
        `must be at most ${MAX_RECORD_CONTENT_CHARS} characters`,
      ),
    citations: z
      .array(citationSchema)
      .max(
        MAX_CITATIONS_PER_STEP,
        `must have at most ${MAX_CITATIONS_PER_STEP} citations`,
      )
      .optional(),
    graph: graphSchema.optional(),
    reports: reportsSchema.optional(),
  })
  .superRefine(checkRunFields)
  .superRefine(checkWriteRequired);

/**
 * One line of a session log as stored on disk. The step and answer fields stay
 * optional here: records written before they existed still parse. Replay
 * refuses to build a turn from a record that lacks a field it needs.
 */
export const storedRecordSchema = recordBase
  .extend({ prev_hash: hash64, row_hash: hash64 })
  .superRefine(checkRunFields);

/**
 * Hand-written type, not z.infer: the server tsconfig runs with strict:false,
 * and under that setting zod 3 marks every key optional. The zod schema still
 * validates each record at runtime before the cast.
 */
export type RecordKind =
  | "session_created"
  | "query"
  | "step"
  | "answer"
  | "error"
  | "deleted";

export interface StoredRecord {
  session_id: string;
  run_id: string | null;
  seq: number;
  created_at: string;
  kind: RecordKind;
  step_kind?: StepKind;
  tool?: string | null;
  content: string;
  ok?: boolean;
  trace_id?: string | null;
  index?: number;
  tool_input?: string | null;
  duration_ms?: number;
  citations?: Citation[];
  graph?: ObservationGraph;
  reports?: ObservationReport[];
  trace_url?: string | null;
  prev_hash: string;
  row_hash: string;
}

export const indexEntrySchema = z
  .object({
    session_id: z.string().regex(SESSION_ID_PATTERN),
    owner: z.string().min(1),
    title: z.string(),
    created_at: isoUtc,
    last_active_at: isoUtc,
    turns: z.number().int().nonnegative(),
    record_count: z.number().int().positive(),
    tokens: z.number().int().nonnegative(),
    hidden: z.boolean(),
  })
  .strict();

export interface IndexEntry {
  session_id: string;
  owner: string;
  title: string;
  created_at: string;
  last_active_at: string;
  turns: number;
  record_count: number;
  tokens: number;
  hidden: boolean;
}

export const indexFileSchema = z
  .object({
    version: z.literal(1),
    sessions: z.array(indexEntrySchema),
  })
  .strict();

export function summarizeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
