import { generateJSON } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  SECTION_DEFS,
  SECTION_KEYS,
  buildReportDoc,
  extractSections,
  isDocNode,
  paragraph,
  patientInfoTable,
  pickDefaultTemplate,
  radiologistBlock,
  sectionHeading,
  text,
} from "../../../shared/reportDocument.js";
import { uid } from "./units.js";

export const EXTRA_SECTIONS = [
  { key: "patientInfo", label: "PATIENT INFORMATION" },
  { key: "radiologist", label: "RADIOLOGIST DETAILS" },
  { key: "addendum", label: "ADDENDUM" },
];

export function sectionLabel(key) {
  return SECTION_DEFS.find((item) => item.key === key)?.label || EXTRA_SECTIONS.find((item) => item.key === key)?.label || key;
}

function hasLegacyText(report) {
  return SECTION_KEYS.some((key) => String(report?.[key] || "").replace(/<[^>]+>/g, "").trim()) || String(report?.indication || "").trim();
}

function legacyBlocks(value, extensions) {
  const source = String(value || "").trim();
  if (!source) return [];
  if (/<\/?[a-z][\s\S]*>/i.test(source)) {
    try {
      const json = generateJSON(source, extensions);
      return (json.content || []).filter((node) => node.type !== "heading" || node.content?.length);
    } catch {
      // Fall through to plain text.
    }
  }
  return source.split(/\n/).map((line) => {
    const runs = line.split(/\*\*([^*]+)\*\*/g)
      .map((part, index) => (part ? text(part, index % 2 === 1 ? [{ type: "bold" }] : undefined) : null))
      .filter(Boolean);
    return paragraph(runs);
  });
}

// The first document for a report: the stored document, the old section text converted,
// or the best template for the study (built-in labels only, never findings).
export function initialDocument({ report, study, templates, extensions }) {
  if (isDocNode(report?.doc)) return { doc: report.doc, source: "stored", template: null };
  if (hasLegacyText(report)) {
    const sections = {};
    for (const key of SECTION_KEYS) sections[key] = legacyBlocks(report[key], extensions);
    if (report.indication && !String(report.clinical || "").includes(report.indication)) {
      sections.clinical = [...(sections.clinical || []), ...legacyBlocks(report.indication, extensions)];
    }
    for (const key of SECTION_KEYS) if (!sections[key].length) delete sections[key];
    return { doc: buildReportDoc({ subtitle: study?.description || "", sections }), source: "legacy", template: null };
  }
  const template = pickDefaultTemplate(templates || [], study);
  if (template && isDocNode(template.doc)) return { doc: template.doc, source: "template", template };
  return { doc: buildReportDoc({ subtitle: study?.description || "" }), source: "blank", template: null };
}

// ---------- sections ----------

export function findSection(doc, key) {
  let index = -1;
  let pos = 0;
  let headingPos = -1;
  doc.forEach((node, offset, childIndex) => {
    if (index >= 0) return;
    if (node.type.name === "heading" && node.attrs.sectionKey === key) {
      index = childIndex;
      headingPos = offset;
      pos = offset + node.nodeSize;
    }
  });
  if (index < 0) return null;
  let end = pos;
  let empty = true;
  for (let child = index + 1; child < doc.childCount; child += 1) {
    const node = doc.child(child);
    if (node.type.name === "heading" && (node.attrs.sectionKey || node.attrs.level <= 2)) break;
    if (node.textContent.trim() || (node.type.name !== "paragraph")) empty = false;
    end += node.nodeSize;
  }
  return { key, index, headingPos, from: pos, to: end, empty };
}

export function listSections(doc) {
  const items = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== "heading") return;
    const section = node.attrs.sectionKey ? findSection(doc, node.attrs.sectionKey) : null;
    items.push({ pos: offset, level: node.attrs.level, key: node.attrs.sectionKey || "", label: node.textContent.replace(/:\s*$/, "") || "Heading", empty: section ? section.empty : false });
  });
  return items;
}

export function currentSectionKey(state) {
  const { $from } = state.selection;
  if ($from.depth < 1) return "";
  const index = $from.index(0);
  for (let child = index; child >= 0; child -= 1) {
    const node = state.doc.child(child);
    if (node.type.name === "heading" && node.attrs.sectionKey) return node.attrs.sectionKey;
    if (node.type.name === "heading" && node.attrs.level <= 2 && child !== index) return "";
  }
  return "";
}

