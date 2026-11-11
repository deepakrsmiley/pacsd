import { Box, ChevronLeft, ChevronRight, Crosshair, LayoutGrid, Monitor, Pause, Play } from "lucide-react";

const LAYOUTS = [
  ["1", "1×1"],
  ["1x2", "1×2"],
  ["2x1", "2×1"],
  ["2x2", "2×2"],
];

export default function ViewerBottomToolbar({
  playing,
  onPlay,
  slice,
  count,
  onSlice,
  fps,
  onFps,
  onCine,
  sync,
  onSync,
  overlayOn,
  onOverlay,
  crosshair,
  onCrosshair,
  onMpr,
  mprOn,
  onVolume,
  volumeOn,
  layout,
  onLayout,
  onFullscreen,
  layoutEnabled,
}) {
  const max = Math.max(0, count - 1);
  return (
    <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-white/[0.06] bg-[#111115]/90 px-4 text-[12px] font-medium text-zinc-200 backdrop-blur-xl">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/[0.06] text-zinc-400" title="Layout">
        <LayoutGrid className="h-3.5 w-3.5" />
      </span>
      <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-[#7c3aed] text-white shadow-lg shadow-violet-900/40 transition hover:bg-[#8b5cf6] active:scale-95" aria-label={playing ? "Pause" : "Play"} onClick={onPlay}>
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <span className="w-14 shrink-0 tabular-nums">{count ? `${slice + 1} / ${count}` : "— / —"}</span>
      <button type="button" className="grid h-7 w-7 place-items-center rounded-md hover:bg-white/10 disabled:opacity-30" aria-label="Previous slice" disabled={!count} onClick={() => onSlice(Math.max(0, slice - 1))}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <input aria-label="Slice" className="h-1 min-w-[80px] flex-1 accent-[#7c3aed]" type="range" min="0" max={max} value={Math.min(slice, max)} disabled={!count} onChange={(event) => onSlice(Number(event.target.value))} />
      <button type="button" className="grid h-7 w-7 place-items-center rounded-md hover:bg-white/10 disabled:opacity-30" aria-label="Next slice" disabled={!count} onClick={() => onSlice(Math.min(max, slice + 1))}>
        <ChevronRight className="h-4 w-4" />
      </button>
      <label className="flex items-center gap-1 text-zinc-300">
        FPS
        <select aria-label="Cine speed" value={fps} className="h-7 rounded-lg bg-white/[0.06] outline-none px-1.5" onChange={(event) => onFps(Number(event.target.value))}>
          {[6, 8, 12, 15, 24, 30].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button type="button" data-active={playing ? "true" : "false"} className="h-8 rounded-full bg-white/[0.06] transition hover:bg-white/[0.1] active:scale-95 px-3 hover:bg-white/5 data-[active=true]:bg-violet-500/25 data-[active=true]:text-violet-200" onClick={onCine}>Cine</button>
      <button type="button" data-active={sync ? "true" : "false"} className="h-8 rounded-full bg-white/[0.06] transition hover:bg-white/[0.1] active:scale-95 px-3 data-[active=true]:bg-[#7c3aed] data-[active=true]:text-white" onClick={onSync}>Sync</button>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" className="accent-[#7c3aed]" checked={overlayOn} onChange={(event) => onOverlay(event.target.checked)} />
        Overlay
      </label>
      <button type="button" data-active={crosshair ? "true" : "false"} className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] transition hover:bg-white/[0.1] active:scale-95 px-2.5 data-[active=true]:bg-violet-500/25 data-[active=true]:text-violet-200" onClick={onCrosshair}>
        <Crosshair className="h-3.5 w-3.5" /> Crosshair
      </button>
      <button type="button" data-active={mprOn ? "true" : "false"} className="h-8 rounded-full bg-white/[0.06] transition hover:bg-white/[0.1] active:scale-95 px-3 data-[active=true]:bg-violet-500/25 data-[active=true]:text-violet-200" onClick={onMpr}>MPR</button>
      <button type="button" data-active={volumeOn ? "true" : "false"} className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] transition hover:bg-white/[0.1] active:scale-95 px-3 data-[active=true]:bg-violet-500/25 data-[active=true]:text-violet-200" onClick={onVolume}>
        <Box className="h-3.5 w-3.5" /> 3D
      </button>
      <div className="ml-auto flex items-center gap-1">
        <select aria-label="Layout" value={layout} disabled={!layoutEnabled} className="h-7 rounded-lg bg-white/[0.06] outline-none px-2" onChange={(event) => onLayout(event.target.value)}>
          {LAYOUTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <button type="button" className="grid h-8 w-8 place-items-center rounded-xl bg-white/[0.06] transition hover:bg-white/[0.12]" aria-label="Fullscreen" onClick={onFullscreen}>
          <Monitor className="h-3.5 w-3.5" />
        </button>
      </div>
    </footer>
  );
}
