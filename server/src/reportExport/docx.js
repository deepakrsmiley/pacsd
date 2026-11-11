import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeightRule,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBorderDisplay,
  PageBorderOffsetFrom,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { DEFAULT_FONT, MM_TO_PT, PAGE_SIZES, PX_TO_PT, TEXT_STYLES, parseFontSize } from "../../../shared/reportDocument.js";
import { cssColor, exportContext, imageSize, logoBuffer, parseDataUrl, splitPageTokens } from "./common.js";

const TWIPS_PER_PT = 20;
const mmToTwips = (value) => Math.round(Number(value || 0) * MM_TO_PT * TWIPS_PER_PT);
const ptToTwips = (value) => Math.round(Number(value || 0) * TWIPS_PER_PT);
const hex = (value) => (cssColor(value) || "").replace("#", "").toUpperCase();

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

export async function renderDocumentDocx(records) {
  const ctx = exportContext(records);
  const { layout, page } = ctx;
  const contentWidthPt = (page.width - layout.margins.left - layout.margins.right) * MM_TO_PT;
  const state = { ctx, contentWidthPt, listInstance: 0, listDepth: 0 };
  const children = blocks(ctx.doc?.content || [], state, {});
  if (!children.length) children.push(new Paragraph({}));
  const base = PAGE_SIZES[layout.pageSize] || PAGE_SIZES.A4;

  const document = new Document({
    creator: "PACSD Report Editor",
    title: `Radiology report ${ctx.patient?.mrn || ""} ${ctx.study?.accession || ""}`.trim(),
    description: ctx.study?.description || "Radiology report",
    styles: {
      default: {
        document: {
          run: { font: DEFAULT_FONT.family, size: DEFAULT_FONT.size * 2, color: "111827" },
          paragraph: { spacing: { after: ptToTwips(TEXT_STYLES.paragraph.spaceAfter), line: Math.round(240 * DEFAULT_FONT.lineHeight), lineRule: LineRuleType.AUTO } },
        },
        heading1: { run: { font: DEFAULT_FONT.family, size: TEXT_STYLES.heading1.fontSize * 2, bold: true, color: hex(TEXT_STYLES.heading1.color) }, paragraph: { spacing: { before: 0, after: ptToTwips(TEXT_STYLES.heading1.spaceAfter) } } },
        heading2: { run: { font: DEFAULT_FONT.family, size: TEXT_STYLES.heading2.fontSize * 2, bold: true, color: hex(TEXT_STYLES.heading2.color) }, paragraph: { spacing: { before: ptToTwips(TEXT_STYLES.heading2.spaceBefore), after: ptToTwips(TEXT_STYLES.heading2.spaceAfter) }, keepNext: true } },
        heading3: { run: { font: DEFAULT_FONT.family, size: TEXT_STYLES.heading3.fontSize * 2, bold: true, color: hex(TEXT_STYLES.heading3.color) }, paragraph: { spacing: { before: ptToTwips(TEXT_STYLES.heading3.spaceBefore), after: ptToTwips(TEXT_STYLES.heading3.spaceAfter) }, keepNext: true } },
        hyperlink: { run: { color: hex(TEXT_STYLES.link), underline: {} } },
      },
    },
    numbering: { config: numberingConfig(orderedStarts(ctx.doc)) },
    sections: [{
      properties: {
        page: {
          size: { width: mmToTwips(base.width), height: mmToTwips(base.height), orientation: layout.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: {
            top: mmToTwips(layout.margins.top),
            right: mmToTwips(layout.margins.right),
            bottom: mmToTwips(layout.margins.bottom),
            left: mmToTwips(layout.margins.left),
            header: mmToTwips(layout.headerDistance),
            footer: mmToTwips(layout.footerDistance),
          },
          borders: pageBorders(layout.border),
        },
      },
      headers: { default: headerSection(state) },
      footers: { default: footerSection(state) },
      children,
    }],
  });
  return Packer.toBuffer(document);
}

function orderedStarts(doc) {
  const starts = new Set([1]);
  (function visit(node) {
    if (node?.type === "orderedList") starts.add(Math.max(1, Number(node.attrs?.start || 1)));
    (node?.content || []).forEach(visit);
  })(doc);
  return [...starts];
}

function numberingReference(start) {
  return start > 1 ? `pacsd-numbers-${start}` : "pacsd-numbers";
}

function numberingConfig(starts) {
  const bulletLevels = ["\u2022", "\u25e6", "\u25aa", "\u2022", "\u25e6", "\u25aa"].map((symbol, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: symbol,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 360 + level * 360, hanging: 260 } } },
  }));
  const formats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
  const orderedLevels = (start) => formats.map((format, level) => ({
    level,
    format,
    text: `%${level + 1}.`,
    start: level === 0 ? start : 1,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 360 + level * 360, hanging: 300 } } },
  }));
  return [
    { reference: "pacsd-bullets", levels: bulletLevels },
    ...starts.map((start) => ({ reference: numberingReference(start), levels: orderedLevels(start) })),
  ];
}

