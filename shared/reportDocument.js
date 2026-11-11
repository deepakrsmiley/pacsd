// Report document model shared by the editor (browser) and the exporters (Node).
// Documents are Tiptap/ProseMirror JSON. Nothing here touches the DOM.

export const DOC_FORMAT = "tiptap-json-v1";

export const SECTION_DEFS = [
  { key: "clinical", label: "CLINICAL HISTORY", prompt: "Type the clinical history and indication…" },
  { key: "technique", label: "TECHNIQUE", prompt: "Type the examination technique…" },
  { key: "comparison", label: "COMPARISON", prompt: "Type comparison studies, or state that none are available…" },
  { key: "findings", label: "FINDINGS", prompt: "Type the findings…" },
  { key: "impression", label: "IMPRESSION", prompt: "Type the impression…" },
  { key: "recommendations", label: "RECOMMENDATION", prompt: "Type recommendations, if any…" },
];

export const SECTION_KEYS = SECTION_DEFS.map((item) => item.key);

export const FIELD_DEFS = [
  { key: "patientName", label: "Patient Name" },
  { key: "patientId", label: "Patient ID" },
  { key: "ageGender", label: "Age / Gender" },
  { key: "birthDate", label: "Date of Birth" },
  { key: "accession", label: "Accession Number" },
  { key: "studyDate", label: "Study Date" },
  { key: "modality", label: "Modality" },
  { key: "studyDescription", label: "Study Description" },
  { key: "facilityName", label: "Facility" },
  { key: "radiologistName", label: "Reporting Radiologist" },
  { key: "radiologistQualifications", label: "Qualifications" },
  { key: "radiologistRegistration", label: "Registration Number" },
  { key: "signature", label: "Signature" },
  { key: "reportDateTime", label: "Report Date and Time" },
  { key: "reportStatus", label: "Report Status" },
];

export const PAGE_SIZES = {
  A4: { label: "A4", width: 210, height: 297 },
  Letter: { label: "Letter", width: 215.9, height: 279.4 },
  Legal: { label: "Legal", width: 215.9, height: 355.6 },
  A5: { label: "A5", width: 148, height: 210 },
};

