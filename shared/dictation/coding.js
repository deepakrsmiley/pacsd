/**
 * Optional coding hints. ICD-10-CM entries below are a small public-domain
 * subset (CDC/CMS), not the WHO ICD-10 book and not a licensed SNOMED map.
 * A suggestion is never a diagnosis and is never saved unless a radiologist
 * approves it. Negated phrases produce no code.
 */

const NEGATION_BEFORE = /\b(no|not|without|absent|negative for|denies|free of|ruled out|no evidence of|no evidence)\b/i;
const NEGATION_AFTER = /\b(absent|not seen|not identified|is not|are not)\b/i;

export const CODING_RULES = [
  { phrases: ["pleural effusion"], system: "ICD-10-CM", code: "J90", description: "Pleural effusion, not elsewhere classified", confidence: 0.72 },
  { phrases: ["pneumothorax"], system: "ICD-10-CM", code: "J93.9", description: "Pneumothorax, unspecified", confidence: 0.7 },
  { phrases: ["cardiomegaly"], system: "ICD-10-CM", code: "I51.7", description: "Cardiomegaly", confidence: 0.74 },
  { phrases: ["pneumonia"], system: "ICD-10-CM", code: "J18.9", description: "Pneumonia, unspecified organism", confidence: 0.66 },
  { phrases: ["atelectasis"], system: "ICD-10-CM", code: "J98.11", description: "Atelectasis", confidence: 0.66 },
  { phrases: ["cerebral infarction", "brain infarct"], system: "ICD-10-CM", code: "I63.9", description: "Cerebral infarction, unspecified", confidence: 0.62, caveat: "Confirm the vascular territory before use." },
  { phrases: ["fatty liver", "hepatic steatosis"], system: "ICD-10-CM", code: "K76.0", description: "Fatty (change of) liver, not elsewhere classified", confidence: 0.64 },
  { phrases: ["renal calculus", "kidney stone", "calculus of the kidney"], system: "ICD-10-CM", code: "N20.0", description: "Calculus of kidney", confidence: 0.68 },
  { phrases: ["hydronephrosis"], system: "ICD-10-CM", code: "N13.30", description: "Unspecified hydronephrosis", confidence: 0.5, caveat: "Confirm laterality and cause before use." },
  { phrases: ["disc bulge", "disc protrusion", "disc extrusion", "disc herniation", "herniated disc"], system: "ICD-10-CM", code: "M51.26", description: "Other intervertebral disc displacement, lumbar region", confidence: 0.58, region: /\blumbar\b/i, caveat: "Suggested only when lumbar is explicit in the impression or the study description." },
  { phrases: ["disc bulge", "disc protrusion", "disc extrusion", "disc herniation", "herniated disc"], system: "ICD-10-CM", code: "M50.20", description: "Other cervical disc displacement, unspecified cervical region", confidence: 0.55, region: /\bcervical\b/i, caveat: "Suggested only when cervical is explicit in the impression or the study description." },
  { phrases: ["spinal stenosis", "canal stenosis"], system: "ICD-10-CM", code: "M48.06", description: "Spinal stenosis, lumbar region", confidence: 0.58, region: /\blumbar\b/i },
  { phrases: ["spinal stenosis", "canal stenosis"], system: "ICD-10-CM", code: "M48.02", description: "Spinal stenosis, cervical region", confidence: 0.55, region: /\bcervical\b/i },
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findPhrase(text, phrase) {
  const body = escapeRegExp(phrase).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "i").exec(text);
}

export function isNegated(text, start, end) {
  const before = String(text || "").slice(Math.max(0, start - 48), start);
  const after = String(text || "").slice(end, end + 28);
  return NEGATION_BEFORE.test(before) || NEGATION_AFTER.test(after);
}

function regionText(impression, context) {
  return `${impression} ${context?.description || ""} ${context?.bodyPart || ""} ${context?.label || ""}`;
}

export function suggestCodes({ impression = "", context = {}, vocabulary = [] } = {}) {
  const text = String(impression || "").replace(/\s+/g, " ").trim();
  const suggestions = [];
  if (!text) {
    return { suggestions, requiresApproval: true, automaticAssignment: false, note: "Dictate or approve an impression before requesting codes." };
  }
  for (const rule of CODING_RULES) {
    if (rule.region && !rule.region.test(regionText(text, context))) continue;
    const match = rule.phrases.map((phrase) => findPhrase(text, phrase)).find(Boolean);
    if (!match || isNegated(text, match.index, match.index + match[0].length)) continue;
    suggestions.push({
      system: rule.system,
      code: rule.code,
      description: rule.description,
      confidence: rule.confidence,
      sourceText: match[0],
      caveat: rule.caveat || "",
      manual: false,
      approved: false,
    });
  }
  for (const entry of vocabulary) {
    const system = String(entry.codeSystem || "");
    if (!entry.code || !/snomed/i.test(system)) continue;
    const match = findPhrase(text, entry.term);
    if (!match || isNegated(text, match.index, match.index + match[0].length)) continue;
    suggestions.push({
      system: "SNOMED-CT",
      code: entry.code,
      description: entry.term,
      confidence: 0.6,
      sourceText: match[0],
      caveat: "Code imported by the facility from a licensed SNOMED CT source.",
      manual: false,
      approved: false,
    });
  }
  const seen = new Set();
  const unique = suggestions.filter((item) => {
    const key = `${item.system}:${item.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    suggestions: unique,
    requiresApproval: true,
    automaticAssignment: false,
    note: "These are optional hints from the approved impression. They are not a diagnosis or a billing decision until an authorized user selects and approves them.",
  };
}
