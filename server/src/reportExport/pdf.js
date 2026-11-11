import PdfPrinter from "pdfmake";
import { DEFAULT_FONT, MM_TO_PT, PX_TO_PT, TEXT_STYLES, parseFontSize } from "../../../shared/reportDocument.js";
import { cssColor, exportContext, logoBuffer, parseDataUrl, splitPageTokens } from "./common.js";
import { reportFonts, splitByScript } from "./fonts.js";

const mm = (value) => Number(value || 0) * MM_TO_PT;

export function renderDocumentPdf(records) {
  const ctx = exportContext(records);
  const fonts = reportFonts();
  const printer = new PdfPrinter(fonts.descriptors);
  const definition = buildDefinition(ctx, fonts);
  return new Promise((resolve, reject) => {
    try {
      const pdf = printer.createPdfKitDocument(definition);
      const chunks = [];
      pdf.on("data", (chunk) => chunks.push(chunk));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
      pdf.end();
    } catch (error) {
      reject(error);
    }
  });
}

export function buildDefinition(ctx, fonts = reportFonts()) {
  const { layout, page } = ctx;
  const width = mm(page.width);
  const height = mm(page.height);
  const margins = layout.margins;
  const contentWidth = width - mm(margins.left) - mm(margins.right);
  const baseFamily = fonts.familyFor(DEFAULT_FONT.family);
  const state = { ctx, fonts, baseFamily, contentWidth, listDepth: 0 };
  const logo = layout.header.showLogo ? logoBuffer() : null;
  const images = logo ? { logo: `data:image/png;base64,${logo.toString("base64")}` } : {};
  const watermark = ctx.report?.status === "final" ? undefined
    : { text: ctx.report?.status === "preliminary" ? "PRELIMINARY" : "DRAFT", color: "#1f3a5f", opacity: 0.06, bold: true, fontSize: 96 };

  return {
    pageSize: { width, height },
    pageMargins: [mm(margins.left), mm(margins.top), mm(margins.right), mm(margins.bottom)],
    info: {
      title: `Radiology report ${ctx.patient?.mrn || ""} ${ctx.study?.accession || ""}`.trim(),
      author: ctx.signer?.name || ctx.fields.radiologistName || "PACSD",
      subject: ctx.study?.description || "Radiology report",
      creator: "PACSD Report Editor",
      producer: "PACSD",
    },
    images,
    watermark,
    defaultStyle: {
      font: baseFamily,
      fontSize: DEFAULT_FONT.size,
      lineHeight: DEFAULT_FONT.lineHeight,
      color: "#111827",
    },
    background: (_page, size) => pageBorder(layout.border, size),
    header: (current, count) => headerBlock(state, logo, current, count),
    footer: (current, count) => footerBlock(state, current, count),
    content: blocks(ctx.doc?.content || [], state, {}),
  };
}

// ---------- header, footer, border ----------

function headerFooterText(state, raw, current, count, align, boldFirst) {
  const value = state.ctx.fill(raw);
  if (!value.trim()) return { text: "", width: "*" };
  const lines = value.split("\n");
  const runs = [];
  lines.forEach((line, index) => {
    for (const part of splitPageTokens(line)) {
      const textValue = part === "{PAGE}" ? String(current) : part === "{PAGES}" ? String(count) : part;
      for (const run of splitByScript(textValue, state.baseFamily, state.fonts)) {
        runs.push({ text: run.text, font: run.font, bold: boldFirst && index === 0 && lines.length > 1 });
      }
    }
    if (index < lines.length - 1) runs.push({ text: "\n" });
  });
  return { text: runs, alignment: align, width: "*" };
}

