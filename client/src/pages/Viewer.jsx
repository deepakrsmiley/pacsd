import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import AiPanel from "../AiPanel.jsx";
import { acceptedAnnotations } from "../imageGeometry.js";
import { useFacility } from "../facility.jsx";
import { useToasts } from "../feedback.jsx";

const PRESETS = {
  default: "Default window",
  full: "Full range",
  lung: "CT Lung",
  abdomen: "CT Abdomen",
  bone: "CT Bone",
  brain: "CT Brain",
  chest: "CT Chest",
  angio: "CT Angio",
};

const PRESET_VALUES = {
  full: [128, 256],
  lung: [-400, 1600],
  abdomen: [60, 400],
  bone: [300, 1500],
  brain: [40, 80],
  chest: [40, 400],
  angio: [300, 600],
};

const HINTS = {
  combined: "Left drag window. Right drag zoom. Middle drag pan.",
  wl: "Drag to change window width and level",
  zoom: "Drag up or down to zoom",
  pan: "Drag to move the image",
  magnify: "Move over the image to magnify",
  length: "Drag from the start point to the end point. The length stays on the image.",
  angle: "Click three points. The second point is the vertex",
  circle: "Drag a circle to read the mean value",
  roi: "Drag an ellipse to read the mean value",
  rectangle: "Drag a rectangle to read the mean value",
  probe: "Click a pixel to read its value",
  text: "Click the image, then type a note",
};

const DRAG_SHAPES = new Set(["length", "circle", "roi", "rectangle"]);

