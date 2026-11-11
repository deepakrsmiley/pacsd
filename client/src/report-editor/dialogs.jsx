import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Columns3,
  FileSignature,
  FileText,
  History,
  Keyboard,
  Link2,
  Mail,
  MessageCircle,
  Omega,
  PanelTop,
  Printer,
  RotateCcw,
  Save,
  Share2,
  SpellCheck,
  Square,
  Star,
  Table2,
  UserRound,
  XCircle,
} from "lucide-react";
import {
  MARGIN_PRESETS,
  PAGE_SIZES,
  docStats,
  exportableDoc,
  extractSections,
  finalizationProblems,
  formatDateTime,
  modalityLabel,
} from "../../../shared/reportDocument.js";
import { api } from "../api.js";
import { applyTemplateFill, templateFromDoc } from "./documentUtils.js";
import { reportExtensions } from "./extensions/index.js";
import { setFieldValues } from "./extensions/schema.js";
import { downloadFile, downloadReport } from "./files.js";
import { addPersonalWord, loadSpeller, misspellings } from "./spell.js";
import { Button, Dialog, Field, NumberInput } from "./ui.jsx";

// ---------- insert ----------

export function TableDialog({ onInsert, onClose }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [header, setHeader] = useState(true);
  return (
    <Dialog title="Insert table" icon={Table2} onClose={onClose} width={340} footer={<><Button onClick={onClose}>Cancel</Button><Button primary onClick={() => { onInsert({ rows: rows || 1, cols: cols || 1, withHeaderRow: header }); onClose(); }}>Insert</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Columns"><NumberInput value={cols} onChange={setCols} min={1} max={12} className="w-full" /></Field>
        <Field label="Rows"><NumberInput value={rows} onChange={setRows} min={1} max={60} className="w-full" /></Field>
      </div>
      <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={header} onChange={(event) => setHeader(event.target.checked)} /> First row is a header row</label>
    </Dialog>
  );
}

export function LinkDialog({ editor, onClose }) {
  const existing = editor.getAttributes("link").href || "";
  const { empty } = editor.state.selection;
  const [href, setHref] = useState(existing || "https://");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  function apply() {
    const value = href.trim();
    if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(value)) {
      setError("Enter a web address starting with http:// or https://, or an email link starting with mailto:");
      return;
    }
    if (empty && !existing) {
      const textValue = label.trim() || value.replace(/^mailto:/i, "");
      editor.chain().focus().insertContent({ type: "text", text: textValue, marks: [{ type: "link", attrs: { href: value } }] }).run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
    }
    onClose();
  }
  return (
    <Dialog title={existing ? "Edit hyperlink" : "Insert hyperlink"} icon={Link2} onClose={onClose} width={420} footer={<>
      {existing && <Button danger onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); onClose(); }}>Remove link</Button>}
      <span className="flex-1" />
      <Button onClick={onClose}>Cancel</Button>
      <Button primary onClick={apply}>OK</Button>
    </>}>
      {empty && !existing && <Field label="Text to display" className="mb-3"><input className="we-input w-full" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Leave blank to show the address" /></Field>}
      <Field label="Address"><input className="we-input w-full" value={href} onChange={(event) => { setHref(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") apply(); }} data-autofocus /></Field>
      {error && <p className="mt-2 text-[11.5px] text-rose-700">{error}</p>}
    </Dialog>
  );
}

export const SYMBOLS = [
  ["Measurement", ["°", "±", "×", "÷", "≈", "≠", "≤", "≥", "<", ">", "µ", "‰", "%", "½", "¼", "¾", "²", "³", "√", "∞"]],
  ["Arrows", ["→", "←", "↑", "↓", "↔", "↕", "⇒", "⇐", "⇔"]],
  ["Greek", ["α", "β", "γ", "δ", "Δ", "ε", "θ", "κ", "λ", "μ", "π", "ρ", "σ", "Σ", "τ", "φ", "χ", "ψ", "ω", "Ω"]],
  ["Punctuation", ["•", "·", "–", "—", "…", "§", "¶", "†", "‡", "“", "”", "‘", "’", "«", "»", "©", "®", "™", "№", "✓"]],
];

export function SymbolDialog({ editor, onClose }) {
  return (
    <Dialog title="Symbol" icon={Omega} onClose={onClose} width={440} footer={<Button onClick={onClose}>Close</Button>}>
      {SYMBOLS.map(([group, items]) => (
        <div key={group} className="mb-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#a1a1a6]">{group}</div>
          <div className="flex flex-wrap gap-1">
            {items.map((symbol) => (
              <button key={symbol} type="button" className="grid h-8 w-8 place-items-center rounded border border-[#e5e5ea] text-[15px] hover:border-[#7c3aed] hover:bg-[#f5f3ff]" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().insertContent(symbol).run()} title={`Insert ${symbol}`}>{symbol}</button>
            ))}
          </div>
        </div>
      ))}
    </Dialog>
  );
}

function dateFormats(now) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    now.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  ];
}

export function DateTimeDialog({ editor, onClose }) {
  const formats = useMemo(() => dateFormats(new Date()), []);
  const [choice, setChoice] = useState(0);
  const insert = () => {
    editor.chain().focus().insertContent(formats[choice]).run();
    onClose();
  };
  return (
    <Dialog title="Date and time" icon={CalendarClock} onClose={onClose} width={360} footer={<><Button onClick={onClose}>Cancel</Button><Button primary onClick={insert}>Insert</Button></>}>
      <div className="grid gap-0.5" role="listbox" aria-label="Available formats">
        {formats.map((value, index) => (
          <button key={value} type="button" role="option" aria-selected={choice === index} className={`rounded px-2 py-1.5 text-left ${choice === index ? "bg-[#ede9fe] text-[#5b21b6]" : "hover:bg-[#f5f5f7]"}`} onClick={() => setChoice(index)} onDoubleClick={insert}>{value}</button>
        ))}
      </div>
    </Dialog>
  );
}

// ---------- layout ----------

const TOKENS = ["{FACILITY}", "{PATIENT}", "{PATIENT_ID}", "{ACCESSION}", "{MODALITY}", "{STUDY}", "{STATUS}", "{DATE}", "{PAGE}", "{PAGES}"];

export function HeaderFooterDialog({ layout, onChange, onClose, focus = "header" }) {
  const [header, setHeader] = useState({ ...layout.header });
  const [footer, setFooter] = useState({ ...layout.footer });
  const [headerDistance, setHeaderDistance] = useState(layout.headerDistance);
  const [footerDistance, setFooterDistance] = useState(layout.footerDistance);
  const save = () => {
    onChange({ header, footer, headerDistance: headerDistance ?? 10, footerDistance: footerDistance ?? 8 });
    onClose();
  };
  const area = (value, set, key, autoFocus) => (
    <textarea className="we-input h-[54px] w-full resize-none py-1" value={value[key] || ""} onChange={(event) => set({ ...value, [key]: event.target.value })} data-autofocus={autoFocus ? "" : undefined} />
  );
  return (
    <Dialog title="Header and footer" icon={PanelTop} onClose={onClose} width={640} footer={<><Button onClick={onClose}>Cancel</Button><Button primary onClick={save}>Apply to all pages</Button></>}>
      <p className="mb-3 text-[11.5px] text-[#6e6e73]">These appear on every page of the editor, the PDF and the Word file. Fields: {TOKENS.join(" ")}. The first line of a header column is bold.</p>
      <h3 className="mb-1.5 text-[12px] font-semibold">Header</h3>
      <label className="mb-2 flex items-center gap-2"><input type="checkbox" checked={Boolean(header.showLogo)} onChange={(event) => setHeader({ ...header, showLogo: event.target.checked })} /> Show the facility logo</label>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Left">{area(header, setHeader, "left", focus === "header")}</Field>
        <Field label="Centre">{area(header, setHeader, "center")}</Field>
        <Field label="Right">{area(header, setHeader, "right")}</Field>
      </div>
      <h3 className="mb-1.5 mt-4 text-[12px] font-semibold">Footer</h3>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Left">{area(footer, setFooter, "left", focus === "footer")}</Field>
        <Field label="Centre">{area(footer, setFooter, "center")}</Field>
        <Field label="Right">{area(footer, setFooter, "right")}</Field>
      </div>
      <Field label="Footer note" className="mt-2"><input className="we-input w-full" value={footer.note || ""} onChange={(event) => setFooter({ ...footer, note: event.target.value })} /></Field>
      <div className="mt-4 flex gap-6">
        <Field label="Header from top"><NumberInput value={headerDistance} onChange={setHeaderDistance} min={0} max={60} step={0.5} suffix="mm" /></Field>
        <Field label="Footer from bottom"><NumberInput value={footerDistance} onChange={setFooterDistance} min={0} max={60} step={0.5} suffix="mm" /></Field>
      </div>
    </Dialog>
  );
}

