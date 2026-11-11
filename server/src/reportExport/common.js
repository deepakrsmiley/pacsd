import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  docFromLegacyFields,
  exportableDoc,
  fillTokens,
  headerFooterTokens,
  isDocNode,
  normalizeLayout,
  pageDimensions,
  resolveFieldValues,
} from "../../../shared/reportDocument.js";

const logoPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../client/public/gms-logo.png");
let logoCache;

export function logoBuffer() {
  if (logoCache !== undefined) return logoCache;
  logoCache = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;
  return logoCache;
}

// Everything an exporter needs, resolved once from the database records.
export function exportContext({ report, study, patient, facility, author, signer }) {
  const layout = normalizeLayout(report?.layout);
  const source = isDocNode(report?.doc) ? report.doc : docFromLegacyFields(report || {});
  const doc = exportableDoc(source);
  const fields = resolveFieldValues({ report, study, patient, facility, author, signer });
  const tokens = headerFooterTokens(fields);
  return {
    report,
    study,
    patient,
    facility,
    signer,
    layout,
    doc,
    fields,
    tokens,
    page: pageDimensions(layout),
    fill: (value) => fillTokens(value, tokens),
  };
}

export function cssColor(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) return `#${raw.slice(1).split("").map((c) => c + c).join("")}`.toLowerCase();
  const rgb = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
  const named = { black: "#000000", white: "#ffffff", red: "#ff0000", yellow: "#ffff00", green: "#008000", blue: "#0000ff", gray: "#808080", grey: "#808080" };
  return named[raw.toLowerCase()] || "";
}

export function parseDataUrl(src) {
  const match = String(src || "").match(/^data:(image\/(png|jpe?g|gif|bmp));base64,(.+)$/i);
  if (!match) return null;
  const kind = match[2].toLowerCase().replace("jpeg", "jpg");
  return { mime: match[1].toLowerCase(), kind, buffer: Buffer.from(match[3], "base64") };
}

// Natural pixel size from PNG or JPEG headers.
export function imageSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

export function markOf(node, type) {
  return (node?.marks || []).find((mark) => mark.type === type) || null;
}

// Splits header/footer text into pieces around the page tokens.
export function splitPageTokens(value) {
  return String(value || "").split(/(\{PAGE\}|\{PAGES\})/).filter((part) => part !== "");
}

export function reportFileName(ctx, extension) {
  const parts = ["Report", ctx.patient?.mrn, ctx.study?.accession, ctx.report?.status === "final" ? "final" : ctx.report?.status || "draft"]
    .filter(Boolean)
    .map((part) => String(part).replace(/[^A-Za-z0-9_-]+/g, "-"));
  return `${parts.join("_")}.${extension}`;
}
