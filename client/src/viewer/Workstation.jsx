import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Enums } from "@cornerstonejs/core";
import { api } from "../api.js";
import { AI_NOTICE } from "../AiPanel.jsx";
import { useAuth } from "../auth.jsx";
import { useFacility } from "../facility.jsx";
import { acceptedAnnotations } from "../imageGeometry.js";
import { CT_WINDOW_PRESETS } from "../../../shared/ctPresets.js";
import { confirmSeries } from "./dicomSource.js";
import { createViewerEngine, initCornerstone, setImageMetadata } from "./engine.js";
import { instanceAt, markersFor, metadataEntries, seriesImageIds } from "./metadata.js";
import { summarizeAnnotations } from "./measurements.js";
import { bindingFromEvent, matchShortcut, shortcutMap } from "./shortcuts.js";
import { VOLUME_PRESETS, findVolumePreset } from "./volumePresets.js";
import DicomViewport, { DicomOverlay } from "./gms/DicomViewport.jsx";
import PatientSidebar from "./gms/PatientSidebar.jsx";
import SeriesRail from "./gms/SeriesRail.jsx";
import StudyInfoPanel from "./gms/StudyInfoPanel.jsx";
import ThumbnailStrip from "./gms/ThumbnailStrip.jsx";
import ViewerBottomToolbar from "./gms/ViewerBottomToolbar.jsx";
import ViewerHeader from "./gms/ViewerHeader.jsx";
import ReportDock from "./gms/ReportDock.jsx";
import ViewerToolbar from "./gms/ViewerToolbar.jsx";
import { framesOf } from "./gms/format.js";
import "./gms/gms-viewer.css";

const MPR_LABELS = ["Axial", "Coronal", "Sagittal", "Oblique"];
const MPR_ORIENTATIONS = [
  Enums.OrientationAxis.AXIAL,
  Enums.OrientationAxis.CORONAL,
  Enums.OrientationAxis.SAGITTAL,
  Enums.OrientationAxis.AXIAL,
];

