import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Print-layout pagination. The document is one continuous ProseMirror flow drawn over a
// stack of page sheets. Wherever content would cross the bottom margin of a page, a spacer
// widget pushes it to the top of the next page: before a block, at the first overflowing
// line of a paragraph, or before a table row. Positions are measured in "natural"
// coordinates (actual offset minus the spacers above), so each pass is computed from
// scratch and converges after one or two layouts.

export const paginationKey = new PluginKey("pagination");

const TOLERANCE = 1.5;

export const Pagination = Extension.create({
  name: "pagination",
  addOptions() {
    return { onPages: null };
  },
  addStorage() {
    return {
      geometry: null,
      enabled: true,
      pages: 1,
      schedule: () => {},
    };
  },
  addProseMirrorPlugins() {
    const extension = this;
    return [new Plugin({
      key: paginationKey,
      state: {
        init: () => ({ breaks: [], decorations: DecorationSet.empty }),
        apply(tr, value, _old, state) {
          const meta = tr.getMeta(paginationKey);
          if (meta?.breaks) return { breaks: meta.breaks, decorations: buildDecorations(state.doc, meta.breaks) };
          if (!tr.docChanged) return value;
          return {
            breaks: value.breaks.map((item) => ({
              ...item,
              pos: tr.mapping.map(item.pos, -1),
              cells: item.cells?.map((pos) => tr.mapping.map(pos, 1)),
            })),
            decorations: value.decorations.map(tr.mapping, tr.doc),
          };
        },
      },
      props: {
        decorations(state) {
          return paginationKey.getState(state).decorations;
        },
      },
      view: (view) => new PaginationView(view, extension),
    })];
  },
});

function spacer(height, kind) {
  return () => {
    const element = document.createElement("div");
    element.className = kind === "row" ? "pm-page-spacer pm-row-spacer" : "pm-page-spacer";
    element.style.height = `${height}px`;
    element.contentEditable = "false";
    element.setAttribute("aria-hidden", "true");
    return element;
  };
}

function buildDecorations(doc, breaks) {
  const size = doc.content.size;
  const decorations = [];
  for (const item of breaks) {
    const height = Math.max(0, Math.round(item.height * 10) / 10);
    if (item.kind === "row") {
      for (const pos of item.cells || []) {
        if (pos < 0 || pos > size) continue;
        decorations.push(Decoration.widget(pos, spacer(height, "row"), { side: -1, ignoreSelection: true, key: `row-${pos}-${height}` }));
      }
    } else if (item.pos >= 0 && item.pos <= size) {
      decorations.push(Decoration.widget(item.pos, spacer(height, "block"), { side: -1, ignoreSelection: true, key: `pb-${item.pos}-${height}` }));
    }
  }
  return DecorationSet.create(doc, decorations);
}

class PaginationView {
  constructor(view, extension) {
    this.view = view;
    this.extension = extension;
    this.frame = 0;
    this.passes = 0;
    this.lastDoc = view.state.doc;
    extension.storage.schedule = () => this.schedule(true);
    this.onLoad = (event) => {
      if (event.target?.tagName === "IMG") this.schedule(true);
    };
    view.dom.addEventListener("load", this.onLoad, true);
    this.resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.schedule(false));
    this.resize?.observe(view.dom);
    document.fonts?.ready?.then(() => this.schedule(true));
    this.schedule(true);
  }

  update(view, previous) {
    if (view.state.doc !== previous.doc) {
      this.passes = 0;
      this.schedule(false);
    } else if (paginationKey.getState(view.state) !== paginationKey.getState(previous)) {
      this.schedule(false);
    }
  }

  schedule(reset) {
    if (reset) this.passes = 0;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.measure());
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.view.dom.removeEventListener("load", this.onLoad, true);
    this.resize?.disconnect();
    this.extension.storage.schedule = () => {};
  }

  report(pages) {
    if (this.extension.storage.pages === pages) return;
    this.extension.storage.pages = pages;
    this.extension.options.onPages?.(pages);
  }

  measure() {
    const { view } = this;
    if (view.isDestroyed || !view.dom.isConnected) return;
    const storage = this.extension.storage;
    const current = paginationKey.getState(view.state).breaks;
    const geometry = storage.geometry;
    if (!geometry || !storage.enabled) {
      if (current.length) view.dispatch(view.state.tr.setMeta(paginationKey, { breaks: [] }).setMeta("addToHistory", false));
      this.report(1);
      return;
    }
    const result = computeBreaks(view, geometry);
    this.report(result.pages);
    if (sameBreaks(current, result.breaks)) return;
    if (this.passes > 4) return;
    this.passes += 1;
    view.dispatch(view.state.tr.setMeta(paginationKey, { breaks: result.breaks }).setMeta("addToHistory", false));
  }
}