export const MARGIN_PRESETS = {
  report: { label: "Report (default)", top: 32, right: 20, bottom: 25, left: 20 },
  normal: { label: "Normal", top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  narrow: { label: "Narrow", top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
  moderate: { label: "Moderate", top: 25.4, right: 19.05, bottom: 25.4, left: 19.05 },
  wide: { label: "Wide", top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 },
};

export const DISCLAIMER_SHORT = "Generated with PACSD. Not a certified diagnostic device. A qualified radiologist must review the study before clinical use.";

export const DEFAULT_FONT = { family: "Calibri", size: 11, lineHeight: 1.15, spaceAfter: 6 };

// Block styles in points. The editor stylesheet (report-editor/editor.css) mirrors these.
export const TEXT_STYLES = {
  paragraph: { fontSize: 11, spaceBefore: 0, spaceAfter: 6 },
  listParagraph: { spaceAfter: 2 },
  cellParagraph: { spaceAfter: 0 },
  heading1: { fontSize: 16, bold: true, color: "#1f3a5f", spaceBefore: 0, spaceAfter: 10 },
  heading2: { fontSize: 11.5, bold: true, color: "#1f3a5f", spaceBefore: 12, spaceAfter: 4 },
  heading3: { fontSize: 11, bold: true, color: "#334155", spaceBefore: 8, spaceAfter: 3 },
  headerFooter: { fontSize: 8.5, color: "#334155", noteSize: 7, noteColor: "#64748b" },
  tableBorder: "#94a3b8",
  tableHeaderFill: "#eef2f7",
  link: "#1d4ed8",
  logoHeightMm: 13,
};

export const MM_TO_PT = 72 / 25.4;
export const PX_TO_PT = 0.75;

export function parseFontSize(value) {
  const match = String(value || "").match(/^([\d.]+)\s*(pt|px)?$/);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) return null;
  return match[2] === "px" ? number * PX_TO_PT : number;
}

export function defaultLayout() {
  return {
    pageSize: "A4",
    orientation: "portrait",
    margins: { ...MARGIN_PRESETS.report },
    headerDistance: 10,
    footerDistance: 8,
    pageGap: 24,
    border: { style: "none", color: "#1f3a5f" },
    header: { showLogo: true, left: "", center: "", right: "{FACILITY}\nDepartment of Radiology" },
    footer: {
      left: "{PATIENT} | ID {PATIENT_ID} | Acc {ACCESSION}",
      center: "",
      right: "Page {PAGE} of {PAGES}",
      note: DISCLAIMER_SHORT,
    },
  };
}

export function normalizeLayout(layout) {
  const base = defaultLayout();
  const value = layout && typeof layout === "object" ? layout : {};
  const margins = { ...base.margins, ...(value.margins || {}) };
  for (const side of ["top", "right", "bottom", "left"]) {
    margins[side] = clampNumber(margins[side], 5, 80, base.margins[side]);
  }
  return {
    ...base,
    ...value,
    pageSize: PAGE_SIZES[value.pageSize] ? value.pageSize : base.pageSize,
    orientation: value.orientation === "landscape" ? "landscape" : "portrait",
    margins,
    headerDistance: clampNumber(value.headerDistance, 0, 60, base.headerDistance),
    footerDistance: clampNumber(value.footerDistance, 0, 60, base.footerDistance),
    pageGap: clampNumber(value.pageGap, 0, 96, base.pageGap),
    border: { ...base.border, ...(value.border || {}) },
    header: { ...base.header, ...(value.header || {}) },
    footer: { ...base.footer, ...(value.footer || {}) },
  };
}

// Page dimensions in millimetres after orientation is applied.
export function pageDimensions(layout) {
  const normalized = normalizeLayout(layout);
  const size = PAGE_SIZES[normalized.pageSize];
  return normalized.orientation === "landscape"
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

// ---------- document builders ----------

export function text(value, marks) {
  const node = { type: "text", text: String(value) };
  if (marks?.length) node.marks = marks;
  return node;
}

export function paragraph(content = [], attrs) {
  const node = { type: "paragraph" };
  if (attrs) node.attrs = attrs;
  const items = (Array.isArray(content) ? content : [content]).filter(Boolean).map((item) => (typeof item === "string" ? text(item) : item));
  if (items.length) node.content = items;
  return node;
}

export function field(key) {
  return { type: "dataField", attrs: { key } };
}

export function sectionHeading(key, label) {
  const def = SECTION_DEFS.find((item) => item.key === key);
  return {
    type: "heading",
    attrs: { level: 2, sectionKey: key },
    content: [text(`${label || def?.label || key.toUpperCase()}:`)],
  };
}

function labelled(label, rest = []) {
  return paragraph([text(`${label}: `, [{ type: "bold" }]), ...rest]);
}

function cell(content, attrs = {}, header = false) {
  return {
    type: header ? "tableHeader" : "tableCell",
    attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
    content: [paragraph(content)],
  };
}

export function patientInfoTable() {
  const label = (value) => cell([text(value, [{ type: "bold" }])], { backgroundColor: "#eef2f7" });
  const value = (content) => cell(content);
  return {
    type: "table",
    content: [
      { type: "tableRow", content: [label("Patient Name"), value([field("patientName")]), label("Patient ID"), value([field("patientId")])] },
      { type: "tableRow", content: [label("Age / Gender"), value([field("ageGender")]), label("Accession Number"), value([field("accession")])] },
      { type: "tableRow", content: [label("Referring Doctor"), value([]), label("Study Date"), value([field("studyDate")])] },
      { type: "tableRow", content: [label("Modality"), value([field("modality")]), label("Study Description"), value([field("studyDescription")])] },
    ],
  };
}

export function radiologistBlock() {
  return [
    sectionHeading("radiologist", "RADIOLOGIST DETAILS"),
    labelled("Reporting Radiologist", [field("radiologistName")]),
    labelled("Qualifications", [field("radiologistQualifications")]),
    labelled("Registration Number", [field("radiologistRegistration")]),
    labelled("Signature", [field("signature")]),
    labelled("Report Date and Time", [field("reportDateTime")]),
  ];
}

function linesToParagraphs(lines) {
  if (!lines || !lines.length) return [paragraph()];
  return lines.map((line) => {
    if (line && typeof line === "object") return line;
    const value = String(line);
    const match = value.match(/^([^:]{2,60}):\s*$/);
    if (match) return labelled(match[1]);
    return paragraph(value ? [value] : []);
  });
}

// Builds the standard PACSD radiology report. `sections` maps a section key to an
// array of lines. A line ending in ":" becomes a bold label that the radiologist completes.
export function buildReportDoc({ title = "RADIOLOGY REPORT", subtitle = "", sections = {}, includePatientInfo = true, includeRadiologist = true } = {}) {
  const content = [
    { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [text(title)] },
  ];
  if (subtitle) content.push(paragraph([text(subtitle, [{ type: "italic" }])], { textAlign: "center" }));
  if (includePatientInfo) {
    content.push(sectionHeading("patientInfo", "PATIENT INFORMATION"));
    content.push(patientInfoTable());
    content.push({ type: "heading", attrs: { level: 2, sectionKey: "reportContent" }, content: [text("REPORT CONTENT")] });
  }
  for (const def of SECTION_DEFS) {
    content.push(sectionHeading(def.key));
    content.push(...linesToParagraphs(sections[def.key]));
  }
  if (includeRadiologist) content.push(...radiologistBlock());
  return { type: "doc", content };
}

export function emptyDoc() {
  return { type: "doc", content: [paragraph()] };
}

// ---------- built-in templates ----------

export const BUILTIN_TEMPLATES = [
  {
    name: "CT Brain",
    modality: "CT",
    keywords: ["brain", "head", "cranial", "skull"],
    sections: {
      technique: ["Non-contrast axial CT images of the brain were acquired from the skull base to the vertex. Contrast:"],
      findings: ["Brain parenchyma:", "Grey-white matter differentiation:", "Ventricles and sulci:", "Extra-axial spaces:", "Midline structures:", "Posterior fossa:", "Calvarium and skull base:", "Visualised paranasal sinuses and mastoids:"],
    },
  },
  {
    name: "CT Chest",
    modality: "CT",
    keywords: ["chest", "thorax", "lung", "pulmonary", "hrct"],
    sections: {
      technique: ["Axial CT images of the chest were acquired. Contrast:", "Reconstructions:"],
      findings: ["Lungs and airways:", "Pleura:", "Mediastinum and hila:", "Heart and great vessels:", "Chest wall and axillae:", "Visualised upper abdomen:", "Bones:"],
    },
  },
  {
    name: "CT Abdomen",
    modality: "CT",
    keywords: ["abdomen", "abdominal", "pelvis", "kub", "liver"],
    sections: {
      technique: ["Axial CT images of the abdomen and pelvis were acquired. Contrast phase:", "Oral contrast:"],
      findings: ["Liver:", "Gallbladder and biliary tree:", "Pancreas:", "Spleen:", "Adrenal glands:", "Kidneys and ureters:", "Urinary bladder:", "Bowel and mesentery:", "Lymph nodes:", "Vessels:", "Peritoneum and free fluid:", "Bones and soft tissues:", "Visualised lung bases:"],
    },
  },
  {
    name: "MRI Brain",
    modality: "MR",
    keywords: ["brain", "head", "cranial"],
    sections: {
      technique: ["Multiplanar multisequence MRI of the brain. Sequences:", "Contrast:"],
      findings: ["Brain parenchyma:", "Diffusion-weighted imaging:", "Susceptibility-weighted imaging:", "Ventricles and sulci:", "Extra-axial spaces:", "Sella and pituitary:", "Posterior fossa and craniocervical junction:", "Orbits, sinuses and mastoids:", "Flow voids:"],
    },
  },
  {
    name: "MRI Spine",
    modality: "MR",
    keywords: ["spine", "spinal", "lumbar", "cervical", "thoracic", "ls", "cs"],
    sections: {
      technique: ["Multiplanar multisequence MRI of the spine. Region:", "Sequences:"],
      findings: ["Alignment:", "Vertebral bodies and marrow signal:", "Intervertebral discs:", "Spinal canal:", "Neural foramina:", "Spinal cord and conus:", "Facet joints:", "Paraspinal soft tissues:"],
    },
  },
  {
    name: "X-Ray Chest",
    modality: "DX",
    keywords: ["chest", "cxr", "thorax", "pa", "lung"],
    sections: {
      technique: ["Projection:"],
      findings: ["Lungs:", "Pleura:", "Heart size and mediastinum:", "Hila:", "Diaphragm and costophrenic angles:", "Bones and soft tissues:", "Lines and tubes:"],
    },
  },
  {
    name: "X-Ray KUB",
    modality: "DX",
    keywords: ["kub", "abdomen", "kidney", "ureter", "bladder"],
    sections: {
      technique: ["Supine AP radiograph of the abdomen (KUB)."],
      findings: ["Renal outlines:", "Urinary tract calcification:", "Bowel gas pattern:", "Soft tissue shadows:", "Bones:"],
    },
  },
  {
    name: "Ultrasound Abdomen",
    modality: "US",
    keywords: ["abdomen", "abdominal", "liver", "usg", "sonography", "kub"],
    sections: {
      technique: ["Real-time grey-scale and colour Doppler ultrasound of the abdomen."],
      findings: ["Liver:", "Gallbladder:", "Common bile duct:", "Pancreas:", "Spleen:", "Right kidney:", "Left kidney:", "Urinary bladder:", "Aorta and IVC:", "Free fluid:"],
    },
  },
  {
    name: "CT KUB",
    modality: "CT",
    keywords: ["kub", "kidney", "ureter", "bladder", "stone", "calculus"],
    sections: {
      technique: ["Non-contrast CT of the kidneys, ureters and bladder."],
      findings: ["Right kidney:", "Left kidney:", "Ureters:", "Urinary bladder:", "Calculi:", "Perinephric and periureteric fat:", "Other visualised structures:"],
    },
  },
  {
    name: "MRI Knee",
    modality: "MR",
    keywords: ["knee", "meniscus", "acl", "pcl"],
    sections: {
      technique: ["Multiplanar multisequence MRI of the knee. Sequences:", "Contrast:"],
      findings: ["Bones and marrow:", "Joint fluid:", "Medial meniscus:", "Lateral meniscus:", "ACL:", "PCL:", "Collateral ligaments:", "Extensor mechanism:", "Cartilage:", "Soft tissues:"],
    },
  },
  {
    name: "MRI Shoulder",
    modality: "MR",
    keywords: ["shoulder", "rotator", "cuff", "labrum"],
    sections: {
      technique: ["Multiplanar multisequence MRI of the shoulder. Sequences:", "Contrast:"],
      findings: ["Bones and marrow:", "Joint fluid:", "Supraspinatus:", "Infraspinatus:", "Subscapularis:", "Biceps tendon:", "Labrum:", "Acromioclavicular joint:", "Bursa and soft tissues:"],
    },
  },
  {
    name: "X-Ray Spine",
    modality: "DX",
    keywords: ["spine", "lumbar", "cervical", "thoracic", "ls", "cs"],
    sections: {
      technique: ["Region and projections:"],
      findings: ["Alignment:", "Vertebral bodies:", "Disc spaces:", "Pedicles and posterior elements:", "Paraspinal soft tissues:"],
    },
  },
  {
    name: "X-Ray Extremities",
    modality: "DX",
    keywords: ["extremity", "hand", "wrist", "knee", "ankle", "foot", "shoulder", "elbow", "fracture"],
    sections: {
      technique: ["Region and projections:"],
      findings: ["Bones:", "Joints:", "Alignment:", "Soft tissues:", "Comparison:"],
    },
  },
  {
    name: "Ultrasound Pelvis",
    modality: "US",
    keywords: ["pelvis", "pelvic", "uterus", "ovary", "prostate", "tvs"],
    sections: {
      technique: ["Approach (transabdominal / transvaginal):"],
      findings: ["Uterus:", "Endometrium:", "Right ovary:", "Left ovary:", "Adnexa:", "Urinary bladder:", "Free fluid:", "Prostate and seminal vesicles:"],
    },
  },
];

export function builtinTemplateDoc(template) {
  return buildReportDoc({ title: "RADIOLOGY REPORT", subtitle: template.name, sections: template.sections });
}

const MODALITY_GROUPS = [["DX", "CR", "XR", "RG", "DR"], ["MR", "MRI"], ["US", "USG"], ["CT"], ["MG"], ["PT", "PET"], ["NM"], ["XA", "RF"]];

export function modalityGroup(value) {
  const code = String(value || "").toUpperCase().trim();
  return MODALITY_GROUPS.find((group) => group.includes(code)) || (code ? [code] : []);
}

export function modalityLabel(value) {
  const code = String(value || "").toUpperCase();
  if (["DX", "CR", "XR", "DR"].includes(code)) return "X-Ray";
  if (code === "MR") return "MRI";
  if (code === "US") return "Ultrasound";
  return code || "";
}

// Higher is a better default for the study. Returns -1 when the modality does not match.
export function scoreTemplate(template, study) {
  const group = modalityGroup(study?.modality);
  const tmplModality = String(template?.modality || "").toUpperCase();
  if (tmplModality && group.length && !group.includes(tmplModality)) return -1;
  let score = tmplModality ? 10 : 1;
  const description = String(study?.description || "").toLowerCase();
  const words = new Set(description.split(/[^a-z0-9]+/).filter(Boolean));
  for (const keyword of template?.keywords || []) {
    const key = String(keyword).toLowerCase();
    if (!key) continue;
    if (words.has(key) || (key.length > 3 && description.includes(key))) score += 5;
  }
  if (template?.isDefault) score += 3;
  return score;
}

export function pickDefaultTemplate(templates, study) {
  let best = null;
  let bestScore = 0;
  for (const template of templates || []) {
    const score = scoreTemplate(template, study);
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }
  return best;
}

// ---------- reading documents ----------

const BLOCK_TYPES = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "table", "tableRow", "tableCell", "tableHeader", "blockquote", "horizontalRule", "pageBreak", "image", "columns", "column"]);

