const SKIN = {
  name: "PACSD-Skin",
  gradientOpacity: "4 0 1 255 1",
  specularPower: "10",
  scalarOpacity: "8 -1024 0 -520 0 -180 0.35 400 0.15",
  specular: "0.15",
  shade: "1",
  ambient: "0.25",
  colorTransfer: "16 -1024 0 0 0 -520 0.55 0.38 0.32 -180 0.86 0.67 0.55 400 0.92 0.78 0.68",
  diffuse: "0.9",
  interpolation: "1",
};

export const VOLUME_PRESETS = [
  { id: "bone", label: "Bone", name: "CT-Bone" },
  { id: "skin", label: "Skin", preset: SKIN },
  { id: "soft", label: "Soft Tissue", name: "CT-Soft-Tissue" },
  { id: "lung", label: "Lung", name: "CT-Lung" },
  { id: "angio", label: "CT Angiography", name: "CT-Coronary-Arteries" },
];

function rewrite(encoded, stride, mapPoint) {
  const parts = String(encoded || "").trim().split(/\s+/).map(Number);
  if (parts.length < 1 + stride || parts.some((value) => !Number.isFinite(value))) return encoded;
  const values = parts.slice(1);
  const next = [];
  for (let index = 0; index < values.length; index += stride) {
    next.push(...mapPoint(values.slice(index, index + stride)));
  }
  return [parts[0], ...next.map((value) => Number(value.toFixed(4)))].join(" ");
}

export function findVolumePreset(id, custom = []) {
  return custom.find((item) => item.id === id) || VOLUME_PRESETS.find((item) => item.id === id) || VOLUME_PRESETS[0];
}

export function transferPreset(libraries, selection, opacity = 1, brightness = 0) {
  const source = selection.preset
    || libraries.find((item) => item.name === selection.name)
    || libraries.find((item) => item.name === selection.base)
    || libraries[0];
  if (!source) return null;
  const gain = Number.isFinite(opacity) ? opacity : 1;
  const shift = Number.isFinite(brightness) ? brightness : 0;
  return {
    ...source,
    name: selection.label || source.name,
    scalarOpacity: rewrite(source.scalarOpacity, 2, ([value, alpha]) => [value + shift, Math.min(1, Math.max(0, alpha * gain))]),
    colorTransfer: rewrite(source.colorTransfer, 4, ([value, red, green, blue]) => [value + shift, red, green, blue]),
  };
}
