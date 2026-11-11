import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";
import Image from "@tiptap/extension-image";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { FIELD_DEFS } from "../../../../shared/reportDocument.js";
import { cssLengthToPt, toHexColor } from "../units.js";

const BLOCK_FORMAT_KEYS = ["textAlign", "lineHeight", "spaceBefore", "spaceAfter", "indent", "indentRight", "firstLineIndent"];
export const PARAGRAPH_FORMAT_KEYS = BLOCK_FORMAT_KEYS;

// ---------- character formatting ----------

export const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [{
      types: ["textStyle"],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (element) => {
            const pt = cssLengthToPt(element.style.fontSize);
            return pt ? `${Math.round(pt * 2) / 2}pt` : null;
          },
          renderHTML: (attributes) => (attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

// ---------- paragraph formatting ----------

// Spacing is stored in points. The editor renders it as padding so that adjacent
// paragraphs add their spacing like Word and the exporters, instead of collapsing margins.
function ptAttribute(cssProperty, read) {
  return {
    default: null,
    parseHTML: (element) => {
      const value = read ? read(element) : element.style[cssProperty];
      const pt = cssLengthToPt(value);
      return pt == null ? null : Math.round(pt * 10) / 10;
    },
    renderHTML: () => ({}),
  };
}

export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",
  addOptions() {
    return { types: ["paragraph", "heading"] };
  },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (element) => {
            const value = element.style.lineHeight;
            if (!value || !/^[\d.]+$/.test(value)) return null;
            const number = Number(value);
            return number >= 0.8 && number <= 4 ? number : null;
          },
          renderHTML: () => ({}),
        },
        spaceBefore: ptAttribute("marginTop", (element) => element.style.paddingTop || element.style.marginTop),
        spaceAfter: ptAttribute("marginBottom", (element) => element.style.paddingBottom || element.style.marginBottom),
        indent: ptAttribute("marginLeft"),
        indentRight: ptAttribute("marginRight"),
        firstLineIndent: ptAttribute("textIndent"),
      },
    }];
  },
  addCommands() {
    return {
      setParagraphFormat: (attrs) => ({ tr, state, dispatch }) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!this.options.types.includes(node.type.name)) return;
          const next = { ...node.attrs };
          for (const [key, value] of Object.entries(attrs)) {
            next[key] = typeof value === "function" ? value(node.attrs[key], node) : value;
          }
          tr.setNodeMarkup(pos, undefined, next);
          changed = true;
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      },
    };
  },
});

// Paragraph and heading nodes render these attributes as one inline style.
export function blockStyle(attrs) {
  const parts = [];
  if (attrs.lineHeight) parts.push(`line-height: ${attrs.lineHeight}`);
  if (attrs.spaceBefore != null) parts.push(`padding-top: ${attrs.spaceBefore}pt`);
  if (attrs.spaceAfter != null) parts.push(`padding-bottom: ${attrs.spaceAfter}pt`);
  if (attrs.indent) parts.push(`margin-left: ${attrs.indent}pt`);
  if (attrs.indentRight) parts.push(`margin-right: ${attrs.indentRight}pt`);
  if (attrs.firstLineIndent) parts.push(`text-indent: ${attrs.firstLineIndent}pt`);
  if (attrs.textAlign && attrs.textAlign !== "left") parts.push(`text-align: ${attrs.textAlign}`);
  return parts.join("; ");
}

function styledBlock(tag, HTMLAttributes, node, extra = {}) {
  const style = blockStyle(node.attrs);
  const attributes = mergeAttributes(HTMLAttributes, extra);
  delete attributes.style;
  if (style) attributes.style = style;
  return [tag, attributes, 0];
}

export const ReportParagraph = Node.create({
  name: "paragraph",
  priority: 1000,
  group: "block",
  content: "inline*",
  parseHTML() {
    return [{ tag: "p" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return styledBlock("p", HTMLAttributes, node);
  },
  addCommands() {
    return {
      setParagraph: () => ({ commands }) => commands.setNode(this.name),
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Alt-0": () => this.editor.commands.setParagraph() };
  },
});

export const SectionHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      sectionKey: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-section") || null,
        renderHTML: (attributes) => (attributes.sectionKey ? { "data-section": attributes.sectionKey } : {}),
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = this.options.levels.includes(node.attrs.level) ? node.attrs.level : this.options.levels[0];
    return styledBlock(`h${level}`, HTMLAttributes, node);
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      // Splitting a section heading copies its key; only the first copy keeps it.
      new Plugin({
        key: new PluginKey("uniqueSectionKeys"),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const seen = new Set();
          let tr = null;
          state.doc.forEach((node, pos) => {
            const key = node.type.name === "heading" ? node.attrs.sectionKey : null;
            if (!key) return;
            if (seen.has(key)) {
              tr = tr || state.tr;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, sectionKey: null });
            }
            seen.add(key);
          });
          return tr;
        },
      }),
    ];
  },
}).configure({ levels: [1, 2, 3] });