function hasMark(node, type) {
  return (node.marks || []).some((mark) => mark.type === type);
}

export function inlineText(node, fields = {}, { skipDeleted = true } = {}) {
  if (!node) return "";
  if (node.type === "text") return skipDeleted && hasMark(node, "deletion") ? "" : node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "dataField") return fieldText(node.attrs?.key, fields);
  return (node.content || []).map((child) => inlineText(child, fields, { skipDeleted })).join("");
}

export function fieldText(key, fields = {}) {
  const value = fields?.[key];
  if (value && typeof value === "object") return value.text || "";
  return value == null ? "" : String(value);
}

// Plain text of a list of blocks with list bullets and table cells flattened.
export function blocksToText(blocks, fields = {}, depth = 0) {
  const lines = [];
  (blocks || []).forEach((block) => {
    if (!block) return;
    switch (block.type) {
      case "paragraph":
      case "heading":
        lines.push(inlineText(block, fields));
        break;
      case "bulletList":
      case "orderedList": {
        let index = Number(block.attrs?.start || 1);
        for (const item of block.content || []) {
          const inner = blocksToText(item.content, fields, depth + 1).split("\n");
          const prefix = block.type === "orderedList" ? `${index}. ` : "- ";
          index += 1;
          lines.push(`${"  ".repeat(depth)}${prefix}${inner[0] || ""}`);
          inner.slice(1).forEach((line) => lines.push(`${"  ".repeat(depth + 1)}${line}`));
        }
        break;
      }
      case "table":
        for (const row of block.content || []) {
          lines.push((row.content || []).map((item) => blocksToText(item.content, fields, depth).replace(/\n/g, " ").trim()).join(" | "));
        }
        break;
      case "blockquote":
      case "columns":
      case "column":
        lines.push(blocksToText(block.content, fields, depth));
        break;
      default:
        break;
    }
  });
  return lines.join("\n");
}

