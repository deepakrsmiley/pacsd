import {
  Box,
  Circle,
  Contrast,
  Fullscreen,
  Hand,
  LayoutGrid,
  Link2,
  MousePointer2,
  MoveUpRight,
  Ruler,
  Spline,
  Square,
  Triangle,
  Type,
  ZoomIn,
  ZoomOut,
  Maximize,
} from "lucide-react";
import { ToolButton } from "./ToolButton.jsx";

export default function ViewerToolbar({
  series,
  seriesId,
  onSeries,
  tool,
  onTool,
  onZoomIn,
  onZoomOut,
  onFit,
  onOverlay,
  overlayOn,
  onSync,
  sync,
  onVolume,
  volumeOn,
  onLayout,
  onFullscreen,
  disabled,
}) {
  return (
    <div className="gms2-toolbar flex h-[52px] shrink-0 items-center gap-0.5 overflow-x-auto border-b border-white/[0.06] bg-[#111115]/90 px-2.5 backdrop-blur-xl">
      <select aria-label="Series" value={seriesId || ""} disabled={!series.length} className="mr-2 h-9 max-w-[180px] rounded-xl bg-white/[0.06] px-3 text-[13px] font-medium text-zinc-100 outline-none transition hover:bg-white/[0.1] disabled:opacity-50" onChange={(event) => onSeries(event.target.value)}>
        {series.length === 0 && <option value="">Series</option>}
        {series.map((item, index) => (
          <option key={item._id} value={item._id}>{item.description || `Series ${item.seriesNumber || index + 1}`}</option>
        ))}
      </select>
      <ToolButton label="Select" active={tool === "scroll"} disabled={disabled} onClick={() => onTool("scroll")}><MousePointer2 className="h-4 w-4" /></ToolButton>
      <ToolButton label="Pan" active={tool === "pan"} disabled={disabled} onClick={() => onTool("pan")}><Hand className="h-4 w-4" /></ToolButton>
      <ToolButton label="Zoom in" disabled={disabled} onClick={onZoomIn}><ZoomIn className="h-4 w-4" /></ToolButton>
      <ToolButton label="Zoom out" disabled={disabled} onClick={onZoomOut}><ZoomOut className="h-4 w-4" /></ToolButton>
      <ToolButton label="Fit to screen" disabled={disabled} onClick={onFit}><Maximize className="h-4 w-4" /></ToolButton>
      <Divider />
      <ToolButton label="Window and level" active={tool === "window"} disabled={disabled} onClick={() => onTool("window")}><Contrast className="h-4 w-4" /></ToolButton>
      <ToolButton label="Length" active={tool === "length"} disabled={disabled} onClick={() => onTool("length")}><Ruler className="h-4 w-4" /></ToolButton>
      <ToolButton label="Angle" active={tool === "angle"} disabled={disabled} onClick={() => onTool("angle")}><Triangle className="h-4 w-4" /></ToolButton>
      <ToolButton label="Text annotation" active={tool === "text"} disabled={disabled} onClick={() => onTool("text")}><Type className="h-4 w-4" /></ToolButton>
      <ToolButton label="Rectangle ROI" active={tool === "rectangle"} disabled={disabled} onClick={() => onTool("rectangle")}><Square className="h-4 w-4" /></ToolButton>
      <ToolButton label="Ellipse ROI" active={tool === "ellipse"} disabled={disabled} onClick={() => onTool("ellipse")}><Circle className="h-4 w-4" /></ToolButton>
      <ToolButton label="Freehand ROI" active={tool === "freehand"} disabled={disabled} onClick={() => onTool("freehand")}><Spline className="h-4 w-4" /></ToolButton>
      <ToolButton label="Arrow annotation" active={tool === "arrow"} disabled={disabled} onClick={() => onTool("arrow")}><MoveUpRight className="h-4 w-4" /></ToolButton>
      <Divider />
      <ToolButton label="Overlay" active={overlayOn} onClick={onOverlay}><LayersIcon /></ToolButton>
      <ToolButton label="Link viewports" active={sync} onClick={onSync}><Link2 className="h-4 w-4" /></ToolButton>
      <div className="ml-auto flex items-center gap-1">
        <ToolButton label="3D volume" active={volumeOn} disabled={disabled} onClick={onVolume}><Box className="h-4 w-4" /></ToolButton>
        <ToolButton label="Change layout" disabled={disabled || volumeOn} onClick={onLayout}><LayoutGrid className="h-4 w-4" /></ToolButton>
        <ToolButton label="Fullscreen viewport" onClick={onFullscreen}><Fullscreen className="h-4 w-4" /></ToolButton>
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-1.5 h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />;
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 17l9 5 9-5" />
    </svg>
  );
}