// ---------- structural nodes ----------

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [
      { tag: "div[data-page-break]" },
      { tag: "br[style*='page-break-before']", getAttrs: () => ({}) },
    ];
  },
  renderHTML() {
    return ["div", { "data-page-break": "", class: "pm-page-break", contenteditable: "false" }, ["span", {}, "Page break"]];
  },
  addCommands() {
    return {
      setPageBreak: () => ({ chain, state }) => {
        const { $to } = state.selection;
        const atEnd = $to.parentOffset === $to.parent.content.size && $to.depth === 1 && $to.index(0) === state.doc.childCount - 1;
        return chain().insertContent(atEnd ? [{ type: this.name }, { type: "paragraph" }] : { type: this.name }).run();
      },
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.setPageBreak() };
  },
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },
  renderHTML({ node }) {
    return ["div", { "data-columns": String(node.childCount), class: "pm-columns", style: `grid-template-columns: repeat(${node.childCount}, minmax(0, 1fr))` }, 0];
  },
  addCommands() {
    return {
      insertColumns: (count = 2) => ({ state, dispatch }) => {
        const { schema } = state;
        const { $from, $to } = state.selection;
        if ($from.depth < 1) return false;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === "columns" || $from.node(depth).type.name === "table") return false;
        }
        const start = $from.before(1);
        const end = $to.after(1);
        const blocks = [];
        state.doc.slice(start, end).content.forEach((child) => blocks.push(child));
        const first = blocks.length ? blocks : [schema.nodes.paragraph.create()];
        const columns = [schema.nodes.column.create(null, first)];
        for (let index = 1; index < count; index += 1) columns.push(schema.nodes.column.create(null, schema.nodes.paragraph.create()));
        const node = schema.nodes.columns.create(null, columns);
        if (dispatch) {
          const tr = state.tr.replaceWith(start, end, node);
          tr.setSelection(TextSelection.near(tr.doc.resolve(start + 3)));
          dispatch(tr.scrollIntoView());
        }
        return true;
      },
      removeColumns: () => ({ state, dispatch }) => {
        const { $from } = state.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth);
          if (node.type.name !== "columns") continue;
          const blocks = [];
          node.forEach((column) => column.forEach((child) => blocks.push(child)));
          if (dispatch) {
            const pos = $from.before(depth);
            const tr = state.tr.replaceWith(pos, pos + node.nodeSize, blocks);
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))));
            dispatch(tr);
          }
          return true;
        }
        return false;
      },
    };
  },
});

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },
  renderHTML() {
    return ["div", { "data-column": "", class: "pm-column" }, 0];
  },
});

// ---------- patient and study fields ----------

export const FIELD_LABELS = Object.fromEntries(FIELD_DEFS.map((item) => [item.key, item.label]));

export const DataField = Node.create({
  name: "dataField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      key: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-field") || "",
        renderHTML: (attributes) => ({ "data-field": attributes.key }),
      },
    };
  },
  addStorage() {
    return { values: {}, listeners: new Set() };
  },
  parseHTML() {
    return [{ tag: "span[data-field]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "pm-field" }), fieldDisplay(this.storage.values, node.attrs.key)];
  },
  renderText({ node }) {
    return fieldDisplay(this.storage.values, node.attrs.key);
  },
  addNodeView() {
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement("span");
      dom.className = "pm-field";
      dom.contentEditable = "false";
      const storage = editor.storage.dataField;
      const render = () => {
        const key = current.attrs.key;
        const value = fieldDisplay(storage.values, key);
        dom.replaceChildren();
        dom.dataset.field = key;
        dom.title = `${FIELD_LABELS[key] || key} — filled from the study record`;
        dom.classList.toggle("pm-field-pending", key !== "signature" && /^(Pending|Not recorded|Not assigned)/.test(value));
        if (key === "signature") {
          dom.classList.add("pm-signature");
          const signed = storage.values.reportStatus === "Finalized" || storage.values.reportStatus === "Amended" || storage.values.reportStatus === "Pending Signature";
          const name = document.createElement("span");
          name.className = "pm-signature-name";
          name.textContent = storage.values.radiologistName && storage.values.radiologistName !== "Not assigned" ? storage.values.radiologistName : "Signature";
          dom.append(name);
          if (storage.values.signatureImage) {
            const image = document.createElement("img");
            image.src = storage.values.signatureImage;
            image.alt = "Signature";
            image.className = "pm-signature-image";
            dom.append(image);
          }
          const caption = document.createElement("span");
          caption.className = "pm-signature-caption";
          caption.textContent = signed ? value : "Electronic signature is applied when you sign";
          dom.append(caption);
          return;
        }
        dom.append(document.createTextNode(value || " "));
      };
      render();
      storage.listeners.add(render);
      return {
        dom,
        update(next) {
          if (next.type.name !== "dataField") return false;
          current = next;
          render();
          return true;
        },
        destroy() {
          storage.listeners.delete(render);
        },
        ignoreMutation: () => true,
      };
    };
  },
  addCommands() {
    return {
      insertDataField: (key) => ({ commands }) => commands.insertContent({ type: this.name, attrs: { key } }),
    };
  },
});

