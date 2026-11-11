import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { TEXT_STYLES, pageDimensions } from "../../../shared/reportDocument.js";
import { PX_PER_PT, mmToPx } from "./units.js";

export function pageGeometry(layout) {
  const dims = pageDimensions(layout);
  const width = mmToPx(dims.width);
  const height = mmToPx(dims.height);
  const margins = {
    top: mmToPx(layout.margins.top),
    right: mmToPx(layout.margins.right),
    bottom: mmToPx(layout.margins.bottom),
    left: mmToPx(layout.margins.left),
  };
  const gap = Number(layout.pageGap ?? 24);
  return {
    width,
    height,
    margins,
    gap,
    pitch: height + gap,
    contentWidth: width - margins.left - margins.right,
    contentHeight: height - margins.top - margins.bottom,
  };
}

function HeaderFooterCell({ value, align, boldFirst }) {
  const lines = String(value || "").split("\n");
  return (
    <div className="we-hf-cell" style={{ textAlign: align }}>
      {lines.map((line, index) => (
        <div key={index} className={boldFirst && index === 0 && lines.length > 1 ? "we-hf-strong" : ""}>{line || "\u00a0"}</div>
      ))}
    </div>
  );
}

function BorderBox({ border }) {
  const style = border?.style || "none";
  if (style === "none") return null;
  const color = border.color || "#1f3a5f";
  if (style === "double") {
    return (
      <>
        <div className="we-sheet-border" style={{ border: `1px solid ${color}` }} />
        <div className="we-sheet-border" style={{ inset: 36, border: `1px solid ${color}` }} />
      </>
    );
  }
  return <div className="we-sheet-border" style={{ border: `${style === "thick" ? 3 : 1}px solid ${color}` }} />;
}

function PageChrome({ index, pages, g, layout, fill, onEditHeader, onEditFooter }) {
  const top = index * g.pitch;
  const headerTop = mmToPx(layout.headerDistance);
  const lineTop = Math.max(headerTop + 8 * PX_PER_PT, g.margins.top - 6 * PX_PER_PT);
  const header = layout.header || {};
  const footer = layout.footer || {};
  const page = index + 1;
  const showHeader = header.showLogo || header.left || header.center || header.right;
  return (
    <div className="pointer-events-none absolute left-0 z-[3]" style={{ top, width: g.width, height: g.height }}>
      <div className="we-margin" style={{ top: 0, height: g.margins.top }} />
      <div className="we-margin" style={{ top: g.height - g.margins.bottom, height: g.margins.bottom }} />
      <BorderBox border={layout.border} />
      {showHeader && (
        <>
          <div className="we-hf" style={{ top: headerTop, left: g.margins.left, right: g.margins.right }} onDoubleClick={onEditHeader} title="Double-click to edit the header">
            {header.showLogo && <img src="/gms-logo.png" alt="" style={{ height: `${TEXT_STYLES.logoHeightMm}mm`, maxWidth: "45mm", objectFit: "contain", flex: "0 0 auto" }} />}
            <HeaderFooterCell value={fill(header.left, page, pages)} align="left" boldFirst />
            <HeaderFooterCell value={fill(header.center, page, pages)} align="center" boldFirst />
            <HeaderFooterCell value={fill(header.right, page, pages)} align="right" boldFirst />
          </div>
          <div className="we-hf-line" style={{ top: lineTop, left: g.margins.left, right: g.margins.right }} />
        </>
      )}
      <div className="we-hf flex-col !gap-0" style={{ bottom: mmToPx(layout.footerDistance), left: g.margins.left, right: g.margins.right }} onDoubleClick={onEditFooter} title="Double-click to edit the footer">
        <div className="mb-[3pt] w-full border-t-[0.6pt] border-[#cbd5e1]" />
        <div className="flex w-full gap-[10pt]">
          <HeaderFooterCell value={fill(footer.left, page, pages)} align="left" />
          <HeaderFooterCell value={fill(footer.center, page, pages)} align="center" />
          <HeaderFooterCell value={fill(footer.right, page, pages)} align="right" />
        </div>
        {footer.note && <div className="we-hf-note w-full">{footer.note}</div>}
      </div>
    </div>
  );
}

