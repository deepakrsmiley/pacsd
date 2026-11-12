import { orientationMarkers } from "../../../shared/dicomGeometry.js";

export function imageIdsFor(instance) {
  if (instance && instance.fileAvailable === false && !instance.hasArchiveCopy) return [];
  const frames = Math.max(1, Number(instance.numberOfFrames) || 1);
  const base = `/api/dicomweb/instances/${instance._id}/file`;
  if (frames === 1) return [`wadouri:${base}`];
  return Array.from({ length: frames }, (_, frame) => `wadouri:${base}?frame=${frame}`);
}

export function seriesImageIds(series) {
  const instances = series?.instances || [];
  const usable = instances.some((item) => item.fileAvailable !== false)
    ? instances.filter((item) => item.fileAvailable !== false)
    : instances;
  return usable.flatMap((instance) => imageIdsFor(instance));
}

function planeModule(instance) {
  const orientation = instance.imageOrientationPatient || [];
  const spacing = instance.pixelSpacing || [];
  if (orientation.length < 6 || spacing.length < 2) return undefined;
  return {
    frameOfReferenceUID: instance.frameOfReferenceUid || undefined,
    rows: instance.rows,
    columns: instance.columns,
    imageOrientationPatient: orientation,
    rowCosines: orientation.slice(0, 3),
    columnCosines: orientation.slice(3, 6),
    imagePositionPatient: instance.imagePositionPatient,
    pixelSpacing: spacing,
    rowPixelSpacing: spacing[0],
    columnPixelSpacing: spacing[1],
    sliceThickness: instance.sliceThickness,
    spacingBetweenSlices: instance.spacingBetweenSlices,
  };
}

function modulesFor(instance, series, study) {
  const bitsStored = instance.bitsStored || instance.bitsAllocated || 8;
  return {
    imagePlaneModule: planeModule(instance),
    imagePixelModule: {
      samplesPerPixel: instance.samplesPerPixel || 1,
      photometricInterpretation: instance.photometric || "MONOCHROME2",
      rows: instance.rows,
      columns: instance.columns,
      bitsAllocated: instance.bitsAllocated || 8,
      bitsStored,
      highBit: Math.max(0, bitsStored - 1),
      pixelRepresentation: instance.pixelRepresentation || 0,
    },
    generalSeriesModule: {
      modality: series.modality || study.modality || "",
      seriesInstanceUID: series.seriesUid,
      seriesNumber: series.seriesNumber,
    },
    voiLutModule: Number.isFinite(instance.windowCenter) && Number.isFinite(instance.windowWidth)
      ? { windowCenter: [instance.windowCenter], windowWidth: [instance.windowWidth] }
      : undefined,
    modalityLutModule: {
      rescaleSlope: Number.isFinite(instance.slope) ? instance.slope : 1,
      rescaleIntercept: Number.isFinite(instance.intercept) ? instance.intercept : 0,
    },
  };
}

export function metadataEntries(study, series) {
  const entries = [];
  for (const instance of series?.instances || []) {
    const modules = modulesFor(instance, series, study);
    imageIdsFor(instance).forEach((imageId) => entries.push({ imageId, modules }));
  }
  return entries;
}

export function markersFor(instance) {
  return orientationMarkers(instance?.imageOrientationPatient);
}

export function instanceAt(series, imageIndex) {
  let cursor = 0;
  for (const instance of series?.instances || []) {
    const frames = Math.max(1, Number(instance.numberOfFrames) || 1);
    if (imageIndex < cursor + frames) return { instance, frame: imageIndex - cursor };
    cursor += frames;
  }
  return { instance: series?.instances?.[0] || null, frame: 0 };
}