function headerBlock(state, logo, current, count) {
  const { layout } = state.ctx;
  const style = TEXT_STYLES.headerFooter;
  const columns = [];
  if (logo) columns.push({ image: "logo", fit: [mm(45), mm(TEXT_STYLES.logoHeightMm)], width: "auto" });
  columns.push(headerFooterText(state, layout.header.left, current, count, "left", true));
  columns.push(headerFooterText(state, layout.header.center, current, count, "center", true));
  columns.push(headerFooterText(state, layout.header.right, current, count, "right", true));
  const empty = !logo && columns.every((item) => !item.text || (Array.isArray(item.text) && !item.text.length));
  if (empty) return null;
  return {
    margin: [mm(layout.margins.left), mm(layout.headerDistance), mm(layout.margins.right), 0],
    stack: [
      { columns, columnGap: 10, fontSize: style.fontSize, color: style.color },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: state.contentWidth, y2: 0, lineWidth: 0.6, lineColor: "#cbd5e1" }], absolutePosition: { x: mm(layout.margins.left), y: Math.max(mm(layout.headerDistance) + 8, mm(layout.margins.top) - 6) } },
    ],
  };
}

function footerBlock(state, current, count) {
  const { layout } = state.ctx;
  const style = TEXT_STYLES.headerFooter;
  const row = [
    headerFooterText(state, layout.footer.left, current, count, "left", false),
    headerFooterText(state, layout.footer.center, current, count, "center", false),
    headerFooterText(state, layout.footer.right, current, count, "right", false),
  ];
  const lines = Math.max(1, ...[layout.footer.left, layout.footer.center, layout.footer.right].map((item) => String(item || "").split("\n").length));
  const note = String(layout.footer.note || "").trim();
  const noteLines = note ? Math.ceil((note.length * style.noteSize * 0.5) / state.contentWidth) : 0;
  const blockHeight = 5 + lines * style.fontSize * 1.25 + noteLines * style.noteSize * 1.3;
  const top = Math.max(2, mm(layout.margins.bottom) - mm(layout.footerDistance) - blockHeight);
  const stack = [
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: state.contentWidth, y2: 0, lineWidth: 0.6, lineColor: "#cbd5e1" }], margin: [0, 0, 0, 3] },
    { columns: row, columnGap: 10, fontSize: style.fontSize, color: style.color },
  ];
  if (note) stack.push({ text: splitByScript(note, state.baseFamily, state.fonts).map((run) => ({ text: run.text, font: run.font })), fontSize: style.noteSize, color: style.noteColor, alignment: "center", margin: [0, 2, 0, 0] });
  return { margin: [mm(layout.margins.left), top, mm(layout.margins.right), 0], stack };
}

function pageBorder(border, size) {
  const style = border?.style || "none";
  if (style === "none") return null;
  const color = cssColor(border.color) || "#1f3a5f";
  const inset = 24;
  const rect = (offset, lineWidth) => ({ type: "rect", x: inset + offset, y: inset + offset, w: size.width - 2 * (inset + offset), h: size.height - 2 * (inset + offset), lineWidth, lineColor: color });
  if (style === "double") return { canvas: [rect(0, 0.75), rect(3, 0.75)] };
  if (style === "thick") return { canvas: [rect(0, 2.25)] };
  return { canvas: [rect(0, 0.75)] };
}

// ---------- blocks ----------

function blocks(list, state, inherited) {
  const out = [];
  for (const node of list || []) {
    const converted = block(node, state, inherited);
    if (Array.isArray(converted)) out.push(...converted.filter(Boolean));
    else if (converted) out.push(converted);
  }
  return out;
}

function paragraphStyle(node, base, inherited) {
  const attrs = node.attrs || {};
  const before = numberOr(attrs.spaceBefore, base.spaceBefore ?? 0);
  const after = numberOr(attrs.spaceAfter, inherited.spaceAfter ?? base.spaceAfter ?? 6);
  const left = numberOr(attrs.indent, 0);
  const right = numberOr(attrs.indentRight, 0);
  const style = {
    margin: [left, before, right, after],
    alignment: alignment(attrs.textAlign),
  };
  const lineHeight = Number(attrs.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) style.lineHeight = lineHeight;
  const first = Number(attrs.firstLineIndent);
  if (Number.isFinite(first) && first > 0) style.leadingIndent = first;
  if (base.fontSize) style.fontSize = base.fontSize;
  if (base.bold) style.bold = true;
  if (base.color) style.color = base.color;
  return style;
}

function numberOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function alignment(value) {
  return ["left", "center", "right", "justify"].includes(value) ? value : "left";
}

function block(node, state, inherited) {
  switch (node?.type) {
    case "paragraph":
      return textBlock(node, TEXT_STYLES.paragraph, state, inherited);
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level || 1)));
      return textBlock(node, TEXT_STYLES[`heading${level}`], state, {});
    }
    case "bulletList":
    case "orderedList":
      return listBlock(node, state);
    case "table":
      return tableBlock(node, state);
    case "image":
      return imageBlock(node, state);
    case "horizontalRule":
      return { canvas: [{ type: "line", x1: 0, y1: 0, x2: state.contentWidth, y2: 0, lineWidth: 0.75, lineColor: "#94a3b8" }], margin: [0, 6, 0, 8] };
    case "pageBreak":
      return { text: "", pageBreak: "after" };
    case "blockquote":
      return { stack: blocks(node.content, state, inherited), margin: [18, 2, 0, 6], color: "#475569", italics: true };
    case "columns": {
      const columns = (node.content || []).map((column) => ({ width: "*", stack: blocks(column.content, { ...state, contentWidth: state.contentWidth / Math.max(1, node.content.length) }, inherited) }));
      return { columns, columnGap: 14, margin: [0, 0, 0, 6] };
    }
    default:
      if (node?.content) return blocks(node.content, state, inherited);
      return null;
  }
}

function textBlock(node, base, state, inherited) {
    const runs = inlineRuns(node.content || [], state);
  const style = paragraphStyle(node, base, inherited);
  const paragraph = { text: runs.length ? runs : [{ text: "\u00a0" }], ...style, preserveLeadingSpaces: true };
  const signature = (node.content || []).some((child) => child.type === "dataField" && child.attrs?.key === "signature");
  if (signature && state.ctx.fields.signatureImage && parseDataUrl(state.ctx.fields.signatureImage)) {
    return [paragraph, { image: state.ctx.fields.signatureImage, fit: [mm(45), mm(18)], margin: [style.margin[0], 0, 0, 6] }];
  }
  return paragraph;
}

function inlineRuns(content, state) {
  const runs = [];
  for (const child of content) {
    if (child.type === "hardBreak") {
      runs.push({ text: "\n" });
      continue;
    }
    let value = "";
    if (child.type === "text") value = child.text || "";
    else if (child.type === "dataField") value = state.ctx.fields[child.attrs?.key] ?? "";
    else continue;
    if (!value) continue;
    const style = runStyle(child.marks || [], state);
    for (const run of splitByScript(value, style.font || state.baseFamily, state.fonts)) {
      runs.push({ ...style, text: run.text, font: run.font });
    }
  }
  return runs;
}

function runStyle(marks, state) {
  const style = {};
  const decoration = [];
  for (const mark of marks) {
    const attrs = mark.attrs || {};
    switch (mark.type) {
      case "bold": style.bold = true; break;
      case "italic": style.italics = true; break;
      case "underline": decoration.push("underline"); break;
      case "strike": decoration.push("lineThrough"); break;
      case "superscript": style.sup = true; break;
      case "subscript": style.sub = true; break;
      case "highlight": style.background = cssColor(attrs.color) || "#fff59d"; break;
      case "link":
        if (/^(https?:|mailto:)/i.test(attrs.href || "")) style.link = attrs.href;
        style.color = TEXT_STYLES.link;
        decoration.push("underline");
        break;
      case "textStyle": {
        const color = cssColor(attrs.color);
        if (color) style.color = color;
        const size = parseFontSize(attrs.fontSize);
        if (size) style.fontSize = size;
        if (attrs.fontFamily) style.font = state.fonts.familyFor(attrs.fontFamily);
        break;
      }
      default: break;
    }
  }
  if (decoration.length) style.decoration = [...new Set(decoration)];
  return style;
}

