import { useEffect, useState } from "react";
import { ChevronDown, RefreshCw, Ruler, Sparkles, Tag, Layers } from "lucide-react";
import AiPanel from "../../AiPanel.jsx";
import { api } from "../../api.js";
import { CT_WINDOW_PRESETS } from "../../../../shared/ctPresets.js";
import { Accordion } from "./ToolButton.jsx";

const PRESETS = [
  ["brain", "Brain"],
  ["bone", "Bone"],
  ["lung", "Lung"],
  ["soft", "Soft Tissue"],
];

export default function StudyInfoPanel({
  tab,
  onTab,
  study,
  series,
  instance,
  snapshot,
  measurements,
  annotations,
  onPreset,
  onWindow,
  onResetWindow,
  seriesList,
  seriesId,
  onSeries,
  smooth,
  onSmooth,
  mode,
  onMode,
  volumePresetId,
  onVolumePreset,
  volumePresets,
  opacity,
  onOpacity,
  brightness,
  onBrightness,
  background,
  onBackground,
  crop,
  onCrop,
  onSaveVolume,
  onResetCamera,
  slab,
  onSlab,
  blend,
  onBlend,
  onOrientation,
  tool,
  onTool,
  studyId,
  onInstance,
  onOpenReport,
  onAiChange,
  frame,
}) {
  const [open, setOpen] = useState({ details: true, window: true, measurements: false, annotations: false, series: false, tags: false });
  const [width, setWidth] = useState("");
  const [level, setLevel] = useState("");
  function toggle(key) {
    setOpen((current) => ({ ...current, [key]: !current[key] }));
  }

  useEffect(() => {
    if (Number.isFinite(snapshot.windowWidth)) setWidth(String(Math.round(snapshot.windowWidth)));
    if (Number.isFinite(snapshot.windowCenter)) setLevel(String(Math.round(snapshot.windowCenter)));
  }, [snapshot.windowWidth, snapshot.windowCenter]);

  function commitWindow() {
    const nextWidth = Number(width);
    const nextLevel = Number(level);
    if (Number.isFinite(nextWidth) && Number.isFinite(nextLevel)) onWindow(nextLevel, Math.max(1, nextWidth));
  }

  return (
    <aside className="gms2-right flex w-[330px] min-w-0 flex-col border-l border-[#2a2a31] bg-[#1c1c21]">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-[#2a2a31] px-2">
        <PanelTab active={tab === "info"} label="Study Info" onClick={() => onTab("info")} />
        <PanelTab active={tab === "tools"} label="Tools" onClick={() => onTab("tools")} />
        <PanelTab active={tab === "ai"} label="AI Assist" onClick={() => onTab("ai")} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "info" && (
          <>
            <div className="flex items-center justify-between border-b border-[#2a2a31] px-3 py-2">
              <span className="text-[13px] font-semibold">Study Details</span>
              <span className="flex items-center gap-1">
                <span className="rounded bg-[#2a2a31] px-1.5 py-0.5 text-[10px] font-semibold text-[#c4b5fd]">{study?.modality || series?.modality || "—"}</span>
                <span className="max-w-[120px] truncate text-[11px] text-zinc-300">{study?.description || ""}</span>
              </span>
            </div>
            <dl className="grid grid-cols-[108px_minmax(0,1fr)] gap-y-1.5 border-b border-[#2a2a31] px-3 py-3 text-[12px]">
              <Row label="Study UID" value={study?.studyUid} />
              <Row label="Accession" value={study?.accession} />
              <Row label="Date" value={study?.studyDate} />
              <Row label="Modality" value={series?.modality || study?.modality} />
              <Row label="Institution" value={instance?.institution} />
              <Row label="Manufacturer" value={instance?.manufacturer} />
              <Row label="Images" value={series?.imageCount} />
              <Row label="Slice Thickness" value={instance?.sliceThickness != null ? `${instance.sliceThickness} mm` : ""} />
              <Row label="Pixel Spacing" value={(instance?.pixelSpacing || []).join(" × ")} />
              <Row label="Matrix" value={instance?.columns && instance?.rows ? `${instance.columns} × ${instance.rows}` : ""} />
            </dl>
            <Accordion
              title="Window / Level"
              icon={ContrastMark}
              open={open.window}
              onToggle={() => toggle("window")}
              extra={<span className="grid h-6 w-6 place-items-center rounded text-zinc-400 hover:bg-white/10" title="Reset window" onClick={(event) => { event.stopPropagation(); onResetWindow(); }}><RefreshCw className="h-3.5 w-3.5" /></span>}
            >
              <div className="mb-2 grid grid-cols-4 gap-1">
                {PRESETS.map(([id, label]) => {
                  const preset = CT_WINDOW_PRESETS.find((item) => item.id === id);
                  const selected = Boolean(preset && near(snapshot, preset));
                  return (
                    <button key={id} type="button" data-active={selected ? "true" : "false"} className="h-7 rounded-full border border-[#2a2a31] text-[11px] text-zinc-300 hover:bg-white/5 data-[active=true]:border-[#7c3aed] data-[active=true]:bg-[#7c3aed] data-[active=true]:text-white" onClick={() => onPreset(preset)}>{label}</button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="W" value={width} onChange={setWidth} onCommit={commitWindow} />
                <NumberField label="L" value={level} onChange={setLevel} onCommit={commitWindow} />
              </div>
            </Accordion>
            <Accordion title="Measurements" icon={Ruler} open={open.measurements} onToggle={() => toggle("measurements")}>
              {measurements.length === 0 && <p className="text-[12px] text-zinc-400">No measurements on this series yet.</p>}
              {measurements.map((item) => <p key={item.id} className="mb-1 text-[12px] text-zinc-200">{item.tool}: {item.text}</p>)}
            </Accordion>
            <Accordion title="Annotations" open={open.annotations} onToggle={() => toggle("annotations")}>
              {annotations.length === 0 && <p className="text-[12px] text-zinc-400">No annotations on this series yet.</p>}
              {annotations.map((item) => <p key={item.id} className="mb-1 text-[12px] text-zinc-200">{item.tool}: {item.text}</p>)}
            </Accordion>
            <Accordion title="Series Display" icon={Layers} open={open.series} onToggle={() => toggle("series")}>
              <label className="mb-2 flex items-center justify-between text-[12px] text-zinc-300">
                Interpolation
                <button type="button" className="h-7 rounded-md border border-[#2a2a31] px-2" onClick={onSmooth}>{smooth ? "Linear" : "Nearest"}</button>
              </label>
              {seriesList.map((item) => (
                <button key={item._id} type="button" data-active={item._id === seriesId ? "true" : "false"} className="mb-1 flex w-full items-center justify-between rounded-md border border-[#2a2a31] px-2 py-1.5 text-left text-[12px] hover:bg-white/5 data-[active=true]:border-[#7c3aed]" onClick={() => onSeries(item._id)}>
                  <span className="truncate">{item.description || "Series"} · {item.modality}</span>
                  <span className="shrink-0 text-zinc-400">{item.imageCount}</span>
                </button>
              ))}
              {series && !series.volume?.ready && <p className="mt-1 text-[11px] text-zinc-500">{series.volume?.reason}</p>}
            </Accordion>
            <Accordion title="DICOM Tags" icon={Tag} open={open.tags} onToggle={() => toggle("tags")}>
              {open.tags ? <DicomTags instanceId={instance?._id} /> : null}
            </Accordion>
          </>
        )}
        {tab === "tools" && (
          <div className="space-y-3 p-3 text-[12px]">
            <div className="grid grid-cols-2 gap-1">
              <Mini label="Flip horizontal" onClick={() => onTool("flip-h")} />
              <Mini label="Flip vertical" onClick={() => onTool("flip-v")} />
              <Mini label="Rotate 90°" onClick={() => onTool("rotate-view")} />
              <Mini label="Invert" onClick={() => onTool("invert")} />
              <Mini label="Reset view" onClick={() => onTool("reset")} />
              <Mini label="Actual size" onClick={() => onTool("actual")} />
              <Mini label="Zoom tool" active={tool === "zoom"} onClick={() => onTool("zoom")} />
              <Mini label="Probe" active={tool === "probe"} onClick={() => onTool("probe")} />
              <Mini label="Cobb angle" active={tool === "cobb"} onClick={() => onTool("cobb")} />
              <Mini label="Bidirectional" active={tool === "bidirectional"} onClick={() => onTool("bidirectional")} />
            </div>
            <div className="grid grid-cols-3 gap-1">
              <Mini label="MPR" active={mode === "mpr"} onClick={() => onMode("mpr")} />
              <Mini label="3D" active={mode === "volume"} onClick={() => onMode("volume")} />
              <Mini label="MIP" active={mode === "projection"} onClick={() => onMode("projection")} />
            </div>
            {(mode === "mpr" || mode === "projection") && (
              <div className="space-y-2 rounded-lg border border-[#2a2a31] p-2">
                <label className="flex items-center justify-between gap-2">Slab
                  <input aria-label="Slab thickness" type="range" min="0" max="40" step="0.5" value={slab} onChange={(event) => onSlab(Number(event.target.value))} />
                </label>
                <select aria-label="Projection" value={blend} className="h-8 w-full rounded-md border border-[#2a2a31] bg-[#1c1c21] px-2" onChange={(event) => onBlend(event.target.value)}>
                  <option value="composite">Thin</option>
                  <option value="mip">MIP</option>
                  <option value="minip">MinIP</option>
                  <option value="average">Average</option>
                </select>
                <div className="grid grid-cols-3 gap-1">
                  <Mini label="Axial" onClick={() => onOrientation("AXIAL")} />
                  <Mini label="Coronal" onClick={() => onOrientation("CORONAL")} />
                  <Mini label="Sagittal" onClick={() => onOrientation("SAGITTAL")} />
                </div>
              </div>
            )}
            {mode === "volume" && (
              <div className="space-y-2 rounded-lg border border-[#2a2a31] p-2">
                <select aria-label="3D preset" value={volumePresetId} className="h-8 w-full rounded-md border border-[#2a2a31] bg-[#1c1c21] px-2" onChange={(event) => onVolumePreset(event.target.value)}>
                  {volumePresets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <label className="flex items-center justify-between gap-2">Opacity <input aria-label="Opacity" type="range" min="0.05" max="2" step="0.05" value={opacity} onChange={(event) => onOpacity(Number(event.target.value))} /></label>
                <label className="flex items-center justify-between gap-2">Brightness <input aria-label="Brightness" type="range" min="-400" max="400" step="10" value={brightness} onChange={(event) => onBrightness(Number(event.target.value))} /></label>
                <select aria-label="Background" value={background} className="h-8 w-full rounded-md border border-[#2a2a31] bg-[#1c1c21] px-2" onChange={(event) => onBackground(event.target.value)}>
                  <option value="black">Black</option>
                  <option value="navy">Navy</option>
                  <option value="slate">Slate</option>
                </select>
                <label className="flex items-center justify-between gap-2">Crop <input aria-label="Volume crop" type="range" min="0" max="0.4" step="0.01" value={crop} onChange={(event) => onCrop(Number(event.target.value))} /></label>
                <div className="grid grid-cols-2 gap-1">
                  <Mini label="Reset camera" onClick={onResetCamera} />
                  <Mini label="Save 3D preset" onClick={onSaveVolume} />
                </div>
              </div>
            )}
          </div>
        )}
        {tab === "ai" && (
          <div className="gms2-ai-host p-3">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Sparkles className="h-3.5 w-3.5" /> AI Assist</div>
            {studyId ? (
              <AiPanel
                studyId={studyId}
                instances={series?.instances || []}
                instanceId={instance?._id}
                frame={frame}
                onInstance={onInstance}
                onOpenReport={onOpenReport}
                onChange={onAiChange}
              />
            ) : <p className="text-[12px] text-zinc-400">Open a study to review AI findings.</p>}
          </div>
        )}
      </div>
    </aside>
  );
}

function PanelTab({ active, label, onClick }) {
  return (
    <button type="button" data-active={active ? "true" : "false"} className="h-8 rounded-lg px-2.5 text-[12px] text-zinc-400 hover:bg-white/5 data-[active=true]:bg-[#3b2a5c] data-[active=true]:text-white" onClick={onClick}>{label}</button>
  );
}

function Row({ label, value }) {
  return (
    <>
      <dt className="text-zinc-400">{label}</dt>
      <dd className="truncate text-zinc-100" title={value || ""}>{value || "—"}</dd>
    </>
  );
}

function NumberField({ label, value, onChange, onCommit }) {
  return (
    <label className="flex h-8 items-center gap-2 rounded-md border border-[#2a2a31] bg-[#1c1c21] px-2">
      <span className="text-[12px] text-zinc-400">{label}</span>
      <input aria-label={label === "W" ? "Window width" : "Window level"} value={value} className="w-full bg-transparent text-[13px] outline-none" onChange={(event) => onChange(event.target.value)} onBlur={onCommit} onKeyDown={(event) => { if (event.key === "Enter") onCommit(); }} />
      <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
    </label>
  );
}

function Mini({ label, onClick, active = false }) {
  return (
    <button type="button" data-active={active ? "true" : "false"} className="h-8 rounded-md border border-[#2a2a31] px-2 text-[12px] text-zinc-200 hover:bg-white/5 data-[active=true]:border-[#7c3aed] data-[active=true]:bg-[#3b2a5c]" onClick={onClick}>{label}</button>
  );
}

function ContrastMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function DicomTags({ instanceId }) {
  const [tags, setTags] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!instanceId) return undefined;
    let cancel = false;
    setTags(null);
    api(`/api/instances/${instanceId}/tags`).then((data) => {
      if (!cancel) setTags(data.tags || []);
    }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [instanceId]);
  if (!instanceId) return <p className="text-[12px] text-zinc-400">No image is open.</p>;
  if (error) return <p className="text-[12px] text-amber-200">{error}</p>;
  if (!tags) return <p className="text-[12px] text-zinc-400">Reading DICOM tags…</p>;
  return (
    <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-y-1 text-[11px]">
      {tags.slice(0, 40).map((item) => (
        <span key={item.tag} className="contents">
          <dt className="text-zinc-500">{item.tag}</dt>
          <dd className="truncate text-zinc-200" title={`${item.name}: ${item.value}`}>{item.name}: {item.value}</dd>
        </span>
      ))}
    </dl>
  );
}

function near(snapshot, preset) {
  return Number.isFinite(snapshot.windowWidth)
    && Math.abs(snapshot.windowWidth - preset.width) < 2
    && Math.abs(snapshot.windowCenter - preset.center) < 2;
}