function viewCount(mode, layout) {
  if (mode === "mpr") return 4;
  if (mode === "volume" || mode === "projection") return 1;
  if (layout === "1x2" || layout === "2x1") return 2;
  if (layout === "2x2") return 4;
  return 1;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Workstation() {
  const { studyId } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { facilityId } = useFacility();
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const gridRef = useRef(null);
  const slotRefs = useRef([]);
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = createViewerEngine();
  const engine = engineRef.current;
  const [studies, setStudies] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dicomStatus, setDicomStatus] = useState("");
  const [mode, setMode] = useState("stack");
  const [layout, setLayout] = useState("1");
  const [tool, setTool] = useState("scroll");
  const [activeSlot, setActiveSlot] = useState(0);
  const [slotSeries, setSlotSeries] = useState([]);
  const [sync, setSync] = useState(true);
  const [smooth, setSmooth] = useState(true);
  const [overlayOn, setOverlayOn] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(12);
  const [snapshot, setSnapshot] = useState(engine.snapshot());
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(300);
  const [hidden, setHidden] = useState([]);
  const [shortcuts, setShortcuts] = useState({});
  const [customWindows, setCustomWindows] = useState([]);
  const [customVolumes, setCustomVolumes] = useState([]);
  const [volumePresetId, setVolumePresetId] = useState("bone");
  const [opacity, setOpacity] = useState(1);
  const [brightness, setBrightness] = useState(0);
  const [background, setBackground] = useState("black");
  const [blend, setBlend] = useState("mip");
  const [slab, setSlab] = useState(0);
  const [crop, setCrop] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiState, setAiState] = useState({ analysis: null, showMarks: true });
  const [customize, setCustomize] = useState(false);
  const [binding, setBinding] = useState("");
  const [loading, setLoading] = useState(false);
  const [gridAttempt, setGridAttempt] = useState(0);
  const [headerQuery, setHeaderQuery] = useState("");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [infoTab, setInfoTab] = useState("info");
  const [workspace, setWorkspace] = useState("image");
  const splitRowRef = useRef(null);
  const reportSized = useRef(false);
  const [reportWidth, setReportWidth] = useState(() => {
    if (typeof window === "undefined") return 680;
    return Math.round(Math.min(860, Math.max(420, window.innerWidth * 0.48)));
  });
  useEffect(() => {
    if (workspace === "image") return;
    setLeftCollapsed(true);
  }, [workspace]);
  useEffect(() => {
    if (workspace !== "split") {
      reportSized.current = false;
      return undefined;
    }
    const row = splitRowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return undefined;
    const fit = () => {
      if (reportSized.current) return;
      const width = row.clientWidth;
      if (!width) return;
      setReportWidth(Math.round(Math.min(880, Math.max(320, width * 0.5))));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [workspace]);
  const [reportTab, setReportTab] = useState("report");
  const skipAnnotationKey = useRef("");
  const seriesLocked = useRef(false);
  const toolRef = useRef("scroll");
  toolRef.current = tool;

  const series = catalog?.series || [];
  const count = viewCount(mode, layout);
  const activeSeries = series.find((item) => item._id === slotSeries[Math.min(activeSlot, count - 1)]) || series[0] || null;
  const placed = useMemo(() => slotSeries.slice(0, count).map((id) => series.find((item) => item._id === id) || activeSeries).filter(Boolean), [slotSeries, count, series, activeSeries]);
  const current = instanceAt(activeSeries, snapshot.slice);
  const imageIds = seriesImageIds(activeSeries);
  const imageId = imageIds[snapshot.slice] || imageIds[0] || "";
  const markers = markersFor(current.instance);
  const measurements = summarizeAnnotations(snapshot.measurements, activeSeries?.modality || catalog?.study?.modality || "");
  const backgrounds = { black: [0, 0, 0], navy: [0.03, 0.05, 0.08], slate: [0.16, 0.18, 0.2] };
  const volumeSelection = findVolumePreset(volumePresetId, customVolumes.map((item) => ({ ...item, preset: undefined, name: item.base, label: item.label, id: item.id })));

  useEffect(() => engine.subscribe(setSnapshot), [engine]);
  useEffect(() => engine.setLoadErrorListener((message) => {
    setError((current) => current || message || "The DICOM image could not be loaded");
  }), [engine]);

  const destroyTimer = useRef(0);
  useEffect(() => {
    clearTimeout(destroyTimer.current);
    initCornerstone().catch((err) => setError(err.message));
    // StrictMode remounts immediately; destroying at once would purge the image cache and reload everything.
    return () => { destroyTimer.current = setTimeout(() => engine.destroy(), 0); };
  }, [engine]);

  useEffect(() => {
    let cancel = false;
    api("/api/viewer/preferences").then((data) => {
      if (cancel || !data.preference) return;
      const preference = data.preference;
      if (preference.layout) setLayout(preference.layout);
      setHidden(preference.hiddenTools || []);
      setShortcuts(preference.shortcuts || {});
      setCustomWindows(preference.windowPresets || []);
      setCustomVolumes(preference.volumePresets || []);
      if (preference.panelLeft) setLeftWidth(preference.panelLeft);
      if (preference.panelRight) setRightWidth(preference.panelRight);
    }).catch(() => {});
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    let cancel = false;
    api("/api/studies").then((data) => {
      if (cancel) return;
      setStudies(data.studies || []);
      if (studyId && !(data.studies || []).some((item) => item._id === studyId)) navigate("/viewer", { replace: true });
    }).catch((err) => setError(err.message));
    return () => { cancel = true; };
  }, [facilityId, studyId, navigate]);

  useEffect(() => {
    if (!studyId) {
      setCatalog(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPlaying(false);
    seriesLocked.current = false;
    api(`/api/viewer/studies/${studyId}/catalog`).then((data) => {
      if (controller.signal.aborted) return;
      setCatalog(data);
      const preferred = [...(data.series || [])].sort((a, b) => (b.imageCount || 0) - (a.imageCount || 0))[0];
      const first = preferred?._id || "";
      setSlotSeries(Array.from({ length: 4 }, () => first));
      setActiveSlot(0);
      setMode("stack");
      if (!data.series?.length) setNotice("This study has no stored images.");
      else if (data.pixelsMissing) {
        setNotice("Study details are here, but the image files are not on this computer and Orthanc no longer has them. Push the study again from the console to GMSPACS.");
        setError("Images are missing — re-send this study from the console to Orthanc, then open it again.");
      } else setNotice("");
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    api(`/api/viewer/studies/${studyId}/annotations`).then((data) => {
      if (!controller.signal.aborted) setAnnotations(data.records || []);
    }).catch(() => { if (!controller.signal.aborted) setAnnotations([]); });
    return () => controller.abort();
  }, [studyId]);

  useEffect(() => {
    if (!catalog?.series?.length || seriesLocked.current) return;
    const best = [...catalog.series].sort((a, b) => (b.imageCount || 0) - (a.imageCount || 0))[0];
    if (!best?._id) return;
    setSlotSeries((current) => (current[0] === best._id ? current : Array.from({ length: 4 }, () => best._id)));
  }, [catalog]);

  const importing = Boolean(catalog && catalog.archiveInstances > catalog.storedInstances);
  useEffect(() => {
    if (!studyId || !importing) return undefined;
    const timer = setInterval(() => {
      api(`/api/viewer/studies/${studyId}/catalog`).then((data) => {
        setCatalog((current) => (
          current?.study?._id === data.study?._id && current.storedInstances !== data.storedInstances ? data : current
        ));
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [studyId, importing]);

  useEffect(() => {
    const studyUid = catalog?.study?.studyUid;
    if (!studyUid) return undefined;
    let cancel = false;
    confirmSeries(studyUid).then((list) => {
      if (!cancel) setDicomStatus(`${list.length} series confirmed through DICOMweb`);
    }).catch((err) => { if (!cancel) setDicomStatus(err.message); });
    return () => { cancel = true; };
  }, [catalog?.study?.studyUid]);

  useEffect(() => {
    if (studyId) setWorkspace((current) => (current === "image" ? "split" : current));
  }, [studyId]);

  useEffect(() => {
    let timer = 0;
    engine.setAnnotationListener((list) => {
      const seriesId = activeSeries?._id;
      if (!studyId || !seriesId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const payload = JSON.parse(JSON.stringify(list || []));
        api(`/api/viewer/studies/${studyId}/annotations`, { method: "PUT", body: { seriesId, annotations: payload } })
          .then((data) => {
            skipAnnotationKey.current = `${seriesId}:${data.record?.updatedAt || ""}`;
            setAnnotations((currentRecords) => {
              const next = currentRecords.filter((item) => String(item.seriesId) !== String(seriesId));
              next.push(data.record);
              return next;
            });
          })
          .catch((err) => setNotice(err.message));
      }, 700);
    });
    return () => clearTimeout(timer);
  }, [engine, studyId, activeSeries?._id]);

  useLayoutEffect(() => {
    if (!catalog || !activeSeries) return undefined;
    const elements = slotRefs.current.slice(0, count).filter(Boolean);
    if (elements.length !== count) {
      if (gridAttempt < 5) {
        const timer = setTimeout(() => setGridAttempt((value) => value + 1), 30);
        return () => clearTimeout(timer);
      }
      return undefined;
    }
    const slots = Array.from({ length: count }, (_, index) => {
      const chosen = placed[index] || activeSeries;
      return { imageIds: seriesImageIds(chosen), index: 0, seriesId: chosen._id };
    });
    if (catalog.pixelsMissing || slots.every((slot) => !slot.imageIds.length)) {
      setError("Images are missing — re-send this study from the console to Orthanc, then open it again.");
      return undefined;
    }
    const metadata = placed.flatMap((item) => metadataEntries(catalog.study, item));
    if (!metadata.length) metadata.push(...metadataEntries(catalog.study, activeSeries));
    setImageMetadata(metadata);
    const orientations = mode === "mpr"
      ? MPR_ORIENTATIONS
      : [mode === "projection" ? Enums.OrientationAxis.AXIAL : Enums.OrientationAxis.CORONAL];
    let cancel = false;
    setError("");
    engine.show({
      elements,
      mode,
      slots,
      orientations,
      volumeKey: activeSeries._id,
      volumeImageIds: seriesImageIds(activeSeries),
      sync,
      sameSeries: new Set(slots.map((item) => String(item.seriesId))).size === 1,
      blend: mode === "projection" ? blend : "composite",
      slab: mode === "projection" ? (slab || activeSeries.volume?.span || activeSeries.instances?.[0]?.sliceThickness || 1) : slab,
      volumePreset: volumeSelection,
      opacity,
      brightness,
      crop,
      background: mode === "stack" ? [0, 0, 0] : backgrounds[background],
    }).then(() => { if (!cancel) engine.setTool(toolRef.current); })
      .catch((err) => { if (!cancel) setError(err.message || "The images could not be displayed"); });
    return () => { cancel = true; engine.cancel(); };
  }, [catalog, activeSeries, placed, count, mode, sync, engine, gridAttempt]);

  useEffect(() => {
    if (!activeSeries) return;
    const saved = annotations.find((item) => String(item.seriesId) === String(activeSeries._id));
    const key = `${activeSeries._id}:${saved?.updatedAt || "none"}`;
    if (skipAnnotationKey.current === key) return;
    engine.replaceAnnotations(saved?.annotations || [], key, slotRefs.current[activeSlot]);
  }, [annotations, activeSeries, activeSlot, engine]);

  useEffect(() => {
    if (mode === "volume") {
      engine.setVolumeStyle({ volumePreset: volumeSelection, opacity, brightness, background: backgrounds[background], crop });
    }
    if (mode === "mpr" || mode === "projection") engine.setSlab(slab, mode === "projection" ? blend : "composite");
  }, [mode, volumeSelection, opacity, brightness, background, crop, slab, blend, engine]);

  useEffect(() => {
    engine.setInterpolation(smooth);
  }, [smooth, engine, mode, activeSeries?._id]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => engine.scroll(1), Math.max(40, 1000 / fps));
    return () => clearInterval(timer);
  }, [playing, fps, engine]);

  useEffect(() => {
    const node = gridRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => engine.resize());
    observer.observe(node);
    return () => observer.disconnect();
  }, [engine, count, mode]);

  useEffect(() => {
    function onKey(event) {
      if (event.target.matches("input, textarea, select") || event.target.closest(".we-app, [contenteditable='true']")) return;
      if (binding) {
        const next = bindingFromEvent(event);
        if (next) setShortcuts((current) => ({ ...current, [binding]: next }));
        setBinding("");
        event.preventDefault();
        return;
      }
      const action = matchShortcut(event, shortcuts);
      if (!action) return;
      event.preventDefault();
      if (action === "window") chooseTool("window");
      if (action === "zoom") chooseTool("zoom");
      if (action === "pan") chooseTool("pan");
      if (action === "scroll") chooseTool("scroll");
      if (action === "length") chooseTool("length");
      if (action === "reset") engine.reset();
      if (action === "invert") engine.invert();
      if (action === "fullscreen") toggleFullscreen();
      if (action === "previous") engine.scroll(-1);
      if (action === "next") engine.scroll(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [binding, shortcuts, engine]);

  function chooseTool(next) {
    setTool(next);
    engine.setTool(next);
  }

  function chooseMode(next) {
    if (next !== "stack" && !activeSeries?.volume?.ready) {
      setNotice(activeSeries?.volume?.reason || "Select a series with a valid volume.");
      return;
    }
    setNotice("");
    setMode(next);
    if (next === "volume") chooseTool("rotate");
    else if (next === "mpr") chooseTool("crosshair");
    else chooseTool("window");
    if (next === "projection") {
      setBlend("mip");
      setSlab(activeSeries?.volume?.span || activeSeries?.instances?.[0]?.sliceThickness || 10);
    }
  }

  function assignSeries(seriesId) {
    seriesLocked.current = true;
    setSlotSeries((current) => current.map((item, index) => (index === activeSlot ? seriesId : item)));
    setMode("stack");
  }

  async function savePreferences(extra = {}) {
    const preference = {
      layout,
      hiddenTools: hidden,
      shortcuts,
      windowPresets: customWindows,
      volumePresets: customVolumes,
      volume: { preset: volumePresetId, opacity, brightness, background: backgrounds[background] },
      panelLeft: leftWidth,
      panelRight: rightWidth,
      ...extra,
    };
    const data = await api("/api/viewer/preferences", { method: "PUT", body: preference });
    setNotice("Viewer layout saved for this account.");
    return data.preference;
  }

  async function recordExport(kind) {
    if (!studyId) return;
    await api(`/api/viewer/studies/${studyId}/exports`, { method: "POST", body: { kind } });
  }

  async function exportViewport(kind) {
    const type = kind === "jpeg" ? "image/jpeg" : "image/png";
    const blob = await engine.exportImage(type);
    const accession = catalog?.study?.accession || "study";
    downloadBlob(blob, `pacsd-${accession}-${Date.now()}.${kind === "jpeg" ? "jpg" : "png"}`);
    await recordExport(kind === "jpeg" ? "jpeg" : "png");
  }

  async function exportMeasurements() {
    const payload = {
      standard: "application-json",
      dicomSr: false,
      notice: "Application annotations only. These are not DICOM SR or DICOM SEG objects, and the source images were not modified.",
      studyUid: catalog?.study?.studyUid,
      seriesUid: activeSeries?.seriesUid,
      measurements,
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `pacsd-measurements-${Date.now()}.json`);
    await recordExport("measurements");
  }

  async function printViewport() {
    const blob = await engine.exportImage("image/png");
    const url = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    document.body.appendChild(frame);
    frame.contentDocument.write(`<img alt="PACSD viewport" src="${url}" style="max-width:100%">`);
    frame.contentDocument.close();
    frame.contentWindow.focus();
    frame.contentWindow.print();
    await recordExport("print");
    setTimeout(() => { URL.revokeObjectURL(url); frame.remove(); }, 1000);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen();
  }

  function dragPanel(side, event) {
    event.preventDefault();
    const start = event.clientX;
    const initial = side === "left" ? leftWidth : rightWidth;
    function move(next) {
      const delta = side === "left" ? next.clientX - start : start - next.clientX;
      const width = Math.min(480, Math.max(200, initial + delta));
      if (side === "left") setLeftWidth(width);
      else setRightWidth(width);
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function saveWindowPreset() {
    if (!Number.isFinite(snapshot.windowCenter) || !Number.isFinite(snapshot.windowWidth)) return;
    const label = window.prompt("Name this window preset");
    if (!label) return;
    const preset = { id: `custom-${Date.now()}`, label: label.slice(0, 40), center: snapshot.windowCenter, width: Math.max(1, snapshot.windowWidth) };
    const windowPresets = [...customWindows, preset].slice(-20);
    setCustomWindows(windowPresets);
    savePreferences({ windowPresets }).catch((err) => setNotice(err.message));
  }

  function saveVolumePreset() {
    const label = window.prompt("Name this 3D preset");
    if (!label) return;
    const base = volumeSelection.name || volumeSelection.base || "CT-Bone";
    const preset = { id: `volume-${Date.now()}`, label: label.slice(0, 40), base, opacity, brightness, background: backgrounds[background] };
    const volumePresets = [...customVolumes, preset].slice(-20);
    setCustomVolumes(volumePresets);
    savePreferences({ volumePresets }).catch((err) => setNotice(err.message));
  }

  const layoutName = mode === "stack" ? layout : mode;
  const derived = mode !== "stack";
  const frames = useMemo(() => framesOf(activeSeries), [activeSeries]);
  const imageCount = series.reduce((sum, item) => sum + (Number(item.imageCount) || 0), 0);
  const previewInstance = activeSeries?.instances?.find((item) => item.hasArchiveCopy);
  const textTools = /label|arrow|text/i;
  const annotationRows = measurements.filter((item) => textTools.test(item.tool));
  const measurementRows = measurements.filter((item) => !textTools.test(item.tool));
  const plane = mode === "mpr" ? MPR_LABELS[activeSlot] : "";

  function cycleLayout() {
    const order = ["1", "1x2", "2x1", "2x2"];
    const index = order.indexOf(layout);
    setLayout(order[(index + 1) % order.length]);
    setMode("stack");
  }

  function runToolAction(action) {
    if (action === "flip-h") return engine.flip("horizontal");
    if (action === "flip-v") return engine.flip("vertical");
    if (action === "rotate-view") return engine.rotate();
    if (action === "invert") return engine.invert();
    if (action === "reset") return engine.reset();
    if (action === "actual") {
      const result = engine.actualSize();
      if (!result.ok) setNotice(result.reason);
      return;
    }
    chooseTool(action);
  }

  function resetWindow() {
    const center = Number.isFinite(current.instance?.windowCenter) ? current.instance.windowCenter : 40;
    const width = Number.isFinite(current.instance?.windowWidth) ? current.instance.windowWidth : 80;
    engine.setWindow(center, width, sync ? "all" : "active");
  }

  function openFullscreen(node) {
    if (document.fullscreenElement) document.exitFullscreen();
    else node?.requestFullscreen?.();
  }

  const toolItems = [
    { label: "Save layout", onClick: () => savePreferences().catch((err) => setNotice(err.message)) },
    { label: "Save window preset", onClick: saveWindowPreset },
    { label: "Export PNG", onClick: () => exportViewport("png").catch((err) => setNotice(err.message)) },
    { label: "Export JPEG", onClick: () => exportViewport("jpeg").catch((err) => setNotice(err.message)) },
    { label: "Export measurements", onClick: () => exportMeasurements().catch((err) => setNotice(err.message)) },
    { label: "Print viewport", onClick: () => printViewport().catch((err) => setNotice(err.message)) },
    { label: "Edit shortcuts", onClick: () => setCustomize(true) },
    { label: "Classic viewer", onClick: () => studyId && navigate(`/viewer/${studyId}/classic`) },
  ];

  return (
    <div className="gms2 relative" ref={rootRef}>
      <ViewerHeader
        user={user}
        query={headerQuery}
        onQuery={setHeaderQuery}
        studies={studies}
        onOpenAi={() => setInfoTab("ai")}
        onLogout={async () => { await logout(); navigate("/login"); }}
        toolItems={toolItems}
      />
      {customize && (
        <div className="absolute right-3 top-16 z-50 max-h-[70vh] w-[360px] overflow-auto rounded-2xl bg-[#1c1c21]/95 p-4 shadow-2xl shadow-black/60 ring-1 ring-white/10 backdrop-blur-2xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Shortcuts</h2>
            <button type="button" className="text-xs text-zinc-400" onClick={() => setCustomize(false)}>Close</button>
          </div>
          {Object.entries(shortcutMap(shortcuts)).map(([name, key]) => (
            <label key={name} className="mb-1 flex items-center justify-between gap-2 text-[12px]">
              <span className="capitalize">{name}</span>
              <button type="button" className="h-8 rounded-lg bg-white/[0.06] px-3 transition hover:bg-white/[0.1]" onClick={() => setBinding(name)}>{binding === name ? "Press a key" : key}</button>
            </label>
          ))}
          <p className="mt-2 text-[11px] text-zinc-500">Hidden tools stay available from the Tools tab. Primary toolbar icons stay visible.</p>
        </div>
      )}
      <div ref={splitRowRef} className="flex min-h-0 min-w-0 flex-1">
        <PatientSidebar
          collapsed={leftCollapsed}
          onToggle={() => setLeftCollapsed((value) => !value)}
          patient={catalog?.patient}
          studies={studies}
          studyId={studyId}
          imageCount={catalog ? imageCount : null}
          previewUrl={previewInstance ? `/api/instances/${previewInstance._id}/orthanc-preview` : ""}
          onOpen={(id) => navigate(`/viewer/${id}`)}
          seriesList={series}
          seriesId={activeSeries?._id || ""}
          onSeries={assignSeries}
          slice={snapshot.slice || 0}
          onSlice={(index) => engine.setSlice(index)}
        />
        {workspace !== "report" && (
        <div className="flex min-w-0 flex-1 flex-col" ref={stageRef}>
          <ViewerToolbar
            series={series}
            seriesId={activeSeries?._id || ""}
            onSeries={assignSeries}
            tool={tool}
            onTool={chooseTool}
            onZoomIn={() => engine.zoomBy(1.15)}
            onZoomOut={() => engine.zoomBy(1 / 1.15)}
            onFit={() => engine.fit()}
            onOverlay={() => setOverlayOn((value) => !value)}
            overlayOn={overlayOn}
            onSync={() => setSync((value) => !value)}
            sync={sync}
            onVolume={() => chooseMode(mode === "volume" ? "stack" : "volume")}
            volumeOn={mode === "volume"}
            onLayout={cycleLayout}
            onFullscreen={() => openFullscreen(stageRef.current)}
            disabled={!activeSeries}
          />
          {loading && <p className="bg-[#1c1c21] px-3 py-1 text-[12px] text-[#c4b5fd]">Loading DICOM geometry…</p>}
          {importing && <p className="bg-[#1c1c21] px-3 py-1 text-[12px] text-[#c4b5fd]">Importing images from the archive: {catalog.storedInstances} of {catalog.archiveInstances}…</p>}
          {error && <p className="bg-[#3a2412] px-3 py-1 text-[12px] text-amber-100" role="alert">{error}</p>}
          {notice && <p className="bg-[#3a2412] px-3 py-1 text-[12px] text-amber-100">{notice}</p>}
          <div className="flex min-h-0 min-w-0 flex-1">
          <SeriesRail series={series} seriesId={activeSeries?._id || ""} onSeries={assignSeries} />
          <DicomViewport
            layoutName={layoutName}
            count={count}
            activeSlot={activeSlot}
            setSlotRef={(index, node) => { slotRefs.current[index] = node; }}
            onActivate={(index) => { setActiveSlot(index); engine.setActive(index); }}
            renderOverlay={(index) => (overlayOn && index === activeSlot ? (
              <>
                <DicomOverlay
                  patient={catalog?.patient}
                  study={catalog?.study}
                  series={placed[index] || activeSeries}
                  instance={current.instance}
                  snapshot={snapshot}
                  markers={mode === "stack" ? markers : null}
                  derived={derived}
                  plane={plane}
                />
                <AiOverlay engine={engine} analysis={aiState.analysis} show={aiState.showMarks} imageId={imageId} frame={current.frame} instanceId={current.instance?._id} />
              </>
            ) : null)}
          />
          </div>
          {mode === "stack" && <ThumbnailStrip frames={frames} activeIndex={snapshot.slice} onPick={engine.setSlice} ready={snapshot.count > 0} />}
        </div>
        )}
        {workspace === "split" && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize report panel"
            className="w-1 shrink-0 cursor-col-resize bg-white/[0.04] transition-colors hover:bg-violet-500/70"
            onMouseDown={(event) => {
              event.preventDefault();
              reportSized.current = true;
              const startX = event.clientX;
              const startW = reportWidth;
              const move = (moveEvent) => {
                const row = splitRowRef.current?.clientWidth || window.innerWidth;
                const limit = Math.round(row * 0.68);
                setReportWidth(Math.min(limit, Math.max(320, startW - (moveEvent.clientX - startX))));
              };
              const up = () => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", up);
            }}
          />
        )}
        <ReportDock studyId={studyId} workspace={workspace} onWorkspace={setWorkspace} width={reportWidth} tab={reportTab} onTab={setReportTab}>
        <StudyInfoPanel
          tab={infoTab}
          onTab={setInfoTab}
          study={catalog?.study}
          series={activeSeries}
          instance={current.instance}
          snapshot={snapshot}
          measurements={measurementRows}
          annotations={annotationRows}
          onPreset={(preset) => preset && engine.setWindow(preset.center, preset.width, sync ? "all" : "active")}
          onWindow={(center, width) => engine.setWindow(center, width, sync ? "all" : "active")}
          onResetWindow={resetWindow}
          seriesList={series}
          seriesId={activeSeries?._id}
          onSeries={assignSeries}
          smooth={smooth}
          onSmooth={() => setSmooth((value) => !value)}
          mode={mode}
          onMode={chooseMode}
          volumePresetId={volumePresetId}
          onVolumePreset={setVolumePresetId}
          volumePresets={[...VOLUME_PRESETS, ...customVolumes]}
          opacity={opacity}
          onOpacity={setOpacity}
          brightness={brightness}
          onBrightness={setBrightness}
          background={background}
          onBackground={setBackground}
          crop={crop}
          onCrop={setCrop}
          onSaveVolume={saveVolumePreset}
          onResetCamera={() => engine.resetCamera()}
          slab={slab}
          onSlab={setSlab}
          blend={blend}
          onBlend={setBlend}
          onOrientation={(axis) => engine.setOrientation(axis)}
          tool={tool}
          onTool={runToolAction}
          studyId={studyId}
          frame={current.frame}
          onInstance={(id) => {
            const index = imageIds.findIndex((item) => item.includes(`/instances/${id}/`));
            if (index >= 0) engine.setSlice(index);
          }}
          onOpenReport={() => { setWorkspace("split"); setReportTab("report"); }}
          onAiChange={setAiState}
        />
        </ReportDock>
      </div>
      {workspace !== "report" && <ViewerBottomToolbar
        playing={playing}
        onPlay={() => setPlaying((value) => !value)}
        slice={snapshot.slice}
        count={snapshot.count}
        onSlice={(index) => engine.setSlice(index)}
        fps={fps}
        onFps={setFps}
        onCine={() => setPlaying((value) => !value)}
        sync={sync}
        onSync={() => setSync((value) => !value)}
        overlayOn={overlayOn}
        onOverlay={setOverlayOn}
        crosshair={tool === "crosshair"}
        onCrosshair={() => {
          if (tool === "crosshair") chooseTool("scroll");
          else {
            chooseMode("mpr");
            chooseTool("crosshair");
          }
        }}
        onMpr={() => chooseMode(mode === "mpr" ? "stack" : "mpr")}
        mprOn={mode === "mpr"}
        onVolume={() => chooseMode(mode === "volume" ? "stack" : "volume")}
        volumeOn={mode === "volume"}
        layout={layout}
        onLayout={(value) => { setLayout(value); setMode("stack"); }}
        onFullscreen={() => openFullscreen(rootRef.current)}
        layoutEnabled={mode === "stack"}
      />}
      <p className="sr-only">{AI_NOTICE}</p>
    </div>
  );
}

function AiOverlay({ engine, analysis, show, imageId, frame, instanceId }) {
  const [marks, setMarks] = useState([]);
  useEffect(() => {
    if (!show || !analysis || !imageId) {
      setMarks([]);
      return undefined;
    }
    const update = () => {
      const boxes = acceptedAnnotations(analysis.findings, {
        columns: analysis.columns,
        rows: analysis.rows,
        annotationsSupported: analysis.annotationsSupported,
      }).filter((box) => (!box.instanceId || box.instanceId === String(instanceId || "")) && box.frame === frame);
      setMarks(boxes.map((box) => {
        const start = engine.project(imageId, [box.x, box.y]);
        const end = engine.project(imageId, [box.x + box.width, box.y + box.height]);
        if (!start || !end) return null;
        const left = Math.min(start[0], end[0]);
        const top = Math.min(start[1], end[1]);
        return { ...box, left, top, boxWidth: Math.abs(end[0] - start[0]), boxHeight: Math.abs(end[1] - start[1]) };
      }).filter(Boolean));
    };
    update();
    return engine.subscribe(update);
  }, [engine, analysis, show, imageId, frame, instanceId]);
  if (!marks.length) return null;
  return (
    <svg className="gms2-ai">
      {marks.map((mark) => (
        <g key={`${mark.index}-${mark.label}`}>
          <rect x={mark.left} y={mark.top} width={mark.boxWidth} height={mark.boxHeight} />
          <text x={mark.left + 2} y={Math.max(12, mark.top - 4)}>AI {mark.index}. {mark.label} · review</text>
        </g>
      ))}
    </svg>
  );
}
