export default function SeriesRail({ series = [], seriesId = "", onSeries }) {
  if (!series.length) return null;
  return (
    <div className="flex w-[84px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-[#2a2a31] bg-black px-1.5 py-2" aria-label="Series">
      {series.map((item) => {
        const instance = (item.instances || []).find((row) => row.fileAvailable !== false || row.hasArchiveCopy) || item.instances?.[0];
        const src = instance?._id ? `/api/instances/${instance._id}/orthanc-preview` : "";
        const count = item.imageCount || item.instances?.length || 0;
        const active = item._id === seriesId;
        return (
          <button
            key={item._id}
            type="button"
            data-active={active ? "true" : "false"}
            title={`Series ${item.seriesNumber || ""} ${item.description || ""} · ${count} images`}
            className="rounded-lg p-1 text-left ring-1 ring-transparent hover:bg-white/5 data-[active=true]:bg-violet-500/15 data-[active=true]:ring-violet-400/70"
            onClick={() => onSeries?.(item._id)}
          >
            <span className="grid h-11 w-full place-items-center overflow-hidden rounded-md bg-[#0b0b0f]">
              {src ? <img alt="" src={src} className="h-full w-full object-cover" /> : null}
            </span>
            <span className="mt-0.5 block truncate text-[10px] font-medium text-zinc-200">
              {item.description || item.modality || "Series"}
            </span>
            <span className="block text-[10px] tabular-nums text-zinc-500">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
