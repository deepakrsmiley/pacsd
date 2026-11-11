import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fonts");

// Editor font family -> TrueType files [regular, bold, italic, bold italic] and a
// standard PDF fallback used when the files are not installed on the server.
const FAMILIES = {
  Calibri: { files: ["calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf"], fallback: "Helvetica" },
  Arial: { files: ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"], fallback: "Helvetica" },
  "Segoe UI": { files: ["segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "segoeuiz.ttf"], fallback: "Helvetica" },
  Verdana: { files: ["verdana.ttf", "verdanab.ttf", "verdanai.ttf", "verdanaz.ttf"], fallback: "Helvetica" },
  Tahoma: { files: ["tahoma.ttf", "tahomabd.ttf", "tahoma.ttf", "tahomabd.ttf"], fallback: "Helvetica" },
  "Times New Roman": { files: ["times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"], fallback: "Times" },
  Georgia: { files: ["georgia.ttf", "georgiab.ttf", "georgiai.ttf", "georgiaz.ttf"], fallback: "Times" },
  Cambria: { files: ["cambria.ttc", "cambriab.ttf", "cambriai.ttf", "cambriaz.ttf"], fallback: "Times" },
  "Courier New": { files: ["cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"], fallback: "Courier" },
};

const STANDARD = {
  Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" },
  Times: { normal: "Times-Roman", bold: "Times-Bold", italics: "Times-Italic", bolditalics: "Times-BoldItalic" },
  Courier: { normal: "Courier", bold: "Courier-Bold", italics: "Courier-Oblique", bolditalics: "Courier-BoldOblique" },
};

function fontDirs() {
  const dirs = [];
  if (process.env.REPORT_FONT_DIR) dirs.push(process.env.REPORT_FONT_DIR);
  if (process.platform === "win32") dirs.push(path.join(process.env.WINDIR || "C:\\Windows", "Fonts"));
  dirs.push("/usr/share/fonts/truetype/msttcorefonts", "/usr/share/fonts/truetype/ms-fonts", "/Library/Fonts", "/System/Library/Fonts/Supplemental");
  return dirs;
}

function locate(file) {
  for (const dir of fontDirs()) {
    for (const name of [file, file.toUpperCase(), file.replace(/^./, (c) => c.toUpperCase())]) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "";
}

let cache = null;

// Returns { descriptors, familyFor(name), unicodeFamily, standard }.
export function reportFonts() {
  if (cache) return cache;
  const descriptors = { ...STANDARD };
  const resolved = {};
  for (const [family, spec] of Object.entries(FAMILIES)) {
    const found = spec.files.map(locate);
    // .ttc collections need a face name; skip a family whose regular face is a collection.
    if (found.every(Boolean) && !found[0].toLowerCase().endsWith(".ttc")) {
      descriptors[family] = { normal: found[0], bold: found[1], italics: found[2], bolditalics: found[3] };
      resolved[family] = family;
    } else {
      resolved[family] = spec.fallback;
    }
  }
  const noto = path.join(bundled, "NotoSans-Regular.ttf");
  const deva = path.join(bundled, "NotoSansDevanagari-Regular.ttf");
  const tamil = path.join(bundled, "NotoSansTamil-Regular.ttf");
  descriptors.NotoSans = { normal: noto, bold: noto, italics: noto, bolditalics: noto };
  descriptors.NotoSansDevanagari = { normal: deva, bold: deva, italics: deva, bolditalics: deva };
  descriptors.NotoSansTamil = { normal: tamil, bold: tamil, italics: tamil, bolditalics: tamil };
  cache = {
    descriptors,
    standard: new Set(Object.keys(STANDARD)),
    familyFor(name) {
      const clean = String(name || "").split(",")[0].replace(/["']/g, "").trim();
      if (resolved[clean]) return resolved[clean];
      if (/mono|courier|consol/i.test(clean)) return "Courier";
      if (/times|serif|georgia|garamond|cambria|book/i.test(clean) && !/sans/i.test(clean)) return resolved["Times New Roman"];
      return resolved.Calibri;
    },
  };
  return cache;
}

// Splits text into runs that a single font can draw. Standard PDF fonts only cover
// WinAnsi, so anything beyond Latin-1 falls back to Noto Sans.
export function splitByScript(value, family, fonts = reportFonts()) {
  const runs = [];
  const standard = fonts.standard.has(family);
  for (const char of String(value)) {
    const code = char.codePointAt(0);
    let font = family;
    if (code >= 0x0900 && code <= 0x097f) font = "NotoSansDevanagari";
    else if (code >= 0x0b80 && code <= 0x0bff) font = "NotoSansTamil";
    else if (standard && code > 0xff && !WIN_ANSI_EXTRA.has(code)) font = "NotoSans";
    const last = runs[runs.length - 1];
    if (last && last.font === font) last.text += char;
    else runs.push({ font, text: char });
  }
  return runs;
}

const WIN_ANSI_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
