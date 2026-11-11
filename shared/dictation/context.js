import { CURATED_TERMS } from "./terms.js";

export const CONTEXT_PROFILES = {
  "ct-brain": { label: "CT brain", modality: "CT", bodyPart: "brain" },
  "mri-brain": { label: "MRI brain", modality: "MR", bodyPart: "brain" },
  "mri-spine": { label: "MRI spine", modality: "MR", bodyPart: "spine" },
  "mri-lumbar": { label: "MRI lumbar spine", modality: "MR", bodyPart: "lumbar spine" },
  "mri-cervical": { label: "MRI cervical spine", modality: "MR", bodyPart: "cervical spine" },
  "chest-xray": { label: "Chest X-ray", modality: "DX", bodyPart: "chest" },
  "us-abdomen": { label: "Ultrasound abdomen", modality: "US", bodyPart: "abdomen" },
  mammography: { label: "Mammography", modality: "MG", bodyPart: "breast" },
  general: { label: "General radiology", modality: "", bodyPart: "" },
};

const MR = new Set(["MR", "MRI"]);
const XR = new Set(["CR", "DX", "XR", "RG"]);

function blob({ modality = "", description = "", bodyPart = "" } = {}) {
  return `${modality} ${description} ${bodyPart}`.toLowerCase();
}

function mentions(text, pattern) {
  return pattern.test(text);
}

export function imagingContext(input = {}) {
  const code = String(input.modality || "").trim().toUpperCase();
  const text = blob(input);
  const brain = mentions(text, /\b(brain|head|cerebral)\b/);
  const lumbar = mentions(text, /\blumbar\b/);
  const cervical = mentions(text, /\bcervical\b/);
  const spine = mentions(text, /\b(spine|lumbar|cervical|dorsal|thoracic)\b/);
  const chest = mentions(text, /\b(chest|thorax|cxr|lung)\b/);
  const abdomen = mentions(text, /\b(abdomen|abdominal)\b/);
  const breast = mentions(text, /\b(breast|mammogra)\b/);
  const mr = MR.has(code) || mentions(text, /\bmri\b/);
  const ct = code === "CT" || (mentions(text, /\bct\b/) && !mr);
  const us = code === "US" || mentions(text, /\b(ultrasound|sonogram|usg)\b/);
  const mg = code === "MG" || mentions(text, /\bmammogra/);
  const xr = XR.has(code) || mentions(text, /\b(x-?ray|radiograph)\b/);

  let key = "general";
  if (mg || (breast && !ct && !mr && !us)) key = "mammography";
  else if (us && abdomen) key = "us-abdomen";
  else if (mr && lumbar) key = "mri-lumbar";
  else if (mr && cervical) key = "mri-cervical";
  else if (mr && spine) key = "mri-spine";
  else if (mr && brain) key = "mri-brain";
  else if (ct && brain) key = "ct-brain";
  else if ((xr || code === "CT") && chest && !mr && !us) key = "chest-xray";
  else if (xr && chest) key = "chest-xray";

  const profile = CONTEXT_PROFILES[key] || CONTEXT_PROFILES.general;
  return {
    key,
    label: profile.label,
    modality: code,
    bodyPart: profile.bodyPart,
    description: String(input.description || "").trim(),
  };
}

export function termsForContext(key, extra = []) {
  const wanted = key && key !== "general" ? key : "";
  const rows = [...CURATED_TERMS, ...extra].filter((item) => item && item.active !== false && item.term);
  if (!wanted) return rows;
  const preferred = rows.filter((item) => (item.contexts || []).includes(wanted));
  const rest = rows.filter((item) => !(item.contexts || []).includes(wanted));
  return [...preferred, ...rest];
}
