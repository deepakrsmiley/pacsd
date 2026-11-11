// Display starting points in Hounsfield units. They are not valid for every
// scanner, reconstruction kernel, or study, and the reader should adjust them.
export const CT_WINDOW_PRESETS = [
  { id: "lung", label: "Lung", center: -600, width: 1500 },
  { id: "bone", label: "Bone", center: 300, width: 1500 },
  { id: "soft", label: "Soft Tissue", center: 40, width: 400 },
  { id: "brain", label: "Brain", center: 40, width: 80 },
  { id: "abdomen", label: "Abdomen", center: 60, width: 400 },
  { id: "liver", label: "Liver", center: 80, width: 150 },
  { id: "mediastinum", label: "Mediastinum", center: 50, width: 350 },
];

export function windowToRange(center, width) {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeCenter = Number.isFinite(center) ? center : 0;
  return {
    lower: safeCenter - safeWidth / 2,
    upper: safeCenter + safeWidth / 2,
  };
}

export function rangeToWindow(range) {
  if (!range || !Number.isFinite(range.lower) || !Number.isFinite(range.upper)) return null;
  return {
    width: range.upper - range.lower,
    center: (range.upper + range.lower) / 2,
  };
}
