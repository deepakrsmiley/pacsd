import { parseDictation } from "./commands.js";

const BODY_PARTS = [
  ["lumbar spine", /\blumbar spine\b/i],
  ["cervical spine", /\bcervical spine\b/i],
  ["thoracic spine", /\b(?:thoracic|dorsal) spine\b/i],
  ["spine", /\bspine\b/i],
  ["brain", /\bbrain\b/i],
  ["head", /\bhead\b/i],
  ["chest", /\bchest\b/i],
  ["abdomen", /\babdomen\b/i],
  ["breast", /\bbreast\b/i],
  ["pelvis", /\bpelvis\b/i],
  ["knee", /\bknee\b/i],
];

const CLINICAL = /\b(is|are|was|were|shows|show|seen|evidence|normal|abnormal|no|not|without|mild|moderate|severe|measur|there)\b/i;
const GLUE = new Set(["examination", "radiograph", "imaging", "of", "the", "a"]);
const STOP = new Set("a an the of and or to in on for with is are was were be been being it its as at by from this that".split(" "));

export function splitSentences(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  return cleaned.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
}

export function finishSentence(value) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text.replace(/\s+([,.;:?!])/g, "$1");
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.!?]$/.test(text)) text += ".";
  return text;
}

function matchModality(sentence) {
  if (/\b(ct|cat)\b/i.test(sentence)) return "CT";
  if (/\b(mri|mr)\b/i.test(sentence)) return "MRI";
  if (/\b(x-?ray|radiograph)\b/i.test(sentence)) return "X-ray";
  if (/\b(ultrasound|sonogram|usg)\b/i.test(sentence)) return "ultrasound";
  if (/\b(mammogram|mammography)\b/i.test(sentence)) return "mammography";
  return "";
}

function matchContrast(sentence) {
  if (/\b(plain|non[-\s]?contrast|without contrast)\b/i.test(sentence)) return "Non-contrast";
  if (/\b(with contrast|contrast[-\s]?enhanced|post[-\s]?contrast)\b/i.test(sentence)) return "Contrast-enhanced";
  return "";
}

function matchBody(sentence) {
  for (const [label, pattern] of BODY_PARTS) {
    const match = sentence.match(pattern);
    if (match) return match[0].toLowerCase();
  }
  return "";
}

export function isTechniqueOpener(sentence) {
  const words = String(sentence || "").replace(/[.!?]+$/g, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 8) return false;
  if (CLINICAL.test(sentence) || /\d/.test(sentence)) return false;
  return Boolean(matchModality(sentence) || (matchBody(sentence) && matchContrast(sentence)));
}

export function techniqueLine(sentence) {
  if (!isTechniqueOpener(sentence)) return "";
  const modality = matchModality(sentence);
  const contrast = matchContrast(sentence);
  const body = matchBody(sentence);
  if (!modality && !body) return "";
  const prefix = contrast ? `${contrast} ` : "";
  let line = "";
  if (modality === "X-ray") line = `${prefix}${body ? `${body} radiograph` : "radiograph"}`;
  else if (modality === "mammography") line = `${prefix}${body ? `${body} mammogram` : "mammogram"}`;
  else if (modality === "ultrasound") line = `${prefix}ultrasound examination${body ? ` of the ${body}` : ""}`;
  else if (modality) line = `${prefix}${modality} examination${body ? ` of the ${body}` : ""}`;
  else line = `${prefix}examination${body ? ` of the ${body}` : ""}`;
  return finishSentence(line.replace(/\s+/g, " "));
}

function emptySections() {
  return { clinical: [], technique: [], comparison: [], findings: [], impression: [], recommendations: [] };
}

function numbersOf(text) {
  return String(text || "").match(/\d+(?:\.\d+)?/g) || [];
}

export function measurementsOf(text) {
  return [...String(text || "").matchAll(/\b\d+(?:\.\d+)?(?:\s*(?:x|by)\s*\d+(?:\.\d+)?)*\s*(?:mm|cm|ml|cc|hu|%)\b/gi)]
    .map((match) => match[0].replace(/\s+/g, " ").toLowerCase());
}