function fieldDisplay(values, key) {
  const value = values?.[key];
  if (value == null || value === "") return FIELD_LABELS[key] ? `[${FIELD_LABELS[key]}]` : "";
  return String(value);
}

export function setFieldValues(editor, values) {
  const storage = editor?.storage?.dataField;
  if (!storage) return;
  storage.values = values || {};
  storage.listeners.forEach((render) => render());
  editor.storage.pagination?.schedule?.();
}

// ---------- review marks ----------

function reviewMark(name, className, attributes, options = {}) {
  return Mark.create({
    name,
    inclusive: false,
    excludes: options.excludes ?? name,
    spanning: true,
    addAttributes() {
      return Object.fromEntries(Object.entries(attributes).map(([key, fallback]) => [key, {
        default: fallback,
        parseHTML: (element) => {
          const raw = element.getAttribute(`data-${key}`);
          if (raw == null) return fallback;
          if (Array.isArray(fallback)) {
            try { return JSON.parse(raw); } catch { return fallback; }
          }
          return raw;
        },
        renderHTML: (attrs) => {
          const value = attrs[key];
          if (value == null || value === "") return {};
          return { [`data-${key}`]: Array.isArray(value) ? JSON.stringify(value) : String(value) };
        },
      }]));
    },
    parseHTML() {
      return [{ tag: `span[data-review="${name}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes, { "data-review": name, class: className }), 0];
    },
  });
}

export const CommentMark = reviewMark("comment", "pm-comment", { id: "", text: "", author: "", date: "", replies: [] }, { excludes: "" });
export const InsertionMark = reviewMark("insertion", "pm-insertion", { id: "", author: "", date: "" });
export const DeletionMark = reviewMark("deletion", "pm-deletion", { id: "", author: "", date: "" });
// `original` holds the JSON of the text an AI suggestion replaced, so rejecting restores it.
export const AiSuggestionMark = reviewMark("aiSuggestion", "pm-ai-suggestion", { id: "", task: "", original: "" });

// ---------- tables ----------

const cellBackground = {
  backgroundColor: {
    default: null,
    parseHTML: (element) => toHexColor(element.style.backgroundColor || element.getAttribute("bgcolor")) || null,
    renderHTML: (attributes) => (attributes.backgroundColor ? { style: `background-color: ${attributes.backgroundColor}` } : {}),
  },
};

export const ReportTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground };
  },
});

export const ReportTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground };
  },
});

// ---------- images ----------

export const ReportImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute("width")) || parseInt(element.style.width, 10) || null,
        renderHTML: (attributes) => (attributes.width ? { width: attributes.width } : {}),
      },
      height: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute("height")) || parseInt(element.style.height, 10) || null,
        renderHTML: (attributes) => (attributes.height ? { height: attributes.height } : {}),
      },
      align: {
        default: "center",
        parseHTML: (element) => element.getAttribute("data-align") || "center",
        renderHTML: (attributes) => ({ "data-align": attributes.align || "center" }),
      },
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "pm-image";
      const frame = document.createElement("span");
      frame.className = "pm-image-frame";
      const image = document.createElement("img");
      image.draggable = false;
      const handle = document.createElement("span");
      handle.className = "pm-image-handle";
      handle.title = "Drag to resize";
      frame.append(image, handle);
      dom.append(frame);

      const render = () => {
        image.src = current.attrs.src;
        image.alt = current.attrs.alt || "";
        dom.dataset.align = current.attrs.align || "center";
        if (current.attrs.width) image.style.width = `${current.attrs.width}px`;
        else image.style.removeProperty("width");
      };
      render();

      handle.addEventListener("mousedown", (event) => {
        if (!editor.isEditable) return;
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const scale = image.getBoundingClientRect().width / (image.offsetWidth || 1) || 1;
        const startWidth = image.offsetWidth;
        const ratio = (image.naturalHeight || image.offsetHeight) / (image.naturalWidth || image.offsetWidth || 1);
        const maxWidth = dom.clientWidth || startWidth;
        const move = (moveEvent) => {
          const width = Math.max(40, Math.min(maxWidth, startWidth + (moveEvent.clientX - startX) / scale));
          image.style.width = `${width}px`;
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          const width = Math.round(image.offsetWidth);
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos == null) return;
          editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...current.attrs,
            width,
            height: Math.round(width * ratio),
          }));
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      });
      image.addEventListener("load", () => editor.storage.pagination?.schedule?.());

      return {
        dom,
        update(next) {
          if (next.type.name !== current.type.name) return false;
          current = next;
          render();
          return true;
        },
        selectNode() {
          dom.classList.add("is-selected");
        },
        deselectNode() {
          dom.classList.remove("is-selected");
        },
        stopEvent: (event) => event.target === handle,
        ignoreMutation: () => true,
      };
    };
  },
}).configure({ inline: false, allowBase64: true });
