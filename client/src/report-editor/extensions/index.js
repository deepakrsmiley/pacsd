import CharacterCount from "@tiptap/extension-character-count";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { SECTION_DEFS } from "../../../../shared/reportDocument.js";
import { toHexColor } from "../units.js";
import { Pagination } from "./pagination.js";
import { TrackChanges } from "./review.js";
import {
  AiSuggestionMark,
  Column,
  Columns,
  CommentMark,
  DataField,
  DeletionMark,
  FontSize,
  InsertionMark,
  PageBreak,
  ParagraphFormat,
  ReportImage,
  ReportParagraph,
  ReportTableCell,
  ReportTableHeader,
  SectionHeading,
} from "./schema.js";
import { FormatPainter, FormattingMarks, Search, WordKeymap } from "./tools.js";

const PROMPTS = Object.fromEntries(SECTION_DEFS.map((item) => [item.key, item.prompt]));

const HexColor = Color.extend({
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        color: {
          default: null,
          parseHTML: (element) => toHexColor(element.style.color) || null,
          renderHTML: (attributes) => (attributes.color ? { style: `color: ${attributes.color}` } : {}),
        },
      },
    }];
  },
});

const HexHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => toHexColor(element.getAttribute("data-color") || element.style.backgroundColor) || null,
        renderHTML: (attributes) => (attributes.color ? { "data-color": attributes.color, style: `background-color: ${attributes.color}; color: inherit` } : {}),
      },
    };
  },
}).configure({ multicolor: true });

function sectionPlaceholder({ editor, node, pos }) {
  if (node.type.name !== "paragraph" || typeof pos !== "number") return "";
  const $pos = editor.state.doc.resolve(pos);
  if ($pos.depth !== 0) return "";
  const index = $pos.index(0);
  const previous = index > 0 ? editor.state.doc.child(index - 1) : null;
  if (previous?.type.name === "heading" && previous.attrs.sectionKey) return PROMPTS[previous.attrs.sectionKey] || "Type here…";
  return "";
}

export function reportExtensions({ onPages, paginate = true, placeholder = true } = {}) {
  return [
    StarterKit.configure({
      heading: false,
      paragraph: false,
      code: false,
      codeBlock: false,
      history: { depth: 300, newGroupDelay: 600 },
      dropcursor: { color: "#2563eb", width: 2 },
    }),
    ReportParagraph,
    SectionHeading,
    Underline,
    TextStyle,
    HexColor,
    FontFamily,
    FontSize,
    HexHighlight,
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
    ParagraphFormat,
    Subscript,
    Superscript,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      protocols: ["mailto"],
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      validate: (href) => /^(https?:|mailto:)/i.test(href),
    }),
    Table.configure({ resizable: true, lastColumnResizable: false, allowTableNodeSelection: true, cellMinWidth: 36 }),
    TableRow,
    ReportTableHeader,
    ReportTableCell,
    ReportImage,
    PageBreak,
    Columns,
    Column,
    DataField,
    CommentMark,
    InsertionMark,
    DeletionMark,
    AiSuggestionMark,
    placeholder ? Placeholder.configure({ includeChildren: false, showOnlyCurrent: false, placeholder: sectionPlaceholder }) : null,
    CharacterCount,
    Search,
    FormattingMarks,
    FormatPainter,
    TrackChanges,
    WordKeymap,
    paginate ? Pagination.configure({ onPages }) : null,
  ].filter(Boolean);
}
