import { Extension } from "@tiptap/core";
import { DOMSerializer, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { uid } from "../units.js";

// Track changes: while enabled, typing inserts text marked as an insertion and deleting
// marks text as a deletion instead of removing it. Removing your own pending insertion
// deletes it outright. Structural edits (splitting or joining paragraphs) are not tracked.

export const trackChangesKey = new PluginKey("trackChanges");

export const TrackChanges = Extension.create({
  name: "trackChanges",
  priority: 1100,
  addStorage() {
    return { enabled: false, user: { id: "", name: "" } };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    const user = () => storage.user;
    return [new Plugin({
      key: trackChangesKey,
      props: {
        handleTextInput(view, from, to, text) {
          if (!storage.enabled || view.composing) return false;
          const tr = view.state.tr;
          trackedReplace(view.state, tr, from, to, text, user());
          view.dispatch(tr.scrollIntoView());
          return true;
        },
        handleKeyDown(view, event) {
          if (!storage.enabled) return false;
          const { state } = view;
          const { selection } = state;
          if (event.key === "Backspace" || event.key === "Delete") {
            const tr = state.tr;
            if (!selection.empty) {
              const end = markDeletion(tr, selection.from, selection.to, user());
              tr.setSelection(TextSelection.create(tr.doc, event.key === "Backspace" ? tr.mapping.map(selection.from) : end));
              view.dispatch(tr.scrollIntoView());
              return true;
            }
            const $pos = selection.$from;
            if (!$pos.parent.isTextblock) return false;
            const blockStart = $pos.start();
            const blockEnd = $pos.end();
            const word = event.ctrlKey || event.metaKey || event.altKey;
            if (event.key === "Backspace") {
              let pos = selection.from;
              while (pos > blockStart && isDeleted(state, pos - 1)) pos -= 1;
              if (pos === blockStart) {
                if (pos === selection.from) return false;
                view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
                return true;
              }
              const from = word ? wordStart(state, pos, blockStart) : pos - 1;
              markDeletion(tr, from, pos, user());
              tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from)));
            } else {
              let pos = selection.from;
              while (pos < blockEnd && isDeleted(state, pos)) pos += 1;
              if (pos === blockEnd) {
                if (pos === selection.from) return false;
                view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
                return true;
              }
              const to = word ? wordEnd(state, pos, blockEnd) : pos + 1;
              const end = markDeletion(tr, pos, to, user());
              tr.setSelection(TextSelection.create(tr.doc, end));
            }
            view.dispatch(tr.scrollIntoView());
            return true;
          }
          if (event.key === "Enter" && !selection.empty) {
            const tr = state.tr;
            const end = markDeletion(tr, selection.from, selection.to, user());
            tr.setSelection(TextSelection.create(tr.doc, end));
            view.dispatch(tr);
            return false;
          }
          return false;
        },
        handlePaste(view, _event, slice) {
          if (!storage.enabled) return false;
          const { from, to } = view.state.selection;
          const tr = view.state.tr;
          const at = from < to ? markDeletion(tr, from, to, user()) : from;
          const steps = tr.steps.length;
          tr.replace(at, at, slice);
          const inserted = tr.mapping.slice(steps);
          const start = inserted.map(at, -1);
          const end = inserted.map(at, 1);
          markInsertion(tr, start, end, user());
          tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1));
          view.dispatch(tr.scrollIntoView());
          return true;
        },
        handleDOMEvents: {
          cut(view, event) {
            if (!storage.enabled) return false;
            const { selection, schema } = view.state;
            if (selection.empty || !event.clipboardData) return false;
            const slice = selection.content();
            const holder = document.createElement("div");
            holder.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(slice.content));
            event.clipboardData.setData("text/html", holder.innerHTML);
            event.clipboardData.setData("text/plain", slice.content.textBetween(0, slice.content.size, "\n\n", "\ufffc"));
            event.preventDefault();
            const tr = view.state.tr;
            const end = markDeletion(tr, selection.from, selection.to, user());
            tr.setSelection(TextSelection.create(tr.doc, end));
            view.dispatch(tr);
            return true;
          },
        },
      },
    })];
  },
});

function isDeleted(state, pos) {
  const node = state.doc.nodeAt(pos);
  return Boolean(node?.marks.some((mark) => mark.type.name === "deletion"));
}

function wordStart(state, pos, blockStart) {
  const text = state.doc.textBetween(blockStart, pos, "\n", "\ufffc");
  const match = text.match(/(\S+\s*|\s+)$/);
  return Math.max(blockStart, pos - (match ? match[0].length : 1));
}