export function scrollToPos(editor, pos) {
  const target = Math.min(pos + 1, editor.state.doc.content.size);
  const tr = editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(target)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  const dom = editor.view.nodeDOM(pos);
  if (dom?.scrollIntoView) dom.scrollIntoView({ block: "center", behavior: "smooth" });
}

function sectionNodes(schema, key) {
  if (key === "patientInfo") return [sectionHeading("patientInfo", "PATIENT INFORMATION"), patientInfoTable()];
  if (key === "radiologist") return radiologistBlock();
  return [sectionHeading(key, sectionLabel(key)), paragraph()];
}

// Inserts a section heading (and body) after the block at the cursor. Returns false when
// the section already exists, after moving the cursor to it.
export function insertSection(editor, key) {
  const existing = findSection(editor.state.doc, key);
  if (existing) {
    scrollToPos(editor, existing.headingPos);
    return false;
  }
  const { state } = editor;
  const nodes = sectionNodes(state.schema, key).map((json) => state.schema.nodeFromJSON(json));
  const $from = state.selection.$from;
  let insertAt = $from.depth >= 1 ? $from.after(1) : state.doc.content.size;
  if (key !== "radiologist" && key !== "addendum") {
    const radiologist = findSection(state.doc, "radiologist");
    if (radiologist && insertAt > radiologist.headingPos) insertAt = radiologist.headingPos;
  }
  const tr = state.tr.insert(insertAt, nodes);
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + nodes[0].nodeSize + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

function suggestionParagraphs(schema, value, attrs) {
  const mark = schema.marks.aiSuggestion.create(attrs);
  return String(value || "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => schema.nodes.paragraph.create(null, schema.text(line, [mark])));
}

// Puts AI text into a section as a pending suggestion the radiologist must accept or reject.
export function insertSuggestionIntoSection(editor, key, value, task) {
  const { state } = editor;
  const id = uid("ai");
  const paragraphs = suggestionParagraphs(state.schema, value, { id, task, original: "" });
  if (!paragraphs.length) return null;
  let section = findSection(state.doc, key);
  let tr = state.tr;
  if (!section) {
    insertSection(editor, key);
    section = findSection(editor.state.doc, key);
    tr = editor.state.tr;
    if (!section) return null;
  }
  if (section.empty) tr.replaceWith(section.from, section.to, paragraphs);
  else tr.insert(section.to, paragraphs);
  const start = section.empty ? section.from : section.to;
  tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  return id;
}

// Replaces the selection with AI text, keeping the original so that rejecting restores it.
export function replaceSelectionWithSuggestion(editor, value, task) {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  if (empty) return null;
  const id = uid("ai");
  const original = JSON.stringify(state.selection.content().toJSON());
  const mark = state.schema.marks.aiSuggestion.create({ id, task, original });
  const lines = String(value || "").replace(/\r/g, "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  const inherited = $from.marks().filter((item) => !["aiSuggestion", "comment", "insertion", "deletion"].includes(item.type.name));
  const tr = state.tr;
  if (lines.length === 1 || $from.sameParent($to)) {
    tr.replaceWith(from, to, state.schema.text(lines.join(" "), [...inherited, mark]));
  } else {
    const blocks = lines.map((line) => state.schema.nodes.paragraph.create(null, state.schema.text(line, [...inherited, mark])));
    tr.replace(from, to, new Slice(Fragment.from(blocks), 1, 1));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return id;
}

export function insertTextAsSuggestion(editor, value, task) {
  const { state } = editor;
  const id = uid("ai");
  const mark = state.schema.marks.aiSuggestion.create({ id, task, original: "" });
  const lines = String(value || "").replace(/\r/g, "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const at = state.selection.to;
  const tr = state.tr;
  if (lines.length === 1) {
    tr.insert(at, state.schema.text(lines[0], [mark]));
  } else {
    const blocks = lines.map((line) => state.schema.nodes.paragraph.create(null, state.schema.text(line, [mark])));
    tr.replace(at, at, new Slice(Fragment.from(blocks), 1, 1));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return id;
}

export function selectedText(editor) {
  const { state } = editor;
  const { from, to } = state.selection;
  return state.doc.textBetween(from, to, "\n", (node) => (node.type.name === "dataField" ? editor.storage.dataField.values?.[node.attrs.key] || "" : ""));
}

export function sectionsText(editor) {
  return extractSections(editor.getJSON(), editor.storage.dataField.values || {});
}

// ---------- templates ----------

export function applyTemplateFill(editor, template) {
  const templateDoc = editor.schema.nodeFromJSON(template.doc);
  let filled = 0;
  for (const def of SECTION_DEFS) {
    const source = findSection(templateDoc, def.key);
    if (!source) continue;
    const nodes = [];
    templateDoc.slice(source.from, source.to).content.forEach((node) => nodes.push(node));
    if (!nodes.some((node) => node.textContent.trim() || node.type.name !== "paragraph")) continue;
    const target = findSection(editor.state.doc, def.key);
    if (!target) continue;
    if (!target.empty) continue;
    editor.view.dispatch(editor.state.tr.replaceWith(target.from, target.to, nodes));
    filled += 1;
  }
  return filled;
}

export function templateFromDoc(json, { clearText }) {
  if (!clearText) return json;
  const clear = new Set(["findings", "impression", "recommendations", "comparison", "clinical"]);
  const content = [];
  let current = null;
  for (const node of json.content || []) {
    if (node.type === "heading" && node.attrs?.sectionKey) {
      current = node.attrs.sectionKey;
      content.push(node);
      if (clear.has(current)) content.push({ type: "paragraph" });
      continue;
    }
    if (node.type === "heading" && (node.attrs?.level || 1) <= 2) current = null;
    if (current && clear.has(current)) continue;
    content.push(node);
  }
  return { ...json, content };
}

// ---------- images ----------

export async function imageFileToDataUrl(file, { maxWidth = 1600, maxBytes = 1_500_000 } = {}) {
  if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type)) throw new Error("Choose a PNG, JPEG, GIF, WebP or BMP image.");
  const raw = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("The image could not be decoded."));
    element.src = raw;
  });
  const keep = (file.type === "image/png" || file.type === "image/jpeg") && file.size <= maxBytes && image.naturalWidth <= maxWidth;
  if (keep) return { src: raw, width: image.naturalWidth, height: image.naturalHeight };
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const usePng = file.type === "image/png" && canvas.width * canvas.height < 600_000;
  return { src: canvas.toDataURL(usePng ? "image/png" : "image/jpeg", 0.88), width: canvas.width, height: canvas.height };
}

export function insertImage(editor, { src, width, height, alt = "" }, contentWidthPx) {
  const fitWidth = Math.min(width || contentWidthPx, contentWidthPx, 520);
  const ratio = width && height ? height / width : 0.75;
  editor.chain().focus().insertContent({ type: "image", attrs: { src, alt, width: Math.round(fitWidth), height: Math.round(fitWidth * ratio), align: "center" } }).run();
}

// ---------- text case ----------

export function changeCase(editor, mode) {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  if (empty) return false;
  const tr = state.tr;
  let sentenceStart = true;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) sentenceStart = true;
    if (!node.isText) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const value = node.text.slice(start - pos, end - pos);
    let next = value;
    if (mode === "upper") next = value.toUpperCase();
    else if (mode === "lower") next = value.toLowerCase();
    else if (mode === "title") next = value.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_m, space, letter) => space + letter.toUpperCase());
    else if (mode === "sentence") {
      next = value.toLowerCase().replace(/(^|[.!?]\s+)(\p{L})/gu, (match, lead, letter, offset) => {
        if (offset === 0 && !sentenceStart) return match;
        return lead + letter.toUpperCase();
      });
    }
    sentenceStart = /[.!?]\s*$/.test(value);
    if (next !== value) tr.replaceWith(tr.mapping.map(start), tr.mapping.map(end), state.schema.text(next, node.marks));
    return false;
  });
  tr.setSelection(TextSelection.create(tr.doc, from, tr.mapping.map(to)));
  editor.view.dispatch(tr);
  return true;
}
