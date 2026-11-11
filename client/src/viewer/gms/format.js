export function formatStudyDate(value) {
  const text = String(value || "").trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text;
}

export function formatAge(birthDate, onDate) {
  const born = parseDate(birthDate);
  const at = parseDate(onDate) || new Date();
  if (!born) return "";
  let age = at.getFullYear() - born.getFullYear();
  const month = at.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && at.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age < 130 ? `${age}Y` : "";
}

export function formatSex(sex) {
  const value = String(sex || "").trim().toUpperCase();
  if (value.startsWith("M")) return "M";
  if (value.startsWith("F")) return "F";
  return value.slice(0, 1);
}

export function framesOf(series) {
  const frames = [];
  let index = 0;
  for (const instance of series?.instances || []) {
    const count = Math.max(1, Number(instance.numberOfFrames) || 1);
    for (let frame = 0; frame < count; frame += 1) {
      frames.push({
        index,
        frame,
        instance,
        label: frames.length + 1,
      });
      index += 1;
    }
  }
  return frames;
}

function parseDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d{8}$/.test(text)) {
    const date = new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
