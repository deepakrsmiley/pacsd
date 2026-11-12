import { memo, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function ThumbnailStrip({ frames, activeIndex, onPick, ready = true }) {
  const scroller = useRef(null);

  useEffect(() => {
    const node = scroller.current?.querySelector(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [activeIndex]);

  function scrollBy(direction) {
    scroller.current?.scrollBy({ left: direction * 240, behavior: "smooth" });
  }

  return (
    <div className="flex h-[104px] shrink-0 items-center gap-1 border-t border-[#2a2a31] bg-black px-1">
      <button type="button" className="grid h-8 w-7 shrink-0 place-items-center text-zinc-300 hover:text-white disabled:opacity-30" aria-label="Previous thumbnails" disabled={!frames.length} onClick={() => scrollBy(-1)}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div ref={scroller} className="gms2-thumbs flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-2">
        {frames.map((frame) => (
          <SliceThumb key={`${frame.instance?._id}-${frame.frame}`} frame={frame} active={frame.index === activeIndex} onPick={onPick} ready={ready} />
        ))}
        {frames.length === 0 && <p className="self-center text-[12px] text-zinc-500">No images in this series</p>}
      </div>
      <button type="button" className="grid h-8 w-7 shrink-0 place-items-center text-zinc-300 hover:text-white disabled:opacity-30" aria-label="Next thumbnails" disabled={!frames.length} onClick={() => scrollBy(1)}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

const SliceThumb = memo(function SliceThumb({ frame, active, onPick, ready }) {
  const ref = useRef(null);
  const [show, setShow] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = frame.instance?.fileAvailable && frame.instance?.hasArchiveCopy
    ? `/api/instances/${frame.instance._id}/orthanc-preview`
    : "";

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShow(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setShow(true);
      observer.disconnect();
    }, { root: node.parentElement, rootMargin: "80px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <button ref={ref} type="button" data-index={frame.index} className="w-12 shrink-0 text-center" title={`Slice ${frame.label}`} onClick={() => onPick(frame.index)}>
      <span className={`grid h-12 w-12 place-items-center overflow-hidden rounded-md bg-[#0b0b0f] ${active ? "ring-2 ring-[#7c3aed]" : "ring-1 ring-[#2a2a31]"}`}>
        {src && ready && show && !failed ? <img alt="" src={src} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(true)} /> : null}
      </span>
      <span className={`mt-1 block text-[10px] ${active ? "text-[#7c3aed]" : "text-zinc-400"}`}>{frame.label}</span>
    </button>
  );
});