function countWord(text, word) {
  return (String(text || "").toLowerCase().match(new RegExp(`\\b${word}\\b`, "g")) || []).length;
}

function tokensOf(text) {
  return (String(text || "").toLowerCase().match(/[a-z][a-z'-]*/g) || []);
}

function multisetSubset(needles, hay) {
  const pool = [...hay];
  for (const needle of needles) {
    const index = pool.indexOf(needle);
    if (index < 0) return false;
    pool.splice(index, 1);
  }
  return true;
}

function techniqueAllowed(token, source) {
  if (GLUE.has(token) || STOP.has(token)) return true;
  if (token === "non-contrast" && /\b(plain|non[-\s]?contrast|without contrast)\b/i.test(source)) return true;
  if (token === "contrast-enhanced" && /\b(with contrast|contrast[-\s]?enhanced|post[-\s]?contrast)\b/i.test(source)) return true;
  return tokensOf(source).includes(token);
}

export function preservesClinicalMeaning(source, formatted) {
  const narrative = ["clinical", "comparison", "findings", "impression", "recommendations"]
    .map((key) => formatted[key] || "")
    .join(" ");
  const sourceTokens = new Set(tokensOf(source));
  for (const token of tokensOf(narrative)) {
    if (STOP.has(token)) continue;
    if (!sourceTokens.has(token)) return false;
  }
  if (!multisetSubset(numbersOf(narrative), numbersOf(source))) return false;
  if (!multisetSubset(measurementsOf(narrative), measurementsOf(source))) return false;
  for (const word of ["no", "not", "without", "absent", "left", "right", "bilateral"]) {
    if (countWord(narrative, word) > countWord(source, word)) return false;
  }
  for (const token of tokensOf(formatted.technique || "")) {
    if (!techniqueAllowed(token, source)) return false;
  }
  if (!multisetSubset(numbersOf(formatted.technique || ""), numbersOf(source))) return false;
  return true;
}

function pack(buckets, extra) {
  const formatted = {
    patientInformation: "",
    studyDescription: extra.studyDescription || "",
    clinical: buckets.clinical.join(" "),
    technique: buckets.technique.join(" "),
    comparison: buckets.comparison.join(" "),
    findings: buckets.findings.join(" "),
    impression: buckets.impression.join(" "),
    recommendations: buckets.recommendations.join(" "),
    techniqueSources: extra.techniqueSources,
    impressionDictated: buckets.impression.length > 0,
    impressionCopied: false,
    invented: false,
    fallback: false,
  };
  return formatted;
}

export function formatRadiologyReport(raw, context = {}) {
  const parsed = parseDictation(raw);
  const buckets = emptySections();
  const techniqueSources = [];
  let current = "findings";
  for (const event of parsed.events) {
    if (event.type === "command") {
      if (event.command === "section" && buckets[event.key]) current = event.key;
      continue;
    }
    for (const sentence of splitSentences(event.value)) {
      if (current === "findings") {
        const line = techniqueLine(sentence);
        if (line) {
          buckets.technique.push(line);
          techniqueSources.push(finishSentence(sentence));
          continue;
        }
      }
      buckets[current].push(finishSentence(sentence));
    }
  }
  const formatted = pack(buckets, {
    studyDescription: context.description || "",
    techniqueSources,
  });
  if (!preservesClinicalMeaning(parsed.text, formatted)) {
    return {
      ...pack(emptySections(), { studyDescription: context.description || "", techniqueSources: [] }),
      findings: splitSentences(parsed.text).map(finishSentence).join(" "),
      fallback: true,
      impressionDictated: false,
    };
  }
  return formatted;
}

export function copyFindingsAsImpression(formatted) {
  const findings = String(formatted?.findings || "").trim();
  if (!findings) return formatted;
  return {
    ...formatted,
    impression: findings,
    impressionDictated: false,
    impressionCopied: true,
  };
}