function pageBorders(border) {
  const style = border?.style || "none";
  if (style === "none") return undefined;
  const color = hex(border.color) || "1F3A5F";
  const spec = {
    style: style === "double" ? BorderStyle.DOUBLE : BorderStyle.SINGLE,
    size: style === "thick" ? 18 : 6,
    color,
    space: 24,
  };
  return {
    pageBorders: { display: PageBorderDisplay.ALL_PAGES, offsetFrom: PageBorderOffsetFrom.PAGE },
    pageBorderTop: spec,
    pageBorderRight: spec,
    pageBorderBottom: spec,
    pageBorderLeft: spec,
  };
}

// ---------- header and footer ----------

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };

function headerFooterParagraphs(state, raw, align, boldFirst, size) {
  const value = state.ctx.fill(raw);
  const lines = value.split("\n");
  return lines.map((line, index) => new Paragraph({
    alignment: ALIGN[align],
    spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO },
    children: splitPageTokens(line).map((part) => {
      const common = { size: size * 2, color: hex(TEXT_STYLES.headerFooter.color), bold: boldFirst && index === 0 && lines.length > 1 };
      if (part === "{PAGE}") return new TextRun({ ...common, children: [PageNumber.CURRENT] });
      if (part === "{PAGES}") return new TextRun({ ...common, children: [PageNumber.TOTAL_PAGES] });
      return new TextRun({ ...common, text: part });
    }),
  }));
}