export default function Viewer() {
  const { studyId } = useParams();
  const navigate = useNavigate();
  const { facilityId } = useFacility();
  const toasts = useToasts();
  const facilityRef = useRef(facilityId);
  const rootRef = useRef(null);
  const [studies, setStudies] = useState([]);
  const [query, setQuery] = useState("");
  const [bundle, setBundle] = useState(null);
  const [cache, setCache] = useState({});
  const cacheRef = useRef({});
  const loadingRef = useRef(new Set());
  const [layout, setLayout] = useState(1);
  const [activeSlot, setActiveSlot] = useState(0);
  const [viewports, setViewports] = useState(() => [emptySlot()]);
  const [tool, setTool] = useState("combined");
  const [preset, setPreset] = useState("default");
  const [playing, setPlaying] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiState, setAiState] = useState({ analysis: null, showMarks: true });
  const [tags, setTags] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const instances = bundle?.instances || [];
  const study = bundle?.study;
  const listItem = studies.find((item) => item._id === (study?._id || studyId));
  const stack = useMemo(() => buildImageStack(instances, cache), [instances, cache]);
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const viewportsRef = useRef(viewports);
  viewportsRef.current = viewports;
  const active = viewports[activeSlot] || viewports[0] || emptySlot();
  const activePixels = active.instanceId ? cache[imageCacheKey(active.instanceId, active.frame)] : null;
  const seriesStack = stack.filter((item) => String(item.seriesId) === String(active.seriesId));
  const uniqueImages = new Set(stack.map((item) => item.key)).size;

  useEffect(() => {
    let cancel = false;
    const facilityChanged = facilityRef.current !== facilityId;
    facilityRef.current = facilityId;
    if (facilityChanged) {
      setStudies([]);
      setBundle(null);
      setError("");
      cacheRef.current = {};
      loadingRef.current = new Set();
      setCache({});
      setViewports([emptySlot()]);
      setLayout(1);
      setActiveSlot(0);
    }
    api("/api/studies")
      .then(async (data) => {
        if (cancel) return;
        setStudies(data.studies);
        if (studyId && !data.studies.some((item) => item._id === studyId)) {
          navigate("/viewer", { replace: true });
          return;
        }
        if (studyId) return;
        for (const item of data.studies.slice(0, 8)) {
          const detail = await api(`/api/studies/${item._id}/series`);
          if (cancel) return;
          if (detail.instances?.length) {
            navigate(`/viewer/${item._id}`, { replace: true });
            return;
          }
        }
        setNotice("No stored images in this facility yet. Import a DICOM file from Study Database.");
      })
      .catch((err) => { setError(err.message); toasts.error(err.message); });
    return () => {
      cancel = true;
    };
  }, [studyId, navigate, facilityId]);

  useEffect(() => {
    if (!studyId || !studies.some((item) => item._id === studyId)) return;
    setPlaying(false);
    setActiveSlot(0);
    setViewports((current) => Array.from({ length: Math.max(1, current.length) }, () => emptySlot()));
    api(`/api/studies/${studyId}/series`)
      .then((data) => setBundle(data))
      .catch((err) => { setError(err.message); toasts.error(err.message); });
  }, [studyId, studies]);

  useEffect(() => {
    if (!instances.length) return;
    setViewports((current) => {
      if (current.some((slot) => slot.instanceId)) return fillEmptySlots(current, stack, layout);
      return hangLayout(stack, bundle?.series || [], layout, 0, current);
    });
  }, [instances, stack, layout, bundle]);

  useEffect(() => {
    const ids = [];
    function queue(instanceId, frame = 0) {
      if (!instanceId) return;
      const key = imageCacheKey(instanceId, frame);
      if (!ids.includes(key)) ids.push(key);
    }
    for (const series of bundle?.series || []) {
      const first = instances.find((item) => String(item.seriesId) === String(series._id));
      if (first) queue(first._id, 0);
    }
    viewports.forEach((slot) => {
      if (!slot.instanceId) return;
      queue(slot.instanceId, slot.frame);
      const images = stack.filter((item) => String(item.seriesId) === String(slot.seriesId));
      [-1, 1].forEach((offset) => {
        const nearby = images[slot.stackIndex + offset];
        if (nearby) queue(nearby.instanceId, nearby.frame);
      });
    });
    ids.forEach((key) => {
      if (cacheRef.current[key] || loadingRef.current.has(key)) return;
      loadingRef.current.add(key);
      const [instanceId, frameText] = key.split(":");
      loadPixelCache(instanceId, Number(frameText) || 0)
        .then((data) => {
          cacheRef.current[key] = data;
          setCache({ ...cacheRef.current });
        })
        .catch((err) => {
          const reason = err.message || "The image could not be loaded.";
          cacheRef.current[key] = { supported: false, reason };
          setCache({ ...cacheRef.current });
          setError(reason);
          toasts.error(reason);
        });
    });
  }, [instances, viewports, layout, bundle, stack]);

  useEffect(() => {
    if (!playing) return undefined;
    const images = seriesStack;
    if (images.length < 2) return undefined;
    const timer = setInterval(() => {
      stepSlot(activeSlot, 1, true);
    }, 450);
    return () => clearInterval(timer);
  }, [playing, activeSlot, seriesStack.length]);

  useEffect(() => {
    function onKey(event) {
      if (event.target.matches("input, textarea, select")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") stepSlot(activeSlot, 1);
      if (event.key === "ArrowLeft" || event.key === "PageUp") stepSlot(activeSlot, -1);
      if (event.key === "i" || event.key === "I") patchSlotView(activeSlot, (current) => ({ ...current, invert: !current.invert }));
      if (event.key === "r" || event.key === "R") resetView();
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((current) => !current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeSlot, seriesStack.length]);

  function patchSlot(slotIndex, updater) {
    setViewports((current) => current.map((slot, index) => {
      if (index !== slotIndex) return slot;
      return typeof updater === "function" ? updater(slot) : { ...slot, ...updater };
    }));
  }

  function patchSlotView(slotIndex, updater) {
    patchSlot(slotIndex, (slot) => ({
      ...slot,
      view: typeof updater === "function" ? updater(slot.view) : updater,
    }));
  }

  function activateSlot(slotIndex) {
    setActiveSlot(slotIndex);
    setViewports((current) => current.map((slot, index) => (
      index === slotIndex ? slot : { ...slot, draft: null }
    )));
  }

  function stepSlot(slotIndex, delta, wrap = false) {
    const images = imagesForSlot(viewportsRef.current[slotIndex], stackRef.current);
    if (images.length < 2) return;
    setViewports((current) => current.map((slot, index) => {
      if (index !== slotIndex) return slot;
      const seriesImages = imagesForSlot(slot, stackRef.current);
      if (seriesImages.length < 2) return slot;
      const nextIndex = wrap
        ? (slot.stackIndex + delta + seriesImages.length) % seriesImages.length
        : clamp(slot.stackIndex + delta, 0, seriesImages.length - 1);
      const item = seriesImages[nextIndex];
      if (!item || item.key === slot.key) return slot;
      return slotFromImage(item, slot);
    }));
  }

  function loadSeriesIntoSlot(slotIndex, seriesId) {
    const images = stackRef.current.filter((item) => String(item.seriesId) === String(seriesId));
    if (!images.length) return;
    activateSlot(slotIndex);
    setPlaying(false);
    patchSlot(slotIndex, (slot) => slotFromImage(images[0], slot));
  }

  function applyLayout(count) {
    setLayout(count);
    setActiveSlot((current) => Math.min(current, count - 1));
    setPlaying(false);
    setViewports((current) => hangLayout(stackRef.current, bundle?.series || [], count, Math.min(activeSlot, current.length - 1), current));
    if (stackRef.current.length < count) {
      setNotice(count === 4
        ? "2×2 opens four independent panes. Each pane shows a different image. Drop a series into an empty pane, or open a study with more slices."
        : "Each pane shows a different image. Drop a series into an empty pane.");
    } else {
      setNotice("");
    }
  }

  function resetView() {
    const pixels = active.instanceId ? cacheRef.current[imageCacheKey(active.instanceId, active.frame)] : null;
    setPreset("default");
    patchSlot(activeSlot, (slot) => ({
      ...slot,
      view: {
        ...initialView(),
        wc: pixels?.windowCenter ?? slot.view.wc,
        ww: pixels?.windowWidth ?? slot.view.ww,
      },
      marks: [],
      draft: null,
    }));
  }

  function choosePreset(id) {
    setPreset(id);
    if (id === "default") {
      const pixels = active.instanceId ? cacheRef.current[imageCacheKey(active.instanceId, active.frame)] : null;
      patchSlotView(activeSlot, (current) => ({ ...current, wc: pixels?.windowCenter ?? 128, ww: pixels?.windowWidth ?? 256 }));
      return;
    }
    const next = PRESET_VALUES[id];
    if (next) patchSlotView(activeSlot, (current) => ({ ...current, wc: next[0], ww: next[1] }));
  }

  function chooseTool(next) {
    setTool(next);
    setViewports((current) => current.map((slot) => ({ ...slot, draft: null })));
  }

  async function openReport() {
    if (!studyId) return;
    try {
      const data = await api("/api/reports", { method: "POST", body: { studyId } });
      navigate(`/reports/${data.report._id}`);
    } catch (err) {
      try {
        const list = await api("/api/reports");
        const found = list.reports.find((item) => String(item.studyId) === String(studyId));
        if (found) navigate(`/reports/${found._id}`);
        else toasts.error(err.message);
      } catch {
        toasts.error(err.message);
      }
    }
  }

  function explainReconstruction(name) {
    setNotice(`${name} needs a multi-slice volume. This workstation displays the stored grayscale images, with window, measurement, and cine tools.`);
  }

  function onImageClick(slotIndex, point) {
    activateSlot(slotIndex);
    if (tool === "probe") {
      patchSlot(slotIndex, (slot) => ({ ...slot, marks: [...slot.marks, { kind: "probe", points: [point] }] }));
      return;
    }
    if (tool === "text") {
      const note = window.prompt("Annotation text");
      if (note?.trim()) patchSlot(slotIndex, (slot) => ({ ...slot, marks: [...slot.marks, { kind: "text", points: [point], text: note.trim() }] }));
      return;
    }
    if (tool !== "angle") return;
    patchSlot(slotIndex, (slot) => {
      const points = slot.draft?.kind === "angle" ? [...slot.draft.points, point] : [point];
      if (points.length >= 3) return { ...slot, marks: [...slot.marks, { kind: "angle", points }], draft: null };
      return { ...slot, draft: { kind: "angle", points } };
    });
  }

  function onDragShape(slotIndex, kind, start, end, commit) {
    if (!kind) {
      patchSlot(slotIndex, { draft: null });
      return;
    }
    const next = { kind, points: [start, end] };
    patchSlot(slotIndex, (slot) => {
      if (commit) return { ...slot, marks: [...slot.marks, next], draft: null };
      return { ...slot, draft: next };
    });
  }

  function captureJpeg() {
    const canvas = rootRef.current?.querySelector(`canvas[data-viewport="${activeSlot}"]`);
    if (!canvas) {
      toasts.error("Open an image before saving a JPEG.");
      return;
    }
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/jpeg", 0.92);
    link.download = `${listItem?.accession || study?.accession || "study"}-viewport.jpg`;
    link.click();
  }

  function printViewport() {
    const canvas = rootRef.current?.querySelector(`canvas[data-viewport="${activeSlot}"]`);
    if (!canvas) {
      toasts.error("Open an image before printing.");
      return;
    }
    const frame = window.open("", "_blank");
    if (!frame) {
      toasts.error("The browser blocked the print window.");
      return;
    }
    frame.document.write(`<img src="${canvas.toDataURL("image/png")}" style="max-width:100%">`);
    frame.document.close();
    frame.focus();
    frame.print();
  }

  async function showTags() {
    if (!active.instanceId) {
      toasts.error("Open an image before reading DICOM tags.");
      return;
    }
    try {
      const data = await api(`/api/instances/${active.instanceId}/tags`);
      setTags(data.tags || []);
      setInfoOpen(true);
    } catch (err) {
      toasts.error(err.message);
    }
  }

  const readout = markLabel(active.draft, null, activePixels)?.text || "";
  const shown = studies.filter((item) => {
    const text = `${item.patientId?.name || ""} ${item.patientId?.mrn || ""} ${item.accession || ""} ${item.description || ""}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-black text-zinc-200">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-violet-950 bg-[#1a1024] px-2 py-1.5">
        <button type="button" className={toolClass(panelOpen)} onClick={() => setPanelOpen((open) => !open)}>Panel</button>
        <button type="button" className={toolClass(aiOpen)} onClick={() => setAiOpen((open) => !open)}>Analyze with AI</button>
        <span className="mx-1 text-xs uppercase tracking-wide text-violet-200/80">Layout</span>
        {[1, 2, 4].map((count) => (
          <button key={count} type="button" className={toolClass(layout === count)} onClick={() => applyLayout(count)}>
            {count === 1 ? "1×1" : count === 2 ? "1×2" : "2×2"}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-white/15" />
        <button type="button" className={toolClass(tool === "combined")} onClick={() => chooseTool("combined")}>Combined</button>
        <button type="button" className={toolClass(tool === "zoom")} onClick={() => chooseTool("zoom")}>Zoom</button>
        <button type="button" className={toolClass(tool === "pan")} onClick={() => chooseTool("pan")}>Pan</button>
        <button type="button" className={toolClass(tool === "wl")} onClick={() => chooseTool("wl")}>WL</button>
        <button type="button" className={toolClass(tool === "magnify")} onClick={() => chooseTool("magnify")}>Magnify</button>
        <select
          className="h-7 border border-white/15 bg-black/40 px-2 text-xs"
          value={preset}
          onChange={(event) => choosePreset(event.target.value)}
          aria-label="Window preset"
        >
          {Object.entries(PRESETS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <button type="button" className={toolClass(false)} onClick={() => patchSlotView(activeSlot, (current) => ({ ...current, rotation: (current.rotation + 270) % 360 }))}>Rotate L</button>
        <button type="button" className={toolClass(false)} onClick={() => patchSlotView(activeSlot, (current) => ({ ...current, rotation: (current.rotation + 90) % 360 }))}>Rotate R</button>
        <button type="button" className={toolClass(false)} onClick={() => patchSlotView(activeSlot, (current) => ({ ...current, flipH: !current.flipH }))}>Flip H</button>
        <button type="button" className={toolClass(false)} onClick={() => patchSlotView(activeSlot, (current) => ({ ...current, flipV: !current.flipV }))}>Flip V</button>
        <button type="button" className={toolClass(active.view.invert)} onClick={() => patchSlotView(activeSlot, (current) => ({ ...current, invert: !current.invert }))}>Invert</button>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <button type="button" className={toolClass(tool === "length")} onClick={() => chooseTool("length")}>Length</button>
        <button type="button" className={toolClass(tool === "angle")} onClick={() => chooseTool("angle")}>Angle</button>
        <button type="button" className={toolClass(tool === "circle")} onClick={() => chooseTool("circle")}>Circle</button>
        <button type="button" className={toolClass(tool === "rectangle")} onClick={() => chooseTool("rectangle")}>Rectangle</button>
        <button type="button" className={toolClass(tool === "roi")} onClick={() => chooseTool("roi")}>Ellipse</button>
        <button type="button" className={toolClass(tool === "probe")} onClick={() => chooseTool("probe")}>Probe</button>
        <button type="button" className={toolClass(tool === "text")} onClick={() => chooseTool("text")}>Text</button>
        <button type="button" className={toolClass(false)} onClick={() => patchSlot(activeSlot, (slot) => ({ ...slot, marks: slot.marks.slice(0, -1), draft: null }))} disabled={!active.marks.length && !active.draft}>Undo</button>
        <button type="button" className={toolClass(false)} onClick={() => patchSlot(activeSlot, { marks: [], draft: null })}>Clear</button>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <button type="button" className={toolClass(false)} onClick={() => stepSlot(activeSlot, -1)} disabled={seriesStack.length < 2 || active.stackIndex === 0}>Prev</button>
        <button type="button" className={toolClass(playing)} onClick={() => setPlaying((current) => !current)} disabled={seriesStack.length < 2}>Movie</button>
        <button type="button" className={toolClass(false)} onClick={() => stepSlot(activeSlot, 1)} disabled={seriesStack.length < 2 || active.stackIndex >= seriesStack.length - 1}>Next</button>
        <button type="button" className={toolClass(overlay)} onClick={() => setOverlay((current) => !current)}>Overlay</button>
        <button type="button" className={toolClass(infoOpen)} onClick={() => { if (infoOpen) setInfoOpen(false); else showTags(); }}>Tags</button>
        <button type="button" className={toolClass(false)} onClick={resetView}>Reset</button>
        <button type="button" className={toolClass(false)} onClick={captureJpeg} disabled={!active.instanceId}>JPEG</button>
        <button type="button" className={toolClass(false)} onClick={printViewport} disabled={!active.instanceId}>Print</button>
        <button type="button" className={toolClass(false)} title="Volume reconstruction is not available on this workstation" onClick={() => explainReconstruction("MPR")}>MPR</button>
        <button type="button" className={toolClass(false)} title="3D volume rendering is not available on this workstation" onClick={() => explainReconstruction("3D")}>3D</button>
        <button
          type="button"
          className="ml-auto h-7 bg-[#5b21b6] px-3 text-xs font-semibold text-white hover:bg-[#6d28d9] disabled:opacity-40"
          disabled={!studyId}
          onClick={openReport}
        >
          Report
        </button>
        <button
          type="button"
          className={toolClass(false)}
          onClick={() => {
            if (!document.fullscreenElement) rootRef.current?.requestFullscreen();
            else document.exitFullscreen();
          }}
        >
          Full screen
        </button>
      </div>
      {notice && (
        <p className="shrink-0 border-b border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-100">{notice}</p>
      )}
      {error && <p className="shrink-0 px-3 py-1.5 text-xs text-amber-300">{error}</p>}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {panelOpen && (
        <aside className="flex max-h-64 w-full shrink-0 flex-col border-b border-white/10 bg-[#120e18] md:max-h-none md:w-60 md:border-b-0 md:border-r lg:w-72">
          <div className="border-b border-white/10 p-2">
            <label className="block text-xs text-violet-200" htmlFor="viewer-patient">Patient</label>
            <select
              id="viewer-patient"
              className="mt-1 h-8 w-full border border-white/10 bg-black/40 px-2 text-xs text-white"
              value={studyId || ""}
              onChange={(event) => event.target.value && navigate(`/viewer/${event.target.value}`)}
            >
              <option value="">Select a study</option>
              {shown.map((item) => (
                <option key={item._id} value={item._id}>{item.patientId?.name || "Patient"} · {item.modality} · {item.accession}</option>
              ))}
            </select>
            {listItem && (
              <p className="mt-2 text-xs leading-5 text-zinc-300">
                {listItem.modality} · {listItem.description || "No description"}
                <br />
                {listItem.studyDate || "Date not recorded"} · {listItem.patientId?.sex || ""}
              </p>
            )}
          </div>
          <form className="border-b border-white/10 p-2" onSubmit={(event) => event.preventDefault()}>
            <label className="block text-xs text-zinc-300" htmlFor="viewer-find">Find a study</label>
            <input
              id="viewer-find"
              className="mt-1 h-8 w-full border border-white/10 bg-black/40 px-2 text-xs outline-none focus:border-violet-400"
              placeholder="Patient, MRN, accession"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </form>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-violet-200">Series</p>
            <p className="mb-2 text-xs text-zinc-400">Click a series to load it in the selected pane. Drag it onto any pane.</p>
            {(bundle?.series || []).map((series) => {
              const frames = stack.filter((item) => String(item.seriesId) === String(series._id));
              const first = instances.find((item) => String(item.seriesId) === String(series._id));
              const activeSeries = String(active.seriesId) === String(series._id);
              return (
                <button
                  key={series._id}
                  type="button"
                  draggable
                  className={`mb-2 block w-full border text-left ${activeSeries ? "border-violet-300 bg-[#3b1d5c]" : "border-white/10 hover:border-violet-400/50"}`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/x-pacsd-series", String(series._id));
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => loadSeriesIntoSlot(activeSlot, series._id)}
                >
                  <SeriesThumb pixels={first ? cache[imageCacheKey(first._id, 0)] : null} />
                  <span className="block truncate px-2 pt-1 text-xs font-medium text-white">{series.description || `Series ${series.seriesNumber}`}</span>
                  <span className="block px-2 pb-2 text-xs text-zinc-300">{series.modality || study?.modality || ""} · {frames.length || instances.filter((item) => String(item.seriesId) === String(series._id)).length} images</span>
                </button>
              );
            })}
            {study && !instances.length && <p className="px-1 py-2 text-xs text-zinc-300">This study has no stored images.</p>}
            {!bundle?.series?.length && instances.length > 0 && <p className="px-1 py-2 text-xs text-zinc-300">{instances.length} images</p>}
          </div>
        </aside>
        )}
        <div className={`grid h-full min-h-0 min-w-0 flex-1 ${layout === 4 ? "grid-cols-2 grid-rows-2" : layout === 2 ? "grid-cols-2 grid-rows-1" : "grid-cols-1 grid-rows-1"}`}>
          {viewports.slice(0, layout).map((slot, slotIndex) => {
            const instance = instances.find((item) => item._id === slot.instanceId);
            const pixels = slot.instanceId ? cache[imageCacheKey(slot.instanceId, slot.frame)] : null;
            const slotImages = imagesForSlot(slot, stack);
            const aiBoxes = (aiState.showMarks ? acceptedAnnotations(aiState.analysis?.findings, {
              columns: aiState.analysis?.columns,
              rows: aiState.analysis?.rows,
              annotationsSupported: aiState.analysis?.annotationsSupported,
            }) : []).filter((box) => box.instanceId === slot.instanceId && box.frame === slot.frame);
            return (
              <Viewport
                key={`slot-${slotIndex}`}
                slotIndex={slotIndex}
                pixels={pixels}
                view={slot.view}
                active={activeSlot === slotIndex}
                tool={tool}
                marks={slot.marks}
                draft={slot.draft}
                aiBoxes={aiBoxes}
                overlay={overlay}
                label={listItem}
                study={study}
                index={slot.stackIndex}
                total={slotImages.length || (instance ? 1 : 0)}
                emptyHint={uniqueImages < layout ? "Drop a series here" : "No image in this pane"}
                onActivate={() => activateSlot(slotIndex)}
                onView={(updater) => patchSlotView(slotIndex, updater)}
                onImageClick={(point) => onImageClick(slotIndex, point)}
                onDragShape={(kind, start, end, commit) => onDragShape(slotIndex, kind, start, end, commit)}
                onWheel={(direction) => stepSlot(slotIndex, direction)}
                onDropSeries={(seriesId) => loadSeriesIntoSlot(slotIndex, seriesId)}
              />
            );
          })}
        </div>
        {aiOpen && (
          <div className="w-full shrink-0 overflow-auto border-t border-white/10 md:w-96 md:border-l md:border-t-0">
            <AiPanel
              studyId={study?._id}
              instanceId={active.instanceId}
              frame={active.frame || 0}
              instances={instances}
              onInstance={(instanceId) => {
                const item = stackRef.current.find((entry) => entry.instanceId === instanceId && entry.frame === 0);
                if (item) patchSlot(activeSlot, (slot) => slotFromImage(item, slot));
              }}
              onChange={setAiState}
              onOpenReport={async () => {
                try {
                  const data = await api("/api/reports");
                  const existing = (data.reports || []).find((item) => String(item.studyId?._id || item.studyId) === String(study._id));
                  if (existing) navigate(`/reports/${existing._id}`);
                  else {
                    const created = await api("/api/reports", { method: "POST", body: { studyId: study._id } });
                    navigate(`/reports/${created.report._id}`);
                  }
                } catch (err) {
                  pushToast(err.message, "error");
                }
              }}
            />
          </div>
        )}
        {infoOpen && (
          <aside className="w-full shrink-0 overflow-auto border-t border-white/10 bg-[#120e18] md:w-80 md:border-l md:border-t-0">
            <div className="flex items-center justify-between px-3 py-2">
              <p className="text-xs uppercase tracking-[0.16em] text-violet-200">Image information</p>
              <button type="button" className={toolClass(false)} onClick={() => setInfoOpen(false)}>Close</button>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {tags.map((tag) => (
                  <tr key={tag.tag} className="border-t border-white/5">
                    <td className="px-3 py-1 align-top font-mono text-zinc-400">{tag.tag}</td>
                    <td className="px-2 py-1 align-top text-zinc-300">{tag.name}</td>
                    <td className="px-3 py-1 text-white">{tag.value}</td>
                  </tr>
                ))}
                {!tags.length && <tr><td className="px-3 py-4 text-zinc-300" colSpan={3}>No tags were returned for this image.</td></tr>}
              </tbody>
            </table>
          </aside>
        )}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#101014] px-3 py-1 text-xs text-zinc-400">
        <span>{HINTS[tool]}{readout ? ` · ${readout}` : ""}{layout > 1 ? " · Draw in the highlighted pane." : ""}</span>
        <span>
          {calibrationLabel(activePixels)}
          {calibrationLabel(activePixels) ? " · " : ""}
          WW {Math.round(active.view.ww)} · WL {Math.round(active.view.wc)} · {Math.round(active.view.zoom * 100)}% · {slotImagesLabel(active, seriesStack)}
        </span>
      </footer>
    </div>
  );
}

function Viewport({
  slotIndex,
  pixels,
  view,
  active,
  tool,
  marks,
  draft,
  aiBoxes = [],
  overlay,
  label,
  study,
  index,
  total,
  emptyHint,
  onActivate,
  onView,
  onImageClick,
  onDragShape,
  onWheel,
  onDropSeries,
}) {
  const hostRef = useRef(null);
  const displayRef = useRef(null);
  const sourceRef = useRef(null);
  const valuesRef = useRef(null);
  const dragRef = useRef(null);
  const [cursor, setCursor] = useState(null);
  const [dropOver, setDropOver] = useState(false);

  useLayoutEffect(() => {
    const display = displayRef.current;
    const host = hostRef.current;
    if (!display || !host) return undefined;
    const paint = () => {
      const width = Math.max(1, Math.floor(host.clientWidth));
      const height = Math.max(1, Math.floor(host.clientHeight));
      if (display.width !== width) display.width = width;
      if (display.height !== height) display.height = height;
      const context = display.getContext("2d");
      context.fillStyle = "#000";
      context.fillRect(0, 0, width, height);
      if (!pixels?.supported || !pixels.pixelBytes) return;
      const decoded = decodePixels(pixels);
      valuesRef.current = decoded;
      const monoInvert = pixels.photometric === "MONOCHROME1";
      sourceRef.current = decoded.rgb
        ? renderColor(decoded.rgb, decoded.columns, decoded.rows)
        : renderSource(decoded.values, decoded.columns, decoded.rows, view.wc, view.ww, monoInvert !== view.invert);
      paintFrame(context, sourceRef.current, view, width, height);
      drawMarks(context, sourceRef.current, view, width, height, marks, draft, decoded, pixels);
      drawAiBoxes(context, sourceRef.current, view, width, height, aiBoxes);
      if (tool === "magnify" && cursor && active) drawLens(context, sourceRef.current, view, width, height, cursor);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(host);
    return () => observer.disconnect();
  }, [pixels, view, marks, draft, aiBoxes, cursor, tool, active]);

  function eventPoint(event) {
    const host = hostRef.current;
    const display = displayRef.current;
    const source = sourceRef.current;
    if (!host || !display || !source) return null;
    const rect = host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const sx = (event.clientX - rect.left) * (display.width / rect.width);
    const sy = (event.clientY - rect.top) * (display.height / rect.height);
    return screenToImage(sx, sy, source, view, display.width, display.height);
  }

  function finishDrag(event, commit) {
    const drag = dragRef.current;
    const point = eventPoint(event) || drag?.lastPoint;
    if (drag && DRAG_SHAPES.has(drag.action)) {
      if (commit && point) {
        const moved = Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) >= 2;
        if (moved) onDragShape(drag.action, drag.origin, point, true);
        else onDragShape(null, drag.origin, point, false);
      } else {
        onDragShape(null, drag.origin, point || drag.origin, false);
      }
    }
    dragRef.current = null;
  }

  return (
    <div
      ref={hostRef}
      role="application"
      tabIndex={0}
      aria-label={`Image pane ${slotIndex + 1}${active ? ", selected" : ""}`}
      className={`relative h-full min-h-0 min-w-0 overflow-hidden bg-black ${active ? "outline outline-1 outline-violet-400/80" : "outline outline-1 outline-white/10"} ${dropOver ? "outline-violet-300" : ""}`}
      style={{ cursor: tool === "pan" ? "grab" : "crosshair", touchAction: "none" }}
      onContextMenu={(event) => event.preventDefault()}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropOver(true);
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropOver(false);
        const seriesId = event.dataTransfer.getData("application/x-pacsd-series");
        if (seriesId) onDropSeries(seriesId);
      }}
      onPointerDown={(event) => {
        onActivate();
        const point = eventPoint(event);
        if (!point) return;
        event.preventDefault();
        if (tool === "angle" || tool === "probe" || tool === "text") {
          onImageClick(point);
          return;
        }
        const action = pointerAction(tool, event.button);
        dragRef.current = { x: event.clientX, y: event.clientY, origin: point, lastPoint: point, action, button: event.button };
        if (DRAG_SHAPES.has(action)) onDragShape(action, point, point, false);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture needs a real pointer. Drawing still continues on this pane.
        }
      }}
      onPointerMove={(event) => {
        const point = eventPoint(event);
        if (tool === "magnify") setCursor(point);
        const drag = dragRef.current;
        if (!drag || !point) return;
        drag.lastPoint = point;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        applyPointerAction(drag.action, dx, dy, drag.origin, point, false, onView, onDragShape);
      }}
      onPointerUp={(event) => finishDrag(event, true)}
      onPointerCancel={(event) => finishDrag(event, false)}
      onLostPointerCapture={(event) => {
        if (dragRef.current) finishDrag(event, true);
      }}
      onWheel={(event) => {
        event.preventDefault();
        if (tool === "zoom" || tool === "combined") onView((current) => ({ ...current, zoom: clamp(current.zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.2, 12) }));
        else onWheel(event.deltaY > 0 ? 1 : -1);
      }}
    >
      <canvas ref={displayRef} data-viewport={slotIndex} className="pointer-events-none absolute inset-0 h-full w-full" />
      {pixels && !pixels.supported && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center" role="alert">
          <div>
            <p className="text-base font-medium text-white">This image cannot be displayed.</p>
            <p className="mt-2 max-w-md text-sm text-zinc-200">{pixels.reason || "The pixel data is missing or this transfer syntax is not supported."}</p>
            {pixels.orthancPreview && <img alt="Archive preview" className="mx-auto mt-3 max-h-[50vh]" src={`/api/instances/${pixels.id}/orthanc-preview`} />}
          </div>
        </div>
      )}
      {!pixels && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {total ? <div className="h-24 w-24 animate-pulse bg-white/10" role="status" aria-label="Loading image" /> : <p className="px-4 text-center text-xs text-zinc-300">{emptyHint}</p>}
        </div>
      )}
      {overlay && pixels?.supported && (
        <>
          <div className="pointer-events-none absolute left-2 top-2 text-xs leading-4 text-zinc-200">
            <div>{label?.patientId?.name || "Patient"}</div>
            <div className="text-zinc-400">{label?.patientId?.mrn || ""} {study?.accession ? `· ${study.accession}` : ""}</div>
            <div className="text-zinc-400">{study?.description || study?.modality || ""}</div>
          </div>
          <div className="pointer-events-none absolute right-2 top-2 text-right text-xs leading-4 text-zinc-200">
            <div>{study?.description || study?.modality}</div>
            <div className="text-zinc-400">{study?.studyDate || ""}</div>
            <div>WW {Math.round(view.ww)} WL {Math.round(view.wc)}</div>
            <div>{pixels.rows && pixels.columns ? `${pixels.columns}×${pixels.rows}` : ""}</div>
            <div>{total ? `${index + 1} / ${total}` : ""}</div>
          </div>
          {!calibratedSpacing(pixels) && (
            <div className="pointer-events-none absolute bottom-2 right-2 max-w-[240px] text-right text-xs text-amber-300">No pixel spacing. Lengths are px uncalibrated.</div>
          )}
          <OrientationMarkers orientation={pixels.orientation} view={view} />
          <div className="pointer-events-none absolute bottom-2 left-2 text-xs text-zinc-400">
            WW {Math.round(view.ww)} WL {Math.round(view.wc)}
          </div>
        </>
      )}
    </div>
  );
}

function emptySlot() {
  return {
    instanceId: null,
    seriesId: null,
    frame: 0,
    stackIndex: 0,
    key: "",
    view: initialView(),
    marks: [],
    draft: null,
  };
}

function imageCacheKey(instanceId, frame = 0) {
  return `${instanceId}:${Number(frame) || 0}`;
}

function buildImageStack(instances, cache) {
  const stack = [];
  const seriesCursor = new Map();
  for (const instance of instances) {
    const meta = cache[imageCacheKey(instance._id, 0)];
    const frames = Math.max(1, Number(meta?.numberOfFrames) || 1);
    const seriesId = String(instance.seriesId || "");
    if (!seriesCursor.has(seriesId)) seriesCursor.set(seriesId, 0);
    for (let frame = 0; frame < frames; frame += 1) {
      const stackIndex = seriesCursor.get(seriesId);
      seriesCursor.set(seriesId, stackIndex + 1);
      stack.push({
        instanceId: instance._id,
        seriesId: instance.seriesId,
        frame,
        instance,
        stackIndex,
        key: imageCacheKey(instance._id, frame),
      });
    }
  }
  return stack;
}

function imagesForSlot(slot, stack) {
  if (!slot?.seriesId) return [];
  return stack.filter((item) => String(item.seriesId) === String(slot.seriesId));
}

function slotFromImage(item, previous = emptySlot()) {
  const sameImage = previous.instanceId === item.instanceId && previous.frame === item.frame;
  const sameSeries = String(previous.seriesId) === String(item.seriesId);
  return {
    instanceId: item.instanceId,
    seriesId: item.seriesId,
    frame: item.frame,
    stackIndex: item.stackIndex ?? 0,
    key: item.key,
    view: sameSeries ? previous.view : {
      ...initialView(),
      wc: item.instance?.windowCenter ?? previous.view.wc ?? 128,
      ww: item.instance?.windowWidth ?? previous.view.ww ?? 256,
    },
    marks: sameImage ? previous.marks : [],
    draft: sameImage ? previous.draft : null,
  };
}

function hangLayout(stack, seriesList, count, activeIndex = 0, current = []) {
  const next = [];
  const used = new Set();
  const active = current[activeIndex] || current[0];
  const preferredSeries = active?.seriesId;
  const seriesImages = preferredSeries
    ? stack.filter((item) => String(item.seriesId) === String(preferredSeries))
    : [];
  const start = active?.stackIndex || 0;

  function take(item, previous) {
    if (!item || used.has(item.key)) return null;
    used.add(item.key);
    return slotFromImage(item, previous || emptySlot());
  }

  if (seriesImages.length >= count) {
    const step = Math.max(1, Math.floor(seriesImages.length / count));
    for (let slot = 0; slot < count; slot += 1) {
      const item = seriesImages[(start + slot * step) % seriesImages.length];
      next.push(take(item, current[slot]) || emptySlot());
    }
    return next;
  }

  const firstBySeries = [];
  for (const series of seriesList) {
    const first = stack.find((item) => String(item.seriesId) === String(series._id) && !used.has(item.key));
    if (first) firstBySeries.push(first);
  }
  if (firstBySeries.length >= 2) {
    for (let slot = 0; slot < count; slot += 1) {
      next.push(take(firstBySeries[slot], current[slot]) || emptySlot());
    }
    return next;
  }

  for (let slot = 0; slot < count; slot += 1) {
    const item = stack.find((candidate) => !used.has(candidate.key));
    next.push(take(item, current[slot]) || emptySlot());
  }
  return next;
}

function fillEmptySlots(current, stack, layout) {
  const next = current.slice(0, layout);
  while (next.length < layout) next.push(emptySlot());
  const used = new Set(next.filter((slot) => slot.key).map((slot) => slot.key));
  let changed = current.length !== next.length;
  const filled = next.map((slot) => {
    if (slot.instanceId) {
      const item = stack.find((candidate) => candidate.key === slot.key);
      if (item && item.stackIndex !== slot.stackIndex) {
        changed = true;
        return { ...slot, stackIndex: item.stackIndex };
      }
      return slot;
    }
    const item = stack.find((candidate) => !used.has(candidate.key));
    if (!item) return slot;
    used.add(item.key);
    changed = true;
    return slotFromImage(item, slot);
  });
  return changed ? filled : current;
}

function slotImagesLabel(slot, seriesStack) {
  if (!slot?.instanceId) return "—";
  if (!seriesStack.length) return "1/1";
  return `${slot.stackIndex + 1}/${seriesStack.length}`;
}

function initialView() {
  return { wc: 128, ww: 256, zoom: 1, panX: 0, panY: 0, rotation: 0, flipH: false, flipV: false, invert: false };
}

function SeriesThumb({ pixels }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    canvas.width = 220;
    canvas.height = 120;
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!pixels?.supported || !pixels.pixelBytes) return;
    const decoded = decodePixels(pixels);
    const source = decoded.rgb
      ? renderColor(decoded.rgb, decoded.columns, decoded.rows)
      : renderSource(decoded.values, decoded.columns, decoded.rows, pixels.windowCenter ?? 128, pixels.windowWidth ?? 256, pixels.photometric === "MONOCHROME1");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }, [pixels]);
  return <canvas ref={ref} className="block aspect-[11/6] h-auto w-full bg-black" aria-hidden="true" />;
}

function toolClass(active) {
  return `h-7 px-2 text-xs font-medium ${active ? "bg-[#5b21b6] text-white" : "text-zinc-300 hover:bg-white/10"} disabled:opacity-40`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pointerAction(tool, button) {
  if (tool === "combined") {
    if (button === 2) return "zoom";
    if (button === 1) return "pan";
    return "wl";
  }
  return tool;
}

function applyPointerAction(action, dx, dy, origin, point, commit, onView, onDragShape) {
  if (action === "wl") onView((current) => ({ ...current, ww: Math.max(1, current.ww + dx * 2), wc: current.wc - dy }));
  else if (action === "zoom") onView((current) => ({ ...current, zoom: clamp(current.zoom * (1 - dy / 180), 0.2, 12) }));
  else if (action === "pan") onView((current) => ({ ...current, panX: current.panX + dx, panY: current.panY + dy }));
  else if (DRAG_SHAPES.has(action)) onDragShape(action, origin, point, commit);
}

async function loadPixelCache(id, frame = 0) {
  const data = await api(`/api/instances/${id}/pixels?frame=${frame}`);
  if (!data.supported) return data;
  const headers = {};
  const facilityId = sessionStorage.getItem("pacsd_facility");
  if (facilityId) headers["x-facility-id"] = facilityId;
  const response = await fetch(`/api/instances/${id}/pixels/raw?frame=${data.frame || frame}`, { credentials: "include", headers });
  if (!response.ok) throw new Error("Pixel data was not available");
  data.pixelBytes = new Uint8Array(await response.arrayBuffer());
  return data;
}

function decodePixels(payload) {
  const raw = payload.pixelBytes;
  const count = payload.rows * payload.columns;
  if (payload.samplesPerPixel === 3 && raw.length >= count * 3) {
    return { rgb: raw, values: null, rows: payload.rows, columns: payload.columns };
  }
  const values = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    let value = payload.bitsAllocated === 16 ? raw[index * 2] | (raw[index * 2 + 1] << 8) : raw[index];
    if (payload.bitsAllocated === 16 && payload.pixelRepresentation === 1 && value > 32767) value -= 65536;
    values[index] = value * (payload.slope || 1) + (payload.intercept || 0);
  }
  return { values, rows: payload.rows, columns: payload.columns };
}

function renderColor(rgb, columns, rows) {
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  const image = context.createImageData(columns, rows);
  for (let index = 0; index < columns * rows; index += 1) {
    image.data[index * 4] = rgb[index * 3];
    image.data[index * 4 + 1] = rgb[index * 3 + 1];
    image.data[index * 4 + 2] = rgb[index * 3 + 2];
    image.data[index * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function renderSource(values, columns, rows, wc, ww, invert) {
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  const image = context.createImageData(columns, rows);
  const low = wc - ww / 2;
  for (let index = 0; index < values.length; index += 1) {
    let gray = Math.round(((values[index] - low) / Math.max(1, ww)) * 255);
    gray = Math.max(0, Math.min(255, gray));
    if (invert) gray = 255 - gray;
    const offset = index * 4;
    image.data[offset] = gray;
    image.data[offset + 1] = gray;
    image.data[offset + 2] = gray;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function fitScale(source, width, height) {
  return Math.min(width / source.width, height / source.height) * 0.92;
}

function paintFrame(context, source, view, width, height) {
  const scale = fitScale(source, width, height) * view.zoom;
  context.imageSmoothingEnabled = scale > 1.25;
  context.imageSmoothingQuality = "high";
  context.save();
  context.translate(width / 2 + view.panX, height / 2 + view.panY);
  context.rotate((view.rotation * Math.PI) / 180);
  context.scale(view.flipH ? -1 : 1, view.flipV ? -1 : 1);
  context.scale(scale, scale);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  context.restore();
}

function screenToImage(sx, sy, source, view, width, height) {
  let x = sx - (width / 2 + view.panX);
  let y = sy - (height / 2 + view.panY);
  const radians = (-view.rotation * Math.PI) / 180;
  const rx = x * Math.cos(radians) - y * Math.sin(radians);
  const ry = x * Math.sin(radians) + y * Math.cos(radians);
  const scale = fitScale(source, width, height) * view.zoom;
  x = rx / (scale * (view.flipH ? -1 : 1));
  y = ry / (scale * (view.flipV ? -1 : 1));
  return { x: x + source.width / 2, y: y + source.height / 2 };
}

function imageToScreen(point, source, view, width, height) {
  const scale = fitScale(source, width, height) * view.zoom;
  let x = (point.x - source.width / 2) * scale * (view.flipH ? -1 : 1);
  let y = (point.y - source.height / 2) * scale * (view.flipV ? -1 : 1);
  const radians = (view.rotation * Math.PI) / 180;
  const rx = x * Math.cos(radians) - y * Math.sin(radians);
  const ry = x * Math.sin(radians) + y * Math.cos(radians);
  return [rx + width / 2 + view.panX, ry + height / 2 + view.panY];
}

function calibrationLabel(pixels) {
  if (!pixels) return "";
  return calibratedSpacing(pixels) ? "Calibration mm" : "Calibration px uncalibrated";
}

function OrientationMarkers({ orientation, view }) {
  if (!orientation?.left || !orientation?.right || !orientation?.top || !orientation?.bottom) return null;
  const placed = `rotate(${view.rotation || 0}deg) scale(${view.flipH ? -1 : 1}, ${view.flipV ? -1 : 1})`;
  const upright = `scale(${view.flipH ? -1 : 1}, ${view.flipV ? -1 : 1}) rotate(${-(view.rotation || 0)}deg)`;
  const label = "pointer-events-none absolute text-xs font-semibold text-amber-100";
  return (
    <div className="pointer-events-none absolute inset-8" style={{ transform: placed }} aria-hidden="true">
      <span className={`${label} left-1/2 top-0 -translate-x-1/2`} style={{ transform: upright }}>{orientation.top}</span>
      <span className={`${label} bottom-0 left-1/2 -translate-x-1/2`} style={{ transform: upright }}>{orientation.bottom}</span>
      <span className={`${label} left-0 top-1/2 -translate-y-1/2`} style={{ transform: upright }}>{orientation.left}</span>
      <span className={`${label} right-0 top-1/2 -translate-y-1/2`} style={{ transform: upright }}>{orientation.right}</span>
    </div>
  );
}

function calibratedSpacing(pixels) {
  const chosen = Array.isArray(pixels?.pixelSpacing) && pixels.pixelSpacing.length >= 2
    ? pixels.pixelSpacing
    : pixels?.imagerPixelSpacing;
  if (!Array.isArray(chosen) || chosen.length < 2) return null;
  const row = Number(chosen[0]);
  const column = Number(chosen[1]);
  if (!Number.isFinite(row) || !Number.isFinite(column) || row <= 0 || column <= 0) return null;
  return [row, column];
}

function drawAiBoxes(context, source, view, width, height, boxes) {
  if (!boxes?.length) return;
  context.save();
  context.font = "600 13px Segoe UI, sans-serif";
  boxes.forEach((box) => {
    const [x, y] = imageToScreen({ x: box.x, y: box.y }, source, view, width, height);
    const [x2, y2] = imageToScreen({ x: box.x + box.width, y: box.y + box.height }, source, view, width, height);
    context.strokeStyle = "#f5d0fe";
    context.lineWidth = 2;
    context.strokeRect(Math.min(x, x2), Math.min(y, y2), Math.abs(x2 - x), Math.abs(y2 - y));
    context.fillStyle = "#f5d0fe";
    context.fillText(String(box.index), Math.min(x, x2) + 4, Math.min(y, y2) + 14);
  });
  context.restore();
}

function drawMarks(context, source, view, width, height, marks, draft, decoded, pixels) {
  const items = draft ? [...marks, draft] : marks;
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  context.font = "600 13px Segoe UI, sans-serif";
  items.forEach((mark) => {
    const screen = mark.points.map((point) => imageToScreen(point, source, view, width, height));
    context.lineWidth = 4;
    context.strokeStyle = "rgba(0,0,0,0.85)";
    traceMark(context, mark, screen);
    context.lineWidth = 2;
    context.strokeStyle = "#67e8f9";
    traceMark(context, mark, screen);
    screen.forEach(([x, y]) => {
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fillStyle = "#67e8f9";
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = "#041016";
      context.stroke();
    });
    const label = markLabel(mark, decoded, pixels);
    if (label && screen.length) {
      const anchor = screen[Math.min(1, screen.length - 1)];
      drawMarkLabel(context, label.text, anchor[0], anchor[1]);
    }
  });
  context.restore();
}

function traceMark(context, mark, screen) {
  if ((mark.kind === "roi" || mark.kind === "circle") && screen.length === 2) {
    const [a, b] = screen;
    const rx = Math.max(1, Math.abs(b[0] - a[0]) / 2);
    const ry = mark.kind === "circle" ? rx : Math.max(1, Math.abs(b[1] - a[1]) / 2);
    context.beginPath();
    context.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, rx, ry, 0, 0, Math.PI * 2);
    context.stroke();
    return;
  }
  if (mark.kind === "rectangle" && screen.length === 2) {
    const [a, b] = screen;
    context.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    return;
  }
  if (screen.length < 2) return;
  context.beginPath();
  screen.forEach(([x, y], pointIndex) => {
    if (pointIndex === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

function drawMarkLabel(context, text, x, y) {
  const padX = 6;
  const boxH = 20;
  const boxW = context.measureText(text).width + padX * 2;
  const left = Math.round(x + 10);
  const top = Math.round(y - boxH - 8);
  context.fillStyle = "rgba(8, 16, 24, 0.88)";
  context.fillRect(left, top, boxW, boxH);
  context.strokeStyle = "#67e8f9";
  context.lineWidth = 1;
  context.strokeRect(left, top, boxW, boxH);
  context.fillStyle = "#ecfeff";
  context.fillText(text, left + padX, top + 14);
}

function markLabel(mark, decoded, pixels) {
  if (!mark) return null;
  if (mark.kind === "text") return mark.text ? { text: mark.text, uncalibrated: false } : null;
  if (mark.kind === "probe" && mark.points[0]) {
    const value = sampleValue(decoded, mark.points[0].x, mark.points[0].y);
    return value == null ? null : { text: `HU ${Math.round(value)}`, uncalibrated: false };
  }
  if (mark.kind === "length" && mark.points.length === 2) {
    const [a, b] = mark.points;
    const spacing = calibratedSpacing(pixels);
    if (!spacing) return { text: `${Math.hypot(b.x - a.x, b.y - a.y).toFixed(1)} px uncalibrated`, uncalibrated: true };
    const millimetres = Math.hypot((b.x - a.x) * spacing[1], (b.y - a.y) * spacing[0]);
    return { text: `${millimetres.toFixed(1)} mm`, uncalibrated: false };
  }
  if (mark.kind === "angle" && mark.points.length === 3) {
    const [a, b, c] = mark.points;
    const v1x = a.x - b.x;
    const v1y = a.y - b.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const dot = v1x * v2x + v1y * v2y;
    const size = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
    return { text: `${Math.round((Math.acos(clamp(dot / size, -1, 1)) * 180) / Math.PI)}°`, uncalibrated: false };
  }
  if ((mark.kind === "roi" || mark.kind === "circle" || mark.kind === "rectangle") && mark.points.length === 2 && decoded?.values) {
    return regionStats(mark, decoded);
  }
  return null;
}

function sampleValue(decoded, x, y) {
  if (!decoded?.values) return null;
  const column = Math.round(x);
  const row = Math.round(y);
  if (column < 0 || row < 0 || column >= decoded.columns || row >= decoded.rows) return null;
  return decoded.values[row * decoded.columns + column];
}

function regionStats(mark, decoded) {
  const [a, b] = mark.points;
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x)));
  const maxX = Math.min(decoded.columns - 1, Math.ceil(Math.max(a.x, b.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y)));
  const maxY = Math.min(decoded.rows - 1, Math.ceil(Math.max(a.y, b.y)));
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.max(1, Math.abs(b.x - a.x) / 2);
  const ry = mark.kind === "circle" ? rx : Math.max(1, Math.abs(b.y - a.y) / 2);
  let sum = 0;
  let count = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (mark.kind !== "rectangle") {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
      }
      sum += decoded.values[y * decoded.columns + x];
      count += 1;
    }
  }
  return count ? { text: `Mean ${Math.round(sum / count)} · n ${count}`, uncalibrated: false } : null;
}

function drawLens(context, source, view, width, height, point) {
  const [sx, sy] = imageToScreen(point, source, view, width, height);
  context.save();
  context.beginPath();
  context.arc(sx, sy, 72, 0, Math.PI * 2);
  context.clip();
  context.translate(sx, sy);
  context.scale(2.4, 2.4);
  context.translate(-sx, -sy);
  paintFrame(context, source, view, width, height);
  context.restore();
  context.beginPath();
  context.arc(sx, sy, 72, 0, Math.PI * 2);
  context.strokeStyle = "#e4e4e7";
  context.stroke();
}
