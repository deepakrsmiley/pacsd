import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { PARAGRAPH_FORMAT_KEYS } from "./schema.js";

// ---------- find and replace ----------

export const searchKey = new PluginKey("search");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findMatches(doc, { query, caseSensitive, wholeWord }) {
  if (!query) return [];
  let pattern;
  try {
    const source = escapeRegExp(query);
    pattern = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}_])${source}(?![\\p{L}\\p{N}_])` : source, caseSensitive ? "gu" : "giu");
  } catch {
    return [];
  }
  const matches = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const offsets = [];
    node.forEach((child, offset) => {
      const value = child.isText ? child.text : "\ufffc".repeat(child.nodeSize);
      for (let index = 0; index < value.length; index += 1) offsets.push(pos + 1 + offset + index);
      text += value;
    });
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (!match[0].length) {
        pattern.lastIndex += 1;
        continue;
      }
      const from = offsets[match.index];
      const to = offsets[match.index + match[0].length - 1] + 1;
      matches.push({ from, to });
    }
    return false;
  });
  return matches;
}

export const Search = Extension.create({
  name: "search",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: searchKey,
      state: {
        init: () => ({ query: "", caseSensitive: false, wholeWord: false, matches: [], index: -1, decorations: DecorationSet.empty }),
        apply(tr, value, _old, state) {
          const meta = tr.getMeta(searchKey);
          if (!meta && !tr.docChanged) return value;
          const next = { ...value, ...(meta || {}) };
          next.matches = findMatches(state.doc, next);
          if (meta?.index === undefined) {
            const head = state.selection.from;
            next.index = next.matches.length ? Math.max(0, next.matches.findIndex((match) => match.from >= head)) : -1;
            if (next.index < 0 && next.matches.length) next.index = 0;
          }
          if (next.index >= next.matches.length) next.index = next.matches.length - 1;
          next.decorations = DecorationSet.create(state.doc, next.matches.map((match, index) => Decoration.inline(match.from, match.to, {
            class: index === next.index ? "pm-search-match pm-search-current" : "pm-search-match",
          })));
          return next;
        },
      },
      props: {
        decorations(state) {
          return searchKey.getState(state).decorations;
        },
      },
    })];
  },
});

export function setSearch(editor, options) {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, options).setMeta("addToHistory", false));
}

export function searchState(editor) {
  return editor ? searchKey.getState(editor.state) : null;
}

export function goToMatch(editor, direction) {
  const search = searchState(editor);
  if (!search?.matches.length) return false;
  const count = search.matches.length;
  const index = search.index < 0 ? 0 : (search.index + direction + count) % count;
  const match = search.matches[index];
  const tr = editor.state.tr
    .setMeta(searchKey, { index })
    .setSelection(TextSelection.create(editor.state.doc, match.from, match.to))
    .setMeta("addToHistory", false);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function replaceCurrent(editor, replacement) {
  const search = searchState(editor);
  const match = search?.matches[search.index];
  if (!match) return false;
  editor.chain().focus().insertContentAt({ from: match.from, to: match.to }, replacement ? { type: "text", text: replacement, marks: marksAt(editor, match.from) } : "").run();
  goToMatch(editor, 0);
  return true;
}

export function replaceAll(editor, replacement) {
  const search = searchState(editor);
  if (!search?.matches.length) return 0;
  const tr = editor.state.tr;
  for (const match of [...search.matches].reverse()) {
    const marks = editor.state.doc.resolve(match.from + 1).marks();
    if (replacement) tr.replaceWith(match.from, match.to, editor.schema.text(replacement, marks));
    else tr.delete(match.from, match.to);
  }
  editor.view.dispatch(tr);
  return search.matches.length;
}

function marksAt(editor, pos) {
  return editor.state.doc.resolve(pos + 1).marks().map((mark) => mark.toJSON());
}

// ---------- formatting marks ----------

export const formattingMarksKey = new PluginKey("formattingMarks");

export const FormattingMarks = Extension.create({
  name: "formattingMarks",
  addStorage() {
    return { visible: false };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [new Plugin({
      key: formattingMarksKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, value, _old, state) {
          const meta = tr.getMeta(formattingMarksKey);
          if (meta === undefined && !tr.docChanged) return value;
          return storage.visible ? markDecorations(state.doc) : DecorationSet.empty;
        },
      },
      props: {
        decorations(state) {
          return formattingMarksKey.getState(state);
        },
      },
    })];
  },
});

function markDecorations(doc) {
  const decorations = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      decorations.push(Decoration.widget(pos + node.nodeSize - 1, () => {
        const element = document.createElement("span");
        element.className = "pm-pilcrow";
        element.textContent = "\u00b6";
        return element;
      }, { side: 1, ignoreSelection: true, key: "pilcrow" }));
      return true;
    }
    if (node.type.name === "hardBreak") {
      decorations.push(Decoration.widget(pos, () => {
        const element = document.createElement("span");
        element.className = "pm-pilcrow";
        element.textContent = "\u21b5";
        return element;
      }, { side: -1, ignoreSelection: true, key: "break" }));
      return false;
    }
    if (node.isText) {
      const text = node.text;
      for (let index = 0; index < text.length; index += 1) {
        if (text[index] === " " || text[index] === "\u00a0") decorations.push(Decoration.inline(pos + index, pos + index + 1, { class: "pm-space" }));
        else if (text[index] === "\t") decorations.push(Decoration.inline(pos + index, pos + index + 1, { class: "pm-tab" }));
      }
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export function setFormattingMarks(editor, visible) {
  editor.storage.formattingMarks.visible = visible;
  editor.view.dispatch(editor.state.tr.setMeta(formattingMarksKey, visible).setMeta("addToHistory", false));
}

// ---------- format painter ----------

const CHARACTER_MARKS = ["bold", "italic", "underline", "strike", "textStyle", "highlight", "superscript", "subscript", "link"];

export const FormatPainter = Extension.create({
  name: "formatPainter",
  addStorage() {
    return { active: false, sticky: false, marks: [], block: null, onChange: null };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    const editor = this.editor;
    return [new Plugin({
      key: new PluginKey("formatPainter"),
      props: {
        handleDOMEvents: {
          mouseup: () => {
            if (!storage.active) return false;
            window.setTimeout(() => {
              if (!storage.active || editor.state.selection.empty) return;
              applyFormat(editor, storage);
              if (!storage.sticky) stopFormatPainter(editor);
            }, 0);
            return false;
          },
        },
        handleKeyDown: (_view, event) => {
          if (storage.active && event.key === "Escape") {
            stopFormatPainter(editor);
            return true;
          }
          return false;
        },
      },
    })];
  },
});

export function copyFormat(editor) {
  const { state } = editor;
  const storage = editor.storage.formatPainter;
  const marks = (state.storedMarks || state.selection.$from.marks()).filter((mark) => CHARACTER_MARKS.includes(mark.type.name) && mark.type.name !== "link");
  const parent = state.selection.$from.parent;
  storage.marks = marks;
  storage.block = parent.isTextblock ? Object.fromEntries(PARAGRAPH_FORMAT_KEYS.map((key) => [key, parent.attrs[key] ?? null])) : null;
  return storage;
}

export function startFormatPainter(editor, sticky = false) {
  const storage = copyFormat(editor);
  storage.active = true;
  storage.sticky = sticky;
  editor.view.dom.classList.add("pm-painting");
  storage.onChange?.(true);
}

export function stopFormatPainter(editor) {
  const storage = editor.storage.formatPainter;
  storage.active = false;
  storage.sticky = false;
  editor.view.dom.classList.remove("pm-painting");
  storage.onChange?.(false);
}

export function applyFormat(editor, storage = editor.storage.formatPainter) {
  const { state } = editor;
  const { from, to } = state.selection;
  const tr = state.tr;
  for (const name of CHARACTER_MARKS) {
    if (name === "link") continue;
    const type = state.schema.marks[name];
    if (type) tr.removeMark(from, to, type);
  }
  for (const mark of storage.marks || []) tr.addMark(from, to, mark);
  if (storage.block) {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock || !("lineHeight" in node.attrs)) return;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...storage.block });
    });
  }
  editor.view.dispatch(tr);
}

// ---------- Word keyboard shortcuts ----------

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

export function currentFontSize(editor) {
  const size = editor.getAttributes("textStyle").fontSize;
  if (size) return parseFloat(size);
  const parent = editor.state.selection.$from.parent;
  if (parent.type.name === "heading") return parent.attrs.level === 1 ? 16 : parent.attrs.level === 2 ? 11.5 : 11;
  return 11;
}

export function stepFontSize(editor, direction) {
  const size = currentFontSize(editor);
  const next = direction > 0 ? FONT_SIZES.find((item) => item > size) || size + 2 : [...FONT_SIZES].reverse().find((item) => item < size) || Math.max(1, size - 1);
  return editor.chain().focus().setFontSize(`${next}pt`).run();
}

export function changeIndent(editor, direction) {
  if (editor.isActive("listItem")) {
    return direction > 0 ? editor.chain().focus().sinkListItem("listItem").run() : editor.chain().focus().liftListItem("listItem").run();
  }
  return editor.chain().focus().setParagraphFormat({
    indent: (value) => {
      const next = Math.max(0, Math.round(((Number(value) || 0) + direction * 36) / 36) * 36);
      return next || null;
    },
  }).run();
}

export function clearFormatting(editor) {
  return editor.chain().focus().unsetAllMarks().setParagraphFormat({
    textAlign: null,
    lineHeight: null,
    spaceBefore: null,
    spaceAfter: null,
    indent: null,
    indentRight: null,
    firstLineIndent: null,
  }).run();
}

export const WordKeymap = Extension.create({
  name: "wordKeymap",
  addKeyboardShortcuts() {
    const editor = this.editor;
    return {
      "Mod-l": () => editor.commands.setTextAlign("left"),
      "Mod-e": () => editor.commands.setTextAlign("center"),
      "Mod-r": () => editor.commands.setTextAlign("right"),
      "Mod-j": () => editor.commands.setTextAlign("justify"),
      "Mod-y": () => editor.commands.redo(),
      "Mod-]": () => stepFontSize(editor, 1),
      "Mod-[": () => stepFontSize(editor, -1),
      "Mod-Shift->": () => stepFontSize(editor, 1),
      "Mod-Shift-<": () => stepFontSize(editor, -1),
      "Mod-m": () => changeIndent(editor, 1),
      "Mod-Shift-m": () => changeIndent(editor, -1),
      "Mod-1": () => editor.commands.setParagraphFormat({ lineHeight: 1 }),
      "Mod-2": () => editor.commands.setParagraphFormat({ lineHeight: 2 }),
      "Mod-5": () => editor.commands.setParagraphFormat({ lineHeight: 1.5 }),
      "Mod-Space": () => editor.chain().unsetAllMarks().run(),
      "Mod-=": () => editor.commands.toggleSubscript(),
      "Mod-Shift-=": () => editor.commands.toggleSuperscript(),
      "Mod-Shift-c": () => {
        copyFormat(editor);
        return true;
      },
      "Mod-Shift-v": () => {
        if (!editor.storage.formatPainter.marks) return false;
        applyFormat(editor);
        return true;
      },
      Tab: () => {
        if (editor.isActive("table")) return false;
        if (editor.isActive("listItem")) return editor.commands.sinkListItem("listItem");
        const { $from, empty } = editor.state.selection;
        if (empty && $from.parentOffset === 0 && $from.parent.isTextblock) return changeIndent(editor, 1);
        return editor.commands.insertContent("\u00a0\u00a0\u00a0\u00a0");
      },
      "Shift-Tab": () => {
        if (editor.isActive("table")) return false;
        if (editor.isActive("listItem")) return editor.commands.liftListItem("listItem");
        return changeIndent(editor, -1);
      },
    };
  },
});
