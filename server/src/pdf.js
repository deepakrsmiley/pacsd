import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const DISCLAIMER = "This report is generated using PACSD by Galactic Medical Systems. This software is not a certified diagnostic device. A qualified radiologist must review the study before clinical use.";
const fontDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
const logoPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/public/gms-logo.png");

const MODALITY = {
  CT: "Computed Tomography (CT)",
  MR: "Magnetic Resonance Imaging (MRI)",
  DX: "Digital Radiography (DX)",
  CR: "Computed Radiography (CR)",
  US: "Ultrasound (US)",
  MG: "Mammography (MG)",
};

function fontFor(char) {
  const code = char.codePointAt(0);
  if (code >= 0x0900 && code <= 0x097f) return "NotoSansDevanagari";
  if (code >= 0x0b80 && code <= 0x0bff) return "NotoSansTamil";
  return "NotoSans";
}

function plainReportText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function writeLine(doc, value, options = {}) {
  const runs = [];
  for (const char of String(value ?? "")) {
    const font = fontFor(char);
    const last = runs[runs.length - 1];
    if (last?.font === font) last.text += char;
    else runs.push({ font, text: char });
  }
  if (!runs.length) {
    doc.font("NotoSans").text("", options);
    return;
  }
  runs.forEach((run, index) => {
    doc.font(run.font).text(run.text, { ...options, continued: index < runs.length - 1 });
  });
}

function section(doc, title, body) {
  if (doc.y > 720) doc.addPage();
  doc.moveDown(0.4);
  doc.fillColor("#5b21b6").fontSize(12);
  writeLine(doc, title);
  doc.fillColor("#1e1b4b").fontSize(10);
  writeLine(doc, plainReportText(body) || "Not recorded.");
}

export function renderReportPdf({ facility, patient, study, report, signer, images = [] }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: "A4" });
    doc.registerFont("NotoSans", path.join(fontDir, "NotoSans-Regular.ttf"));
    doc.registerFont("NotoSansDevanagari", path.join(fontDir, "NotoSansDevanagari-Regular.ttf"));
    doc.registerFont("NotoSansTamil", path.join(fontDir, "NotoSansTamil-Regular.ttf"));
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.save();
    doc.rect(0, 0, doc.page.width, 78).fill("#4c1d95");
    doc.restore();
    if (fs.existsSync(logoPath)) doc.image(logoPath, 28, 16, { height: 46 });
    doc.fillColor("#ffffff").font("NotoSans").fontSize(18).text("RADIOLOGY REPORT", 80, 22, { width: 430, align: "center" });
    doc.fontSize(10).text(MODALITY[study?.modality] || study?.modality || "Imaging study", 80, 46, { width: 430, align: "center" });
    doc.y = 96;
    doc.fillColor("#1e1b4b").fontSize(11);
    writeLine(doc, `Patient: ${patient?.name || "Not recorded"}`);
    writeLine(doc, `MRN: ${patient?.mrn || ""}    Sex: ${patient?.sex || ""}    DOB: ${patient?.birthDate || ""}`);
    writeLine(doc, `Accession: ${study?.accession || ""}    Modality: ${study?.modality || ""}`);
    writeLine(doc, `Study: ${study?.description || ""}    Date: ${study?.studyDate || ""}`);
    writeLine(doc, `Facility: ${facility?.name || "Galactic Medical Systems"}`);
    const signed = report.status === "preliminary" || report.status === "final";
    writeLine(doc, `Status: ${report.status}    Signed: ${signed && report.signedAt ? new Date(report.signedAt).toLocaleString() : "Not signed"}`);
    writeLine(doc, `Signer: ${signed ? (signer?.name || "Radiologist") : "Not signed"}`);

    const previews = images.filter((image) => image?.length).slice(0, 4);
    if (previews.length) {
      doc.moveDown(0.6);
      doc.fillColor("#5b21b6").fontSize(12);
      writeLine(doc, "Key images");
      const top = doc.y + 6;
      previews.forEach((image, index) => {
        try {
          doc.image(image, 36 + index * 132, top, { fit: [120, 90] });
        } catch {
          // A preview that is not a supported image is left out.
        }
      });
      doc.y = top + 100;
      doc.fillColor("#1e1b4b").fontSize(9);
      writeLine(doc, "The finding in the report is the text below. A mark is drawn on an image only when the analysis returns a location.");
    }

    section(doc, "Clinical information", report.clinical || report.indication);
    section(doc, "Comparison", report.comparison);
    section(doc, "Technique", report.technique);
    section(doc, "Findings", report.findings);
    section(doc, "Impression", report.impression);
    section(doc, "Recommendations", report.recommendations);
    doc.moveDown(0.8);
    doc.fillColor("#5b21b6").fontSize(12);
    writeLine(doc, signed ? "Radiology department signature" : "Not signed");
    doc.fillColor("#1e1b4b").fontSize(10);
    writeLine(doc, signed ? `${signer?.name || "Radiologist"} · ${report.status}` : "Draft report. The radiology department has not signed this copy.");
    doc.moveDown();
    doc.fontSize(8).fillColor("#444444");
    writeLine(doc, DISCLAIMER);
    doc.end();
  });
}

export { DISCLAIMER };