function threeColumnTable(state, cells, borderBottom) {
  const widthTwips = Math.round(state.contentWidthPt * TWIPS_PER_PT);
  const columnWidths = cells.map((item) => Math.round(widthTwips * item.share));
  return new Table({
    width: { size: widthTwips, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: { ...NO_BORDERS, bottom: borderBottom || NO_BORDER },
    rows: [new TableRow({
      children: cells.map((item, index) => new TableCell({
        width: { size: columnWidths[index], type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        borders: { top: NO_BORDER, left: NO_BORDER, right: NO_BORDER, bottom: borderBottom || NO_BORDER },
        children: item.children.length ? item.children : [new Paragraph({})],
      })),
    })],
  });
}

function headerSection(state) {
  const { layout } = state.ctx;
  const size = TEXT_STYLES.headerFooter.fontSize;
  const logo = layout.header.showLogo ? logoBuffer() : null;
  const left = [];
  if (logo) {
    const natural = imageSize(logo) || { width: 400, height: 120 };
    const heightPx = (TEXT_STYLES.logoHeightMm * MM_TO_PT) / PX_TO_PT;
    left.push(new Paragraph({ spacing: { after: 0 }, children: [new ImageRun({ type: "png", data: logo, transformation: { width: Math.round((heightPx * natural.width) / natural.height), height: Math.round(heightPx) } })] }));
  }
  if (String(layout.header.left || "").trim()) left.push(...headerFooterParagraphs(state, layout.header.left, "left", true, size));
  const line = { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" };
  return new Header({
    children: [
      threeColumnTable(state, [
        { share: 0.36, children: left },
        { share: 0.28, children: headerFooterParagraphs(state, layout.header.center, "center", true, size) },
        { share: 0.36, children: headerFooterParagraphs(state, layout.header.right, "right", true, size) },
      ], line),
      new Paragraph({ spacing: { after: 0 }, children: [] }),
    ],
  });
}

function footerSection(state) {
  const { layout } = state.ctx;
  const style = TEXT_STYLES.headerFooter;
  const children = [
    new Paragraph({ spacing: { after: 40 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1", space: 1 } }, children: [] }),
    threeColumnTable(state, [
      { share: 0.45, children: headerFooterParagraphs(state, layout.footer.left, "left", false, style.fontSize) },
      { share: 0.2, children: headerFooterParagraphs(state, layout.footer.center, "center", false, style.fontSize) },
      { share: 0.35, children: headerFooterParagraphs(state, layout.footer.right, "right", false, style.fontSize) },
    ]),
  ];
  if (String(layout.footer.note || "").trim()) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 40, after: 0 },
      children: [new TextRun({ text: state.ctx.fill(layout.footer.note), size: style.noteSize * 2, color: hex(style.noteColor) })],
    }));
  }
  return new Footer({ children });
}

// ---------- body ----------

function blocks(list, state, inherited) {
  const out = [];
  for (const node of list || []) {
    const converted = block(node, state, inherited);
    if (Array.isArray(converted)) out.push(...converted.filter(Boolean));
    else if (converted) out.push(converted);
  }
  return out;
}

function block(node, state, inherited) {
  switch (node?.type) {
    case "paragraph":
      return textParagraphs(node, state, { ...inherited });
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level || 1)));
      return textParagraphs(node, state, { heading: level });
    }
    case "bulletList":
    case "orderedList":
      return listParagraphs(node, state, inherited);
    case "table":
      return [tableBlock(node, state), new Paragraph({ spacing: { after: 80 }, children: [] })];
    case "image":
      return imageParagraph(node, state);
    case "horizontalRule":
      return new Paragraph({ spacing: { before: 60, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "94A3B8", space: 1 } }, children: [] });
    case "pageBreak":
      return new Paragraph({ children: [new PageBreak()] });
    case "blockquote":
      return blocks(node.content, state, { ...inherited, quote: true });
    case "columns":
      return [columnsTable(node, state), new Paragraph({ spacing: { after: 60 }, children: [] })];
    default:
      return node?.content ? blocks(node.content, state, inherited) : null;
  }
}

function numberOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function paragraphOptions(node, inherited) {
  const attrs = node.attrs || {};
  const headingStyle = inherited.heading ? TEXT_STYLES[`heading${inherited.heading}`] : null;
  const baseAfter = inherited.spaceAfter ?? headingStyle?.spaceAfter ?? TEXT_STYLES.paragraph.spaceAfter;
  const baseBefore = headingStyle?.spaceBefore ?? 0;
  const spacing = {
    before: ptToTwips(numberOr(attrs.spaceBefore, baseBefore)),
    after: ptToTwips(numberOr(attrs.spaceAfter, baseAfter)),
  };
  const lineHeight = Number(attrs.lineHeight);
  spacing.line = Math.round(240 * (Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : DEFAULT_FONT.lineHeight));
  spacing.lineRule = LineRuleType.AUTO;
  const options = { spacing, alignment: ALIGN[attrs.textAlign] || AlignmentType.LEFT };
  const indent = {};
  if (Number(attrs.indent) > 0) indent.left = ptToTwips(attrs.indent) + (inherited.quote ? 360 : 0);
  else if (inherited.quote) indent.left = 360;
  if (Number(attrs.indentRight) > 0) indent.right = ptToTwips(attrs.indentRight);
  if (Number(attrs.firstLineIndent) > 0) indent.firstLine = ptToTwips(attrs.firstLineIndent);
  if (Object.keys(indent).length && !inherited.numbering) options.indent = indent;
  if (inherited.heading) options.heading = `Heading${inherited.heading}`;
  if (inherited.numbering) options.numbering = inherited.numbering;
  if (inherited.heading) options.keepNext = true;
  return options;
}