export function docToText(doc, fields = {}) {
  return blocksToText(doc?.content || [], fields).replace(/\n{3,}/g, "\n\n").trim();
}

// Splits the top-level blocks of a document into report sections by their section headings.
export function sectionBlocks(doc) {
  const result = {};
  let current = null;
  for (const block of doc?.content || []) {
    if (block.type === "heading" && block.attrs?.sectionKey) {
      current = block.attrs.sectionKey;
      if (!result[current]) result[current] = [];
      continue;
    }
    if (block.type === "heading" && current && Number(block.attrs?.level || 1) <= 2) {
      current = null;
      continue;
    }
    if (current) result[current].push(block);
  }
  return result;
}

// Legacy plain-text section fields derived from the document. These keep the existing
// report APIs, share pages and signature checks working.
export function extractSections(doc, fields = {}) {
  const blocks = sectionBlocks(doc);
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, blocksToText(blocks[key] || [], fields).replace(/\n{3,}/g, "\n\n").trim()]));
}

function walk(node, visit, parent = null) {
  if (!node) return;
  visit(node, parent);
  for (const child of node.content || []) walk(child, visit, node);
}

// Counts the review items that must be cleared before a report is finalized.
export function documentIssues(doc) {
  const issues = { aiSuggestions: 0, insertions: 0, deletions: 0, comments: 0 };
  const commentIds = new Set();
  const aiIds = new Set();
  walk(doc, (node) => {
    if (node.type !== "text") return;
    for (const mark of node.marks || []) {
      if (mark.type === "aiSuggestion") aiIds.add(mark.attrs?.id || node.text);
      if (mark.type === "insertion") issues.insertions += 1;
      if (mark.type === "deletion") issues.deletions += 1;
      if (mark.type === "comment") commentIds.add(mark.attrs?.id || node.text);
    }
  });
  issues.aiSuggestions = aiIds.size;
  issues.comments = commentIds.size;
  return issues;
}

