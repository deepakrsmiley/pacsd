import { providerCapabilities } from "./capabilities.js";

const DRAFT_KEYS = ["clinical", "technique", "comparison", "findings", "impression", "recommendations"];

export function plainText(value, max = 4000) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim()
    .slice(0, max);
}

export function extractJson(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return a JSON object");
  return JSON.parse(raw.slice(start, end + 1));
}

export function normalizeAnalysis(payload, { frame = 0, instanceId = "" } = {}) {
  const capabilities = providerCapabilities();
  const findings = Array.isArray(payload?.findings) ? payload.findings.slice(0, 12).map((item) => {
    const finding = {
      title: plainText(item?.title, 180) || "Review suggested",
      location: plainText(item?.location, 180),
      description: plainText(item?.description, 2000),
      evidence: plainText(item?.evidence, 2000),
      limitations: plainText(item?.limitations, 2000),
      followUp: plainText(item?.followUp, 1000),
      frame,
      instanceId: String(instanceId),
      decision: "pending",
      box: null,
    };
    if (capabilities.tasks.annotations && item?.box) finding.box = item.box;
    return finding;
  }).filter((item) => item.description) : [];
  let status = ["completed", "review_recommended", "insufficient_quality", "unsupported"].includes(payload?.status)
    ? payload.status
    : "review_recommended";
  if (!capabilities.medicalDevice && status === "completed") status = "review_recommended";
  if (!findings.length && status !== "insufficient_quality" && status !== "unsupported") status = "review_recommended";
  return {
    status,
    findings,
    limitations: uniqueLimitations(payload?.limitations, capabilities.limitations),
    draft: normalizeDraft(payload?.draft),
    annotationsSupported: capabilities.tasks.annotations,
    model: capabilities.model,
    provider: capabilities.provider,
  };
}

const SECTION_ALIASES = {
  clinical: ["clinical", "clinicalInformation", "clinical_information", "history"],
  technique: ["technique", "examinationTechnique", "examination_technique"],
  comparison: ["comparison", "comparisons"],
  findings: ["findings", "finding"],
  impression: ["impression", "impressions", "conclusion"],
  recommendations: ["recommendations", "recommendation"],
};

export function normalizeDraft(payload) {
  const source = unwrapDraft(payload);
  return Object.fromEntries(DRAFT_KEYS.map((key) => [key, sectionText(source, key)]));
}

export function mergeDraft(primary, fallback) {
  return Object.fromEntries(DRAFT_KEYS.map((key) => [key, primary?.[key] || fallback?.[key] || ""]));
}

export function draftFromFindings(findings, { modality = "", description = "", clinical = "" } = {}) {
  const kept = (findings || []).filter((item) => item && item.decision !== "rejected" && (item.description || item.title));
  const findingsText = kept.map((item) => [item.title, item.location, item.description].filter(Boolean).join(". ")).join("\n");
  const followUp = kept.map((item) => item.followUp).filter(Boolean).join("\n");
  return {
    clinical: plainText(clinical, 8000),
    technique: plainText([modality, description].filter(Boolean).join(" — "), 8000),
    comparison: "",
    findings: plainText(findingsText, 8000),
    impression: findingsText ? "Review recommended. These suggestions come from the selected image and are not a diagnosis." : "",
    recommendations: plainText(followUp, 8000),
  };
}

function unwrapDraft(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const nested = [payload.draft, payload.report, payload.reportDraft].find((item) => item && typeof item === "object" && !Array.isArray(item));
  return nested ? { ...payload, ...nested } : payload;
}

function sectionText(source, key) {
  for (const alias of SECTION_ALIASES[key]) {
    const text = valueToText(source[alias]);
    if (text) return plainText(text, 8000);
  }
  return "";
}

function valueToText(value, depth = 0) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (depth > 1) return "";
  if (Array.isArray(value)) return value.map((item) => valueToText(item, depth + 1)).filter(Boolean).join("\n");
  if (typeof value === "object") {
    return ["title", "location", "text", "description", "content", "findings", "impression"]
      .map((key) => valueToText(value[key], depth + 1))
      .filter(Boolean)
      .join(". ");
  }
  return "";
}

function uniqueLimitations(extra, required) {
  const values = [...required, ...(Array.isArray(extra) ? extra.map((item) => plainText(item, 500)) : [])];
  return [...new Set(values.filter(Boolean))].slice(0, 12);
}