function textParagraphs(node, state, inherited) {
  const options = paragraphOptions(node, inherited);
  const children = inlineRuns(node.content || [], state, inherited);
  const out = [new Paragraph({ ...options, children })];
  const signature = (node.content || []).some((child) => child.type === "dataField" && child.attrs?.key === "signature");
  const image = signature ? parseDataUrl(state.ctx.fields.signatureImage) : null;
  if (image && ["png", "jpg"].includes(image.kind)) {
    const natural = imageSize(image.buffer) || { width: 300, height: 100 };
    const width = Math.min(170, natural.width);
    out.push(new Paragraph({ children: [new ImageRun({ type: image.kind, data: image.buffer, transformation: { width, height: Math.round((width * natural.height) / natural.width) } })] }));
  }
  return out;
}

function inlineRuns(content, state, inherited) {
  const runs = [];
  for (const child of content) {
    if (child.type === "hardBreak") {
      runs.push(new TextRun({ break: 1 }));
      continue;
    }
    let value = "";
    if (child.type === "text") value = child.text || "";
    else if (child.type === "dataField") value = String(state.ctx.fields[child.attrs?.key] ?? "");
    else continue;
    if (!value) continue;
    const { options, href } = runOptions(child.marks || [], inherited);
    const run = new TextRun({ ...options, text: value });
    if (href) runs.push(new ExternalHyperlink({ link: href, children: [new TextRun({ ...options, text: value, style: "Hyperlink" })] }));
    else runs.push(run);
  }
  return runs;
}

function runOptions(marks, inherited) {
  const options = {};
  let href = "";
  if (inherited.bold) options.bold = true;
  if (inherited.quote) options.italics = true;
  for (const mark of marks) {
    const attrs = mark.attrs || {};
    switch (mark.type) {
      case "bold": options.bold = true; break;
      case "italic": options.italics = true; break;
      case "underline": options.underline = {}; break;
      case "strike": options.strike = true; break;
      case "superscript": options.superScript = true; break;
      case "subscript": options.subScript = true; break;
      case "highlight": options.shading = { type: ShadingType.CLEAR, color: "auto", fill: hex(attrs.color) || "FFF59D" }; break;
      case "link":
        if (/^(https?:|mailto:)/i.test(attrs.href || "")) href = attrs.href;
        break;
      case "textStyle": {
        const color = hex(attrs.color);
        if (color) options.color = color;
        const size = parseFontSize(attrs.fontSize);
        if (size) options.size = Math.round(size * 2);
        if (attrs.fontFamily) options.font = String(attrs.fontFamily).split(",")[0].replace(/["']/g, "").trim();
        break;
      }
      default: break;
    }
  }
  return { options, href };
}

function listParagraphs(node, state, inherited) {
  const ordered = node.type === "orderedList";
  const level = Math.min(5, state.listDepth);
  if (ordered && level === 0) {
    state.listInstance += 1;
    state.listReference = numberingReference(Math.max(1, Number(node.attrs?.start || 1)));
  }
  const instance = ordered ? state.listInstance : 0;
  const reference = ordered ? state.listReference || "pacsd-numbers" : "pacsd-bullets";
  const out = [];
  for (const item of node.content || []) {
    let first = true;
    for (const child of item.content || []) {
      if (child.type === "bulletList" || child.type === "orderedList") {
        state.listDepth += 1;
        out.push(...listParagraphs(child, state, inherited));
        state.listDepth -= 1;
        continue;
      }
      if (child.type === "paragraph" || child.type === "heading") {
        const numbering = first
          ? { reference, level, ...(ordered ? { instance } : {}) }
          : undefined;
        const continuation = first ? child : { ...child, attrs: { ...(child.attrs || {}), indent: (360 + level * 360) / TWIPS_PER_PT } };
        out.push(...textParagraphs(continuation, state, { ...inherited, spaceAfter: TEXT_STYLES.listParagraph.spaceAfter, numbering }));
        first = false;
        continue;
      }
      out.push(...[].concat(block(child, state, inherited) || []));
    }
  }
  return out;
}

function cellBorders(color = "94A3B8") {
  const line = { style: BorderStyle.SINGLE, size: 4, color };
  return { top: line, bottom: line, left: line, right: line };
}

function tableBlock(node, state) {
  const rows = node.content || [];
  const widthsPx = [];
  let columnCount = 0;
  const occupied = [];
  rows.forEach((row, r) => {
    occupied[r] = occupied[r] || [];
    let c = 0;
    for (const cell of row.content || []) {
      while (occupied[r][c]) c += 1;
      const colspan = Math.max(1, Number(cell.attrs?.colspan || 1));
      const rowspan = Math.max(1, Number(cell.attrs?.rowspan || 1));
      const colwidth = Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth : [];
      for (let dr = 0; dr < rowspan; dr += 1) {
        occupied[r + dr] = occupied[r + dr] || [];
        for (let dc = 0; dc < colspan; dc += 1) occupied[r + dr][c + dc] = true;
      }
      for (let dc = 0; dc < colspan; dc += 1) if (widthsPx[c + dc] === undefined && Number(colwidth[dc]) > 0) widthsPx[c + dc] = Number(colwidth[dc]);
      c += colspan;
      columnCount = Math.max(columnCount, c);
    }
  });
  const totalTwips = Math.round(state.contentWidthPt * TWIPS_PER_PT);
  let columnWidths;
  if (columnCount && widthsPx.filter(Boolean).length === columnCount) {
    columnWidths = widthsPx.map((px) => Math.round(px * PX_TO_PT * TWIPS_PER_PT));
    const sum = columnWidths.reduce((a, b) => a + b, 0);
    if (sum > totalTwips) columnWidths = columnWidths.map((value) => Math.round((value * totalTwips) / sum));
  } else {
    columnWidths = Array.from({ length: Math.max(1, columnCount) }, () => Math.round(totalTwips / Math.max(1, columnCount)));
  }
  const tableWidth = columnWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    rows: rows.map((row) => new TableRow({
      cantSplit: true,
      children: (row.content || []).map((cell) => {
        const header = cell.type === "tableHeader";
        const fill = hex(cell.attrs?.backgroundColor) || (header ? hex(TEXT_STYLES.tableHeaderFill) : "");
        const colspan = Math.max(1, Number(cell.attrs?.colspan || 1));
        const rowspan = Math.max(1, Number(cell.attrs?.rowspan || 1));
        const content = blocks(cell.content, state, { spaceAfter: 0, bold: header });
        return new TableCell({
          children: content.length ? content : [new Paragraph({})],
          columnSpan: colspan > 1 ? colspan : undefined,
          rowSpan: rowspan > 1 ? rowspan : undefined,
          shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
          borders: cellBorders(),
          margins: { top: 50, bottom: 50, left: 90, right: 90 },
        });
      }),
    })),
  });
}