export const PageStack = forwardRef(function PageStack({ editor, layout, pages, fill, onEditHeader, onEditFooter, web }, ref) {
  const g = pageGeometry(layout);
  if (web) {
    return (
      <div ref={ref} className="we-stack we-web-layout mx-auto" style={{ width: "100%", maxWidth: 1100 }}>
        <EditorContent editor={editor} className="we-content" />
      </div>
    );
  }
  const totalHeight = pages * g.pitch - g.gap;
  return (
    <div ref={ref} className="we-stack" style={{ width: g.width, height: totalHeight }}>
      {Array.from({ length: pages }, (_, index) => (
        <div key={`sheet-${index}`} className="we-sheet" style={{ top: index * g.pitch, width: g.width, height: g.height }} />
      ))}
      <EditorContent editor={editor} className="we-content" />
      {Array.from({ length: pages }, (_, index) => (
        <PageChrome key={`chrome-${index}`} index={index} pages={pages} g={g} layout={layout} fill={fill} onEditHeader={onEditHeader} onEditFooter={onEditFooter} />
      ))}
      {g.gap > 0 && Array.from({ length: pages - 1 }, (_, index) => (
        <div key={`gap-${index}`} className="we-gap" style={{ top: index * g.pitch + g.height, height: g.gap }} />
      ))}
    </div>
  );
});

// ---------- ruler ----------

const CM = mmToPx(10);

