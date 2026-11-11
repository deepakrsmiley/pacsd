function round(value) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 100) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

function firstStats(annotation) {
  const stats = annotation?.data?.cachedStats;
  if (!stats || typeof stats !== "object") return {};
  const values = Object.values(stats);
  return values.find((item) => item && typeof item === "object") || {};
}

export function summarizeAnnotations(annotations, modality = "") {
  return (annotations || []).map((item, index) => {
    const stats = firstStats(item);
    const tool = item?.metadata?.toolName || "Annotation";
    const parts = [];
    const unit = stats.unit || "";
    if (Number.isFinite(stats.length)) parts.push(`Length ${round(stats.length)} ${unit}`.trim());
    if (Number.isFinite(stats.width)) parts.push(`Width ${round(stats.width)} ${unit}`.trim());
    if (Number.isFinite(stats.angle)) parts.push(`Angle ${round(stats.angle)}°`);
    if (Number.isFinite(stats.area)) parts.push(`Area ${round(stats.area)} ${stats.areaUnit || unit}`.trim());
    if (Number.isFinite(stats.perimeter)) parts.push(`Perimeter ${round(stats.perimeter)} ${unit}`.trim());
    const sample = [stats.mean, stats.value, stats.modalityValue].find((value) => Number.isFinite(value));
    if (Number.isFinite(sample)) {
      const sampleUnit = modality === "CT" ? "HU" : (stats.modalityUnit || "value");
      parts.push(`Mean ${round(sample)} ${sampleUnit}`.trim());
    }
    if (Number.isFinite(stats.max)) parts.push(`Max ${round(stats.max)}`);
    if (Number.isFinite(stats.min)) parts.push(`Min ${round(stats.min)}`);
    const label = item?.data?.label || item?.data?.text || "";
    if (label) parts.push(String(label));
    return {
      id: item?.annotationUID || `annotation-${index}`,
      tool,
      text: parts.join(" · ") || tool,
    };
  });
}