export function finalizationProblems(doc) {
  const issues = documentIssues(doc);
  const problems = [];
  if (issues.aiSuggestions) problems.push(`${issues.aiSuggestions} AI suggestion${issues.aiSuggestions === 1 ? " has" : "s have"} not been reviewed`);
  if (issues.insertions || issues.deletions) problems.push("Tracked changes have not been accepted or rejected");
  if (issues.comments) problems.push(`${issues.comments} comment${issues.comments === 1 ? " is" : "s are"} still open`);
  return problems;
}

// Returns a copy for export: pending deletions removed, review marks dropped.
export function exportableDoc(doc) {
  const drop = new Set(["insertion", "comment", "aiSuggestion"]);
  function clean(node) {
    if (!node || typeof node !== "object") return node;
    if (node.type === "text") {
      if (hasMark(node, "deletion")) return null;
      const marks = (node.marks || []).filter((mark) => !drop.has(mark.type));
      const next = { ...node };
      if (marks.length) next.marks = marks;
      else delete next.marks;
      return next;
    }
    const next = { ...node };
    if (node.content) next.content = node.content.map(clean).filter(Boolean);
    return next;
  }
  return clean(doc);
}

export function appendAddendumSection(doc, { date = new Date(), author = "" } = {}) {
  const content = [...(doc?.content || [])];
  let insertAt = content.findIndex((block) => block.type === "heading" && block.attrs?.sectionKey === "radiologist");
  if (insertAt < 0) insertAt = content.length;
  const stamp = `${date.toISOString().slice(0, 10)}${author ? ` by ${author}` : ""}`;
  content.splice(insertAt, 0,
    { type: "heading", attrs: { level: 2, sectionKey: "addendum" }, content: [text("ADDENDUM:")] },
    paragraph([text(`Addendum started ${stamp}.`, [{ type: "italic" }])]),
    paragraph(),
  );
  return { ...doc, type: "doc", content };
}