function wordEnd(state, pos, blockEnd) {
  const text = state.doc.textBetween(pos, blockEnd, "\n", "\ufffc");
  const match = text.match(/^(\s*\S+|\s+)/);
  return Math.min(blockEnd, pos + (match ? match[0].length : 1));
}

function changeAttrs(user, id) {
  return { id: id || uid("chg"), author: user?.name || "", date: new Date().toISOString() };
}

// Marks [from, to) as deleted. Pending insertions inside the range are removed instead.
// Returns the mapped end position of the range.
export function markDeletion(tr, from, to, user) {
  const { schema } = tr.doc.type;
  const deletion = schema.marks.deletion;
  const insertion = schema.marks.insertion;
  const toMark = [];
  const toRemove = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    if (start >= end) return false;
    if (node.marks.some((mark) => mark.type === insertion)) toRemove.push([start, end]);
    else if (!node.marks.some((mark) => mark.type === deletion)) toMark.push([start, end]);
    return false;
  });
  const attrs = changeAttrs(user, adjacentId(tr.doc, from, "deletion", user));
  for (const [start, end] of toMark) tr.addMark(start, end, deletion.create(attrs));
  for (const [start, end] of toRemove.reverse()) tr.delete(start, end);
  return tr.mapping.map(to);
}

export function markInsertion(tr, from, to, user) {
  if (to <= from) return;
  const insertion = tr.doc.type.schema.marks.insertion;
  const attrs = changeAttrs(user);
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    if (start < end) tr.addMark(start, end, insertion.create(attrs));
    return false;
  });
}

function adjacentId(doc, pos, type, user) {
  const before = pos > 0 ? doc.resolve(pos).nodeBefore : null;
  const mark = before?.marks.find((item) => item.type.name === type);
  return mark && mark.attrs.author === (user?.name || "") ? mark.attrs.id : "";
}

export function trackedReplace(state, tr, from, to, text, user) {
  let at = from;
  if (from < to) at = markDeletion(tr, from, to, user);
  const $at = tr.doc.resolve(at);
  const base = (state.storedMarks || $at.marks()).filter((mark) => !["deletion", "insertion", "aiSuggestion", "comment"].includes(mark.type.name));
  const insertion = state.schema.marks.insertion.create(changeAttrs(user, adjacentId(tr.doc, at, "insertion", user)));
  tr.insert(at, state.schema.text(text, [...base, insertion]));
  tr.setSelection(TextSelection.create(tr.doc, at + text.length));
  return tr;
}

// ---------- collecting review items ----------

function collectMarkRanges(doc, typeName) {
  const groups = new Map();
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const mark of node.marks) {
      if (mark.type.name !== typeName) continue;
      const id = mark.attrs.id || `${typeName}-${pos}`;
      let group = groups.get(id);
      if (!group) {
        group = { id, attrs: mark.attrs, mark, ranges: [], text: "" };
        groups.set(id, group);
      }
      const last = group.ranges[group.ranges.length - 1];
      if (last && last.to === pos) last.to = pos + node.nodeSize;
      else group.ranges.push({ from: pos, to: pos + node.nodeSize });
      group.text += node.isText ? node.text : "\u2022";
    }
    return false;
  });
  return [...groups.values()].map((group) => ({ ...group, from: group.ranges[0].from, to: group.ranges[group.ranges.length - 1].to }));
}

export function collectChanges(doc) {
  const insertions = collectMarkRanges(doc, "insertion").map((item) => ({ ...item, type: "insertion" }));
  const deletions = collectMarkRanges(doc, "deletion").map((item) => ({ ...item, type: "deletion" }));
  return [...insertions, ...deletions].sort((a, b) => a.from - b.from);
}

export function collectComments(doc) {
  return collectMarkRanges(doc, "comment").sort((a, b) => a.from - b.from);
}

export function collectSuggestions(doc) {
  return collectMarkRanges(doc, "aiSuggestion").sort((a, b) => a.from - b.from);
}

function removeRanges(tr, ranges) {
  const sorted = [...ranges].sort((a, b) => b.from - a.from);
  for (const range of sorted) {
    const from = tr.mapping.map(range.from);
    const to = tr.mapping.map(range.to);
    const $from = tr.doc.resolve(from);
    const parent = $from.parent;
    const whole = parent.isTextblock && from === $from.start() && to === $from.end() && $from.depth > 0;
    const siblings = whole ? tr.doc.resolve($from.before()).parent.childCount : 0;
    if (whole && siblings > 1) tr.delete($from.before(), $from.after());
    else tr.delete(from, to);
  }
}

