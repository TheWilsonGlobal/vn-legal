// ============================================================================
// Recall-intent detection (plan §5.5) and recall-key classification (§5.2).
//
// Matching uses Unicode letter boundaries (\p{L}), not \b: \b is ASCII-only,
// so it would split Vietnamese words at their diacritics. Input is NFC-normalised
// before matching; the `i` flag handles case.
//
// Bare "trước" is deliberately NOT a trigger: "thông báo trước khi chấm dứt
// hợp đồng" is an ordinary legal question (nexus planner.py:19-20 makes the
// same choice). "trước đó" triggers only at the end of a message, and only with
// a recall verb (hỏi, nói, nhắc, đề cập) or `bạn` in the message. A first-person
// pronoun alone is not enough: "Tôi đã báo cho công ty 30 ngày trước đó." is a
// legal sentence and does not route to recall (RX-02).
//
// First-question phrasing ("câu đầu", "câu hỏi đầu tiên") triggers only with a
// first-person marker. "Câu đầu tiên của khoản 2 Điều 5" is a legal reference.
//
// A recall key is the argument the model chose, so a bare "câu đầu tiên" or
// "câu hỏi đầu" is accepted as a first-question key without a marker (RX-03).
// Every conversation-referring phrase the detector accepts also classifies as a
// recent key, so a conversation key never falls through to topical scoring.
// ============================================================================

const B = String.raw`(?<!\p{L})`;
const E = String.raw`(?!\p{L})`;

/** First-person subject. */
const ME = String.raw`(?:tôi|mình|em|chúng\s+tôi|chúng\s+mình)`;

function alternatives(words: readonly string[]): string {
  return words.map((w) => w.replace(/ /g, String.raw`\s+`)).join("|");
}

/** Vietnamese conversation phrases that need no further context. */
const VI_CONVERSATION = [
  String.raw`${ME}\s+(?:đã|vừa)\s+(?:hỏi|nói|nhắc|đề\s+cập)`,
  alternatives(["lúc nãy", "vừa rồi", "lần trước", "nhắc lại", "vừa hỏi"]),
];

/** English conversation phrases: nexus planner.py:22-24, plus "earlier" and "I asked" forms. */
const EN_CONVERSATION = [
  String.raw`do you (?:still )?(?:remember|recall)`,
  String.raw`(?:remember|recall) (?:what|when|who|that|my|our|me)`,
  String.raw`last time`,
  String.raw`did i (?:ask|say|mention|tell)`,
  String.raw`(?:did|have) (?:i|we) (?:ask|say|mention|tell you|talk about|discuss)`,
  String.raw`(?:i|we) (?:asked|said|mentioned|told you|talked about|discussed)`,
  String.raw`you (?:said|told me|mentioned)`,
];

/** "câu đầu" and "câu hỏi đầu", with an optional "tiên". "câu hỏi đầu tư" is a different word. */
const FIRST_NOUN = String.raw`câu\s+(?:hỏi\s+)?đầu`;
const FIRST_FULL = String.raw`${FIRST_NOUN}\s+tiên`;

/** First-question phrasing, accepted only with a first-person marker. */
const VI_FIRST_MARKED = [
  String.raw`${FIRST_NOUN}(?:\s+tiên)?\s+(?:của\s+)?${ME}`,
  String.raw`${ME}\s+(?:đã\s+|vừa\s+)?hỏi\s+${FIRST_FULL}`,
  String.raw`${FIRST_FULL}\s+${ME}\s+(?:đã\s+|vừa\s+)?hỏi`,
];

const INTENT_RE = new RegExp(
  `${B}(?:${[
    ...VI_CONVERSATION,
    ...EN_CONVERSATION,
    ...VI_FIRST_MARKED,
    String.raw`first\s+question`,
  ].join("|")})${E}`,
  "iu",
);

/**
 * A recall verb or `bạn` somewhere in the message. A first-person pronoun is not
 * enough: "Tôi đã báo cho công ty 30 ngày trước đó." has none of these.
 */
const CONVERSATION_CONTEXT = String.raw`${B}(?:bạn|hỏi|nói|nhắc|đề\s+cập)${E}`;

/** "trước đó" ends the message, and the message has conversational context ("... trước đó?"). */
const TRUOC_DO_END_RE = new RegExp(
  String.raw`^(?=[\s\S]*${CONVERSATION_CONTEXT})[\s\S]*${B}trước\s+đó\s*[?!.…]*\s*$`,
  "iu",
);

/** Keys that name the first question with a first-person marker, or the full phrase. */
const FIRST_KEY_RE = new RegExp(
  `${B}(?:${[
    String.raw`câu\s+hỏi\s+đầu\s+tiên`,
    String.raw`${FIRST_NOUN}(?:\s+tiên)?\s+(?:của\s+)?${ME}`,
    String.raw`${ME}\s+(?:đã\s+|vừa\s+)?hỏi\s+${FIRST_FULL}`,
    String.raw`first\s+question`,
    String.raw`first\s+thing`,
  ].join("|")})${E}`,
  "iu",
);

/**
 * A key that is only the bare phrase, with nothing around it (RX-03). Anchored at
 * both ends, so "Câu đầu tiên của khoản 2 Điều 5" stays a topical key.
 */
const BARE_FIRST_KEY_RE = new RegExp(
  String.raw`^\s*(?:câu\s+đầu\s+tiên|câu\s+hỏi\s+đầu)\s*[?!.…]*\s*$`,
  "iu",
);

function isFirstKeyText(s: string): boolean {
  return FIRST_KEY_RE.test(s) || BARE_FIRST_KEY_RE.test(s);
}

/** Keys that name the recent turns: the latest queries, newest first. */
const RECENT_KEY_RE = new RegExp(
  `${B}(?:${[
    String.raw`(?:đã|vừa)\s+(?:hỏi|nói|nhắc|đề\s+cập)`,
    alternatives([
      "lúc nãy",
      "vừa rồi",
      "lần trước",
      "nhắc lại",
      "vừa hỏi",
      "trước đó",
    ]),
    "earlier",
    ...EN_CONVERSATION,
  ].join("|")})${E}`,
  "iu",
);

function nfc(text: string): string {
  return text.normalize("NFC");
}

/** True when the user's message refers to the conversation itself (route `recall`). */
export function detectRecallIntent(text: string): boolean {
  const s = nfc(text);
  return INTENT_RE.test(s) || TRUOC_DO_END_RE.test(s);
}

/** True when a recall key asks for the latest queries. First-question keys are excluded. */
export function isRecentKey(key: string): boolean {
  const s = nfc(key);
  return !isFirstKeyText(s) && RECENT_KEY_RE.test(s);
}

/** True when a recall key asks for the earliest queries. */
export function isFirstKey(key: string): boolean {
  return isFirstKeyText(nfc(key));
}