export function Ruler({ layout, zoom, editor, readOnly, onMargins }) {
  const g = pageGeometry(layout);
  const [drag, setDrag] = useState(null);
  const parent = editor?.state.selection.$from.parent;
  const attrs = parent?.isTextblock ? parent.attrs : {};
  const indent = (Number(attrs.indent) || 0) * PX_PER_PT;
  const first = (Number(attrs.firstLineIndent) || 0) * PX_PER_PT;
  const right = (Number(attrs.indentRight) || 0) * PX_PER_PT;
  const values = drag ? drag.values : { indent, first, right, left: g.margins.left, rightMargin: g.margins.right };

  const begin = (kind) => (event) => {
    if (readOnly) return;
    event.preventDefault();
    const startX = event.clientX;
    const start = { indent, first, right, left: g.margins.left, rightMargin: g.margins.right };
    let latest = start;
    const snap = (value) => (event.altKey ? value : Math.round(value / (CM / 4)) * (CM / 4));
    const move = (moveEvent) => {
      const dx = (moveEvent.clientX - startX) / zoom;
      const next = { ...start };
      if (kind === "left") {
        next.indent = Math.max(0, Math.min(g.contentWidth - 40, snap(start.indent + dx)));
      } else if (kind === "first") {
        next.first = Math.max(0, Math.min(g.contentWidth - start.indent - 40, snap(start.first + dx)));
      } else if (kind === "right") {
        next.right = Math.max(0, Math.min(g.contentWidth - start.indent - 40, snap(start.right - dx)));
      } else if (kind === "marginLeft") {
        next.left = Math.max(mmToPx(5), Math.min(g.width / 2 - 20, snap(start.left + dx)));
      } else if (kind === "marginRight") {
        next.rightMargin = Math.max(mmToPx(5), Math.min(g.width / 2 - 20, snap(start.rightMargin - dx)));
      }
      latest = next;
      setDrag({ kind, values: next });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDrag(null);
      if (kind === "marginLeft" || kind === "marginRight") {
        onMargins({ left: Math.round((latest.left / mmToPx(1)) * 10) / 10, right: Math.round((latest.rightMargin / mmToPx(1)) * 10) / 10 });
        return;
      }
      const toPt = (px) => Math.round((px / PX_PER_PT) * 10) / 10 || null;
      editor.chain().focus().setParagraphFormat({ indent: toPt(latest.indent), firstLineIndent: toPt(latest.first), indentRight: toPt(latest.right) }).run();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const ticks = [];
  for (let x = values.left % (CM / 4); x <= g.width; x += CM / 4) {
    const fromOrigin = Math.round((x - values.left) / (CM / 4));
    const major = fromOrigin % 4 === 0;
    const half = fromOrigin % 2 === 0;
    if (!major) ticks.push(<span key={x} className="absolute bg-[#94a3b8]" style={{ left: x, width: 1, top: half ? 7 : 9, height: half ? 6 : 2 }} />);
    if (major && fromOrigin !== 0) {
      ticks.push(<span key={`label-${x}`} className="absolute -translate-x-1/2 text-[9px]" style={{ left: x, top: 5 }}>{Math.abs(fromOrigin / 4)}</span>);
    }
  }

  return (
    <div className="we-ruler shrink-0" style={{ width: g.width * zoom }} aria-label="Ruler">
      <div className="absolute left-0 top-0 h-full origin-top-left" style={{ width: g.width, transform: `scale(${zoom}, 1)` }}>
        <div className="we-ruler-margin" style={{ left: 0, width: values.left }} />
        <div className="we-ruler-margin" style={{ right: 0, width: values.rightMargin }} />
        {ticks}
        <span className="absolute top-0 h-full w-[6px] -translate-x-1/2 cursor-col-resize" style={{ left: values.left }} onMouseDown={begin("marginLeft")} title="Left margin" />
        <span className="absolute top-0 h-full w-[6px] translate-x-1/2 cursor-col-resize" style={{ right: values.rightMargin }} onMouseDown={begin("marginRight")} title="Right margin" />
      </div>
      <span className="we-ruler-marker top" style={{ left: (values.left + values.indent + values.first) * zoom }} onMouseDown={begin("first")} title="First line indent" />
      <span className="we-ruler-marker bottom" style={{ left: (values.left + values.indent) * zoom }} onMouseDown={begin("left")} title="Left indent" />
      <span className="we-ruler-marker bottom" style={{ left: (g.width - values.rightMargin - values.right) * zoom }} onMouseDown={begin("right")} title="Right indent" />
    </div>
  );
}

// ---------- multiple pages ----------

export function PageThumbnails({ stackRef, pages, layout, scale, version, onOpen }) {
  const g = pageGeometry(layout);
  const holders = useRef([]);
  useLayoutEffect(() => {
    const source = stackRef.current;
    if (!source) return;
    holders.current.forEach((holder, index) => {
      if (!holder) return;
      const clone = source.cloneNode(true);
      clone.querySelectorAll("[contenteditable]").forEach((element) => element.setAttribute("contenteditable", "false"));
      clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      clone.style.transform = `translateY(${-index * g.pitch}px)`;
      clone.style.position = "absolute";
      clone.style.left = "0";
      clone.style.top = "0";
      holder.replaceChildren(clone);
    });
  }, [pages, version, layout, scale]);
  return (
    <div className="flex flex-wrap content-start justify-center gap-6 p-6">
      {Array.from({ length: pages }, (_, index) => (
        <div key={index} className="flex flex-col items-center gap-1.5">
          <button type="button" className="we-thumb" style={{ width: g.width * scale, height: g.height * scale }} onClick={() => onOpen(index)} aria-label={`Open page ${index + 1}`}>
            <div className="we-thumb-inner" style={{ width: g.width, height: g.height, transform: `scale(${scale})`, overflow: "hidden" }} inert="">
              <div ref={(element) => { holders.current[index] = element; }} style={{ position: "relative", width: g.width, height: g.height, overflow: "hidden" }} />
            </div>
          </button>
          <span className="text-[11px] text-[#64748b]">Page {index + 1}</span>
        </div>
      ))}
    </div>
  );
}

export function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
