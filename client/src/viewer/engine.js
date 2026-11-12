import vtkPlane from "@kitware/vtk.js/Common/DataModel/Plane";
import {
  CONSTANTS,
  Enums,
  RenderingEngine,
  cache,
  eventTarget,
  getRenderingEngine,
  init as coreInit,
  metaData,
  setVolumesForViewports,
  utilities,
  volumeLoader,
} from "@cornerstonejs/core";
import { init as dicomImageLoaderInit } from "@cornerstonejs/dicom-image-loader";
import {
  AngleTool,
  ArrowAnnotateTool,
  BidirectionalTool,
  CobbAngleTool,
  CrosshairsTool,
  EllipticalROITool,
  Enums as toolEnums,
  LabelTool,
  LengthTool,
  OrientationMarkerTool,
  PanTool,
  PlanarFreehandROITool,
  ProbeTool,
  RectangleROITool,
  ReferenceLinesTool,
  ScaleOverlayTool,
  StackScrollTool,
  SynchronizerManager,
  ToolGroupManager,
  TrackballRotateTool,
  VolumeCroppingTool,
  WindowLevelTool,
  ZoomTool,
  addTool,
  annotation,
  init as toolsInit,
  synchronizers,
  utilities as toolUtilities,
} from "@cornerstonejs/tools";
import { transferPreset } from "./volumePresets.js";

const ENGINE_ID = "pacsd-workstation";
const GROUP_ID = "pacsd-tools";

const TOOL_LIST = [
  WindowLevelTool, ZoomTool, PanTool, StackScrollTool, LengthTool, AngleTool, CobbAngleTool,
  RectangleROITool, EllipticalROITool, PlanarFreehandROITool, ProbeTool, LabelTool, ArrowAnnotateTool,
  BidirectionalTool, CrosshairsTool, TrackballRotateTool, VolumeCroppingTool, OrientationMarkerTool,
  ScaleOverlayTool, ReferenceLinesTool,
];

export const TOOL_NAMES = {
  window: WindowLevelTool.toolName,
  zoom: ZoomTool.toolName,
  pan: PanTool.toolName,
  scroll: StackScrollTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
  cobb: CobbAngleTool.toolName,
  rectangle: RectangleROITool.toolName,
  ellipse: EllipticalROITool.toolName,
  freehand: PlanarFreehandROITool.toolName,
  probe: ProbeTool.toolName,
  text: LabelTool.toolName,
  arrow: ArrowAnnotateTool.toolName,
  bidirectional: BidirectionalTool.toolName,
  crosshair: CrosshairsTool.toolName,
  rotate: TrackballRotateTool.toolName,
  crop: VolumeCroppingTool.toolName,
};

const SLICE_TOOLS = ["window", "zoom", "pan", "scroll", "length", "angle", "cobb", "rectangle", "ellipse", "freehand", "probe", "text", "arrow", "bidirectional"];

// Crosshairs and the 3D tools initialise themselves even when passive and fail on viewports they do not support.
const MODE_TOOLS = {
  stack: SLICE_TOOLS,
  projection: SLICE_TOOLS,
  mpr: [...SLICE_TOOLS, "crosshair"],
  volume: ["window", "zoom", "pan", "scroll", "rotate", "crop"],
};

function toolsForMode(mode) {
  return MODE_TOOLS[mode] || SLICE_TOOLS;
}

const BLEND = {
  composite: Enums.BlendModes.COMPOSITE,
  mip: Enums.BlendModes.MAXIMUM_INTENSITY_BLEND,
  minip: Enums.BlendModes.MINIMUM_INTENSITY_BLEND,
  average: Enums.BlendModes.AVERAGE_INTENSITY_BLEND,
};

const metadataByImage = new Map();
let ready;
let providerRegistered = false;

function metadataProvider(type, imageId) {
  const modules = metadataByImage.get(imageId);
  if (!modules || modules[type] == null) return undefined;
  return modules[type];
}

export function setImageMetadata(entries) {
  metadataByImage.clear();
  for (const entry of entries || []) metadataByImage.set(entry.imageId, entry.modules);
}

function ensureMetadataProvider() {
  if (providerRegistered) return;
  metaData.addProvider(metadataProvider, -1);
  providerRegistered = true;
}

