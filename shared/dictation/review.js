import { measurementsOf } from "./format.js";

const VERIFY_GROUPS = [
  ["effusion", "infusion"],
  ["hypodense", "hyperdense"],
  ["hypointense", "hyperintense"],
  ["hypoechoic", "hyperechoic"],
  ["lesion-free", "lesion"],
  ["present", "absent"],
  ["increased", "decreased"],
];

const NEGATION = /\b(no|not|without|absent|negative|denies|free of|no evidence of)\b/gi;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function includesPhrase(text, phrase) {
  const body = escapeRegExp(phrase).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "i").test(text);
}

function phraseAt(text, phrase) {
  const body = escapeRegExp(phrase).replace(/\s+/g, "\\s+");
  const match = new RegExp(`(?<![A-Za-z0-9])(${body})(?![A-Za-z0-9])`, "i").exec(text);
  return match ? { index: match.index, value: match[1] } : null;
}

function levenshtein(a, b) {
  const row = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) row[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + cost);
      previous = current;
    }
  }
  return row[b.length];
}

function unique(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function preservedSignals(text) {
  const source = String(text || "");
  return {
    negations: [...source.matchAll(NEGATION)].map((match) => match[1].toLowerCase()),
    laterality: [...source.matchAll(/\b(left|right|bilateral)\b/gi)].map((match) => match[1].toLowerCase()),
    measurements: measurementsOf(source),
  };
}

export function reviewTranscript(text, vocabulary = []) {
  const source = String(text || "");
  const lower = source.toLowerCase();
  const verify = [];
  const consumed = [];
  const groups = [...VERIFY_GROUPS].sort((a, b) => b[0].length - a[0].length);
  for (const group of groups) {
    for (const word of group) {
      const found = phraseAt(source, word);
      if (!found) continue;
      if (consumed.some((range) => found.index >= range.start && found.index < range.end)) continue;
      consumed.push({ start: found.index, end: found.index + found.value.length });
      verify.push({
        term: found.value,
        alternatives: group.filter((item) => item !== word),
        reason: "Similar wording can change the finding. The transcript was not changed.",
        index: found.index,
      });
    }
  }

  const suggestions = [];
  for (const entry of vocabulary) {
    if (!entry?.term || entry.ambiguous) continue;
    for (const spoken of entry.spoken || []) {
      if (!spoken || spoken.toLowerCase() === entry.term.toLowerCase()) continue;
      if (spoken.length > entry.term.length + 2) continue;
      const found = phraseAt(source, spoken);
      if (!found) continue;
      if (found.value.toLowerCase() === entry.term.toLowerCase()) continue;
      const around = source.slice(Math.max(0, found.index - entry.term.length), found.index + found.value.length + entry.term.length);
      if (includesPhrase(around, entry.term)) continue;
      suggestions.push({
        from: found.value,
        to: entry.term,
        reason: "Matches a spoken alternative in the medical vocabulary. Not applied.",
        kind: "spoken",
        index: found.index,
      });
    }
  }

  const known = new Set();
  for (const entry of vocabulary) {
    known.add(String(entry.term || "").toLowerCase());
    for (const spoken of entry.spoken || []) known.add(String(spoken).toLowerCase());
  }
  const single = vocabulary
    .map((entry) => String(entry.term || "").toLowerCase())
    .filter((entry) => entry && !entry.includes(" ") && !entry.includes("-"));
  const words = [...source.matchAll(/\b[a-z][a-z'-]{5,}\b/gi)];
  for (const match of words) {
    const token = match[0].toLowerCase();
    if (known.has(token)) continue;
    if (VERIFY_GROUPS.some((group) => group.includes(token))) continue;
    let best = "";
    let bestDistance = 2;
    for (const candidate of single) {
      if (candidate[0] !== token[0] || Math.abs(candidate.length - token.length) > 1) continue;
      const distance = levenshtein(token, candidate);
      if (distance === 1 && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best) {
      suggestions.push({
        from: match[0],
        to: best,
        reason: "Close to a vocabulary term. Not applied, because the intended word is uncertain.",
        kind: "spelling",
        index: match.index,
      });
    }
  }

  return {
    originalText: source,
    text: source,
    replaced: false,
    verify: unique(verify, (item) => `${item.index}:${item.term.toLowerCase()}`),
    suggestions: unique(suggestions, (item) => `${item.index}:${item.from.toLowerCase()}:${item.to.toLowerCase()}`).slice(0, 8),
    preserved: preservedSignals(source),
    recognized: vocabulary
      .filter((entry) => entry?.term && !entry.ambiguous && includesPhrase(lower, entry.term))
      .slice(0, 24)
      .map((entry) => entry.term),
  };
}

export function decorateTranscript(text, review = {}) {
  const source = String(text || "");
  const marks = [];
  for (const item of review.verify || []) marks.push({ start: item.index, end: item.index + item.term.length, mark: "verify" });
  for (const item of review.preserved?.measurements || []) {
    const found = phraseAt(source, item);
    if (found) marks.push({ start: found.index, end: found.index + found.value.length, mark: "measure" });
  }
  for (const term of review.recognized || []) {
    const found = phraseAt(source, term);
    if (found) marks.push({ start: found.index, end: found.index + found.value.length, mark: "term" });
  }
  marks.sort((a, b) => a.start - b.start || b.end - a.end);
  const pieces = [];
  let cursor = 0;
  const used = [];
  for (const mark of marks) {
    if (mark.start < cursor) continue;
    if (used.some((range) => mark.start < range.end && mark.end > range.start)) continue;
    if (mark.start > cursor) pieces.push({ text: source.slice(cursor, mark.start), mark: "plain" });
    pieces.push({ text: source.slice(mark.start, mark.end), mark: mark.mark });
    used.push(mark);
    cursor = mark.end;
  }
  if (cursor < source.length) pieces.push({ text: source.slice(cursor), mark: "plain" });
  return pieces.filter((piece) => piece.text);
}