function listBlock(node, state) {
  const ordered = node.type === "orderedList";
  const items = (node.content || []).map((item) => {
    const inner = blocks(item.content, { ...state, listDepth: state.listDepth + 1 }, { spaceAfter: TEXT_STYLES.listParagraph.spaceAfter });
    return inner.length === 1 ? inner[0] : { stack: inner };
  });
  const orderedType = ["decimal", "lower-alpha", "lower-roman"][state.listDepth % 3];
  const bulletType = ["disc", "circle", "square"][state.listDepth % 3];
  const list = ordered ? { ol: items, start: Number(node.attrs?.start || 1), type: orderedType } : { ul: items, type: bulletType };
  return { ...list, margin: [state.listDepth ? 0 : 6, 0, 0, 4] };
}

function tableBlock(node, state) {
  const rows = node.content || [];
  const grid = [];
  const widthsPx = [];
  rows.forEach((row, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    for (const cellNode of row.content || []) {
      while (grid[r][c] !== undefined) c += 1;
      const colspan = Math.max(1, Number(cellNode.attrs?.colspan || 1));
      const rowspan = Math.max(1, Number(cellNode.attrs?.rowspan || 1));
      const header = cellNode.type === "tableHeader";
      const fill = cssColor(cellNode.attrs?.backgroundColor) || (header ? TEXT_STYLES.tableHeaderFill : "");
      const cell = {
        stack: blocks(cellNode.content, state, { spaceAfter: TEXT_STYLES.cellParagraph.spaceAfter }),
        margin: [4, 3, 4, 3],
      };
      if (header) cell.bold = true;
      if (fill) cell.fillColor = fill;
      if (colspan > 1) cell.colSpan = colspan;
      if (rowspan > 1) cell.rowSpan = rowspan;
      const colwidth = Array.isArray(cellNode.attrs?.colwidth) ? cellNode.attrs.colwidth : [];
      for (let dr = 0; dr < rowspan; dr += 1) {
        grid[r + dr] = grid[r + dr] || [];
        for (let dc = 0; dc < colspan; dc += 1) {
          grid[r + dr][c + dc] = dr === 0 && dc === 0 ? cell : {};
          if (dr === 0 && widthsPx[c + dc] === undefined && Number(colwidth[dc]) > 0) widthsPx[c + dc] = Number(colwidth[dc]);
        }
      }
      c += colspan;
    }
  });
  const columnCount = Math.max(1, ...grid.map((row) => row.length));
  const body = grid.slice(0, rows.length).map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? { text: "" }));
  let widths = Array.from({ length: columnCount }, (_, index) => (widthsPx[index] ? widthsPx[index] * PX_TO_PT : "*"));
  const known = widths.filter((value) => value !== "*");
  if (known.length === columnCount) {
    const total = known.reduce((sum, value) => sum + value, 0) + columnCount * 8;
    if (total > state.contentWidth) widths = widths.map((value) => value * ((state.contentWidth - columnCount * 8) / (total - columnCount * 8)));
  }
  const line = () => 0.6;
  const color = () => TEXT_STYLES.tableBorder;
  return {
    table: { widths, body, dontBreakRows: true },
    layout: { hLineWidth: line, vLineWidth: line, hLineColor: color, vLineColor: color, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    margin: [0, 2, 0, 8],
  };
}

function imageBlock(node, state) {
  const data = parseDataUrl(node.attrs?.src);
  if (!data || !["png", "jpg"].includes(data.kind)) return null;
  const widthPx = Number(node.attrs?.width) || 0;
  const heightPx = Number(node.attrs?.height) || 0;
  let width = widthPx ? widthPx * PX_TO_PT : state.contentWidth;
  width = Math.min(width, state.contentWidth);
  const image = { image: node.attrs.src, width, margin: [0, 2, 0, 6], alignment: alignment(node.attrs?.align) };
  if (widthPx && heightPx) image.height = (width * heightPx) / widthPx;
  return image;
}