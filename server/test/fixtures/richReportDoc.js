import { buildReportDoc, paragraph, text } from "../../../shared/reportDocument.js";

// 1x1 PNG
export const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// A report that uses every node and mark the editor can produce.
export function richReportDoc() {
  const doc = buildReportDoc({
    subtitle: "CT Brain",
    sections: {
      clinical: ["Headache for two weeks."],
      technique: ["Non-contrast axial CT."],
      findings: [
        paragraph([
          text("Bold ", [{ type: "bold" }]),
          text("italic ", [{ type: "italic" }]),
          text("underline ", [{ type: "underline" }]),
          text("strike ", [{ type: "strike" }]),
          text("red 14pt Times ", [{ type: "textStyle", attrs: { color: "#c00000", fontSize: "14pt", fontFamily: "Times New Roman" } }]),
          text("highlight ", [{ type: "highlight", attrs: { color: "#fff59d" } }]),
          text("2", [{ type: "superscript" }]),
          text(" H"),
          text("2", [{ type: "subscript" }]),
          text("O "),
          text("link", [{ type: "link", attrs: { href: "https://example.org" } }]),
          text(" ≥ 5 mm ± 1 µm. தமிழ் देवनागरी"),
          { type: "hardBreak" },
          text("Second line after a break."),
        ], { textAlign: "justify", lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12, indent: 18, firstLineIndent: 18 }),
        { type: "bulletList", content: [
          { type: "listItem", content: [paragraph(["First bullet"]), { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [paragraph(["Nested number"])] }] }] },
          { type: "listItem", content: [paragraph(["Second bullet"])] },
        ] },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [paragraph(["Starts at three"])] }] },
        { type: "table", content: [
          { type: "tableRow", content: [
            { type: "tableHeader", attrs: { colspan: 2, rowspan: 1, colwidth: [120, 160] }, content: [paragraph(["Merged header"])] },
            { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: [200] }, content: [paragraph(["Third"])] },
          ] },
          { type: "tableRow", content: [
            { type: "tableCell", attrs: { colspan: 1, rowspan: 2, colwidth: [120], backgroundColor: "#e0f2fe" }, content: [paragraph(["Tall cell"])] },
            { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [160] }, content: [paragraph(["B2"])] },
            { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [200] }, content: [paragraph(["C2"])] },
          ] },
          { type: "tableRow", content: [
            { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [160] }, content: [paragraph(["B3"])] },
            { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [200] }, content: [paragraph(["C3"])] },
          ] },
        ] },
        { type: "image", attrs: { src: TINY_PNG, width: 120, height: 120, align: "center" } },
        { type: "horizontalRule" },
        { type: "columns", attrs: { count: 2 }, content: [
          { type: "column", content: [paragraph(["Left column"])] },
          { type: "column", content: [paragraph(["Right column"])] },
        ] },
        { type: "pageBreak" },
        paragraph(["After the page break."]),
        paragraph([text("Deleted text", [{ type: "deletion", attrs: { author: "A" } }]), text("Inserted text", [{ type: "insertion", attrs: { author: "A" } }])]),
      ],
      impression: ["No acute intracranial abnormality is stated in this synthetic test."],
      recommendations: [],
    },
  });
  return doc;
}