function columnsTable(node, state) {
  const columns = node.content || [];
  const count = Math.max(1, columns.length);
  const totalTwips = Math.round(state.contentWidthPt * TWIPS_PER_PT);
  const width = Math.round(totalTwips / count);
  return new Table({
    width: { size: totalTwips, type: WidthType.DXA },
    columnWidths: columns.map(() => width),
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [new TableRow({
      height: { value: 0, rule: HeightRule.AUTO },
      children: columns.map((column) => new TableCell({
        width: { size: width, type: WidthType.DXA },
        borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
        margins: { left: 0, right: 140 },
        children: (() => {
          const content = blocks(column.content, { ...state, contentWidthPt: state.contentWidthPt / count }, {});
          return content.length ? content : [new Paragraph({})];
        })(),
      })),
    })],
  });
}

function imageParagraph(node, state) {
  const data = parseDataUrl(node.attrs?.src);
  if (!data || !["png", "jpg", "gif", "bmp"].includes(data.kind)) return null;
  const natural = imageSize(data.buffer);
  const maxPx = state.contentWidthPt / PX_TO_PT;
  let width = Number(node.attrs?.width) || natural?.width || maxPx;
  let height = Number(node.attrs?.height) || (natural ? (width * natural.height) / natural.width : width * 0.75);
  if (natural && !node.attrs?.height) height = (width * natural.height) / natural.width;
  if (width > maxPx) {
    height = (height * maxPx) / width;
    width = maxPx;
  }
  return new Paragraph({
    alignment: ALIGN[node.attrs?.align] || AlignmentType.LEFT,
    spacing: { after: 120 },
    children: [new ImageRun({ type: data.kind, data: data.buffer, transformation: { width: Math.round(width), height: Math.round(height) } })],
  });
}