// Converts the legacy text sections into a document. HTML from the old editor is
// reduced to text here; the browser editor parses HTML itself for higher fidelity.
export function docFromLegacyFields(report) {
  const sections = {};
  for (const key of SECTION_KEYS) {
    let value = String(report?.[key] || "");
    if (key === "clinical" && report?.indication && !String(report.clinical || "").includes(report.indication)) {
      value = [value, report.indication].filter(Boolean).join("\n");
    }
    const plain = value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
    sections[key] = plain ? plain.split(/\n/).map((line) => paragraph(line ? [line] : [])) : [];
  }
  return buildReportDoc({ sections });
}

export function docStats(doc, fields = {}) {
  const plain = docToText(doc, fields);
  const words = plain.split(/\s+/).filter(Boolean).length;
  let paragraphs = 0;
  walk(doc, (node) => {
    if ((node.type === "paragraph" || node.type === "heading") && inlineText(node, fields).trim()) paragraphs += 1;
  });
  return {
    words,
    characters: plain.replace(/\n/g, "").length,
    charactersNoSpaces: plain.replace(/\s/g, "").length,
    paragraphs,
  };
}

export function isDocNode(value) {
  return Boolean(value && typeof value === "object" && value.type === "doc" && Array.isArray(value.content));
}

export function isKnownBlock(type) {
  return BLOCK_TYPES.has(type);
}

