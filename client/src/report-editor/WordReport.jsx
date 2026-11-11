import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useEditor } from "@tiptap/react";
import { Mic, Upload, ZoomIn, ZoomOut } from "lucide-react";
import Logo from "../logo.jsx";
import {
  defaultLayout,
  fillTokens,
  headerFooterTokens,
  normalizeLayout,
  radiologistBlock,
  resolveFieldValues,
  statusLabel,
} from "../../../shared/reportDocument.js";
import { imagingContext } from "../../../shared/dictation/context.js";
import { formatRadiologyReport } from "../../../shared/dictation/format.js";
import { suggestCodes } from "../../../shared/dictation/coding.js";
import { reviewTranscript } from "../../../shared/dictation/review.js";
import { searchVocabulary } from "../../../shared/dictation/vocabulary.js";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useToasts } from "../feedback.jsx";
import {
  BorderDialog,
  ConflictDialog,
  DateTimeDialog,
  FilesDialog,
  FinalizeDialog,
  HeaderFooterDialog,
  HistoryDialog,
  PageSetupDialog,
  ParagraphDialog,
  PrintPreviewDialog,
  ProfileDialog,
  ShareDialog,
  ShortcutsDialog,
  SpellingDialog,
  TableDialog,
  TemplatesDialog,
  SaveTemplateDialog,
} from "./dialogs.jsx";
import { FindPanel, NavigationPane } from "./panels.jsx";
import DictationDock from "./DictationDock.jsx";
import { applyDictation, createDictation, insertStructuredReport, replaceSpokenTerm, speechSupported } from "./dictation.js";
import { initialDocument, insertImage, insertSection, listSections, scrollToPos } from "./documentUtils.js";
import { documentFromFile } from "./importReport.js";
import "./editor.css";
import { reportExtensions } from "./extensions/index.js";
import { setFieldValues } from "./extensions/schema.js";
import { PageStack, Ruler, pageGeometry } from "./PageCanvas.jsx";
import { DEFAULT_SHORTCUTS, PhrasesDialog, expandShortcut } from "./phrases.jsx";
import Ribbon, { FormatStrip } from "./ribbon.jsx";
import { readBackup } from "./useAutosave.js";
import { useAutosave } from "./useAutosave.js";
import { Button } from "./ui.jsx";

const SAVE_LABEL = {
  saved: "Saved",
  saving: "Saving…",
  dirty: "Unsaved changes",
  offline: "Offline — will retry",
  conflict: "Saved elsewhere",
  error: "Save failed",
};

function jumpSection(editor, direction) {
  const items = listSections(editor.state.doc);
  if (!items.length) return;
  const pos = editor.state.selection.from;
  if (direction > 0) {
    const next = items.find((item) => item.pos > pos) || items[0];
    scrollToPos(editor, next.pos);
    return;
  }
  const previous = [...items].reverse().find((item) => item.pos < pos) || items[items.length - 1];
  scrollToPos(editor, previous.pos);
}

