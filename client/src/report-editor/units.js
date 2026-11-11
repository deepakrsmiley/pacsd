export const PX_PER_MM = 96 / 25.4;
export const PX_PER_PT = 96 / 72;

export function mmToPx(mm) {
  return Number(mm) * PX_PER_MM;
}

export function cssLengthToPt(value) {
  const match = String(value || "").trim().match(/^(-?[\d.]+)(pt|px|in|cm|mm|em)?$/);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  switch (match[2]) {
    case "px": return number * 0.75;
    case "in": return number * 72;
    case "cm": return (number * 72) / 2.54;
    case "mm": return (number * 72) / 25.4;
    case "em": return number * 11;
    default: return number;
  }
}

export function toHexColor(value) {
  const text = String(value || "").trim();
  if (!text || text === "transparent" || text === "inherit" || text === "initial") return "";
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) return `#${text.slice(1).split("").map((c) => c + c).join("")}`.toLowerCase();
  const rgb = text.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/i);
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return "";
    return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("")}`;
  }
  return "";
}

export function uid(prefix = "id") {
  const random = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
