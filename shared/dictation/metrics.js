function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9.\s%-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(a, b) {
  const row = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) row[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let previous = i - 1;
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

function includesPhrase(text, phrase) {
  const body = String(phrase).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, "i").test(text);
}

export function wordErrorRate(reference, hypothesis) {
  const ref = tokens(reference);
  const hyp = tokens(hypothesis);
  const distance = editDistance(ref, hyp);
  const wer = ref.length ? distance / ref.length : (hyp.length ? 1 : 0);
  return { wer, distance, referenceWords: ref.length, hypothesisWords: hyp.length };
}

export function medicalTermAccuracy(reference, hypothesis, vocabulary = []) {
  const expected = vocabulary.filter((entry) => {
    const forms = [entry.term, ...(entry.spoken || [])];
    return forms.some((form) => form && includesPhrase(reference, form));
  });
  if (!expected.length) return { accuracy: 1, expected: 0, matched: 0, missed: [] };
  const missed = expected.filter((entry) => {
    const forms = [entry.term, ...(entry.spoken || [])];
    return !forms.some((form) => form && includesPhrase(hypothesis, form));
  });
  const matched = expected.length - missed.length;
  return { accuracy: matched / expected.length, expected: expected.length, matched, missed: missed.map((entry) => entry.term) };
}

function negationTargets(text) {
  const targets = [];
  const pattern = /\b(?:no evidence of|no|without|negative for|free of|absent)\s+([a-z][a-z\s-]{0,48}?)(?=[.,;]|$)/gi;
  for (const match of String(text || "").matchAll(pattern)) {
    const target = match[1].replace(/\b(of|the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
    if (target) targets.push(target);
  }
  return targets;
}

export function negationAccuracy(reference, hypothesis) {
  const expected = negationTargets(reference);
  if (!expected.length) return { accuracy: 1, expected: 0, preserved: 0, missed: [] };
  const hyp = String(hypothesis || "").toLowerCase();
  const missed = expected.filter((target) => {
    const index = hyp.indexOf(target.toLowerCase());
    if (index < 0) return true;
    const before = hyp.slice(Math.max(0, index - 40), index);
    return !/\b(no evidence of|no|not|without|absent|negative for|free of)\b/.test(before);
  });
  return {
    accuracy: (expected.length - missed.length) / expected.length,
    expected: expected.length,
    preserved: expected.length - missed.length,
    missed,
  };
}

export function lateralitySequence(text) {
  return [...String(text || "").toLowerCase().matchAll(/\b(left|right|bilateral)\b/g)].map((match) => match[1]);
}

export function lateralityAccuracy(reference, hypothesis) {
  const expected = lateralitySequence(reference);
  const actual = lateralitySequence(hypothesis);
  if (!expected.length) return { accuracy: actual.length ? 0 : 1, expected, actual };
  let correct = 0;
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] === actual[index]) correct += 1;
  }
  return { accuracy: correct / expected.length, expected, actual };
}

export function measurementAccuracy(reference, hypothesis) {
  const measure = (text) => [...String(text || "").matchAll(/\b\d+(?:\.\d+)?(?:\s*(?:x|by)\s*\d+(?:\.\d+)?)*\s*(?:mm|cm|ml|cc|hu|%)\b/gi)]
    .map((match) => match[0].replace(/\s+/g, " ").toLowerCase());
  const expected = measure(reference);
  const actual = measure(hypothesis);
  if (!expected.length) return { accuracy: actual.length ? 0 : 1, expected, actual, missed: [] };
  const pool = [...actual];
  const missed = [];
  for (const item of expected) {
    const index = pool.indexOf(item);
    if (index < 0) missed.push(item);
    else pool.splice(index, 1);
  }
  return { accuracy: (expected.length - missed.length) / expected.length, expected, actual, missed };
}

export function scoreDictation(reference, hypothesis, vocabulary = []) {
  return {
    wordErrorRate: wordErrorRate(reference, hypothesis),
    medicalTermAccuracy: medicalTermAccuracy(reference, hypothesis, vocabulary),
    negationAccuracy: negationAccuracy(reference, hypothesis),
    lateralityAccuracy: lateralityAccuracy(reference, hypothesis),
    measurementAccuracy: measurementAccuracy(reference, hypothesis),
  };
}
