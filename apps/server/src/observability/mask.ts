// Capture-mode masking for every text payload that leaves the process (§5.8 item 7).
// The LangfuseSpanProcessor `mask` hook routes trace/observation input, output and
// observation metadata through maskPayload. Trace metadata set via propagateAttributes
// is not routed through the hook, so the tracer never puts payload text there.

export type CaptureMode = "full" | "masked" | "metadata_only";

export const REDACTED = "[redacted]";
export const MAX_FIELD_CHARS = 2000;

// Letters are Unicode so that a local part such as "nguyễna@x.vn" is redacted whole,
// not left as "nguyễn[email]".
const EMAIL_RE =
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
// Vietnamese mobile/landline: 0xxxxxxxxx, or +84 with an optional "(0)" trunk digit.
// Digits may be separated by one space or dash. "." is not a separator, so amounts
// such as 1.000.000.000 never match. A separated digit right after the number blocks
// the match, so "0912 345 678 9" falls through to the account rule and is redacted whole.
const VN_PHONE_RE =
  /(?<!\d)(?:\+84[ -]?(?:\(0\)[ -]?)?|0)\d(?:[ -]?\d){7,8}(?![ -]?\d)/g;
// CMND (9 digits) and CCCD (12 digits).
const ID_RE = /(?<!\d)(?:\d{9}|\d{12})(?!\d)/g;
// Bank-account-like runs: 8 or more digits, optionally grouped with ONE separator kind
// (space or dash) used throughout the run. A run followed by a currency word is an
// amount ("1000000000 đồng") and is not matched. Matches that are dates or year lists
// are rejected in redactAccount.
const ACCOUNT_RE =
  /(?<!\d)\d+(?:(?<sep>[ -])\d+(?:\k<sep>\d+)*)?(?!\d)(?!\s*(?:đồng|vnđ|VND|₫))/g;
const DATE_RE = /^(?:\d{1,2}-\d{1,2}-\d{4}|\d{4}-\d{1,2}-\d{1,2})$/;
const YEAR_RE = /^(?:19|20)\d{2}$/;

function redactAccount(run: string): string {
  if (run.replace(/\D/g, "").length < 8) return run;
  if (DATE_RE.test(run)) return run;
  const groups = run.split(/[ -]/);
  if (groups.length > 1 && groups.every((group) => YEAR_RE.test(group))) {
    return run;
  }
  return "[account]";
}

export function redactText(text: string): string {
  const normalised = text.normalize("NFC");
  const redacted = normalised
    .replace(EMAIL_RE, "[email]")
    .replace(VN_PHONE_RE, "[phone]")
    .replace(ID_RE, "[id]")
    .replace(ACCOUNT_RE, (run) => redactAccount(run));
  const chars = Array.from(redacted);
  return chars.length > MAX_FIELD_CHARS
    ? chars.slice(0, MAX_FIELD_CHARS).join("")
    : redacted;
}

function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, redactDeep(inner)]),
    );
  }
  return value;
}

// metadata_only: any string or structured value is replaced wholesale. Numbers,
// booleans and null carry no free text, so they pass (ok flags, citation counts).
// masked: string leaves are regex-redacted and truncated; object keys are kept.
// full: the value passes unchanged.
export function maskPayload(data: unknown, capture: CaptureMode): unknown {
  if (capture === "full") return data;
  if (capture === "metadata_only") {
    return typeof data === "string" ||
      (typeof data === "object" && data !== null)
      ? REDACTED
      : data;
  }
  return redactDeep(data);
}