function unmarkRanges(tr, ranges, markType, id) {
  for (const range of ranges) {
    tr.doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (!node.isInline) return true;
      const mark = node.marks.find((item) => item.type === markType && (!id || item.attrs.id === id));
      if (mark) tr.removeMark(Math.max(pos, range.from), Math.min(pos + node.nodeSize, range.to), mark);
      return false;
    });
  }
}

export function resolveChange(editor, change, accept) {
  const { state } = editor;
  const tr = state.tr;
  const keep = (change.type === "insertion") === accept;
  if (keep) unmarkRanges(tr, change.ranges, state.schema.marks[change.type], change.id);
  else removeRanges(tr, change.ranges);
  editor.view.dispatch(tr);
}

export function resolveAllChanges(editor, accept) {
  const changes = collectChanges(editor.state.doc);
  if (!changes.length) return 0;
  const { state } = editor;
  const tr = state.tr;
  const keepType = accept ? "insertion" : "deletion";
  for (const change of changes) {
    if (change.type === keepType) unmarkRanges(tr, change.ranges, state.schema.marks[change.type], change.id);
  }
  removeRanges(tr, changes.filter((change) => change.type !== keepType).flatMap((change) => change.ranges));
  editor.view.dispatch(tr);
  return changes.length;
}

export function resolveSuggestion(editor, suggestion, accept) {
  const { state } = editor;
  const tr = state.tr;
  if (accept) {
    unmarkRanges(tr, suggestion.ranges, state.schema.marks.aiSuggestion, suggestion.id);
  } else if (suggestion.attrs.original) {
    let original = null;
    try {
      original = Slice.fromJSON(state.schema, JSON.parse(suggestion.attrs.original));
    } catch {
      original = null;
    }
    if (original) tr.replace(suggestion.from, suggestion.to, original);
    else removeRanges(tr, suggestion.ranges);
  } else {
    removeRanges(tr, suggestion.ranges);
  }
  editor.view.dispatch(tr);
}

export function resolveAllSuggestions(editor, accept) {
  const suggestions = collectSuggestions(editor.state.doc);
  for (const suggestion of [...suggestions].reverse()) {
    const fresh = collectSuggestions(editor.state.doc).find((item) => item.id === suggestion.id);
    if (fresh) resolveSuggestion(editor, fresh, accept);
  }
  return suggestions.length;
}

// ---------- comments ----------

export function addComment(editor, text, user) {
  let { from, to, empty } = editor.state.selection;
  if (empty) {
    const $pos = editor.state.selection.$from;
    if (!$pos.parent.isTextblock) return null;
    const start = $pos.start();
    const before = editor.state.doc.textBetween(start, from, "\n", "\ufffc").match(/\S*$/)[0].length;
    const after = editor.state.doc.textBetween(from, $pos.end(), "\n", "\ufffc").match(/^\S*/)[0].length;
    from -= before;
    to += after;
    if (from === to) return null;
  }
  const id = uid("cmt");
  const mark = editor.schema.marks.comment.create({ id, text, author: user?.name || "", date: new Date().toISOString(), replies: [] });
  editor.view.dispatch(editor.state.tr.addMark(from, to, mark));
  return id;
}

export function updateComment(editor, id, change) {
  const comment = collectComments(editor.state.doc).find((item) => item.id === id);
  if (!comment) return;
  const tr = editor.state.tr;
  const markType = editor.schema.marks.comment;
  const attrs = { ...comment.attrs, ...change };
  for (const range of comment.ranges) {
    tr.doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (!node.isInline) return true;
      const mark = node.marks.find((item) => item.type === markType && item.attrs.id === id);
      if (mark) {
        const from = Math.max(pos, range.from);
        const to = Math.min(pos + node.nodeSize, range.to);
        tr.removeMark(from, to, mark);
        tr.addMark(from, to, markType.create(attrs));
      }
      return false;
    });
  }
  editor.view.dispatch(tr);
}

export function deleteComment(editor, id) {
  const comment = collectComments(editor.state.doc).find((item) => item.id === id);
  if (!comment) return;
  const tr = editor.state.tr;
  unmarkRanges(tr, comment.ranges, editor.schema.marks.comment, id);
  editor.view.dispatch(tr);
}

export function selectRange(editor, from, to) {
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}
