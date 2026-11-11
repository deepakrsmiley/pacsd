import { termsForContext, imagingContext } from "./context.js";

export function normalizeTerm(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function termKey(value) {
  return normalizeTerm(value).toLowerCase();
}

export function mergeVocabulary(extra = []) {
  const map = new Map();
  for (const item of termsForContext("", [])) {
    map.set(termKey(item.term), { ...item, spoken: [...(item.spoken || [])], managed: false, source: "curated" });
  }
  for (const item of extra) {
    if (!item?.term || item.active === false) continue;
    const key = termKey(item.term);
    const current = map.get(key);
    const spoken = [...new Set([...(current?.spoken || []), ...(item.spoken || [])].map((entry) => normalizeTerm(entry)).filter(Boolean))];
    map.set(key, {
      ...(current || {}),
      ...item,
      term: normalizeTerm(item.term),
      spoken,
      source: item.source || "custom",
      managed: Boolean(item._id || item.managed),
      active: item.active !== false,
    });
  }
  return [...map.values()];
}

export function searchVocabulary(query, options = {}) {
  const context = options.context || imagingContext(options).key;
  const limit = Math.min(Math.max(Number(options.limit) || 80, 1), 200);
  const category = String(options.category || "").trim();
  const q = termKey(query);
  let rows = mergeVocabulary(options.extraTerms || options.vocabulary || []);
  if (category) rows = rows.filter((item) => item.category === category);
  if (q) {
    rows = rows.filter((item) => {
      const hay = [item.term, item.abbreviation, ...(item.spoken || [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  } else if (context && context !== "general") {
    const preferred = rows.filter((item) => (item.contexts || []).includes(context));
    rows = preferred.length ? preferred : rows;
  }
  rows.sort((a, b) => {
    const ar = (a.contexts || []).includes(context) ? 0 : 1;
    const br = (b.contexts || []).includes(context) ? 0 : 1;
    if (ar !== br) return ar - br;
    return a.term.localeCompare(b.term);
  });
  return rows.slice(0, limit);
}

export function promptTerms(input, extra = [], limit = 32) {
  const context = imagingContext(input);
  return searchVocabulary("", { context: context.key, extraTerms: extra, limit }).map((item) => item.term);
}