// ---------- field values ----------

export function sexLabel(value) {
  if (value === "F") return "Female";
  if (value === "M") return "Male";
  if (value === "O") return "Other";
  return "";
}

export function parseLooseDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value) {
  const date = parseLooseDate(value);
  if (!date) return value ? String(value) : "";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ageYears(birthDate, onDate) {
  const born = parseLooseDate(birthDate);
  const at = parseLooseDate(onDate) || new Date();
  if (!born) return null;
  let years = at.getFullYear() - born.getFullYear();
  const month = at.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && at.getDate() < born.getDate())) years -= 1;
  return years >= 0 && years < 130 ? years : null;
}

const AGE_LIMIT = { Y: 130, M: 240, W: 260, D: 999 };

function ageUnit(token) {
  const value = String(token || "Y").toUpperCase();
  if (value.startsWith("MON") || value === "M") return "M";
  if (value.startsWith("W")) return "W";
  if (value.startsWith("D")) return "D";
  return "Y";
}

function agePart(count, unit) {
  const number = Number(count);
  const key = ageUnit(unit);
  if (!Number.isInteger(number) || number < 0 || number > AGE_LIMIT[key]) return null;
  return { count: number, unit: key };
}

// DICOM Patient Age is AS, for example 036Y, 003M, 010W, or 004D.
export function normalizeAgeToken(value) {
  const match = String(value || "").trim().match(/^0*(\d{1,3})\s*([DWMY])$/i);
  if (!match) return "";
  const part = agePart(match[1], match[2]);
  // Scanners often send 000Y when the age was typed into the patient name instead.
  if (!part || part.count === 0) return "";
  return `${part.count}${part.unit}`;
}

function nameDemographics(name) {
  const text = String(name || "");
  const withSex = text.match(/(?:^|[\s^])(\d{1,3})\s*(YRS?|YEARS?|Y|MONTHS?|WEEKS?|DAYS?|D|M|W)?\s*\/\s*([MFO])\b/i);
  if (withSex) {
    const part = agePart(withSex[1], withSex[2] || "Y");
    return part ? { ...part, sex: withSex[3].toUpperCase() } : null;
  }
  const years = text.match(/(?:^|[\s^])(\d{1,3})\s*(YRS|YEARS|YR|Y)\b/i);
  if (!years) return null;
  const part = agePart(years[1], "Y");
  return part ? { ...part, sex: "" } : null;
}

export function ageTokenFromName(name) {
  const part = nameDemographics(name);
  return part ? `${part.count}${part.unit}` : "";
}

export function sexFromName(name) {
  return nameDemographics(name)?.sex || "";
}

