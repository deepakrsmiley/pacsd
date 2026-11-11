export function fitScale(source, width, height) {
  return Math.min(width / source.width, height / source.height) * 0.92;
}

export function imageToScreen(point, source, view, width, height) {
  const scale = fitScale(source, width, height) * view.zoom;
  let x = (point.x - source.width / 2) * scale * (view.flipH ? -1 : 1);
  let y = (point.y - source.height / 2) * scale * (view.flipV ? -1 : 1);
  const radians = (view.rotation * Math.PI) / 180;
  const rx = x * Math.cos(radians) - y * Math.sin(radians);
  const ry = x * Math.sin(radians) + y * Math.cos(radians);
  return [rx + width / 2 + view.panX, ry + height / 2 + view.panY];
}

export function acceptedAnnotations(findings, { columns, rows, annotationsSupported }) {
  if (!annotationsSupported) return [];
  const widthLimit = Number(columns);
  const heightLimit = Number(rows);
  if (!Number.isFinite(widthLimit) || !Number.isFinite(heightLimit) || widthLimit <= 0 || heightLimit <= 0) return [];
  const boxes = [];
  for (const finding of findings || []) {
    if (finding?.decision === "rejected" || finding?.hidden) continue;
    const box = finding?.box;
    if (!box || box.source === "manual") continue;
    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width);
    const height = Number(box.height);
    const frame = Number(box.frame);
    if (![x, y, width, height].every(Number.isFinite)) continue;
    if (width <= 0 || height <= 0) continue;
    if (x < 0 || y < 0 || x + width > widthLimit + 0.5 || y + height > heightLimit + 0.5) continue;
    boxes.push({
      x, y, width, height,
      frame: Number.isFinite(frame) ? frame : 0,
      instanceId: String(box.instanceId || finding.instanceId || ""),
      label: String(finding.title || "Finding"),
      index: boxes.length + 1,
      source: "ai",
    });
  }
  return boxes;
}