function sameBreaks(a, b) {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    if (item.kind !== other.kind || item.pos !== other.pos) return false;
    if (Math.abs(item.height - other.height) > TOLERANCE) return false;
    return (item.cells || []).join() === (other.cells || []).join();
  });
}

function collectUnits(view) {
  const units = [];
  view.state.doc.descendants((node, pos) => {
    const name = node.type.name;
    if (name === "table") {
      node.forEach((row, offset) => {
        const rowPos = pos + 1 + offset;
        const cells = [];
        row.forEach((_cell, cellOffset) => cells.push(rowPos + 1 + cellOffset + 1));
        units.push({ kind: "row", pos: rowPos, cells, dom: view.nodeDOM(rowPos) });
      });
      return false;
    }
    if (name === "pageBreak") {
      units.push({ kind: "pagebreak", pos, end: pos + node.nodeSize, dom: view.nodeDOM(pos) });
      return false;
    }
    if (name === "columns" || name === "image" || name === "horizontalRule") {
      units.push({ kind: "atom", pos, dom: view.nodeDOM(pos) });
      return false;
    }
    if (node.isTextblock) {
      units.push({ kind: "text", pos, node, heading: name === "heading", dom: view.nodeDOM(pos) });
      return false;
    }
    return true;
  });
  return units.filter((unit) => unit.dom && unit.dom.nodeType === 1);
}