export default function WordReport({ reportId, embedded = false, onReportChange }) {
  const { user } = useAuth();
  const toasts = useToasts();
  const canvasRef = useRef(null);
  const stackRef = useRef(null);
  const dictationRef = useRef(null);
  const shortcutsRef = useRef(DEFAULT_SHORTCUTS);
  const [bundle, setBundle] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
  const [layout, setLayout] = useState(defaultLayout());
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState(embedded ? 0.72 : 1);
  const zoomMode = useRef("fit");
  const [formatOpen, setFormatOpen] = useState(!embedded);
  const [tab, setTab] = useState("home");
  const [panel, setPanel] = useState("");
  const [dialog, setDialog] = useState("");
  const [shareChannel, setShareChannel] = useState("link");
  const [missing, setMissing] = useState(false);
  const [recovery, setRecovery] = useState(null);
  const [listening, setListening] = useState(false);
  const [paused, setPaused] = useState(false);
  const [interim, setInterim] = useState("");
  const [pending, setPending] = useState(false);
  const [dictationOpen, setDictationOpen] = useState(false);
  const [speechInfo, setSpeechInfo] = useState(null);
  const [vocabulary, setVocabulary] = useState([]);
  const [rawSession, setRawSession] = useState("");
  const [cleanSession, setCleanSession] = useState("");
  const [clips, setClips] = useState([]);
  const [impressionOverride, setImpressionOverride] = useState("");
  const [selectedCodes, setSelectedCodes] = useState({});
  const [lang, setLang] = useState("en-IN");
  const [priors, setPriors] = useState(null);
  const layoutRef = useRef(layout);
  const bundleRef = useRef(null);
  const langRef = useRef(lang);
  const rawRef = useRef("");
  const cleanRef = useRef("");
  const levelRef = useRef(() => {});
  const applyPayloadRef = useRef(() => {});
  layoutRef.current = layout;
  shortcutsRef.current = shortcuts;
  bundleRef.current = bundle;
  langRef.current = lang;

  const editor = useEditor({
    extensions: reportExtensions({ onPages: setPages }),
    content: { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: { attributes: { class: "we-doc", spellcheck: "true", "aria-label": "Radiology report" } },
  });

  const autosave = useAutosave({
    editor,
    reportId,
    revision: bundle?.report?.revision || 0,
    enabled: Boolean(bundle?.permissions?.edit && editor),
    getLayout: () => layoutRef.current,
    onSaved: (report) => setBundle((current) => (current ? { ...current, report: { ...current.report, ...report, doc: current.report.doc, layout: current.report.layout } } : current)),
  });

  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;
  const readyRef = useRef(false);
  const applyingRef = useRef(false);

  useEffect(() => {
    if (!editor) return undefined;
    const onUpdate = () => {
      if (!readyRef.current || applyingRef.current) return;
      autosaveRef.current.markChanged();
    };
    editor.on("update", onUpdate);
    return () => editor.off("update", onUpdate);
  }, [editor]);

  useEffect(() => {
    if (!editor || !reportId) return undefined;
    let cancel = false;
    readyRef.current = false;
    setMissing(false);
    setBundle(null);
    Promise.all([
      api(`/api/reports/${reportId}`),
      api("/api/templates").catch(() => ({ templates: [] })),
      api("/api/me/report-shortcuts").catch(() => ({ shortcuts: DEFAULT_SHORTCUTS })),
    ]).then(([data, templateData, shortcutData]) => {
      if (cancel || editor.isDestroyed) return;
      const nextTemplates = templateData.templates || [];
      const nextShortcuts = shortcutData.shortcuts?.length ? shortcutData.shortcuts : DEFAULT_SHORTCUTS;
      const initial = initialDocument({
        report: data.report,
        study: data.study,
        templates: nextTemplates,
        extensions: editor.extensionManager.extensions,
      });
      const backup = readBackup(reportId);
      setBundle(data);
      setTemplates(nextTemplates);
      setShortcuts(nextShortcuts);
      setLayout(normalizeLayout(data.report.layout || initial.template?.layout));
      applyingRef.current = true;
      editor.commands.setContent(initial.doc, false);
      setFieldValues(editor, resolveFieldValues(data));
      applyingRef.current = false;
      editor.setEditable(Boolean(data.permissions?.edit));
      autosaveRef.current.reset(data.report.revision || 0);
      readyRef.current = true;
      if (backup?.doc && (!data.report.updatedAt || new Date(backup.savedAt) > new Date(data.report.updatedAt))) setRecovery(backup);
      if (initial.source !== "stored" && data.permissions?.edit) autosaveRef.current.markChanged();
    }).catch((error) => {
      if (!cancel) {
        setMissing(true);
        toasts.error(error.message);
      }
    });
    return () => { cancel = true; readyRef.current = false; };
  }, [editor, reportId, toasts]);

  useEffect(() => {
    if (!editor || !bundle) return;
    setFieldValues(editor, resolveFieldValues(bundle));
  }, [editor, bundle]);

  useEffect(() => {
    if (!editor || !bundle) return undefined;
    let node;
    try { node = editor.view.dom; } catch { return undefined; }
    const onKey = (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        autosaveRef.current.flush("manual").then((ok) => { if (ok) toasts.success("Report saved."); });
      } else if (mod && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setDialog("print");
      } else if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setPanel("find");
      } else if (mod && event.key.toLowerCase() === "h") {
        event.preventDefault();
        setPanel("replace");
      } else if (mod && event.key.toLowerCase() === "a" && event.shiftKey) {
        event.preventDefault();
        editor.chain().focus().selectAll().run();
      } else if (event.key === "F7") {
        event.preventDefault();
        setDialog("spelling");
      } else if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        jumpSection(editor, event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === " " && !mod && !event.altKey) {
        if (expandShortcut(editor, shortcutsRef.current)) event.preventDefault();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [editor, bundle, toasts]);

  useEffect(() => () => {
    dictationRef.current?.stop();
    clipsRef.current.forEach((clip) => URL.revokeObjectURL(clip.audioUrl));
  }, []);

  useEffect(() => {
    api("/api/system/status").then((status) => setSpeechInfo({ configured: Boolean(status.speech), model: status.speechModel || "" })).catch(() => {});
  }, []);

  useEffect(() => {
    if (!bundle?.study) return undefined;
    const params = new URLSearchParams({
      modality: bundle.study.modality || "",
      description: bundle.study.description || "",
      limit: "120",
    });
    api(`/api/vocabulary?${params.toString()}`).then((data) => setVocabulary(data.terms || [])).catch(() => {});
    return undefined;
  }, [bundle?.study?._id, bundle?.study?.modality, bundle?.study?.description]);

  const fields = useMemo(() => (bundle ? resolveFieldValues(bundle) : {}), [bundle]);
  const tokens = useMemo(() => headerFooterTokens(fields), [fields]);
  const readOnly = bundle ? !bundle.permissions?.edit : true;
  const report = bundle?.report;
  const geometry = pageGeometry(layout);

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    let dom;
    try { dom = editor.view.dom; } catch { return undefined; }
    dom.style.boxSizing = "border-box";
    dom.style.width = `${geometry.width}px`;
    dom.style.paddingTop = `${geometry.margins.top}px`;
    dom.style.paddingRight = `${geometry.margins.right}px`;
    dom.style.paddingBottom = `${geometry.margins.bottom}px`;
    dom.style.paddingLeft = `${geometry.margins.left}px`;
    const pagination = editor.storage.pagination;
    if (pagination) {
      pagination.geometry = {
        paddingTop: geometry.margins.top,
        contentHeight: geometry.contentHeight,
        pitch: geometry.pitch,
      };
      pagination.schedule?.();
    }
    return undefined;
  }, [editor, geometry.width, geometry.contentHeight, geometry.pitch, geometry.margins.top, geometry.margins.right, geometry.margins.bottom, geometry.margins.left]);

  const fitPage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const available = Math.max(240, canvas.clientWidth - (embedded ? 12 : 72));
    const cap = embedded ? 1.22 : 1.05;
    const next = Math.min(cap, Math.max(0.35, available / geometry.width));
    setZoom(Math.round(next * 100) / 100);
  }, [embedded, geometry.width]);

  useLayoutEffect(() => {
    if (!bundle) return undefined;
    if (zoomMode.current === "fit") fitPage();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => { if (zoomMode.current === "fit") fitPage(); });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fitPage, bundle]);

  function fill(template, page, pageCount) {
    return fillTokens(template, tokens).replaceAll("{PAGE}", String(page)).replaceAll("{PAGES}", String(pageCount));
  }

  function updateLayout(next) {
    setLayout((current) => normalizeLayout({
      ...current,
      ...next,
      margins: { ...current.margins, ...(next.margins || {}) },
      header: { ...current.header, ...(next.header || {}) },
      footer: { ...current.footer, ...(next.footer || {}) },
      border: { ...current.border, ...(next.border || {}) },
    }));
    if (!readOnly) autosave.markChanged();
  }

  async function paste() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes("text/html")) {
          const html = await (await item.getType("text/html")).text();
          editor.chain().focus().insertContent(html).run();
          return;
        }
      }
      const text = await navigator.clipboard.readText();
      editor.chain().focus().insertContent(text).run();
    } catch {
      toasts.error("The browser blocked paste. Use Ctrl+V inside the page.");
    }
  }

  async function insertLogo() {
    const response = await fetch("/gms-logo.png");
    if (!response.ok) {
      toasts.error("The hospital logo file is not available.");
      return;
    }
    const blob = await response.blob();
    const src = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    insertImage(editor, { src, width: 180, height: 48, alt: "Galactic Medical Systems" }, geometry.contentWidth);
  }

  const clipsRef = useRef([]);
  clipsRef.current = clips;
  const subscribeLevel = useCallback((listener) => { levelRef.current = listener; }, []);

  function ensureDictation() {
    if (!dictationRef.current) {
      dictationRef.current = createDictation({
        lang,
        getContext: () => ({
          modality: bundleRef.current?.study?.modality || "",
          description: bundleRef.current?.study?.description || "",
        }),
        transcribe: async (blob, meta) => {
          const body = new FormData();
          body.append("audio", blob, "dictation.wav");
          body.append("language", meta.language || langRef.current);
          body.append("modality", meta.modality || "");
          body.append("description", meta.description || "");
          setPending(true);
          try {
            return await api("/api/speech/transcribe", { method: "POST", body });
          } finally {
            setPending(false);
          }
        },
        onFinal: (payload) => applyPayloadRef.current(payload),
        onClip: (clip) => setClips((current) => [...current, clip].slice(-8)),
        onInterim: setInterim,
        onState: ({ listening: next, paused: isPaused }) => {
          setListening(next);
          setPaused(isPaused);
          if (next) setDictationOpen(true);
        },
        onError: (message) => toasts.error(message),
        onLevel: (value) => levelRef.current(value),
      });
    }
    return dictationRef.current;
  }

  applyPayloadRef.current = (payload) => {
    if (!payload || !editor) return;
    applyDictation(editor, payload, {
      nextSection: () => jumpSection(editor, 1),
      stop: () => window.setTimeout(() => dictationRef.current?.stop(), 0),
      resume: () => dictationRef.current?.resume(),
    });
    if (payload.originalText) {
      rawRef.current = `${rawRef.current} ${payload.originalText}`.trim();
      setRawSession(rawRef.current);
    }
    if (payload.text) {
      cleanRef.current = `${cleanRef.current} ${payload.text}`.trim();
      setCleanSession(cleanRef.current);
    }
    setImpressionOverride("");
    if (payload.originalText) {
      api(`/api/reports/${reportId}/dictation`, {
        method: "POST",
        body: {
          originalText: payload.originalText,
          text: payload.text || "",
          language: langRef.current,
          model: payload.model || "",
          contextKey: payload.context?.key || "",
        },
      }).catch(() => {});
    }
  };

  async function toggleDictation() {
    if (!speechSupported()) {
      setDictationOpen(true);
      setDialog("transcribe");
      return;
    }
    const session = ensureDictation();
    if (!listening) await session.start();
    else await session.stop();
  }

  async function uploadAudio(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toasts.error("Audio must be 8 MB or smaller.");
      return;
    }
    const body = new FormData();
    body.append("audio", file);
    body.append("language", lang);
    body.append("modality", bundle?.study?.modality || "");
    body.append("description", bundle?.study?.description || "");
    try {
      setPending(true);
      const data = await api("/api/speech/transcribe", { method: "POST", body });
      applyPayloadRef.current(data);
      setClips((current) => [...current, { audioUrl: URL.createObjectURL(file), text: data.originalText || "" }].slice(-8));
      toasts.success("Transcribed audio was inserted at the cursor. Review it before signing.");
      setDialog("");
      setDictationOpen(true);
    } catch (error) {
      toasts.error(error.message);
    } finally {
      setPending(false);
    }
  }

  async function sign(level, signatureMethodId) {
    const saved = await autosave.flush("manual");
    if (!saved) return false;
    try {
      const data = await api(`/api/reports/${reportId}/sign`, { method: "POST", body: { level, ...(signatureMethodId ? { signatureMethodId } : {}) } });
      const next = await api(`/api/reports/${reportId}`);
      setBundle(next);
      editor.setEditable(Boolean(next.permissions?.edit));
      autosave.reset(data.report.revision || next.report.revision || 0);
      toasts.success(level === "final" ? "Report signed and finalized. The signed copy is locked." : "Report marked pending signature.");
      return true;
    } catch (error) {
      toasts.error(error.message);
      return false;
    }
  }

  async function amend() {
    try {
      const data = await api(`/api/reports/${reportId}/addendum`, { method: "POST", body: {} });
      toasts.success("An amendment draft was created. The signed report was not changed.");
      if (onReportChange) onReportChange(data.report._id);
      else window.location.assign(`/reports/${data.report._id}`);
    } catch (error) {
      toasts.error(error.message);
    }
  }

  async function openPriors() {
    setDialog("priors");
    try {
      const data = await api(`/api/reports/${reportId}/priors`);
      setPriors(data.priors || []);
    } catch (error) {
      setPriors([]);
      toasts.error(error.message);
    }
  }

  function insertPrior(prior) {
    const sentence = `Compared with ${prior.modality || "the prior study"} ${prior.studyDate || ""} accession ${prior.accession}. ${prior.impression || ""}`.trim();
    const section = insertSection(editor, "comparison");
    if (!section) {
      const items = listSections(editor.state.doc).find((item) => item.key === "comparison");
      if (items) scrollToPos(editor, items.pos);
    }
    editor.chain().focus().insertContent(`${sentence} `).run();
    setDialog("");
  }

  async function importFile(file, mode) {
    const doc = await documentFromFile(file, editor.extensionManager.extensions);
    if (mode === "insert") editor.chain().focus().insertContent(doc.content || []).run();
    else editor.commands.setContent(doc, true);
    autosave.markChanged();
    toasts.success(`Imported ${file.name}.`);
    setDialog("");
  }

  function handleDialog(name) {
    if (name === "save") {
      autosave.flush("manual").then((ok) => { if (ok) toasts.success("Report saved."); else if (autosave.error) toasts.error(autosave.error); });
      return;
    }
    if (name === "paste") {
      paste();
      return;
    }
    if (name === "logo") {
      insertLogo().catch((error) => toasts.error(error.message));
      return;
    }
    if (name === "image") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => insertImage(editor, { src: reader.result, alt: file.name }, geometry.contentWidth);
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }
    if (name === "radiologist") {
      editor.chain().focus().insertContent(radiologistBlock()).run();
      return;
    }
    if (name === "signature") {
      editor.chain().focus().insertDataField("signature").run();
      setDialog("profile");
      return;
    }
    if (name === "pageNumber") {
      updateLayout({ ...layout, footer: { ...layout.footer, right: layout.footer?.right?.includes("{PAGE}") ? layout.footer.right : "Page {PAGE} of {PAGES}" } });
      toasts.success("Page numbers are in the footer.");
      return;
    }
    setDialog(name);
  }

  if (!editor || (!bundle && !missing)) {
    return <div className="grid h-full place-items-center bg-[#e7eaf0] text-sm text-[#6e6e73]">Opening the report…</div>;
  }
  if (missing) {
    return <div className="grid h-full place-items-center bg-[#e7eaf0] text-sm text-[#6e6e73]">This report is not available.</div>;
  }

  const favourites = shortcuts.filter((item) => item.favourite);
  const signed = report.status === "preliminary" || report.status === "final";
  const studyContext = imagingContext({ modality: bundle.study?.modality, description: bundle.study?.description });
  const activeVocabulary = vocabulary.length ? vocabulary : searchVocabulary("", { context: studyContext.key, limit: 80 });
  const formattedBase = formatRadiologyReport(rawSession, { description: bundle.study?.description || "" });
  const formatted = impressionOverride
    ? { ...formattedBase, impression: impressionOverride, impressionCopied: true, impressionDictated: false }
    : formattedBase;
  const dictatedReview = reviewTranscript(cleanSession, activeVocabulary);
  const coding = suggestCodes({ impression: formatted.impression, context: studyContext, vocabulary: activeVocabulary });
  function clearDictation() {
    if (!window.confirm("Clear the dictation preview and audio for this session? Report text already inserted stays until you undo it.")) return;
    clips.forEach((clip) => URL.revokeObjectURL(clip.audioUrl));
    rawRef.current = "";
    cleanRef.current = "";
    setRawSession("");
    setCleanSession("");
    setClips([]);
    setImpressionOverride("");
    setSelectedCodes({});
  }
  function openShare(channel) {
    setShareChannel(channel);
    setDialog("share");
  }
  const sendIcons = (
    <div className="flex shrink-0 items-center gap-1.5" title={signed ? "Send the finished report" : "Sign the report to enable sending"}>
      <button type="button" className="we-send we-send-whatsapp" aria-label="Send via WhatsApp" disabled={!signed} onClick={() => openShare("whatsapp")}><BrandMark kind="whatsapp" /></button>
      <button type="button" className="we-send we-send-facebook" aria-label="Send via Facebook" disabled={!signed} onClick={() => openShare("facebook")}><BrandMark kind="facebook" /></button>
    </div>
  );
  return (
    <div className={`we-app flex h-full min-h-0 w-full min-w-0 flex-col ${embedded ? "we-embedded bg-white" : "bg-[#e7edf3]"}`}>
      {embedded ? (
        <header className="we-command">
          <div className="we-command-id">
            <div className="we-command-name">{bundle.patient?.name || "Radiology report"}</div>
            <div className="we-command-meta">
              <span className="truncate">{bundle.study?.accession || "No accession"}</span>
              <span className="we-command-dot" aria-hidden="true" />
              <span>{bundle.study?.modality || "Study"}</span>
              <span className={`we-command-status is-${report.status || "draft"}`}>{statusLabel(report)}</span>
            </div>
          </div>
          <div className="we-command-actions">
            {listening && <RecordingMark paused={paused} />}
            <div className="we-command-group" role="toolbar" aria-label="Report actions">
              <button type="button" className={`we-command-dictate${listening && !paused ? " is-live" : ""}`} disabled={readOnly} onClick={() => { if (!listening) setDictationOpen(true); toggleDictation(); }}>
                <Mic className="h-3.5 w-3.5" strokeWidth={1.75} />
                {listening ? "Stop" : "Dictate"}
              </button>
              <button type="button" className={`we-command-quiet${dictationOpen ? " is-on" : ""}`} aria-expanded={dictationOpen} onClick={() => setDictationOpen((value) => !value)}>Transcription</button>
              <button type="button" className={`we-command-quiet${formatOpen ? " is-on" : ""}`} aria-expanded={formatOpen} onClick={() => setFormatOpen((value) => !value)}>Format</button>
              <button type="button" className="we-command-quiet" onClick={() => setDialog("templates")}>Templates</button>
            </div>
            {report.status === "final"
              ? <button type="button" className="we-command-sign" onClick={amend}>Amend</button>
              : <button type="button" className="we-command-sign" disabled={readOnly} onClick={() => setDialog("finalize")}>Sign</button>}
          </div>
        </header>
      ) : (
        <header className="we-masthead">
          <Logo className="h-9 w-9 shrink-0" />
          <div className="min-w-0">
            <div className="we-masthead-kicker">Galactic Medical Systems</div>
            <div className="truncate text-[15px] font-semibold leading-tight">{bundle.patient?.name || "Radiology report"}</div>
          </div>
          <div className="hidden min-w-0 border-l border-white/15 pl-3 sm:block">
            <div className="truncate text-[12px] text-[#dbe7f5]">{bundle.study?.accession || "No accession"} · {bundle.study?.modality || "Study"}</div>
            <div className="truncate text-[11px] text-[#c4b5fd]">{bundle.facility?.name || "Facility"} · {statusLabel(report)}</div>
          </div>
          {listening && <RecordingMark paused={paused} light />}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {sendIcons}
            <span className="mx-1 hidden h-6 w-px bg-white/15 sm:block" />
            {bundle.study?._id && <Link className="we-ribbon-button h-8 bg-white/10 px-2 text-[12px] text-white hover:bg-white/15" to={`/viewer/${bundle.study._id}`}>Images</Link>}
            <Button className="border-white/20 bg-white/10 text-white hover:bg-white/15" aria-expanded={formatOpen} onClick={() => setFormatOpen((value) => !value)}>Format</Button>
            <Button disabled={readOnly} onClick={() => setDialog("import")}><Upload className="h-3.5 w-3.5" /> Import</Button>
            <Button onClick={() => setDialog("templates")}>Templates</Button>
            {report.status === "final" ? <Button primary onClick={amend}>Amend</Button> : <Button primary disabled={readOnly} onClick={() => setDialog("finalize")}>Sign</Button>}
          </div>
        </header>
      )}
      {embedded && formatOpen && <FormatStrip editor={editor} readOnly={readOnly} />}
      {!embedded && formatOpen && <Ribbon
        editor={editor}
        readOnly={readOnly}
        tab={tab}
        onTab={setTab}
        onDialog={handleDialog}
        onPanel={setPanel}
        dictation={{
          listening,
          paused,
          lang,
          toggle: toggleDictation,
          pause: () => (paused ? ensureDictation().resume() : ensureDictation().pause()),
          setLang: (next) => {
            setLang(next);
            dictationRef.current?.setLang(next);
          },
        }}
      />}
      {!embedded && favourites.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#f2f2f7] bg-[#fafafa] px-2 py-1">
          <span className="text-[11px] text-[#6e6e73]">Phrases</span>
          {favourites.map((item) => (
            <button key={item.trigger} type="button" className="h-6 rounded border border-[#dbe3ee] bg-white px-2 text-[11.5px] text-[#2c2c2e] hover:border-[#7c3aed]" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().insertContent(`${item.expansion} `).run()}>{item.trigger}</button>
          ))}
        </div>
      )}
      {report.status === "final" && <div className="shrink-0 bg-[#f5f3ff] px-3 py-1 text-[12px] text-[#5b21b6]">This signed report is locked. Use Amend to create a new version. The signed copy stays unchanged.</div>}
      {recovery && (
        <div className="flex shrink-0 items-center gap-2 bg-amber-50 px-3 py-1 text-[12px] text-amber-950">
          A local draft from {new Date(recovery.savedAt).toLocaleString()} was recovered.
          <Button onClick={() => { editor.commands.setContent(recovery.doc, false); if (recovery.layout) setLayout(normalizeLayout(recovery.layout)); autosave.markChanged(); setRecovery(null); }}>Restore</Button>
          <Button onClick={() => setRecovery(null)}>Dismiss</Button>
        </div>
      )}
      {(dictationOpen || listening) && <DictationDock
        open={dictationOpen}
        onOpen={() => setDictationOpen((value) => !value)}
        readOnly={readOnly}
        listening={listening}
        paused={paused}
        pending={pending}
        lang={lang}
        speech={speechInfo}
        contextLabel={studyContext.label}
        interim={interim}
        review={dictatedReview}
        formatted={formatted}
        clips={clips}
        coding={coding}
        savedCodes={report.coding || []}
        selectedCodes={selectedCodes}
        compact={embedded}
        subscribeLevel={subscribeLevel}
        onToggle={toggleDictation}
        onPause={() => (paused ? ensureDictation().resume() : ensureDictation().pause())}
        onStop={() => ensureDictation().stop()}
        onLang={(next) => { setLang(next); dictationRef.current?.setLang(next); }}
        onUpload={uploadAudio}
        onClear={clearDictation}
        onUndo={() => editor.chain().focus().undo().run()}
        onRedo={() => editor.chain().focus().redo().run()}
        onSave={() => autosave.flush("manual").then((ok) => { if (ok) toasts.success("Draft saved."); else if (autosave.error) toasts.error(autosave.error); })}
        onInsert={() => {
          const count = insertStructuredReport(editor, formatted);
          if (count) toasts.success("Dictated sections were inserted. They are not signed.");
          else toasts.error("There is no dictated section to insert.");
        }}
        onCopyImpression={() => { if (formatted.findings) setImpressionOverride(formatted.findings); }}
        onApproveReport={() => setDialog("finalize")}
        onAcceptSuggestion={(item) => {
          if (replaceSpokenTerm(editor, item.from, item.to)) toasts.success("The suggestion was applied. Undo is available.");
          else toasts.error("That word is no longer in the report.");
        }}
        onToggleCode={(item) => setSelectedCodes((current) => {
          const key = `${item.system}:${item.code}`;
          return { ...current, [key]: !current[key] };
        })}
        onApproveCodes={async (manual) => {
          const selected = (coding.suggestions || []).filter((item) => selectedCodes[`${item.system}:${item.code}`]);
          const codes = manual?.code ? [...selected, { ...manual, manual: true, sourceText: formatted.impression.slice(0, 180) }] : selected;
          if (!codes.length || !formatted.impression) {
            toasts.error("Dictate an impression, or copy the findings, before approving a code.");
            return;
          }
          if (!window.confirm("Save the selected codes on this draft? The report is not signed, and the codes are not sent as a diagnosis.")) return;
          try {
            const data = await api(`/api/reports/${reportId}/coding`, {
              method: "POST",
              body: {
                confirm: true,
                impression: formatted.impression,
                modality: bundle.study?.modality || "",
                description: bundle.study?.description || "",
                codes: codes.map((item) => ({ system: item.system, code: item.code, description: item.description, sourceText: item.sourceText || "" })),
              },
            });
            setBundle((current) => (current ? { ...current, report: { ...current.report, coding: data.coding } } : current));
            toasts.success("Selected codes were saved on the draft.");
          } catch (error) {
            toasts.error(error.message);
          }
        }}
      />}
      <div className="flex min-h-0 flex-1">
        <div ref={canvasRef} className="we-canvas min-w-0 flex-1">
          <div className={`mx-auto ${embedded ? "we-embedded-stage" : "py-4"}`} style={{ width: geometry.width * zoom }}>
            {!embedded && <Ruler layout={layout} zoom={zoom} editor={editor} readOnly={readOnly} onMargins={(margins) => updateLayout({ ...layout, margins: { ...layout.margins, ...margins } })} />}
            <div style={{ height: (pages * geometry.pitch - geometry.gap) * zoom }}>
              <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                <PageStack ref={stackRef} editor={editor} layout={layout} pages={pages} fill={fill} onEditHeader={() => setDialog("header")} onEditFooter={() => setDialog("footer")} />
              </div>
            </div>
          </div>
        </div>
        {panel === "find" && <FindPanel editor={editor} replaceMode={false} readOnly={readOnly} onClose={() => setPanel("")} />}
        {panel === "replace" && <FindPanel editor={editor} replaceMode readOnly={readOnly} onClose={() => setPanel("")} />}
        {panel === "nav" && <NavigationPane editor={editor} onClose={() => setPanel("")} />}
      </div>
      <footer className={embedded ? "we-embedded-foot" : "we-statusbar"}>
        <span className="we-foot-cluster">
          <span className={embedded ? `we-command-status is-${report.status || "draft"}` : "font-medium text-white"}>{statusLabel(report)}</span>
          <span className="we-foot-sep" aria-hidden="true" />
          <span>{SAVE_LABEL[autosave.status] || autosave.status}</span>
          {autosave.lastSavedAt && <span className="we-foot-muted" title={`Last saved ${autosave.lastSavedAt.toLocaleString()}`}>{autosave.lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
          <span className="we-foot-sep" aria-hidden="true" />
          <span>{pages} {pages === 1 ? "page" : "pages"}</span>
        </span>
        <span className="we-foot-tools">
          <button type="button" onClick={() => setDialog("phrases")}>Phrases</button>
          <button type="button" onClick={openPriors}>Priors</button>
          <button type="button" disabled={report.status === "draft"} onClick={() => openShare("link")}>Share</button>
        </span>
        <span className="we-foot-user">{user?.name}{user?.qualifications ? `, ${user.qualifications}` : ""}</span>
        <span className="we-foot-zoom">
          <button type="button" aria-label="Zoom out" onClick={() => { zoomMode.current = "manual"; setZoom((value) => Math.max(0.35, Math.round((value - 0.1) * 100) / 100)); }}><ZoomOut className="h-3.5 w-3.5" /></button>
          <button type="button" title="Fit the page to the window" onClick={() => { zoomMode.current = "fit"; fitPage(); }}>{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label="Zoom in" onClick={() => { zoomMode.current = "manual"; setZoom((value) => Math.min(2, Math.round((value + 0.1) * 100) / 100)); }}><ZoomIn className="h-3.5 w-3.5" /></button>
        </span>
      </footer>
      {dialog === "table" && <TableDialog onClose={() => setDialog("")} onInsert={(options) => editor.chain().focus().insertTable(options).run()} />}
      {dialog === "datetime" && <DateTimeDialog editor={editor} onClose={() => setDialog("")} />}
      {dialog === "header" && <HeaderFooterDialog layout={layout} focus="header" onClose={() => setDialog("")} onChange={updateLayout} />}
      {dialog === "footer" && <HeaderFooterDialog layout={layout} focus="footer" onClose={() => setDialog("")} onChange={updateLayout} />}
      {dialog === "page" && <PageSetupDialog layout={layout} onClose={() => setDialog("")} onChange={updateLayout} />}
      {dialog === "border" && <BorderDialog layout={layout} onClose={() => setDialog("")} onChange={updateLayout} />}
      {dialog === "paragraph" && <ParagraphDialog editor={editor} onClose={() => setDialog("")} />}
      {dialog === "spelling" && <SpellingDialog editor={editor} onClose={() => setDialog("")} toasts={toasts} />}
      {dialog === "templates" && (
        <TemplatesDialog
          templates={templates}
          editor={editor}
          study={bundle.study}
          canManage={Boolean(bundle.permissions?.manageTemplates)}
          toasts={toasts}
          onClose={() => setDialog("")}
          onReload={async () => setTemplates((await api("/api/templates")).templates || [])}
          onApplied={() => autosave.markChanged()}
          onSaveAs={() => setDialog("saveTemplate")}
        />
      )}
      {dialog === "saveTemplate" && <SaveTemplateDialog editor={editor} layout={layout} study={bundle.study} facilityId={bundle.study?.facilityId} toasts={toasts} onClose={() => setDialog("")} onSaved={() => api("/api/templates").then((data) => setTemplates(data.templates || []))} />}
      {dialog === "history" && <HistoryDialog reportId={reportId} fieldValues={fields} canRestore={!readOnly} toasts={toasts} onClose={() => setDialog("")} onRestore={(revision) => { editor.commands.setContent(revision.doc, false); if (revision.layout) setLayout(normalizeLayout(revision.layout)); autosave.markChanged(); }} />}
      {dialog === "print" && <PrintPreviewDialog reportId={reportId} toasts={toasts} beforeExport={() => autosave.flush("manual")} onClose={() => setDialog("")} />}
      {dialog === "finalize" && <FinalizeDialog editor={editor} accession={bundle.study?.accession} onClose={() => setDialog("")} onSign={sign} openPanel={setPanel} toasts={toasts} />}
      {dialog === "share" && <ShareDialog reportId={reportId} status={report.status} patient={bundle.patient} initialChannel={shareChannel} toasts={toasts} onClose={() => setDialog("")} />}
      {dialog === "profile" && <ProfileDialog toasts={toasts} onClose={() => setDialog("")} onSaved={() => api(`/api/reports/${reportId}`).then(setBundle)} />}
      {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog("")} />}
      {dialog === "files" && <FilesDialog reportId={reportId} artifacts={bundle.artifacts || []} toasts={toasts} onClose={() => setDialog("")} />}
      {dialog === "phrases" && <PhrasesDialog shortcuts={shortcuts} toasts={toasts} onClose={() => setDialog("")} onChange={setShortcuts} />}
      {dialog === "import" && <ImportReportDialog onClose={() => setDialog("")} onFile={importFile} toasts={toasts} />}
      {autosave.conflict && (
        <ConflictDialog
          conflict={autosave.conflict}
          onReload={() => window.location.reload()}
          onOverwrite={() => autosave.resolveConflict("overwrite", autosave.conflict.revision)}
        />
      )}
      {dialog === "priors" && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/30 p-4" onMouseDown={() => setDialog("")}>
          <div className="we-app max-h-[70vh] w-[560px] overflow-auto rounded border border-[#e5e5ea] bg-white p-4 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
            <h2 className="text-sm font-semibold text-[#2c2c2e]">Previous reports</h2>
            {!priors && <p className="mt-2 text-[12px] text-[#6e6e73]">Loading…</p>}
            {priors?.length === 0 && <p className="mt-2 text-[12px] text-[#6e6e73]">No earlier signed report is available for this patient.</p>}
            <ul className="mt-2 grid gap-2">
              {(priors || []).map((prior) => (
                <li key={prior._id} className="rounded border border-[#e5e5ea] p-2 text-[12.5px]">
                  <div className="font-medium">{prior.modality} · {prior.accession} · {prior.description}</div>
                  <p className="text-[#6e6e73]">{prior.impression || "No impression text."}</p>
                  <div className="mt-1 flex gap-2">
                    <Button disabled={readOnly} onClick={() => insertPrior(prior)}>Insert reference</Button>
                    <Link className="text-[#7c3aed] underline" to={`/reports/${prior._id}`}>Open</Link>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-right"><Button onClick={() => setDialog("")}>Close</Button></div>
          </div>
        </div>
      )}
      {dialog === "transcribe" && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/30 p-4">
          <div className="we-app w-[440px] rounded border border-[#e5e5ea] bg-white p-4 shadow-xl">
            <h2 className="text-sm font-semibold">Dictation</h2>
            <p className="mt-2 text-[12.5px] text-[#48484a]">This browser cannot capture a microphone, or microphone access is unavailable. Upload a WAV, WebM, MP3, or M4A recording. Transcription runs on the server with the medical vocabulary for this study. Existing report text is kept.</p>
            <label className="mt-3 inline-flex h-8 cursor-pointer items-center rounded border border-[#d1d1d6] px-3 text-[12.5px]">
              Upload audio
              <input type="file" accept="audio/*" className="sr-only" onChange={(event) => uploadAudio(event.target.files?.[0])} />
            </label>
            <div className="mt-3 text-right"><Button onClick={() => setDialog("")}>Close</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordingMark({ paused, light }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-[12px] font-medium ${light ? "text-rose-200" : "text-rose-700"}`}>
      <Mic className="h-3.5 w-3.5" />
      <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
      {paused ? "Paused" : "Recording"}
    </span>
  );
}

function BrandMark({ kind }) {
  if (kind === "whatsapp") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path fill="currentColor" d="M12.04 2C6.58 2 2.15 6.4 2.15 11.83c0 1.74.46 3.44 1.34 4.94L2 22l5.39-1.41a10.1 10.1 0 0 0 4.65 1.12h.01c5.46 0 9.89-4.4 9.89-9.83C21.94 6.4 17.5 2 12.04 2zm5.76 13.9c-.24.68-1.4 1.25-1.93 1.33-.49.07-1.1.1-1.78-.11-.41-.13-.94-.3-1.62-.59-2.85-1.23-4.7-4.1-4.84-4.29-.14-.19-1.16-1.54-1.16-2.94s.73-2.08 1-2.37c.24-.26.64-.38 1.02-.38.12 0 .23 0 .33.01.29.01.43.03.62.48.24.57.82 1.99.89 2.13.07.15.12.32.02.51-.09.19-.14.31-.27.48-.13.16-.28.36-.4.48-.13.13-.27.27-.12.52.15.26.67 1.1 1.44 1.78 1 .89 1.83 1.17 2.09 1.3.26.13.41.11.56-.07.15-.17.66-.77.84-1.03.18-.26.35-.22.59-.13.24.09 1.52.72 1.78.85.26.13.43.19.5.3.06.11.06.64-.18 1.32z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="currentColor" d="M14.2 8.5V6.3c0-.8.5-1.3 1.3-1.3H17V2h-2.2C12.2 2 10.8 3.6 10.8 6.1v2.4H8.7v3.1h2.1V22H14V11.6h2.4l.4-3.1H14.2z" />
    </svg>
  );
}

function ImportReportDialog({ onClose, onFile, toasts }) {
  const [mode, setMode] = useState("replace");
  const [busy, setBusy] = useState(false);
  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await onFile(file, mode);
    } catch (error) {
      toasts.error(error.message || "The file could not be imported.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="we-app w-[460px] rounded-md border border-[#d1d1d6] bg-white p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <h2 className="text-[15px] font-semibold text-[#1e3a5f]">Import a report</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[#48484a]">Bring in a report you already wrote in Word. Patient fields already in this study stay available from Insert. A Word file (.docx), web page (.html), or text file (.txt) can be used.</p>
        <fieldset className="mt-3 grid gap-1.5 text-[13px]">
          <label className="flex items-center gap-2"><input type="radio" name="import-mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace this report with the file</label>
          <label className="flex items-center gap-2"><input type="radio" name="import-mode" checked={mode === "insert"} onChange={() => setMode("insert")} /> Insert the file at the cursor</label>
        </fieldset>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <label className={`inline-flex h-8 cursor-pointer items-center rounded-md bg-[#7c3aed] px-3 text-[12.5px] font-medium text-white ${busy ? "opacity-60" : ""}`}>
            {busy ? "Importing…" : "Choose file"}
            <input type="file" accept=".docx,.html,.htm,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html,text/plain" className="sr-only" disabled={busy} onChange={choose} />
          </label>
        </div>
      </div>
    </div>
  );
}
