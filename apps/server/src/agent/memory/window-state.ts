// ============================================================================
// Per-session working-memory state (plan §5.5), pure functions.
//
// Turns enter at the newest end. The window keeps the last `maxTurns` turns
// verbatim while they fit `maxTokens`. A turn that leaves the window becomes
// older: its lines feed the extractive history summary.
//
// Only turns with an answer enter the window. A failed or cancelled turn is
// never sent to the LLM, so it takes no slot and no tokens (RX-01).
//
// Summary = the last 3 older lines verbatim ("tail"), preceded by the earlier
// older lines condensed to their first 12 words ("heads"), newest first until
// the `historyMaxTokens` budget is spent. Heads beyond a RAM cap are dropped
// and counted, so state stays bounded however long the session runs.
// ============================================================================

import { capTokens, countTokens } from "./tokens";

export const TAIL_LINES = 3;
const HEAD_WORDS = 12;

export interface Exchange {
  run_id: string;
  query: string;
  answer: string;
}

interface Slot {
  /** The turn as the store holds it. Used when the turn leaves the window. */
  full: Exchange;
  /** What the window shows: `full`, or a cut copy when one turn alone exceeds the cap. */
  shown: Exchange;
  shownTokens: number;
}

export interface WindowState {
  recent: Slot[];
  olderTurns: number;
  tail: string[];
  heads: string[];
  headTokens: number;
  headsDropped: number;
  /** Run ids of the turns in `recent`. A turn already in the window is not added twice. */
  runIds: Set<string>;
}

export interface WindowLimits {
  maxTurns: number;
  maxTokens: number;
  historyMaxTokens: number;
}

export function createWindowState(): WindowState {
  return {
    recent: [],
    olderTurns: 0,
    tail: [],
    heads: [],
    headTokens: 0,
    headsDropped: 0,
    runIds: new Set(),
  };
}

/** A turn with an empty (or blank) answer: a failed or cancelled run. */
export function hasAnswer(text: string): boolean {
  return text.trim().length > 0;
}

function exchangeTokens(ex: Exchange): number {
  return countTokens(ex.query) + countTokens(ex.answer);
}

export function recentTokens(state: WindowState): number {
  return state.recent.reduce((sum, slot) => sum + slot.shownTokens, 0);
}

/** Non-empty lines of a message, in order. Text is kept verbatim. */
function linesOf(role: "User" | "Assistant", text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => `${role}: ${l}`);
}

function condense(line: string): string {
  const words = line.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= HEAD_WORDS) return line;
  return `${words.slice(0, HEAD_WORDS).join(" ")} …`;
}

function pushOlderLine(state: WindowState, line: string, limits: WindowLimits) {
  state.tail.push(line);
  if (state.tail.length > TAIL_LINES) {
    const head = condense(state.tail.shift() as string);
    state.heads.push(head);
    state.headTokens += countTokens(head);
  }
  while (state.headTokens > limits.historyMaxTokens && state.heads.length > 0) {
    const dropped = state.heads.shift() as string;
    state.headTokens -= countTokens(dropped);
    state.headsDropped += 1;
  }
}

function moveOut(state: WindowState, slot: Slot, limits: WindowLimits) {
  state.olderTurns += 1;
  state.runIds.delete(slot.full.run_id);
  for (const line of linesOf("User", slot.full.query)) {
    pushOlderLine(state, line, limits);
  }
  for (const line of linesOf("Assistant", slot.full.answer)) {
    pushOlderLine(state, line, limits);
  }
}

/** Cuts a single exchange to `budget` tokens, query first, answer gets the rest. */
function fitExchange(ex: Exchange, budget: number): Exchange {
  const query = capTokens(ex.query, budget);
  const answer = capTokens(ex.answer, budget - countTokens(query));
  return { run_id: ex.run_id, query, answer };
}

/**
 * Appends one completed turn (newest end) and enforces the window limits.
 * Returns false, and changes nothing, when the turn has no answer (a failed run,
 * which the LLM never sees) or when the run id is already in the window.
 */
export function addExchange(
  state: WindowState,
  ex: Exchange,
  limits: WindowLimits,
): boolean {
  if (!hasAnswer(ex.answer)) return false;
  if (state.runIds.has(ex.run_id)) return false;
  state.recent.push({ full: ex, shown: ex, shownTokens: exchangeTokens(ex) });
  state.runIds.add(ex.run_id);

  while (state.recent.length > limits.maxTurns) {
    moveOut(state, state.recent.shift() as Slot, limits);
  }
  while (state.recent.length > 1 && recentTokens(state) > limits.maxTokens) {
    moveOut(state, state.recent.shift() as Slot, limits);
  }
  if (recentTokens(state) > limits.maxTokens) {
    // The newest turn alone exceeds the cap: keep it, cut to fit.
    const only = state.recent[0];
    const shown = fitExchange(only.full, limits.maxTokens);
    only.shown = shown;
    only.shownTokens = exchangeTokens(shown);
  }
  return true;
}

/**
 * Messages for the LLM: the verbatim window, oldest first. Every turn in the
 * window has an answer (addExchange refuses the others), so user and assistant
 * messages always alternate.
 */
export function windowMessages(
  state: WindowState,
): { role: "user" | "assistant"; content: string }[] {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const slot of state.recent) {
    messages.push({ role: "user", content: slot.shown.query });
    messages.push({ role: "assistant", content: slot.shown.answer });
  }
  return messages;
}

/**
 * What one line costs inside the joined summary: its countTokens plus one for the
 * "\n" join. With this cost, the joined text is within the budget whenever the
 * costs sum to it: countTokens(a + "\n" + b) <= countTokens(a) + countTokens(b) + 1.
 */
function lineCost(line: string): number {
  return countTokens(line) + 1;
}

/** Newest-first heads that fit `budget` at joined cost, as a count taken from the end. */
function headsThatFit(heads: string[], budget: number): number {
  let used = 0;
  let count = 0;
  for (let i = heads.length - 1; i >= 0; i--) {
    const t = lineCost(heads[i]);
    if (used + t > budget) break;
    used += t;
    count += 1;
  }
  return count;
}

/**
 * The history summary, within `historyMaxTokens` by countTokens of the joined text.
 * Tail lines are verbatim. A single tail line over a quarter of the budget is
 * cut to that size, so the tail can never use the whole budget. Every line is
 * charged lineCost, so the "\n" joins cannot push the text over the budget.
 */
export function renderSummary(
  state: WindowState,
  limits: WindowLimits,
): string {
  const budget = limits.historyMaxTokens;
  const perLine = Math.floor(budget / 4);
  const tail = state.tail.map((l) => capTokens(l, perLine));
  const tailCost = tail.reduce((sum, l) => sum + lineCost(l), 0);
  const total = state.heads.length + state.headsDropped;
  if (total === 0 && tail.length === 0) return "";

  const freeBudget = budget - tailCost;
  const allFit =
    state.headsDropped === 0 &&
    headsThatFit(state.heads, freeBudget) === state.heads.length;
  if (allFit) {
    return [...state.heads, ...tail].join("\n");
  }

  const marker = (omitted: number) =>
    `[${omitted} earlier lines condensed out]`;
  const reserve = lineCost(marker(total));
  const taken = headsThatFit(state.heads, freeBudget - reserve);
  const shown = state.heads.slice(state.heads.length - taken);
  const omitted = total - taken;
  const lines =
    omitted > 0 ? [marker(omitted), ...shown, ...tail] : [...shown, ...tail];
  return lines.join("\n");
}