export function initCornerstone() {
  if (!ready) {
    ready = (async () => {
      await coreInit();
      await toolsInit();
      await dicomImageLoaderInit({
        maxWebWorkers: Math.min(4, navigator.hardwareConcurrency || 2),
        beforeSend: (xhr) => {
          xhr.withCredentials = true;
        },
        // Part-10 files are decoded from the stored bytes. The naturalized
        // metadata loader expects pixel data that this archive does not pre-parse.
        useLegacyMetadataProvider: true,
      });
      cache.setMaxCacheSize(768 * 1024 * 1024);
      ensureMetadataProvider();
      for (const tool of TOOL_LIST) {
        try {
          addTool(tool);
        } catch {
          // Tools stay registered for the life of the page.
        }
      }
      toolUtilities.stackPrefetch?.setConfiguration?.({ maxImagesToPrefetch: 10, preserveExistingPool: false });
    })();
  }
  return ready;
}

function viewportType(mode) {
  if (mode === "stack") return Enums.ViewportType.STACK;
  if (mode === "volume") return Enums.ViewportType.VOLUME_3D;
  return Enums.ViewportType.ORTHOGRAPHIC;
}

export function createViewerEngine() {
  let token = 0;
  let renderingEngine = null;
  let toolGroup = null;
  let mode = "stack";
  let activeIndex = 0;
  let tool = "window";
  let volumeId = "";
  let annotationKey = "";
  let restoring = false;
  let cropFraction = 0;
  const listeners = new Set();
  const wheelCleanups = [];
  let annotationListener = null;
  let snapshot = emptySnapshot();

  function viewports() {
    if (!renderingEngine) return [];
    return renderingEngine.getViewports() || [];
  }

  function activeViewport() {
    return viewports()[activeIndex] || viewports()[0] || null;
  }

  let publishFrame = 0;

  function publishNow() {
    publishFrame = 0;
    snapshot = readSnapshot();
    for (const listener of listeners) listener(snapshot);
  }

  // Render, camera and VOI events fire on every mouse move while a tool drags.
  function publish() {
    if (publishFrame) return;
    publishFrame = requestAnimationFrame(publishNow);
  }

  function readSnapshot() {
    const viewport = activeViewport();
    const properties = viewport?.getProperties?.() || {};
      const windowLevel = properties.voiRange
        ? utilities.windowLevel.toWindowLevel(properties.voiRange.lower, properties.voiRange.upper)
        : null;
    const index = viewport?.getCurrentImageIdIndex?.() ?? viewport?.getSliceIndex?.() ?? 0;
    const count = viewport?.getNumberOfSlices?.() ?? viewport?.getImageIds?.()?.length ?? 0;
    let loaded = 0;
    const volume = volumeId ? cache.getVolume(volumeId) : null;
    const total = volume?.imageIds?.length || 0;
    if (volume?.imageIds) loaded = volume.imageIds.filter((imageId) => cache.isLoaded(imageId)).length;
    return {
      slice: index,
      count,
      windowCenter: windowLevel?.windowCenter,
      windowWidth: windowLevel?.windowWidth,
      zoom: viewport?.getZoom?.() || 1,
      measurements: annotation.state.getAllAnnotations(),
      loaded,
      total,
      mode,
      tool,
    };
  }

  let loadErrorListener = null;

  function onRendered() {
    publish();
  }

  function onAnnotation() {
    publish();
    if (!restoring && annotationListener) annotationListener(annotation.state.getAllAnnotations());
  }

  function onImageLoadFailed(event) {
    const detail = event?.detail || {};
    const message = detail.error?.message || detail.message || "The DICOM image could not be loaded";
    if (loadErrorListener) loadErrorListener(message);
  }

  async function init() {
    await initCornerstone();
    if (!renderingEngine) {
      renderingEngine = getRenderingEngine(ENGINE_ID) || new RenderingEngine(ENGINE_ID);
      eventTarget.addEventListener(Enums.Events.IMAGE_RENDERED, onRendered);
      eventTarget.addEventListener(Enums.Events.STACK_NEW_IMAGE, onRendered);
      eventTarget.addEventListener(Enums.Events.VOI_MODIFIED, onRendered);
      eventTarget.addEventListener(Enums.Events.CAMERA_MODIFIED, onRendered);
      eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_FAILED, onImageLoadFailed);
      eventTarget.addEventListener(toolEnums.Events.ANNOTATION_COMPLETED, onAnnotation);
      eventTarget.addEventListener(toolEnums.Events.ANNOTATION_MODIFIED, onAnnotation);
      eventTarget.addEventListener(toolEnums.Events.ANNOTATION_REMOVED, onAnnotation);
    }
  }

  function clearWheel() {
    while (wheelCleanups.length) wheelCleanups.pop()();
  }

  function bindWheel(element) {
    const onWheel = (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const viewport = renderingEngine?.getViewports().find((item) => item.element === element);
      if (!viewport?.getZoom || !viewport.setZoom) return;
      const next = viewport.getZoom() * (event.deltaY > 0 ? 0.9 : 1.1);
      viewport.setZoom(Math.min(30, Math.max(0.05, next)));
      viewport.render();
    };
    element.addEventListener("wheel", onWheel, { capture: true, passive: false });
    wheelCleanups.push(() => element.removeEventListener("wheel", onWheel, { capture: true }));
  }

  function buildToolGroup(viewportIds, nextMode) {
    const existing = ToolGroupManager.getToolGroup(GROUP_ID);
    if (existing) ToolGroupManager.destroyToolGroup(GROUP_ID);
    toolGroup = ToolGroupManager.createToolGroup(GROUP_ID);
    for (const key of toolsForMode(nextMode)) {
      const name = TOOL_NAMES[key];
      if (name === CrosshairsTool.toolName) {
        toolGroup.addTool(name, {
          getReferenceLineColor: () => "rgb(143, 183, 232)",
          getReferenceLineControllable: () => true,
          getReferenceLineDraggableRotatable: () => true,
          getReferenceLineSlabThicknessControlsOn: () => true,
        });
      } else {
        toolGroup.addTool(name);
      }
    }
    for (const viewportId of viewportIds) toolGroup.addViewport(viewportId, ENGINE_ID);
    toolGroup.setToolActive(StackScrollTool.toolName, {
      bindings: [{ mouseButton: toolEnums.MouseBindings.Wheel }],
    });
    try {
      toolGroup.setToolEnabled(ScaleOverlayTool.toolName);
    } catch {
      // The scale overlay needs calibrated spacing. Viewing still works without it.
    }
    if (nextMode === "stack") {
      try {
        toolGroup.setToolEnabled(ReferenceLinesTool.toolName);
      } catch {
        // Reference lines require a shared frame of reference.
      }
    } else {
      try {
        toolGroup.setToolEnabled(OrientationMarkerTool.toolName);
        toolGroup.setToolConfiguration(OrientationMarkerTool.toolName, {
          overlayMarkerType: nextMode === "volume" ? OrientationMarkerTool.CUBE : OrientationMarkerTool.AXIS,
        });
      } catch {
        // The orientation marker is an aid. The planes still render without it.
      }
    }
    applyTool(tool);
  }

  function applyTool(next) {
    tool = next;
    if (!toolGroup) return;
    const available = toolsForMode(mode);
    const selected = available.includes(next) ? TOOL_NAMES[next] : WindowLevelTool.toolName;
    // Passive only strips the primary button binding, so the wheel binding on stack scroll survives.
    for (const key of available) {
      try {
        toolGroup.setToolPassive(TOOL_NAMES[key]);
      } catch {
        // A tool that is not on this viewport type stays unused.
      }
    }
    try {
      toolGroup.setToolActive(selected, { bindings: [{ mouseButton: toolEnums.MouseBindings.Primary }] });
    } catch {
      toolGroup.setToolActive(WindowLevelTool.toolName, { bindings: [{ mouseButton: toolEnums.MouseBindings.Primary }] });
    }
    if (selected !== ZoomTool.toolName) {
      toolGroup.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: toolEnums.MouseBindings.Secondary }] });
    }
    if (selected !== PanTool.toolName) {
      toolGroup.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: toolEnums.MouseBindings.Auxiliary }] });
    }
    toolGroup.setToolActive(StackScrollTool.toolName, {
      bindings: [{ mouseButton: toolEnums.MouseBindings.Wheel }],
    });
    publish();
  }

  function applySync(viewportIds, spec) {
    for (const id of ["pacsd-voi", "pacsd-zoom", "pacsd-scroll"]) {
      if (SynchronizerManager.getSynchronizer(id)) SynchronizerManager.destroySynchronizer(id);
    }
    if (!spec.sync || viewportIds.length < 2 || spec.mode !== "stack") return;
    const voi = synchronizers.createVOISynchronizer("pacsd-voi", { syncInvertState: true, syncColormap: false });
    const zoom = synchronizers.createZoomPanSynchronizer("pacsd-zoom");
    const scroll = spec.sameSeries ? synchronizers.createStackImageSynchronizer("pacsd-scroll") : null;
    for (const viewportId of viewportIds) {
      const info = { renderingEngineId: ENGINE_ID, viewportId };
      voi.add(info);
      zoom.add(info);
      scroll?.add(info);
    }
  }

  async function ensureVolume(spec) {
    const nextId = `cornerstoneStreamingImageVolume:${spec.volumeKey}`;
    const existing = cache.getVolume(nextId);
    if (existing) {
      volumeId = nextId;
      if (existing.loadStatus && !existing.loadStatus.loaded && !existing.loadStatus.loading) existing.load();
      return existing;
    }
    const volume = await volumeLoader.createAndCacheVolume(nextId, { imageIds: spec.volumeImageIds });
    volume.load();
    volumeId = nextId;
    return volume;
  }

  function applyProjection(spec) {
    const blend = BLEND[spec.blend] || BLEND.composite;
    for (const viewport of viewports()) {
      if (spec.mode === "volume") continue;
      if (typeof viewport.setBlendMode === "function" && spec.mode === "projection") viewport.setBlendMode(blend, undefined, false);
      if (typeof viewport.setSlabThickness === "function" && Number.isFinite(spec.slab) && spec.slab > 0) {
        viewport.setSlabThickness(spec.slab);
      }
    }
  }

  function applyVolumeStyle(spec) {
    const viewport = viewports()[0];
    if (!viewport || spec.mode !== "volume") return;
    const libraries = CONSTANTS.VIEWPORT_PRESETS || [];
    const preset = transferPreset(libraries, spec.volumePreset || { name: "CT-Bone" }, spec.opacity ?? 1, spec.brightness ?? 0);
    if (preset) viewport.setProperties({ preset });
    const [red, green, blue] = spec.background || [0.03, 0.05, 0.08];
    viewport.getRenderer()?.setBackground(red, green, blue);
    setCrop(spec.crop || 0);
    viewport.render();
  }

  function setCrop(fraction) {
    cropFraction = Math.min(0.45, Math.max(0, Number(fraction) || 0));
    const viewport = viewports().find((item) => item.type === Enums.ViewportType.VOLUME_3D) || null;
    const actor = viewport?.getDefaultActor?.()?.actor;
    const mapper = actor?.getMapper?.();
    if (!mapper?.addClippingPlane || !mapper.removeAllClippingPlanes) return false;
    mapper.removeAllClippingPlanes();
    if (cropFraction > 0) {
      const bounds = actor.getBounds();
      for (let axis = 0; axis < 3; axis += 1) {
        const min = bounds[axis * 2];
        const max = bounds[axis * 2 + 1];
        const span = max - min;
        if (!Number.isFinite(span) || span <= 0) continue;
        const inset = span * cropFraction;
        const low = vtkPlane.newInstance();
        const high = vtkPlane.newInstance();
        const originLow = [0, 0, 0];
        const originHigh = [0, 0, 0];
        const normalLow = [0, 0, 0];
        const normalHigh = [0, 0, 0];
        originLow[axis] = min + inset;
        originHigh[axis] = max - inset;
        normalLow[axis] = 1;
        normalHigh[axis] = -1;
        low.setOrigin(...originLow);
        low.setNormal(...normalLow);
        high.setOrigin(...originHigh);
        high.setNormal(...normalHigh);
        mapper.addClippingPlane(low);
        mapper.addClippingPlane(high);
      }
    }
    viewport.render();
    return true;
  }

  function targets(scope) {
    if (scope === "all") return viewports();
    const viewport = activeViewport();
    return viewport ? [viewport] : [];
  }

  function restoreAnnotations(list, key, element) {
    if (key === annotationKey) return;
    annotationKey = key;
    restoring = true;
    try {
      annotation.state.removeAllAnnotations();
      for (const item of list || []) {
        const copy = JSON.parse(JSON.stringify(item));
        annotation.state.addAnnotation(copy, element);
      }
    } finally {
      restoring = false;
    }
    publish();
  }

  return {
    async init() {
      await init();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    setAnnotationListener(listener) {
      annotationListener = listener;
    },
    setLoadErrorListener(listener) {
      loadErrorListener = listener;
    },
    snapshot() {
      return snapshot;
    },
    setActive(index) {
      activeIndex = index;
      publish();
    },
    cancel() {
      token += 1;
    },
    async show(spec) {
      const current = ++token;
      await init();
      if (current !== token) return;
      mode = spec.mode;
      const elements = (spec.elements || []).filter(Boolean);
      if (!elements.length) return;
      clearWheel();
      const inputs = elements.map((element, index) => ({
        viewportId: `pacsd-${spec.mode}-${index}`,
        element,
        type: viewportType(spec.mode),
        defaultOptions: {
          background: spec.background || [0.03, 0.05, 0.08],
          orientation: spec.orientations?.[index] || Enums.OrientationAxis.AXIAL,
        },
      }));
      renderingEngine.setViewports(inputs);
      elements.forEach(bindWheel);
      buildToolGroup(inputs.map((item) => item.viewportId), spec.mode);
      if (spec.mode === "stack") {
        volumeId = "";
        await Promise.all(inputs.map(async (input, index) => {
          const imageIds = spec.slots?.[index]?.imageIds || [];
          if (!imageIds.length) return;
          const viewport = renderingEngine.getViewport(input.viewportId);
          await viewport.setStack(imageIds, spec.slots[index].index || 0);
          toolUtilities.stackPrefetch?.enable?.(input.element);
        }));
      } else {
        await ensureVolume(spec);
        if (current !== token) return;
        await setVolumesForViewports(
          renderingEngine,
          [{ volumeId }],
          inputs.map((item) => item.viewportId),
        );
        applyProjection(spec);
        applyVolumeStyle(spec);
      }
      if (current !== token) return;
      applySync(inputs.map((item) => item.viewportId), spec);
      renderingEngine.resize();
      renderingEngine.render();
      publish();
    },
    async replaceAnnotations(list, key, element) {
      await init();
      restoreAnnotations(list, key, element || viewports()[0]?.element);
    },
    setTool(next) {
      applyTool(next);
    },
    setWindow(center, width, scope = "active") {
      const range = utilities.windowLevel.toLowHighRange(width, center);
      for (const viewport of targets(scope)) viewport.setProperties({ voiRange: range });
      renderingEngine?.render();
      publish();
    },
    invert() {
      for (const viewport of targets("active")) {
        const properties = viewport.getProperties();
        viewport.setProperties({ invert: !properties.invert });
      }
      renderingEngine?.render();
    },
    flip(axis) {
      const viewport = activeViewport();
      if (!viewport) return;
      const presentation = viewport.getViewPresentation();
      viewport.setViewPresentation({
        flipHorizontal: axis === "horizontal" ? !presentation.flipHorizontal : presentation.flipHorizontal,
        flipVertical: axis === "vertical" ? !presentation.flipVertical : presentation.flipVertical,
      });
      viewport.render();
    },
    rotate() {
      const viewport = activeViewport();
      if (!viewport) return;
      const presentation = viewport.getViewPresentation();
      viewport.setViewPresentation({ rotation: ((presentation.rotation || 0) + 90) % 360 });
      viewport.render();
    },
    reset() {
      for (const viewport of viewports()) {
        viewport.resetProperties?.();
        viewport.resetCamera?.({ resetPan: true, resetZoom: true, resetToCenter: true });
        viewport.setViewPresentation?.({ rotation: 0, flipHorizontal: false, flipVertical: false });
      }
      if (mode === "mpr") {
        const orientations = [Enums.OrientationAxis.AXIAL, Enums.OrientationAxis.CORONAL, Enums.OrientationAxis.SAGITTAL, Enums.OrientationAxis.AXIAL];
        viewports().forEach((viewport, index) => viewport.setOrientation?.(orientations[index] || Enums.OrientationAxis.AXIAL));
      }
      renderingEngine?.render();
      publish();
    },
    fit() {
      activeViewport()?.resetCamera?.({ resetPan: true, resetZoom: true, resetToCenter: true });
      activeViewport()?.render();
      publish();
    },
    zoomBy(factor) {
      const viewport = activeViewport();
      if (!viewport?.getZoom || !viewport.setZoom) return;
      const next = viewport.getZoom() * (Number(factor) || 1);
      viewport.setZoom(Math.min(30, Math.max(0.05, next)));
      viewport.render();
      publish();
    },
    actualSize() {
      const viewport = activeViewport();
      const image = viewport?.getCornerstoneImage?.();
      const spacing = image?.rowPixelSpacing || image?.columnPixelSpacing;
      if (!viewport || !Number.isFinite(spacing) || spacing <= 0) {
        return { ok: false, reason: "Pixel spacing is missing, so actual size cannot be calibrated." };
      }
      const canvas = viewport.getCanvas();
      viewport.setCamera({ parallelScale: (canvas.clientHeight * spacing) / 2 });
      viewport.render();
      return { ok: true, reason: "" };
    },
    setInterpolation(smooth) {
      const type = smooth ? Enums.InterpolationType.LINEAR : Enums.InterpolationType.NEAREST;
      for (const viewport of viewports()) viewport.setProperties?.({ interpolationType: type });
      renderingEngine?.render();
    },
    scroll(delta) {
      const viewport = activeViewport();
      if (!viewport) return;
      if (typeof viewport.scroll === "function") viewport.scroll(delta, false, true);
      else if (viewport.getCurrentImageIdIndex && viewport.setImageIdIndex) {
        const count = viewport.getImageIds().length;
        const next = (viewport.getCurrentImageIdIndex() + delta + count) % count;
        viewport.setImageIdIndex(next);
      }
    },
    async setSlice(index) {
      const viewport = activeViewport();
      if (!viewport) return;
      if (viewport.setImageIdIndex) await viewport.setImageIdIndex(index);
      else if (typeof viewport.scroll === "function") {
        const current = viewport.getSliceIndex?.() || 0;
        viewport.scroll(index - current, false, false);
      }
    },
    setSlab(slab, blend) {
      applyProjection({ mode, slab, blend });
      renderingEngine?.render();
    },
    setVolumeStyle(spec) {
      applyVolumeStyle({ ...spec, mode: "volume" });
    },
    setCrop,
    setOrientation(axis) {
      const viewport = activeViewport();
      const orientation = Enums.OrientationAxis[axis] || Enums.OrientationAxis.AXIAL;
      viewport?.setOrientation?.(orientation, true);
      viewport?.resetCamera?.();
      viewport?.render();
    },
    resetCamera() {
      const viewport = activeViewport();
      viewport?.resetCamera?.();
      viewport?.render();
    },
    project(imageId, point) {
      const viewport = activeViewport();
      if (!viewport?.worldToCanvas) return null;
      try {
        const world = utilities.imageToWorldCoords(imageId, point);
        if (!world) return null;
        return viewport.worldToCanvas(world);
      } catch {
        return null;
      }
    },
    exportImage(type = "image/png") {
      const canvas = activeViewport()?.getCanvas?.();
      if (!canvas) return Promise.reject(new Error("The viewport has no image yet"));
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image could not be exported"))), type, 0.92);
      });
    },
    annotations() {
      return annotation.state.getAllAnnotations();
    },
    resize() {
      renderingEngine?.resize();
      renderingEngine?.render();
    },
    destroy() {
      token += 1;
      if (publishFrame) cancelAnimationFrame(publishFrame);
      publishFrame = 0;
      clearWheel();
      eventTarget.removeEventListener(Enums.Events.IMAGE_RENDERED, onRendered);
      eventTarget.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onRendered);
      eventTarget.removeEventListener(Enums.Events.VOI_MODIFIED, onRendered);
      eventTarget.removeEventListener(Enums.Events.CAMERA_MODIFIED, onRendered);
      eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_FAILED, onImageLoadFailed);
      eventTarget.removeEventListener(toolEnums.Events.ANNOTATION_COMPLETED, onAnnotation);
      eventTarget.removeEventListener(toolEnums.Events.ANNOTATION_MODIFIED, onAnnotation);
      eventTarget.removeEventListener(toolEnums.Events.ANNOTATION_REMOVED, onAnnotation);
      const existing = ToolGroupManager.getToolGroup(GROUP_ID);
      if (existing) ToolGroupManager.destroyToolGroup(GROUP_ID);
      renderingEngine?.destroy();
      renderingEngine = null;
      cache.purgeVolumeCache();
      cache.purgeCache();
      metadataByImage.clear();
    },
  };
}

function emptySnapshot() {
  return { slice: 0, count: 0, windowCenter: null, windowWidth: null, zoom: 1, measurements: [], loaded: 0, total: 0, mode: "stack", tool: "window" };
}