// Age at the study. Birth date wins. Otherwise the DICOM age, then the age written on the patient name.
export function patientAge({ patient = {}, study = {} } = {}) {
  const years = ageYears(patient?.birthDate, study?.studyDate);
  if (years != null) return { count: years, unit: "Y" };
  const stored = normalizeAgeToken(study?.patientAge);
  if (stored) return agePart(stored.slice(0, -1), stored.slice(-1));
  const named = nameDemographics(patient?.name);
  return named ? { count: named.count, unit: named.unit } : null;
}

export function patientSexCode({ patient = {} } = {}) {
  if (patient?.sex && patient.sex !== "U") return patient.sex;
  return sexFromName(patient?.name);
}

export function statusLabel(report) {
  if (report?.workflow === "amended" || (report?.priorReportId && report?.status === "final")) return "Amended";
  if (report?.workflow === "pending_signature" || report?.status === "preliminary") return "Pending Signature";
  if (report?.workflow === "finalized" || report?.status === "final") return "Finalized";
  if (report?.workflow === "in_progress" || ((report?.revision || 0) > 0 && report?.status === "draft")) return "In Progress";
  return "Draft";
}

export const DEFAULT_SHORTCUTS = [
  { trigger: "nh", expansion: "No significant abnormality.", favourite: true },
  { trigger: "nch", expansion: "No acute intracranial hemorrhage.", favourite: true },
  { trigger: "nlf", expansion: "No lung focal lesion.", favourite: true },
];

// Values shown by data fields. `signature` stays pending until the report is signed.
export function resolveFieldValues({ report = {}, study = {}, patient = {}, facility = {}, author = null, signer = null } = {}) {
  const age = patientAge({ patient, study });
  const sex = sexLabel(patientSexCode({ patient }));
  const signed = report?.status === "preliminary" || report?.status === "final";
  const snapshot = report?.signatureRecord?.name ? report.signatureRecord : null;
  const live = signed ? signer || author : author || signer;
  const radiologist = snapshot ? { ...(live || {}), ...snapshot } : live;
  const notRecorded = "Not recorded";
  return {
    patientName: patient?.name || notRecorded,
    patientId: patient?.mrn || notRecorded,
    ageGender: [age ? `${age.count} ${age.unit}` : "", sex].filter(Boolean).join(" / ") || notRecorded,
    birthDate: formatDate(patient?.birthDate) || notRecorded,
    accession: study?.accession || notRecorded,
    studyDate: formatDate(study?.studyDate) || notRecorded,
    modality: [study?.modality, modalityLabel(study?.modality)].filter(Boolean).filter((item, index, list) => list.indexOf(item) === index).join(" — ") || notRecorded,
    studyDescription: study?.description || notRecorded,
    facilityName: facility?.name || "",
    radiologistName: radiologist?.name || "Not assigned",
    radiologistQualifications: radiologist?.qualifications || "Not recorded",
    radiologistRegistration: radiologist?.registrationNumber || "Not recorded",
    signature: signed
      ? `Electronically signed by ${radiologist?.name || "the reporting radiologist"}${radiologist?.designation ? `, ${radiologist.designation}` : ""}${radiologist?.registrationNumber ? `, Reg. ${radiologist.registrationNumber}` : ""}, authenticated PACSD session`
      : "Pending: the report has not been signed",
    signatureImage: radiologist?.signatureImage || signer?.signatureImage || author?.signatureImage || "",
    reportDateTime: signed && report?.signedAt ? formatDateTime(report.signedAt) : "Pending signature",
    reportStatus: statusLabel(report),
  };
}

export function headerFooterTokens(fields = {}, extra = {}) {
  return {
    "{FACILITY}": fields.facilityName || "",
    "{PATIENT}": fields.patientName || "",
    "{PATIENT_ID}": fields.patientId || "",
    "{ACCESSION}": fields.accession || "",
    "{MODALITY}": fields.modality || "",
    "{STUDY}": fields.studyDescription || "",
    "{STATUS}": fields.reportStatus || "",
    "{DATE}": extra.date || new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
  };
}

// Replaces tokens except {PAGE} and {PAGES}, which each renderer fills itself.
export function fillTokens(template, tokens) {
  let value = String(template || "");
  for (const [token, replacement] of Object.entries(tokens)) value = value.split(token).join(replacement);
  return value;
}
