export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalFromOrientation(orientation) {
  if (!Array.isArray(orientation) || orientation.length < 6) return null;
  if (orientation.some((value) => !Number.isFinite(value))) return null;
  const normal = cross(orientation.slice(0, 3), orientation.slice(3, 6));
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (!length) return null;
  return normal.map((value) => value / length);
}

export function sliceCoord(instance) {
  const normal = normalFromOrientation(instance?.imageOrientationPatient);
  const position = instance?.imagePositionPatient;
  if (!normal || !Array.isArray(position) || position.length < 3) return null;
  if (position.some((value) => !Number.isFinite(value))) return null;
  return dot(position, normal);
}

export function sortInstances(instances) {
  return [...(instances || [])].sort((a, b) => {
    const left = sliceCoord(a);
    const right = sliceCoord(b);
    if (left != null && right != null && left !== right) return left - right;
    const seriesDelta = (a.instanceNumber || 0) - (b.instanceNumber || 0);
    if (seriesDelta) return seriesDelta;
    return String(a.sopUid || "").localeCompare(String(b.sopUid || ""));
  });
}

function roundedOrientation(orientation) {
  return orientation.map((value) => Math.round(value * 1000) / 1000).join(",");
}

export function volumeAssessment(instances) {
  const list = instances || [];
  if (list.some((item) => (item.numberOfFrames || 1) > 1)) {
    return {
      ready: false,
      reason: "This series contains a multiframe object without a separate position for every frame. It can play as cine, and it is not reconstructed as a volume.",
    };
  }
  if (list.length < 2) {
    return { ready: false, reason: "A volume needs at least two slices from the source series." };
  }
  const positioned = list.filter((item) => sliceCoord(item) != null && item.rows > 0 && item.columns > 0);
  if (positioned.length < 2) {
    return {
      ready: false,
      reason: "Image position or orientation is missing, so a geometrically valid volume cannot be built from this series.",
    };
  }
  const spacing = positioned.filter((item) => Array.isArray(item.pixelSpacing) && item.pixelSpacing.length >= 2);
  if (spacing.length < positioned.length) {
    return {
      ready: false,
      reason: "Pixel spacing is missing on one or more slices, so the volume would not have a valid physical size.",
    };
  }
  const reference = positioned[0].frameOfReferenceUid || "";
  if (reference && positioned.some((item) => item.frameOfReferenceUid && item.frameOfReferenceUid !== reference)) {
    return { ready: false, reason: "This series mixes frame-of-reference UIDs and cannot be one volume." };
  }
  const orientation = roundedOrientation(positioned[0].imageOrientationPatient);
  if (positioned.some((item) => roundedOrientation(item.imageOrientationPatient) !== orientation)) {
    return { ready: false, reason: "Slice orientations differ, so this series is not one reconstructable stack." };
  }
  const rows = positioned[0].rows;
  const columns = positioned[0].columns;
  if (positioned.some((item) => item.rows !== rows || item.columns !== columns)) {
    return { ready: false, reason: "Slice dimensions differ, so these images cannot form one volume." };
  }
  const positions = positioned.map(sliceCoord).sort((a, b) => a - b);
  const span = positions[positions.length - 1] - positions[0];
  const step = positions.length > 1 ? span / (positions.length - 1) : 0;
  return { ready: true, reason: "", slices: positioned.length, spacing: step, span };
}

const DIRECTION = [
  [0, "R", "L"],
  [1, "A", "P"],
  [2, "F", "H"],
];

export function directionLetter(vector) {
  if (!Array.isArray(vector) || vector.length < 3) return "";
  const ranked = DIRECTION.map(([index, negative, positive]) => ({
    magnitude: Math.abs(vector[index]),
    letter: vector[index] >= 0 ? positive : negative,
  })).sort((a, b) => b.magnitude - a.magnitude);
  return ranked[0].magnitude >= 0.2 ? ranked[0].letter : "";
}

const OPPOSITE = { L: "R", R: "L", A: "P", P: "A", H: "F", F: "H" };

export function orientationMarkers(orientation) {
  if (!Array.isArray(orientation) || orientation.length < 6) return null;
  const right = directionLetter(orientation.slice(0, 3));
  const bottom = directionLetter(orientation.slice(3, 6));
  if (!OPPOSITE[right] || !OPPOSITE[bottom]) return null;
  return { left: OPPOSITE[right], right, top: OPPOSITE[bottom], bottom };
}