export function PageSetupDialog({ layout, onChange, onClose }) {
  const [margins, setMargins] = useState({ ...layout.margins });
  const [orientation, setOrientation] = useState(layout.orientation);
  const [pageSize, setPageSize] = useState(layout.pageSize);
  const [headerDistance, setHeaderDistance] = useState(layout.headerDistance);
  const [footerDistance, setFooterDistance] = useState(layout.footerDistance);
  const side = (key, label) => (
    <Field label={label}><NumberInput value={margins[key]} onChange={(value) => setMargins({ ...margins, [key]: value })} min={5} max={80} step={0.5} suffix="mm" className="w-20" /></Field>
  );
  const apply = () => {
    onChange({ margins: Object.fromEntries(Object.entries(margins).map(([key, value]) => [key, Number(value) || 5])), orientation, pageSize, headerDistance: headerDistance ?? 10, footerDistance: footerDistance ?? 8 });
    onClose();
  };
  return (
    <Dialog title="Page setup" icon={FileText} onClose={onClose} width={470} footer={<><Button onClick={onClose}>Cancel</Button><Button primary onClick={apply}>OK</Button></>}>
      <h3 className="mb-2 text-[12px] font-semibold">Margins</h3>
      <div className="grid grid-cols-2 gap-3">
        {side("top", "Top")}
        {side("bottom", "Bottom")}
        {side("left", "Left")}
        {side("right", "Right")}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {Object.entries(MARGIN_PRESETS).map(([key, preset]) => (
          <button key={key} type="button" className="rounded border border-[#e5e5ea] px-2 py-1 text-[11.5px] hover:border-[#7c3aed]" onClick={() => setMargins({ top: preset.top, right: preset.right, bottom: preset.bottom, left: preset.left })}>{preset.label}</button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Paper size">
          <select className="we-input w-full" value={pageSize} onChange={(event) => setPageSize(event.target.value)}>
            {Object.entries(PAGE_SIZES).map(([key, size]) => <option key={key} value={key}>{size.label} ({size.width} × {size.height} mm)</option>)}
          </select>
        </Field>
        <Field label="Orientation">
          <select className="we-input w-full" value={orientation} onChange={(event) => setOrientation(event.target.value)}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </Field>
        <Field label="Header from top"><NumberInput value={headerDistance} onChange={setHeaderDistance} min={0} max={60} step={0.5} suffix="mm" /></Field>
        <Field label="Footer from bottom"><NumberInput value={footerDistance} onChange={setFooterDistance} min={0} max={60} step={0.5} suffix="mm" /></Field>
      </div>
    </Dialog>
  );
}

export function BorderDialog({ layout, onChange, onClose }) {
  const [style, setStyle] = useState(layout.border?.style || "none");
  const [color, setColor] = useState(layout.border?.color || "#2c2c2e");
  const options = [["none", "None"], ["single", "Box"], ["double", "Double"], ["thick", "Thick"]];
  return (
    <Dialog title="Page borders" icon={Square} onClose={onClose} width={400} footer={<><Button onClick={onClose}>Cancel</Button><Button primary onClick={() => { onChange({ border: { style, color } }); onClose(); }}>OK</Button></>}>
      <div className="grid grid-cols-4 gap-2">
        {options.map(([key, label]) => (
          <button key={key} type="button" className={`flex flex-col items-center gap-1.5 rounded border p-2 ${style === key ? "border-[#7c3aed] bg-[#f5f3ff]" : "border-[#e5e5ea]"}`} onClick={() => setStyle(key)} aria-pressed={style === key}>
            <span className="h-12 w-9 bg-white" style={{ border: key === "none" ? "1px dashed #d1d1d6" : key === "double" ? `3px double ${color}` : `${key === "thick" ? 3 : 1}px solid ${color}` }} />
            <span className="text-[11.5px]">{label}</span>
          </button>
        ))}
      </div>
      <Field label="Colour" className="mt-3"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-8 w-16 rounded border border-[#d1d1d6]" /></Field>
    </Dialog>
  );
}

export function ParagraphDialog({ editor, onClose }) {
  const parent = editor.state.selection.$from.parent;
  const attrs = parent.isTextblock ? parent.attrs : {};
  const [values, setValues] = useState({
    textAlign: attrs.textAlign || "left",
    indent: attrs.indent ?? 0,
    indentRight: attrs.indentRight ?? 0,
    firstLineIndent: attrs.firstLineIndent ?? 0,
    spaceBefore: attrs.spaceBefore ?? (parent.type.name === "heading" ? null : 0),
    spaceAfter: attrs.spaceAfter ?? null,
    lineHeight: attrs.lineHeight ?? 1.15,
  });
  const set = (key) => (value) => setValues({ ...values, [key]: value });
  const apply = () => {
    const clean = (value) => (value === "" || value === null || Number.isNaN(Number(value)) ? null : Number(value));
    editor.chain().focus().setTextAlign(values.textAlign).setParagraphFormat({
      indent: clean(values.indent) || null,
      indentRight: clean(values.indentRight) || null,
      firstLineIndent: clean(values.firstLineIndent) || null,
      spaceBefore: clean(values.spaceBefore),
      spaceAfter: clean(values.spaceAfter),
      lineHeight: clean(values.lineHeight) === 1.15 ? null : clean(values.lineHeight),
    }).run();
    onClose();
  };
  return (
    <Dialog title="Paragraph" icon={Columns3} onClose={onClose} width={460} footer={<><Button onClick={onClose}>Cancel</Button><Button primary onClick={apply}>OK</Button></>}>
      <Field label="Alignment">
        <select className="we-input w-40" value={values.textAlign} onChange={(event) => set("textAlign")(event.target.value)}>
          <option value="left">Left</option>
          <option value="center">Centred</option>
          <option value="right">Right</option>
          <option value="justify">Justified</option>
        </select>
      </Field>
      <h3 className="mb-2 mt-4 text-[12px] font-semibold">Indentation</h3>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Left"><NumberInput value={values.indent} onChange={set("indent")} min={0} max={400} step={1} suffix="pt" className="w-16" /></Field>
        <Field label="Right"><NumberInput value={values.indentRight} onChange={set("indentRight")} min={0} max={400} step={1} suffix="pt" className="w-16" /></Field>
        <Field label="First line"><NumberInput value={values.firstLineIndent} onChange={set("firstLineIndent")} min={0} max={200} step={1} suffix="pt" className="w-16" /></Field>
      </div>
      <h3 className="mb-2 mt-4 text-[12px] font-semibold">Spacing</h3>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Before" hint="Blank uses the style"><NumberInput value={values.spaceBefore} onChange={set("spaceBefore")} min={0} max={72} step={1} suffix="pt" className="w-16" /></Field>
        <Field label="After" hint="Blank uses the style"><NumberInput value={values.spaceAfter} onChange={set("spaceAfter")} min={0} max={72} step={1} suffix="pt" className="w-16" /></Field>
        <Field label="Line spacing"><NumberInput value={values.lineHeight} onChange={set("lineHeight")} min={0.8} max={4} step={0.05} suffix="×" className="w-16" /></Field>
      </div>
    </Dialog>
  );
}

// ---------- review ----------

export function WordCountDialog({ editor, pages, onClose }) {
  const fields = editor.storage.dataField.values;
  const all = docStats(editor.getJSON(), fields);
  const { from, to, empty } = editor.state.selection;
  const selected = empty ? null : editor.state.doc.textBetween(from, to, "\n", "\ufffc");
  const rows = [
    ["Pages", pages],
    ["Words", all.words],
    ["Characters (no spaces)", all.charactersNoSpaces],
    ["Characters (with spaces)", all.characters],
    ["Paragraphs", all.paragraphs],
  ];
  return (
    <Dialog title="Word count" icon={BookOpen} onClose={onClose} width={340} footer={<Button primary onClick={onClose}>Close</Button>}>
      <table className="w-full text-[12.5px]">
        <tbody>
          {rows.map(([label, value]) => <tr key={label} className="border-b border-[#f5f5f7]"><td className="py-1.5 text-[#48484a]">{label}</td><td className="py-1.5 text-right font-semibold tabular-nums">{value.toLocaleString()}</td></tr>)}
          {selected !== null && <tr><td className="py-1.5 text-[#48484a]">Words in selection</td><td className="py-1.5 text-right font-semibold tabular-nums">{selected.split(/\s+/).filter(Boolean).length}</td></tr>}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-[#a1a1a6]">Counts include patient fields and exclude text marked as deleted.</p>
    </Dialog>
  );
}

export function SpellingDialog({ editor, onClose, toasts }) {
  const [spell, setSpell] = useState(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [replacement, setReplacement] = useState("");
  const [done, setDone] = useState(false);
  const ignored = useRef(new Set());
  const skipped = useRef(new Set());

  const next = (speller = spell) => {
    if (!speller) return;
    const list = misspellings(editor.state.doc, speller, ignored.current).filter((item) => !skipped.current.has(`${item.from}:${item.word}`));
    const head = editor.state.selection.from;
    const found = list.find((item) => item.from >= head) || list[0];
    if (!found) {
      setCurrent(null);
      setDone(true);
      return;
    }
    setDone(false);
    setCurrent(found);
    editor.chain().setTextSelection({ from: found.from, to: found.to }).scrollIntoView().run();
    const options = speller.suggest(found.word).slice(0, 8);
    setSuggestions(options);
    setReplacement(options[0] || found.word);
  };

  useEffect(() => {
    let cancel = false;
    loadSpeller().then((loaded) => {
      if (cancel) return;
      setSpell(loaded);
      next(loaded);
    }).catch((failure) => setError(failure.message));
    return () => { cancel = true; };
  }, []);

  const change = (all) => {
    if (!current || !replacement) return;
    if (all) {
      const matches = misspellings(editor.state.doc, spell, ignored.current).filter((item) => item.word === current.word).reverse();
      const tr = editor.state.tr;
      for (const item of matches) tr.insertText(replacement, item.from, item.to);
      editor.view.dispatch(tr);
      toasts.success(`Changed ${matches.length} occurrence${matches.length === 1 ? "" : "s"}.`);
    } else {
      editor.chain().insertContentAt({ from: current.from, to: current.to }, replacement).run();
    }
    window.setTimeout(() => next(), 0);
  };

  return (
    <Dialog title="Spelling" icon={SpellCheck} onClose={onClose} width={440} footer={<Button onClick={onClose}>Close</Button>}>
      {error && <p className="text-rose-700">{error}</p>}
      {!spell && !error && <p className="text-[#6e6e73]">Loading the English dictionary…</p>}
      {spell && done && <p className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> The spelling check is complete. No more unknown words were found.</p>}
      {spell && current && (
        <div className="grid gap-3">
          <div>
            <div className="text-[11.5px] text-[#6e6e73]">Not in dictionary</div>
            <div className="mt-0.5 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 font-semibold text-rose-800">{current.word}</div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <Field label="Change to"><input className="we-input w-full" value={replacement} onChange={(event) => setReplacement(event.target.value)} /></Field>
              <div className="mt-2 max-h-36 overflow-auto rounded border border-[#e5e5ea]">
                {suggestions.length === 0 && <p className="p-2 text-[11.5px] text-[#a1a1a6]">No suggestions.</p>}
                {suggestions.map((item) => (
                  <button key={item} type="button" className={`block w-full px-2 py-1 text-left ${replacement === item ? "bg-[#ede9fe]" : "hover:bg-[#f5f5f7]"}`} onClick={() => setReplacement(item)} onDoubleClick={() => { setReplacement(item); change(false); }}>{item}</button>
                ))}
              </div>
            </div>
            <div className="flex w-32 flex-col gap-1.5">
              <Button onClick={() => { skipped.current.add(`${current.from}:${current.word}`); next(); }}>Ignore once</Button>
              <Button onClick={() => { ignored.current.add(current.word.toLowerCase()); next(); }}>Ignore all</Button>
              <Button onClick={() => { addPersonalWord(spell, current.word); next(); }}>Add to dictionary</Button>
              <Button primary onClick={() => change(false)}>Change</Button>
              <Button onClick={() => change(true)}>Change all</Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ---------- templates ----------

export function TemplatesDialog({ templates, onReload, editor, study, canManage, onApplied, onClose, toasts, onSaveAs }) {
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(null);
  const [manageId, setManageId] = useState("");
  const modality = String(study?.modality || "").toUpperCase();
  const [scope, setScope] = useState(modality ? "study" : "all");
  const sorted = [...templates].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (a.modality || "").localeCompare(b.modality || "") || a.name.localeCompare(b.name));
  const visible = sorted.filter((template) => scope === "all" || !template.modality || template.modality === modality);

  async function run(label, action) {
    setBusy(label);
    try {
      await action();
    } catch (failure) {
      toasts.error(failure.message);
    } finally {
      setBusy("");
    }
  }

  function apply(template, mode) {
    if (mode === "replace") {
      if (!window.confirm(`Replace the whole report with the "${template.name}" template? You can undo this with Ctrl+Z.`)) return;
      editor.chain().focus().setContent(template.doc, true).run();
      onApplied(template, "replace");
    } else {
      const filled = applyTemplateFill(editor, template);
      if (!filled) {
        toasts.error("No empty sections in this report match the template's sections.");
        return;
      }
      onApplied(template, "fill", filled);
    }
    onClose();
  }

  return (
    <Dialog title="Report templates" icon={FileText} onClose={onClose} width={640} footer={<>
      {canManage && <Button onClick={onSaveAs}><Save className="h-3.5 w-3.5" /> Save this report</Button>}
      <Button onClick={onClose}>Close</Button>
    </>}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6e6e73]">This study</p>
          <p className="truncate text-[13px] font-semibold text-[#1d1d1f]">{study?.modality || "Any modality"} · {study?.description || "No description"}</p>
        </div>
        <div className="flex h-8 shrink-0 items-center rounded-lg border border-[#e5e5ea] bg-[#f2f2f7] p-0.5" role="tablist" aria-label="Template list">
          <button type="button" role="tab" aria-selected={scope === "study"} className={`h-7 rounded-md px-2.5 text-[12px] font-medium ${scope === "study" ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73]"}`} onClick={() => setScope("study")}>{modality || "Study"}</button>
          <button type="button" role="tab" aria-selected={scope === "all"} className={`h-7 rounded-md px-2.5 text-[12px] font-medium ${scope === "all" ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73]"}`} onClick={() => setScope("all")}>All</button>
        </div>
      </div>
      <ul className="grid gap-2">
        {visible.map((template) => (
          <li key={template._id} className="rounded-lg border border-[#e5e5ea] bg-white px-3 py-3">
            {editing?._id === template._id ? (
              <div className="grid gap-2">
                <input className="we-input w-full" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} aria-label="Template name" />
                <div className="grid grid-cols-[88px_1fr] gap-2">
                  <input className="we-input w-full" value={editing.modality || ""} onChange={(event) => setEditing({ ...editing, modality: event.target.value.toUpperCase() })} aria-label="Modality" placeholder="CT" />
                  <input className="we-input w-full" value={editing.description || ""} onChange={(event) => setEditing({ ...editing, description: event.target.value })} placeholder="Description" aria-label="Description" />
                </div>
                <input className="we-input w-full" value={(editing.keywords || []).join(", ")} onChange={(event) => setEditing({ ...editing, keywords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="Keywords, comma separated" aria-label="Keywords" />
                <div className="flex justify-end gap-1.5">
                  <Button disabled={Boolean(busy)} onClick={() => setEditing(null)}>Cancel</Button>
                  <Button primary disabled={Boolean(busy)} onClick={() => run("save", async () => {
                    await api(`/api/templates/${template._id}`, { method: "PATCH", body: { name: editing.name, description: editing.description || "", modality: editing.modality || "", keywords: editing.keywords || [] } });
                    setEditing(null);
                    await onReload();
                    toasts.success("Template updated.");
                  })}>Save</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13.5px] font-semibold text-[#1d1d1f]">{template.name}</span>
                      {template.isDefault && <span className="inline-flex items-center gap-1 rounded-full bg-[#f2f2f7] px-2 py-0.5 text-[11px] font-semibold text-[#1d1d1f]"><Star className="h-3 w-3 fill-[#1d1d1f] text-[#1d1d1f]" aria-hidden="true" />Default</span>}
                      {template.builtin && <span className="rounded-full bg-[#f2f2f7] px-2 py-0.5 text-[11px] font-medium text-[#6e6e73]">Built-in</span>}
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">{template.description || "Section structure only. No findings are filled in."}</p>
                    <p className="mt-1 text-[11.5px] text-[#a1a1a6]">{template.modality ? (modalityLabel(template.modality) !== template.modality ? `${template.modality} · ${modalityLabel(template.modality)}` : template.modality) : "Any modality"}{template.keywords?.length ? ` · ${template.keywords.join(", ")}` : ""} · {template.builtin ? "PACSD" : template.createdBy?.name || "Personal"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button disabled={!editor.isEditable || Boolean(busy)} onClick={() => apply(template, "fill")} title="Copy the template into sections that are still empty">Fill empty</Button>
                    <Button primary disabled={!editor.isEditable || Boolean(busy)} onClick={() => apply(template, "replace")}>Use</Button>
                  </div>
                </div>
                {canManage && manageId === template._id && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-[#f5f5f7] pt-2 text-[12px]">
                    <button type="button" className="text-[#3a3a3c] hover:text-[#1d1d1f] disabled:opacity-40" disabled={Boolean(busy)} onClick={() => run("duplicate", async () => {
                      const data = await api(`/api/templates/${template._id}/duplicate`, { method: "POST", body: { personal: true } });
                      await onReload();
                      toasts.success(`Duplicated as "${data.template.name}".`);
                    })}>Duplicate</button>
                    {template.canManage && (
                      <>
                        <button type="button" className="text-[#3a3a3c] hover:text-[#1d1d1f] disabled:opacity-40" disabled={Boolean(busy)} onClick={() => run("default", async () => {
                          await api(`/api/templates/${template._id}/default`, { method: "POST", body: { isDefault: !template.isDefault } });
                          await onReload();
                        })}>{template.isDefault ? "Unset default" : "Set default"}</button>
                        <button type="button" className="text-[#3a3a3c] hover:text-[#1d1d1f] disabled:opacity-40" disabled={Boolean(busy)} onClick={() => setEditing({ ...template })}>Edit</button>
                        <button type="button" className="text-[#3a3a3c] hover:text-[#1d1d1f] disabled:opacity-40" disabled={Boolean(busy)} title="Replace this template with the current report" onClick={() => run("content", async () => {
                          if (!window.confirm(`Replace the content of "${template.name}" with the current report? Patient data fields stay as fields.`)) return;
                          await api(`/api/templates/${template._id}`, { method: "PATCH", body: { doc: exportableDoc(editor.getJSON()) } });
                          await onReload();
                          toasts.success("Template content updated from this report.");
                        })}>Update from report</button>
                        <button type="button" className="text-[#9f1239] hover:underline disabled:opacity-40" disabled={Boolean(busy)} aria-label={`Delete ${template.name}`} onClick={() => run("delete", async () => {
                          if (!window.confirm(`Delete the "${template.name}" template?`)) return;
                          await api(`/api/templates/${template._id}`, { method: "DELETE" });
                          await onReload();
                          toasts.success("Template deleted.");
                        })}>Delete</button>
                      </>
                    )}
                  </div>
                )}
                {canManage && (
                  <button type="button" className="mt-2 text-[12px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]" onClick={() => setManageId(manageId === template._id ? "" : template._id)}>{manageId === template._id ? "Hide" : "Manage"}</button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {visible.length === 0 && <p className="py-8 text-center text-[13px] text-[#6e6e73]">{sorted.length === 0 ? "No templates are available." : `No ${modality || "study"} template yet. Show all templates, or save this report as one.`}</p>}
    </Dialog>
  );
}

export function SaveTemplateDialog({ editor, layout, study, facilityId, onSaved, onClose, toasts }) {
  const [name, setName] = useState(study?.description ? `${study.description}` : "");
  const [modality, setModality] = useState(String(study?.modality || "").toUpperCase());
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [clearText, setClearText] = useState(true);
  const [includeLayout, setIncludeLayout] = useState(true);
  const [makeDefault, setMakeDefault] = useState(false);
  const [personal, setPersonal] = useState(true);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (name.trim().length < 2) {
      toasts.error("Give the template a name of at least two characters.");
      return;
    }
    setBusy(true);
    try {
      const doc = templateFromDoc(exportableDoc(editor.getJSON()), { clearText });
      const data = await api("/api/templates", {
        method: "POST",
        body: {
          name: name.trim(),
          modality,
          description,
          keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean),
          doc,
          layout: includeLayout ? layout : null,
          isDefault: makeDefault,
          personal,
          facilityId: personal ? null : facilityId || null,
        },
      });
      toasts.success(`Saved the "${data.template.name}" template.`);
      await onSaved?.(data.template);
      onClose();
    } catch (failure) {
      toasts.error(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Save as template" icon={Save} onClose={onClose} width={480} footer={<><Button onClick={onClose}>Cancel</Button><Button primary disabled={busy} onClick={save}>{busy ? "Saving…" : "Save template"}</Button></>}>
      <div className="grid gap-3">
        <Field label="Template name"><input className="we-input w-full" value={name} onChange={(event) => setName(event.target.value)} data-autofocus /></Field>
        <div className="grid grid-cols-[100px_1fr] gap-3">
          <Field label="Modality"><input className="we-input w-full" value={modality} maxLength={8} onChange={(event) => setModality(event.target.value.toUpperCase())} placeholder="Any" /></Field>
          <Field label="Matches study descriptions containing" hint="Comma separated, for example: chest, thorax"><input className="we-input w-full" value={keywords} onChange={(event) => setKeywords(event.target.value)} /></Field>
        </div>
        <Field label="Description"><input className="we-input w-full" value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={clearText} onChange={(event) => setClearText(event.target.checked)} /> <span>Leave clinical history, comparison, findings, impression and recommendation empty<span className="block text-[11px] text-[#a1a1a6]">Recommended, so that this patient's findings are not copied into other reports. Patient fields are always kept as fields.</span></span></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={includeLayout} onChange={(event) => setIncludeLayout(event.target.checked)} /> Save the page layout, header and footer with the template</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={personal} onChange={(event) => setPersonal(event.target.checked)} /> Keep this template on my account</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} /> Use as the default template for {modality || "all"} studies</label>
      </div>
    </Dialog>
  );
}

// ---------- history ----------

const REASON_LABEL = { autosave: "Autosave", manual: "Saved", sign: "Signed", restore: "Restored", template: "Template applied" };

export function HistoryDialog({ reportId, fieldValues, canRestore, onRestore, onClose, toasts }) {
  const [revisions, setRevisions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const preview = useEditor({ extensions: reportExtensions({ paginate: false, placeholder: false }), editable: false, content: { type: "doc", content: [{ type: "paragraph" }] }, editorProps: { attributes: { class: "we-doc p-6" } } });

  useEffect(() => {
    api(`/api/reports/${reportId}/revisions`).then((data) => setRevisions(data.revisions)).catch((failure) => {
      setRevisions([]);
      toasts.error(failure.message);
    });
  }, [reportId]);

  useEffect(() => {
    if (!selected || !preview) return;
    let cancel = false;
    api(`/api/reports/${reportId}/revisions/${selected}`).then((data) => {
      if (cancel) return;
      setLoaded(data.revision);
      setFieldValues(preview, fieldValues);
      preview.commands.setContent(data.revision.doc, false);
    }).catch((failure) => toasts.error(failure.message));
    return () => { cancel = true; };
  }, [selected, preview]);

  return (
    <Dialog title="Version history" icon={History} onClose={onClose} width={980} footer={<>
      <span className="mr-auto text-[11.5px] text-[#6e6e73]">A version is kept every five minutes while you type, and whenever you save, restore, apply a template or sign.</span>
      <Button onClick={onClose}>Close</Button>
      <Button primary disabled={!loaded || !canRestore} onClick={() => {
        if (!window.confirm(`Restore revision ${loaded.revision} from ${formatDateTime(loaded.createdAt)}? The current text is kept in history.`)) return;
        onRestore(loaded);
        onClose();
      }}><RotateCcw className="h-3.5 w-3.5" /> Restore this version</Button>
    </>}>
      <div className="grid h-[62vh] grid-cols-[260px_1fr] gap-3">
        <div className="overflow-auto rounded border border-[#e5e5ea]">
          {revisions === null && <p className="p-3 text-[#a1a1a6]">Loading…</p>}
          {revisions?.length === 0 && <p className="p-3 text-[#a1a1a6]">No earlier versions are stored yet. One is kept when you save.</p>}
          {revisions?.map((item) => (
            <button key={item._id} type="button" className={`block w-full border-b border-[#f5f5f7] px-3 py-2 text-left ${selected === item._id ? "bg-[#ede9fe]" : "hover:bg-[#fafafa]"}`} onClick={() => setSelected(item._id)}>
              <div className="flex items-center gap-1.5 font-medium"><Clock3 className="h-3.5 w-3.5 text-[#6e6e73]" /> {formatDateTime(item.createdAt)}</div>
              <div className="text-[11.5px] text-[#6e6e73]">{REASON_LABEL[item.reason] || item.reason} · revision {item.revision} · {item.words} words</div>
              <div className="text-[11px] text-[#a1a1a6]">{item.savedBy?.name || "Unknown user"} · {item.status}</div>
            </button>
          ))}
        </div>
        <div className="overflow-auto rounded border border-[#e5e5ea] bg-[#fafafa]">
          {!selected && <p className="p-6 text-[#a1a1a6]">Choose a version to preview it.</p>}
          <div className={selected ? "mx-auto my-4 max-w-[760px] bg-white shadow" : "hidden"}><EditorContent editor={preview} /></div>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- output ----------

export function PrintPreviewDialog({ reportId, onClose, toasts, beforeExport }) {
  const [url, setUrl] = useState("");
  const frame = useRef(null);
  useEffect(() => {
    let cancel = false;
    beforeExport().then(() => {
      if (!cancel) setUrl(`/api/reports/${reportId}/pdf?preview=${Date.now()}`);
    });
    return () => { cancel = true; };
  }, []);
  const print = () => {
    try {
      frame.current?.contentWindow?.focus();
      frame.current?.contentWindow?.print();
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };
  const download = (kind) => downloadReport(reportId, kind).then((name) => toasts.success(`Downloaded ${name}.`)).catch((failure) => toasts.error(failure.message));
  return (
    <Dialog title="Print preview" icon={Printer} onClose={onClose} width={1100} footer={<>
      <span className="mr-auto text-[11.5px] text-[#6e6e73]">This is the PDF that will be printed, shared and attached when the report is finalized.</span>
      <Button onClick={() => download("docx")}>Download Word (.docx)</Button>
      <Button onClick={() => download("pdf")}>Download PDF</Button>
      <Button onClick={() => url && window.open(url, "_blank", "noopener")} disabled={!url}>Open in new tab</Button>
      <Button primary onClick={print} disabled={!url}><Printer className="h-3.5 w-3.5" /> Print</Button>
    </>}>
      <div className="h-[72vh] overflow-hidden rounded border border-[#e5e5ea] bg-[#525659]">
        {url ? <iframe ref={frame} title="Report PDF preview" src={url} className="h-full w-full" /> : <p className="p-6 text-white/80">Saving and rendering the report…</p>}
      </div>
    </Dialog>
  );
}

const DESIGNATIONS = [
  "Consultant Radiologist",
  "Senior Consultant Radiologist",
  "Associate Consultant Radiologist",
  "Radiologist",
  "Senior Resident, Radiology",
  "Junior Resident, Radiology",
];

const STYLE_LABEL = { typed: "Typed name", image: "Uploaded signature", drawn: "Drawn signature" };

function blankMethod(isDefault) {
  return {
    id: crypto.randomUUID(),
    label: "",
    designation: "Consultant Radiologist",
    qualifications: "",
    registrationNumber: "",
    style: "typed",
    signatureImage: "",
    isDefault,
  };
}

function SignaturePad({ onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);
  function point(event) {
    const canvas = ref.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }
  function down(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const ctx = ref.current.getContext("2d");
    const p = point(event);
    ctx.strokeStyle = "#1d1d1f";
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(event) {
    if (!drawing.current) return;
    const ctx = ref.current.getContext("2d");
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(ref.current.toDataURL("image/png"));
  }
  function clear() {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }
  return (
    <div className="grid gap-1">
      <canvas ref={ref} width={640} height={160} aria-label="Draw signature" className="h-24 w-full cursor-crosshair rounded-md border border-[#e5e5ea] bg-white touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <button type="button" className="justify-self-start text-[12px] text-[#3a3a3c] underline" onClick={clear}>Clear drawing</button>
    </div>
  );
}

function SignaturePreview({ name, method }) {
  return (
    <div className="rounded-md border border-[#e5e5ea] bg-[#fafafa] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6e6e73]">Appears under your name</p>
      {method?.style !== "typed" && method?.signatureImage && <img src={method.signatureImage} alt="" className="mt-2 max-h-12 max-w-[180px] object-contain" />}
      {method?.style === "typed" && <p className="mt-2 font-['Segoe_Script','Brush_Script_MT',cursive] text-[26px] leading-none text-[#1d1d1f]">{name || "Radiologist"}</p>}
      <p className="mt-2 text-[13px] font-semibold text-[#1d1d1f]">{name || "Radiologist"}</p>
      <p className="text-[12px] text-[#3a3a3c]">{method?.designation || "Consultant Radiologist"}</p>
      <p className="text-[12px] text-[#6e6e73]">{[method?.qualifications, method?.registrationNumber ? `Reg. ${method.registrationNumber}` : ""].filter(Boolean).join(" · ") || "Add qualifications and a registration number."}</p>
    </div>
  );
}

export function SignatureStudio({ toasts, selectedId, onSelect, onSaved }) {
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/api/me/report-profile").then((data) => {
      setProfile(data.profile);
      const methods = data.profile?.signatureMethods || [];
      const current = methods.find((item) => item.id === selectedId) || methods.find((item) => item.isDefault) || methods[0];
      if (current) onSelect?.(current.id);
    }).catch((failure) => toasts?.error(failure.message));
  }, []);
  const methods = profile?.signatureMethods || [];
  async function persist(nextMethods) {
    setBusy(true);
    try {
      const data = await api("/api/me/report-profile", { method: "PATCH", body: { signatureMethods: nextMethods } });
      setProfile(data.profile);
      setDraft(null);
      await onSaved?.(data.profile);
      toasts?.success(nextMethods.length ? "Signature saved. It is used only when you confirm Sign." : "Signature removed.");
      return data.profile;
    } catch (failure) {
      toasts?.error(failure.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft() {
    if (!draft?.label.trim()) {
      toasts?.error("Name this signature, for example Consultant signature.");
      return;
    }
    if (draft.style !== "typed" && !draft.signatureImage) {
      toasts?.error(draft.style === "drawn" ? "Draw the signature, or switch to a typed name." : "Choose a PNG or JPEG signature, or switch to a typed name.");
      return;
    }
    const others = methods.filter((item) => item.id !== draft.id).map((item) => ({ ...item, isDefault: draft.isDefault ? false : item.isDefault }));
    const saved = await persist([...others, { ...draft, label: draft.label.trim() }]);
    if (saved) onSelect?.(draft.id);
  }
  async function remove(id) {
    const remaining = methods.filter((item) => item.id !== id);
    if (remaining.length && !remaining.some((item) => item.isDefault)) remaining[0] = { ...remaining[0], isDefault: true };
    const saved = await persist(remaining);
    if (!saved) return;
    if (selectedId === id) onSelect?.(remaining.find((item) => item.isDefault)?.id || "");
  }
  function chooseImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      toasts?.error("Choose a PNG or JPEG image of your signature.");
      return;
    }
    if (file.size > 280_000) {
      toasts?.error("The signature image must be smaller than 280 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDraft((current) => ({ ...current, signatureImage: reader.result, style: "image" }));
    reader.readAsDataURL(file);
  }
  return (
    <div className="grid gap-3">
      <div>
        <p className="text-[12px] font-semibold text-[#1d1d1f]">Signature method</p>
        <p className="text-[12px] text-[#6e6e73]">Create the block a reporting radiologist uses. Your name stays the signed-in account. Creating a signature does not sign the report.</p>
      </div>
      {methods.length > 0 && (
        <div className="grid gap-1.5" role="radiogroup" aria-label="Signature method">
          {methods.map((method) => (
            <label key={method.id} className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 ${selectedId === method.id ? "border-[#1d1d1f] bg-[#fafafa]" : "border-[#e5e5ea]"}`}>
              <input type="radio" name="signature-method" className="mt-1" checked={selectedId === method.id} onChange={() => onSelect?.(method.id)} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-[#1d1d1f]">{method.label}{method.isDefault ? " · Default" : ""}</span>
                <span className="block text-[12px] text-[#6e6e73]">{method.designation} · {STYLE_LABEL[method.style] || "Typed name"}</span>
              </span>
              <button type="button" className="text-[12px] text-[#3a3a3c] underline" onClick={(event) => { event.preventDefault(); setDraft({ ...method }); }}>Edit</button>
              <button type="button" className="text-[12px] text-[#9f1239] underline" onClick={(event) => { event.preventDefault(); remove(method.id); }}>Delete</button>
            </label>
          ))}
        </div>
      )}
      {!draft && <Button onClick={() => setDraft(blankMethod(methods.length === 0))}>Create signature</Button>}
      {draft && (
        <div className="grid gap-3 rounded-md border border-[#e5e5ea] p-3">
          <Field label="Signature name" hint="Shown when you choose how to sign, for example Consultant signature.">
            <input className="we-input w-full" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="Consultant signature" />
          </Field>
          <Field label="Designation">
            <select className="we-input mb-1.5 w-full" aria-label="Common radiology designations" value={DESIGNATIONS.includes(draft.designation) ? draft.designation : ""} onChange={(event) => { if (event.target.value) setDraft({ ...draft, designation: event.target.value }); }}>
              <option value="">Choose a radiology designation</option>
              {DESIGNATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <input className="we-input w-full" value={draft.designation} onChange={(event) => setDraft({ ...draft, designation: event.target.value })} />
          </Field>
          <Field label="Qualifications" hint="For example MD, DNB (Radiodiagnosis).">
            <input className="we-input w-full" value={draft.qualifications} onChange={(event) => setDraft({ ...draft, qualifications: event.target.value })} />
          </Field>
          <Field label="Registration number">
            <input className="we-input w-full" value={draft.registrationNumber} onChange={(event) => setDraft({ ...draft, registrationNumber: event.target.value })} />
          </Field>
          <fieldset>
            <legend className="mb-1 text-[12px] font-semibold">How the signature looks</legend>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(STYLE_LABEL).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={draft.style === key} className={`h-8 rounded-md border px-2.5 text-[12.5px] ${draft.style === key ? "border-[#1d1d1f] bg-[#1d1d1f] text-white" : "border-[#e5e5ea] text-[#3a3a3c]"}`} onClick={() => setDraft({ ...draft, style: key, signatureImage: key === "typed" ? "" : draft.signatureImage })}>{label}</button>
              ))}
            </div>
          </fieldset>
          {draft.style === "image" && (
            <div className="flex items-center gap-3">
              <div className="grid h-16 w-44 place-items-center rounded-md border border-dashed border-[#d1d1d6] bg-white">
                {draft.signatureImage ? <img src={draft.signatureImage} alt="Uploaded signature" className="max-h-14 max-w-40 object-contain" /> : <span className="text-[11px] text-[#a1a1a6]">No image</span>}
              </div>
              <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-[#d1d1d6] px-3 text-[12.5px] hover:bg-[#f4f6f9]">Choose image<input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={chooseImage} /></label>
            </div>
          )}
          {draft.style === "drawn" && <SignaturePad onChange={(signatureImage) => setDraft((current) => ({ ...current, signatureImage }))} />}
          <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={draft.isDefault || methods.length === 0} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} /> Use this signature when I sign</label>
          <SignaturePreview name={profile?.name} method={draft} />
          <div className="flex gap-2">
            <Button primary disabled={busy} onClick={saveDraft}>{busy ? "Saving…" : methods.some((item) => item.id === draft.id) ? "Save signature" : "Create signature"}</Button>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {!draft && selectedId && <SignaturePreview name={profile?.name} method={methods.find((item) => item.id === selectedId)} />}
    </div>
  );
}

export function FinalizeDialog({ editor, accession, level: initialLevel, onSign, onClose, openPanel, checkOnly, toasts }) {
  const [level, setLevel] = useState(initialLevel || "final");
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signatureMethodId, setSignatureMethodId] = useState("");
  const doc = editor.getJSON();
  const sections = extractSections(doc, editor.storage.dataField.values);
  const problems = finalizationProblems(doc);
  const checks = [
    { ok: Boolean(sections.findings), label: "FINDINGS has text", action: null },
    { ok: Boolean(sections.impression), label: "IMPRESSION has text", action: null },
    { ok: !problems.some((item) => item.includes("AI suggestion")), label: problems.find((item) => item.includes("AI suggestion")) || "No AI suggestions are waiting for review", action: () => openPanel("ai") },
    { ok: !problems.some((item) => item.includes("Tracked")), label: problems.find((item) => item.includes("Tracked")) || "No tracked changes are pending", action: () => openPanel("changes") },
    { ok: !problems.some((item) => item.includes("comment")), label: problems.find((item) => item.includes("comment")) || "No comments are open", action: () => openPanel("comments") },
  ];
  const ready = checks.every((item) => item.ok);
  const canSign = ready && (level === "preliminary" || attest);
  return (
    <Dialog title={checkOnly ? "Check report" : "Sign report"} icon={FileSignature} onClose={onClose} width={560} footer={<>
      <Button onClick={onClose}>{checkOnly ? "Close" : "Cancel"}</Button>
      {!checkOnly && <Button primary disabled={!canSign || busy} onClick={async () => { setBusy(true); const ok = await onSign(level, signatureMethodId); setBusy(false); if (ok) onClose(); }}>{busy ? "Signing…" : level === "final" ? "Sign and finalize" : "Sign as preliminary"}</Button>}
    </>}>
      <ul className="grid gap-1.5">
        {checks.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            {item.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-rose-600" />}
            <span className={item.ok ? "" : "font-medium text-rose-800"}>{item.label}</span>
            {!item.ok && item.action && <button type="button" className="ml-auto text-[11.5px] font-medium text-[#7c3aed] underline" onClick={() => { item.action(); onClose(); }}>Review</button>}
          </li>
        ))}
      </ul>
      {!checkOnly && <div className="mt-4"><SignatureStudio toasts={toasts} selectedId={signatureMethodId} onSelect={setSignatureMethodId} /></div>}
      {!checkOnly && (
        <>
          <fieldset className="mt-4 grid gap-1.5">
            <legend className="mb-1 text-[12px] font-semibold">Signature</legend>
            <label className="flex items-start gap-2"><input type="radio" name="level" className="mt-0.5" checked={level === "preliminary"} onChange={() => setLevel("preliminary")} /> <span>Pending signature<span className="block text-[11px] text-[#6e6e73]">Visible to referring physicians. You can still edit it. The signature is your authenticated account.</span></span></label>
            <label className="flex items-start gap-2"><input type="radio" name="level" className="mt-0.5" checked={level === "final"} onChange={() => setLevel("final")} /> <span>Finalize<span className="block text-[11px] text-[#6e6e73]">Locks this version and stores the signed PDF and Word file{accession ? ` for accession ${accession}` : ""}. A signature image is only a visual mark. The electronic signature is your signed-in identity. Later changes require an amendment.</span></span></label>
          </fieldset>
          {level === "final" && (
            <label className="mt-3 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-900">
              <input type="checkbox" className="mt-0.5" checked={attest} onChange={(event) => setAttest(event.target.checked)} />
              I have reviewed the images and every part of this report, including any text drafted with AI, and I take responsibility for its content.
            </label>
          )}
        </>
      )}
      {!ready && <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-[#6e6e73]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-amber-500" /> Resolve the items above before signing. The server applies the same checks.</p>}
    </Dialog>
  );
}

export function ShareDialog({ reportId, status, patient, onClose, toasts, initialChannel = "link" }) {
  const [channel, setChannel] = useState(initialChannel);
  const [recipient, setRecipient] = useState("");
  const [countryCode, setCountryCode] = useState(patient?.countryCode || "+91");
  const [subject, setSubject] = useState("Radiology report");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(Boolean(patient?.reportingConsent));
  const [hours, setHours] = useState(72);
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const signed = status === "preliminary" || status === "final";
  useEffect(() => {
    if (channel === "email") setRecipient(patient?.email || "");
    if (channel === "whatsapp") setRecipient(patient?.phone || "");
  }, [channel, patient?.email, patient?.phone]);
  useEffect(() => {
    api(`/api/reports/${reportId}/deliveries`).then((data) => setHistory(data.deliveries || [])).catch(() => setHistory([]));
  }, [reportId]);
  async function share() {
    setBusy(true);
    setNote("");
    try {
      if (channel !== "link") {
        await api(`/api/reports/${reportId}/contact`, { method: "PATCH", body: { email: channel === "email" ? recipient : undefined, phone: channel === "whatsapp" ? recipient : undefined, countryCode, consent } });
      }
      const data = await api(`/api/reports/${reportId}/share`, {
        method: "POST",
        body: { channel, recipient: channel === "link" ? undefined : recipient, countryCode, subject, message, consent: channel === "link" ? undefined : consent, expiresInHours: hours || 72 },
      });
      setLink(data.link || "");
      if (data.fallback === "web" && data.waUrl) {
        window.open(data.waUrl, "_blank", "noopener");
        setNote("WhatsApp was opened in the browser. The PDF was not attached and was not sent by the server.");
        toasts.success("WhatsApp Web opened. The PDF was not sent.");
      } else if (data.fbUrl) {
        window.open(data.fbUrl, "_blank", "noopener");
        setNote("Facebook was opened with the secure link. The PDF was not posted to Facebook.");
        toasts.success("Facebook opened. The PDF was not posted.");
      } else if (data.attachmentSent) {
        setNote(data.delivery === "sent" ? "Sent with the PDF attached." : "Delivery recorded.");
        toasts.success("Sent with the PDF attached.");
      } else if (data.delivery === "sent") {
        setNote(data.detail || "The message was sent. The PDF was not attached.");
        toasts.success("Message sent. The PDF was not attached.");
      } else if (channel === "link") {
        if (navigator.clipboard) await navigator.clipboard.writeText(data.link).catch(() => {});
        toasts.success("Secure link copied.");
      }
      const deliveries = await api(`/api/reports/${reportId}/deliveries`);
      setHistory(deliveries.deliveries || []);
    } catch (failure) {
      if (failure.data?.waUrl) window.open(failure.data.waUrl, "_blank", "noopener");
      if (failure.data?.link) setLink(failure.data.link);
      toasts.error(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function retry(id) {
    try {
      const data = await api(`/api/shares/${id}/retry`, { method: "POST", body: {} });
      if (data.fallback === "web" && data.waUrl) {
        window.open(data.waUrl, "_blank", "noopener");
        toasts.success("WhatsApp Web opened again. The PDF was not sent.");
      } else if (data.fbUrl) {
        window.open(data.fbUrl, "_blank", "noopener");
        toasts.success("Facebook opened again. The PDF was not posted.");
      } else if (data.attachmentSent) toasts.success("Delivery retried with the PDF attached.");
      else toasts.success(data.detail || "Delivery retried.");
      setHistory((await api(`/api/reports/${reportId}/deliveries`)).deliveries || []);
    } catch (failure) {
      if (failure.data?.waUrl) window.open(failure.data.waUrl, "_blank", "noopener");
      toasts.error(failure.message);
    }
  }
  const options = [["link", "Copy link", Link2], ["email", "Email", Mail], ["whatsapp", "WhatsApp", MessageCircle], ["facebook", "Facebook", Share2]];
  const needsRecipient = channel === "email" || channel === "whatsapp";
  return (
    <Dialog title="Share report" icon={Share2} onClose={onClose} width={560} footer={<><Button onClick={onClose}>Close</Button><Button primary disabled={!signed || busy || (needsRecipient && !recipient.trim()) || (channel !== "link" && !consent)} onClick={share}>{busy ? "Sharing…" : "Share"}</Button></>}>
      {!signed && <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">Sign the report before sharing it.</p>}
      <div className="grid grid-cols-4 gap-2">
        {options.map(([key, label, Icon]) => (
          <button key={key} type="button" aria-pressed={channel === key} className={`flex flex-col items-center gap-1 rounded border p-2 ${channel === key ? "border-[#7c3aed] bg-[#f5f3ff]" : "border-[#e5e5ea]"}`} onClick={() => setChannel(key)}><Icon className="h-4 w-4 text-[#7c3aed]" /> {label}</button>
        ))}
      </div>
      {channel === "whatsapp" && (
        <div className="mt-3 grid grid-cols-[90px_1fr] gap-2">
          <Field label="Country"><input className="we-input w-full" value={countryCode} onChange={(event) => setCountryCode(event.target.value)} /></Field>
          <Field label="Mobile number"><input className="we-input w-full" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="9800000000" /></Field>
        </div>
      )}
      {channel === "email" && <Field label="Email address" className="mt-3"><input className="we-input w-full" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="name@example.org" /></Field>}
      {channel === "email" && <Field label="Subject" className="mt-3"><input className="we-input w-full" value={subject} onChange={(event) => setSubject(event.target.value)} /></Field>}
      {channel === "facebook" && <p className="mt-3 rounded border border-[#ede9fe] bg-[#f8fbff] p-2 text-[12px] text-[#5b21b6]">Facebook opens with the secure link. The PDF is not posted on Facebook.</p>}
      {channel !== "link" && <Field label="Message" className="mt-3"><textarea className="we-input h-20 w-full" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Leave blank for the standard message. A secure link is added." /></Field>}
      {channel !== "link" && <label className="mt-3 flex items-start gap-2 text-[12.5px]"><input type="checkbox" className="mt-0.5" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> The patient has consented to receive this report by {channel === "email" ? "email" : channel === "facebook" ? "Facebook" : "WhatsApp"}.</label>}
      <Field label="Link expires after" className="mt-3"><NumberInput value={hours} onChange={setHours} min={1} max={336} suffix="hours" /></Field>
      {note && <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-950">{note}</p>}
      {link && (
        <div className="mt-3 flex items-center gap-2 rounded border border-[#e5e5ea] bg-[#fafafa] p-2">
          <input className="we-input flex-1" readOnly value={link} onFocus={(event) => event.target.select()} aria-label="Share link" />
          <Button onClick={() => navigator.clipboard?.writeText(link).then(() => toasts.success("Copied."))}>Copy</Button>
        </div>
      )}
      {history.length > 0 && (
        <div className="mt-3">
          <h3 className="text-[12px] font-semibold">Delivery history</h3>
          <ul className="mt-1 max-h-32 overflow-auto text-[12px]">
            {history.map((item) => (
              <li key={item._id} className="flex items-center gap-2 border-t border-[#f5f5f7] py-1">
                <span className="w-16 capitalize">{item.channel}</span>
                <span className="min-w-0 flex-1 truncate">{item.recipient || "Link"} · {item.attachmentSent ? "PDF attached" : item.delivery}</span>
                {(item.delivery === "failed" || item.delivery === "not_sent") && <Button onClick={() => retry(item._id)}>Retry</Button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

export function ProfileDialog({ onClose, onSaved, toasts }) {
  return (
    <Dialog title="Radiologist signature" icon={UserRound} onClose={onClose} width={560} footer={<Button onClick={onClose}>Close</Button>}>
      <SignatureStudio toasts={toasts} onSaved={onSaved} />
    </Dialog>
  );
}

export const SHORTCUTS = [
  ["Save", "Ctrl+S"], ["Print preview", "Ctrl+P"], ["Find", "Ctrl+F"], ["Replace", "Ctrl+H"], ["Undo / Redo", "Ctrl+Z / Ctrl+Y"],
  ["Bold / Italic / Underline", "Ctrl+B / Ctrl+I / Ctrl+U"], ["Strikethrough", "Ctrl+Shift+S"], ["Subscript / Superscript", "Ctrl+= / Ctrl+Shift+="],
  ["Grow / shrink font", "Ctrl+] / Ctrl+["], ["Clear character formatting", "Ctrl+Space"], ["Align left / centre / right / justify", "Ctrl+L / E / R / J"],
  ["Line spacing 1 / 1.5 / 2", "Ctrl+1 / Ctrl+5 / Ctrl+2"], ["Increase / decrease indent", "Ctrl+M / Ctrl+Shift+M"], ["Bulleted / numbered list", "Ctrl+Shift+8 / Ctrl+Shift+7"],
  ["Copy / paste formatting", "Ctrl+Shift+C / Ctrl+Shift+V"], ["Insert hyperlink", "Ctrl+K"], ["Page break", "Ctrl+Enter"], ["New comment", "Ctrl+Alt+M"],
  ["Track changes", "Ctrl+Shift+E"], ["Spelling", "F7"], ["Next table cell", "Tab"], ["Zoom in / out", "Ctrl+Alt+= / Ctrl+Alt+-"],
];

export function ShortcutsDialog({ onClose }) {
  return (
    <Dialog title="Keyboard shortcuts" icon={Keyboard} onClose={onClose} width={560} footer={<Button primary onClick={onClose}>Close</Button>}>
      <table className="w-full text-[12px]">
        <tbody>
          {SHORTCUTS.map(([label, keys]) => (
            <tr key={label} className="border-b border-[#f5f5f7]"><td className="py-1.5 text-[#48484a]">{label}</td><td className="py-1.5 text-right font-mono text-[11.5px] text-[#111827]">{keys}</td></tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

export function ConflictDialog({ conflict, onReload, onOverwrite }) {
  return (
    <Dialog title="This report changed somewhere else" icon={AlertTriangle} onClose={onReload} width={480} footer={<><Button onClick={onOverwrite}>Keep my version</Button><Button primary onClick={onReload}>Load the latest version</Button></>}>
      <p>{conflict.updatedBy || "Another user or window"} saved revision {conflict.revision}{conflict.updatedAt ? ` at ${formatDateTime(conflict.updatedAt)}` : ""} after you opened it. Your edits here have not been saved.</p>
      <p className="mt-2 text-[#6e6e73]">Loading the latest version replaces your unsaved edits (they stay in this computer's backup until then). Keeping your version saves it over the other copy; the other copy remains in version history.</p>
    </Dialog>
  );
}

export function FilesDialog({ reportId, artifacts, onClose, toasts }) {
  const download = (file) => downloadFile(`/api/reports/${reportId}/files/${file._id}`, file.fileName).catch((failure) => toasts.error(failure.message));
  return (
    <Dialog title="Signed files attached to this study" icon={FileSignature} onClose={onClose} width={560} footer={<Button primary onClick={onClose}>Close</Button>}>
      {artifacts.length === 0 && <p className="text-[#a1a1a6]">Files are attached when the report is signed final.</p>}
      <ul className="grid gap-2">
        {artifacts.map((file) => (
          <li key={file._id} className="flex items-center gap-3 rounded border border-[#e5e5ea] p-2">
            <FileText className="h-5 w-5 text-[#7c3aed]" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{file.fileName}</div>
              <div className="text-[11px] text-[#6e6e73]">{file.kind.toUpperCase()} · {file.status} · version {file.reportVersion} · {formatDateTime(file.createdAt)} · {file.mrn} / {file.accession}</div>
              <div className="truncate font-mono text-[10px] text-[#a1a1a6]" title="SHA-256">{file.sha256}</div>
            </div>
            <Button onClick={() => download(file)}>Download</Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