export function computeBreaks(view, geometry) {
  const root = view.dom;
  const rootRect = root.getBoundingClientRect();
  const scale = rootRect.width / (root.offsetWidth || 1) || 1;
  const originTop = rootRect.top + geometry.paddingTop * scale;
  const local = (clientY) => (clientY - originTop) / scale;

  const intervals = [];
  root.querySelectorAll(".pm-page-spacer").forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) return;
    intervals.push({ top: local(rect.top), bottom: local(rect.bottom) });
  });
  intervals.sort((a, b) => a.top - b.top);
  const merged = [];
  for (const item of intervals) {
    const last = merged[merged.length - 1];
    if (last && item.top < last.bottom - 0.5) last.bottom = Math.max(last.bottom, item.bottom);
    else merged.push({ ...item });
  }
  const natural = (y) => {
    let value = y;
    for (const item of merged) {
      if (item.bottom <= y + 0.5) value -= item.bottom - item.top;
      else if (item.top < y) value -= y - item.top;
      else break;
    }
    return value;
  };

  const { contentHeight: H, pitch } = geometry;
  const breaks = [];
  let offset = 0;
  let page = 0;
  let previous = null;
  const units = collectUnits(view);

  const breakBefore = (unit, height) => {
    if (unit.kind === "row") breaks.push({ kind: "row", pos: unit.pos, cells: unit.cells, height });
    else breaks.push({ kind: "block", pos: unit.pos, height });
  };

  for (const unit of units) {
    const rect = unit.dom.getBoundingClientRect();
    const top = natural(local(rect.top));
    const bottom = natural(local(rect.bottom));

    if (unit.kind === "pagebreak") {
      const at = bottom + offset;
      const height = (page + 1) * pitch - at;
      if (height > 0) {
        breaks.push({ kind: "block", pos: unit.end, height });
        offset += height;
      }
      page += 1;
      previous = null;
      continue;
    }

    let lines = null;
    let guard = 0;
    while (bottom + offset > page * pitch + H + TOLERANCE && guard < 60) {
      guard += 1;
      const pageTop = page * pitch;
      const pageEnd = pageTop + H;
      const actualTop = top + offset;
      const atPageTop = actualTop <= pageTop + TOLERANCE;

      // Keep a heading with the block that follows it.
      const keepWithHeading = () => {
        if (!previous?.unit.heading || previous.page !== page || previous.top + offset <= pageTop + TOLERANCE) return false;
        const height = (page + 1) * pitch - (previous.top + offset);
        breakBefore(previous.unit, height);
        offset += height;
        page += 1;
        return true;
      };

      if (actualTop >= pageEnd - TOLERANCE) {
        if (keepWithHeading()) continue;
        const height = (page + 1) * pitch - actualTop;
        if (height <= 0) {
          page = Math.floor(actualTop / pitch);
          continue;
        }
        breakBefore(unit, height);
        offset += height;
        page += 1;
        continue;
      }

      if (unit.kind === "text") {
        lines = lines || lineBoxes(view, unit, local, natural);
        let index = lines.findIndex((line) => line.bottom + offset > pageEnd + TOLERANCE);
        // Orphan and widow control for paragraphs of three or more lines.
        if (index === 1 && lines.length >= 3 && !atPageTop) index = 0;
        if (index > 1 && index === lines.length - 1 && lines.length >= 3) index -= 1;
        if (index <= 0) {
          if (atPageTop) {
            page = Math.max(page + 1, Math.floor((bottom + offset) / pitch));
            break;
          }
          if (keepWithHeading()) continue;
          const height = (page + 1) * pitch - actualTop;
          breakBefore(unit, height);
          offset += height;
          page += 1;
          continue;
        }
        const line = lines[index];
        const height = (page + 1) * pitch - (line.top + offset);
        breaks.push({ kind: "block", pos: line.pos, height });
        offset += height;
        page += 1;
        continue;
      }

      if (atPageTop) {
        page = Math.max(page, Math.floor((bottom + offset - TOLERANCE) / pitch));
        break;
      }
      if (keepWithHeading()) continue;
      const height = (page + 1) * pitch - actualTop;
      breakBefore(unit, height);
      offset += height;
      page += 1;
    }
    previous = { unit, top, page };
  }

  return { breaks: breaks.sort((a, b) => a.pos - b.pos), pages: page + 1 };
}

// Line boxes of a textblock in natural coordinates, each with the document position of
// its first character.
function lineBoxes(view, unit, local, natural) {
  const rects = [];
  const walker = document.createTreeWalker(unit.dom, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue) continue;
    if (node.parentElement?.closest(".pm-page-spacer, .pm-pilcrow")) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 && rect.height <= 0) continue;
      rects.push(rect);
    }
  }
  unit.dom.querySelectorAll("img").forEach((image) => rects.push(image.getBoundingClientRect()));
  rects.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines = [];
  for (const rect of rects) {
    const last = lines[lines.length - 1];
    if (last && rect.top < last.clientBottom - 2) {
      last.clientBottom = Math.max(last.clientBottom, rect.bottom);
      if (rect.left < last.left) last.left = rect.left;
      continue;
    }
    lines.push({ clientTop: rect.top, clientBottom: rect.bottom, left: rect.left });
  }
  const start = unit.pos + 1;
  const end = unit.pos + unit.node.nodeSize - 1;
  return lines.map((line, index) => {
    let pos = start;
    if (index > 0) {
      const found = view.posAtCoords({ left: line.left + 1, top: (line.clientTop + line.clientBottom) / 2 });
      pos = found ? Math.min(end, Math.max(start, found.pos)) : start;
    }
    return { pos, top: natural(local(line.clientTop)), bottom: natural(local(line.clientBottom)) };
  }).filter((line, index, list) => index === 0 || line.pos > list[index - 1].pos);
}
