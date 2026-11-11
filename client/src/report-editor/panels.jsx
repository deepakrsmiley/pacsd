import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Image as ImageIcon,
  MessageSquarePlus,
  Reply,
  Search as SearchIcon,
  Sparkles,
  X,
} from "lucide-react";
import { formatDateTime } from "../../../shared/reportDocument.js";
import { api } from "../api.js";
import { AI_NOTICE, useAiAnalysis } from "../AiPanel.jsx";
import {
  insertSuggestionIntoSection,
  insertTextAsSuggestion,
  listSections,
  replaceSelectionWithSuggestion,
  scrollToPos,
  sectionLabel,
  sectionsText,
  selectedText,
} from "./documentUtils.js";
import {
  addComment,
  collectChanges,
  collectComments,
  collectSuggestions,
  deleteComment,
  resolveAllChanges,
  resolveAllSuggestions,
  resolveChange,
  resolveSuggestion,
  selectRange,
  updateComment,
} from "./extensions/review.js";
import { findMatches, goToMatch, replaceAll, replaceCurrent, searchState, setSearch } from "./extensions/tools.js";
import { Button } from "./ui.jsx";

function PanelShell({ title, icon: Icon, onClose, children, actions }) {
  return (
    <aside className="flex h-full w-[330px] shrink-0 flex-col border-l border-[#e5e5ea] bg-white">
      <div className="flex items-center gap-2 border-b border-[#f2f2f7] px-3 py-2">
        {Icon && <Icon className="h-4 w-4 text-[#7c3aed]" />}
        <h2 className="flex-1 text-[13px] font-semibold">{title}</h2>
        {actions}
        <button type="button" className="grid h-7 w-7 place-items-center rounded hover:bg-[#f5f5f7]" onClick={onClose} aria-label={`Close ${title}`}><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 text-[12.5px]">{children}</div>
    </aside>
  );
}

function when(value) {
  return value ? formatDateTime(value) : "";
}

// ---------- AI assistant ----------

const WRITING = [
  ["grammar", "Fix grammar", "selection"],
  ["professional", "Professional wording", "selection"],
  ["rewrite", "Rewrite selection", "selection"],
  ["summarize", "Summarize findings", "findings"],
  ["impression", "Draft impression from findings", "findings"],
  ["recommendations", "Suggest recommendations", "findings"],
  ["consistency", "Check findings against impression", "both"],
];

const ANALYSIS_SECTIONS = ["clinical", "technique", "comparison", "findings", "impression", "recommendations"];

export function AiAssistantPanel({ editor, reportId, studyId, readOnly, onClose, toasts }) {
  const ai = useAiAnalysis(studyId);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [instances, setInstances] = useState([]);
  const [instanceId, setInstanceId] = useState("");
  const [showAnalysis, setShowAnalysis] = useState(false);
  const suggestions = collectSuggestions(editor.state.doc);
  const configured = ai.capabilities?.configured;

  useEffect(() => {
    if (!studyId || !showAnalysis) return;
    api(`/api/studies/${studyId}/series`).then((data) => {
      setInstances(data.instances || []);
      setInstanceId((current) => current || data.instances?.[0]?._id || "");
    }).catch(() => setInstances([]));
  }, [studyId, showAnalysis]);

  async function run(task) {
    setError("");
    const sections = sectionsText(editor);
    const body = { task, findings: sections.findings, impression: sections.impression, clinical: sections.clinical };
    const { from, to } = editor.state.selection;
    let selection = null;
    if (["grammar", "rewrite", "professional"].includes(task)) {
      const value = selectedText(editor);
      if (!value.trim()) {
        setError("Select the text in the report first.");
        return;
      }
      body.text = value;
      selection = { from, to, text: editor.state.doc.textBetween(from, to, "\n", "\ufffc") };
    }
    setBusy(task);
    try {
      const data = await api(`/api/reports/${reportId}/ai`, { method: "POST", body });
      setResult({ ...data.result, selection });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy("");
    }
  }

  function restoreSelection() {
    const selection = result?.selection;
    if (!selection) return false;
    const size = editor.state.doc.content.size;
    if (selection.to > size || editor.state.doc.textBetween(selection.from, selection.to, "\n", "\ufffc") !== selection.text) {
      setError("The selected text has changed since you asked. Select it again and repeat the request.");
      return false;
    }
    selectRange(editor, selection.from, selection.to);
    return true;
  }

  function applyReplace() {
    if (!restoreSelection()) return;
    replaceSelectionWithSuggestion(editor, result.text, result.task);
    setResult(null);
    toasts.success("Inserted as an AI suggestion. Accept or reject it before signing.");
  }

  function applyBelow() {
    if (result.selection && !restoreSelection()) return;
    const { to } = editor.state.selection;
    editor.chain().setTextSelection(to).run();
    insertTextAsSuggestion(editor, ` ${result.text}`, result.task);
    setResult(null);
    toasts.success("Inserted as an AI suggestion.");
  }

  function applyToSection(key) {
    insertSuggestionIntoSection(editor, key, result.text, result.task);
    setResult(null);
    toasts.success(`Added to ${sectionLabel(key)} as an AI suggestion. Accept or reject it before signing.`);
  }

  function findExcerpt(value) {
    const excerpt = String(value || "").trim().slice(0, 80);
    if (!excerpt) return;
    const match = findMatches(editor.state.doc, { query: excerpt, caseSensitive: false, wholeWord: false })[0];
    if (match) selectRange(editor, match.from, match.to);
    else toasts.error("That text is no longer in the report.");
  }

  async function draftFromAnalysis() {
    const sections = sectionsText(editor);
    await ai.draft(sections.clinical || "");
  }

  function insertDraft(keys) {
    const draft = ai.analysis?.draft || {};
    const inserted = [];
    for (const key of keys) {
      if (!draft[key]) continue;
      insertSuggestionIntoSection(editor, key, draft[key], "analysis");
      inserted.push(key);
    }
    if (inserted.length) {
      ai.recordSections(inserted).catch(() => {});
      toasts.success("The draft is in the report as AI suggestions. Review each one before signing.");
    }
  }

  return (
    <PanelShell title="AI assistant" icon={Sparkles} onClose={onClose}>
      <p className="rounded border border-amber-200 bg-amber-50 p-2 text-[11.5px] leading-5 text-amber-900">{AI_NOTICE} Suggestions are highlighted in purple and block signing until you accept or reject each one.</p>
      <p className="mt-2 text-[11px] text-[#6e6e73]">{ai.capabilities ? `${ai.capabilities.provider || "Provider"} · ${ai.capabilities.model || "model not set"}` : "Checking the AI provider…"}</p>
      {ai.capabilities && !configured && <p className="mt-1 text-[11.5px] text-rose-700">AI is not configured on the server (AI_BASE_URL and AI_API_KEY). Writing tools and image analysis are unavailable.</p>}

      <h3 className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Writing</h3>
      <div className="grid gap-1">
        {WRITING.map(([task, label, needs]) => (
          <button key={task} type="button" className="flex items-center justify-between rounded border border-[#e5e5ea] px-2.5 py-1.5 text-left hover:border-[#c4b5fd] hover:bg-[#f8fbff] disabled:opacity-50" disabled={!configured || Boolean(busy) || readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => run(task)}>
            <span>{busy === task ? "Working…" : label}</span>
            <span className="text-[10.5px] text-[#a1a1a6]">{needs === "selection" ? "uses selection" : needs === "both" ? "findings + impression" : "uses findings"}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-[11.5px] text-rose-700" role="alert">{error}</p>}

      {result && (
        <div className="mt-3 rounded border border-violet-200 bg-violet-50/60 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-800">Suggestion · not applied</span>
            <button type="button" className="text-[11px] text-[#6e6e73] underline" onClick={() => setResult(null)}>Discard</button>
          </div>
          {result.text && <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-[#1d1d1f]">{result.text}</p>}
          {result.summary && <p className="mt-1 text-[12px] text-[#3a3a3c]">{result.summary}</p>}
          {result.issues?.length > 0 && (
            <ul className="mt-2 grid gap-1.5">
              {result.issues.map((issue, index) => (
                <li key={index} className="rounded border border-[#e5e5ea] bg-white p-2">
                  <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className={`h-3.5 w-3.5 ${issue.severity === "high" ? "text-rose-600" : issue.severity === "medium" ? "text-amber-500" : "text-[#a1a1a6]"}`} /> {issue.description}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                    {issue.findingsExcerpt && <button type="button" className="text-[#7c3aed] underline" onClick={() => findExcerpt(issue.findingsExcerpt)}>Show in findings</button>}
                    {issue.impressionExcerpt && <button type="button" className="text-[#7c3aed] underline" onClick={() => findExcerpt(issue.impressionExcerpt)}>Show in impression</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {result.task === "consistency" && !result.issues?.length && <p className="mt-1 flex items-center gap-1 text-emerald-700"><Check className="h-3.5 w-3.5" /> No inconsistencies were reported. Review the report yourself before signing.</p>}
          {result.text && !readOnly && (
            <div className="mt-2 flex flex-wrap gap-1">
              {result.selection && <Button primary onClick={applyReplace}>Replace selection</Button>}
              {result.task === "impression" && <Button primary onClick={() => applyToSection("impression")}>Add to IMPRESSION</Button>}
              {result.task === "recommendations" && <Button primary onClick={() => applyToSection("recommendations")}>Add to RECOMMENDATION</Button>}
              {result.task === "summarize" && <Button primary onClick={() => applyToSection("impression")}>Add to IMPRESSION</Button>}
              <Button onClick={applyBelow}>{result.selection ? "Insert after selection" : "Insert at cursor"}</Button>
              <Button onClick={() => navigator.clipboard?.writeText(result.text).then(() => toasts.success("Copied."))}><Copy className="h-3.5 w-3.5" /> Copy</Button>
            </div>
          )}
        </div>
      )}

      <h3 className="mb-1.5 mt-4 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-[#a1a1a6]">
        <span>Pending suggestions ({suggestions.length})</span>
        {suggestions.length > 0 && !readOnly && (
          <span className="flex gap-2 normal-case tracking-normal">
            <button type="button" className="text-[#047857] underline" onClick={() => resolveAllSuggestions(editor, true)}>Accept all</button>
            <button type="button" className="text-rose-700 underline" onClick={() => resolveAllSuggestions(editor, false)}>Reject all</button>
          </span>
        )}
      </h3>
      {suggestions.length === 0 && <p className="text-[11.5px] text-[#a1a1a6]">None. AI text you insert appears here until you review it.</p>}
      <ul className="grid gap-1.5">
        {suggestions.map((item) => (
          <li key={item.id} className="rounded border border-violet-200 bg-white p-2">
            <button type="button" className="line-clamp-3 text-left text-[12px] text-[#3a3a3c] hover:text-[#7c3aed]" onClick={() => selectRange(editor, item.from, item.to)}>{item.text}</button>
            {!readOnly && (
              <div className="mt-1.5 flex gap-1">
                <Button onClick={() => resolveSuggestion(editor, item, true)}><Check className="h-3.5 w-3.5 text-emerald-600" /> Accept</Button>
                <Button onClick={() => resolveSuggestion(editor, item, false)}><X className="h-3.5 w-3.5 text-rose-600" /> Reject</Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <button type="button" className="mt-4 flex w-full items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-[#a1a1a6]" onClick={() => setShowAnalysis(!showAnalysis)} aria-expanded={showAnalysis}>
        {showAnalysis ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Image analysis
      </button>
      {showAnalysis && (
        <div className="mt-2 grid gap-2">
          {instances.length === 0 && <p className="text-[11.5px] text-[#a1a1a6]">No images are stored for this study.</p>}
          {instances.length > 0 && (
            <label className="block text-[11.5px] text-[#48484a]">
              Image
              <select className="we-input mt-1 w-full" value={instanceId} onChange={(event) => setInstanceId(event.target.value)}>
                {instances.map((item, index) => <option key={item._id} value={item._id}>Image {index + 1}{item.seriesDescription ? ` · ${item.seriesDescription}` : ""}</option>)}
              </select>
            </label>
          )}
          <Button primary disabled={!configured || !instanceId || ai.busy === "analyze" || readOnly} onClick={() => ai.analyze(instanceId, 0)}><ImageIcon className="h-3.5 w-3.5" /> {ai.busy === "analyze" ? "Analyzing…" : "Analyze selected image"}</Button>
          <p className="text-[11px] text-[#a1a1a6]">Only this image is sent to the AI provider.</p>
          {ai.error && <p className="text-[11.5px] text-rose-700">{ai.error}</p>}
          {ai.analysis && (
            <div className="grid gap-1.5">
              <p className="text-[11px] text-[#6e6e73]">{formatDateTime(ai.analysis.createdAt)} · {ai.analysis.status?.replace(/_/g, " ")}</p>
              {(ai.analysis.findings || []).map((finding, index) => (
                <div key={`${finding.title}-${index}`} className="rounded border border-[#e5e5ea] p-2">
                  <div className="font-medium">{index + 1}. {finding.title}</div>
                  {finding.location && <div className="text-[11px] text-[#6e6e73]">Location: {finding.location}</div>}
                  <p className="mt-0.5 text-[12px] text-[#3a3a3c]">{finding.description}</p>
                  <div className="mt-1 flex items-center gap-1">
                    <span className={`mr-auto text-[10.5px] uppercase tracking-wide ${finding.decision === "accepted" ? "text-emerald-700" : finding.decision === "rejected" ? "text-rose-700" : "text-[#a1a1a6]"}`}>{finding.decision || "pending"}</span>
                    <Button disabled={readOnly} onClick={() => ai.review(index, { decision: "accepted" }).catch((failure) => toasts.error(failure.message))}>Approve</Button>
                    <Button disabled={readOnly} onClick={() => ai.review(index, { decision: "rejected" }).catch((failure) => toasts.error(failure.message))}>Reject</Button>
                  </div>
                </div>
              ))}
              <Button disabled={!configured || ai.busy === "draft" || readOnly || ai.analysis.status === "failed"} onClick={draftFromAnalysis}>{ai.busy === "draft" ? "Drafting…" : "Draft report text from approved findings"}</Button>
              {ai.analysis.draft && ANALYSIS_SECTIONS.some((key) => ai.analysis.draft[key]) && (
                <div className="grid gap-1.5">
                  {ANALYSIS_SECTIONS.filter((key) => ai.analysis.draft[key]).map((key) => (
                    <div key={key} className="rounded border border-violet-200 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-800">{sectionLabel(key)}</span>
                        {!readOnly && <button type="button" className="text-[11px] text-[#7c3aed] underline" onClick={() => insertDraft([key])}>Insert as suggestion</button>}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[12px]">{ai.analysis.draft[key]}</p>
                    </div>
                  ))}
                  {!readOnly && <Button primary onClick={() => insertDraft(ANALYSIS_SECTIONS)}>Insert all as suggestions</Button>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </PanelShell>
  );
}

// ---------- comments ----------

export function CommentsPanel({ editor, user, readOnly, onClose, composing, onComposed }) {
  const comments = collectComments(editor.state.doc);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(null);
  const [reply, setReply] = useState({ id: "", text: "" });
  const input = useRef(null);
  const activeId = editor.state.selection.$from.marks().find((mark) => mark.type.name === "comment")?.attrs.id;

  useEffect(() => {
    if (composing) input.current?.focus();
  }, [composing]);

  function create() {
    if (!draft.trim()) return;
    const id = addComment(editor, draft.trim(), user);
    if (!id) return;
    setDraft("");
    onComposed?.();
  }

  return (
    <PanelShell title={`Comments (${comments.length})`} icon={MessageSquarePlus} onClose={onClose}>
      {!readOnly && (
        <div className="mb-3 rounded border border-[#e5e5ea] p-2">
          <textarea ref={input} className="we-input h-16 w-full resize-none py-1" placeholder={editor.state.selection.empty ? "Comment on the word at the cursor, or select text first…" : "Comment on the selected text…"} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) create(); }} />
          <div className="mt-1.5 flex justify-end"><Button primary disabled={!draft.trim()} onClick={create}>Add comment</Button></div>
        </div>
      )}
      {comments.length === 0 && <p className="text-[11.5px] text-[#a1a1a6]">No comments. Open comments block signing, so resolve them when done.</p>}
      <ul className="grid gap-2">
        {comments.map((comment) => (
          <li key={comment.id} className={`rounded border p-2 ${comment.id === activeId ? "border-amber-400 bg-amber-50/60" : "border-[#e5e5ea]"}`}>
            <button type="button" className="block w-full text-left" onClick={() => selectRange(editor, comment.from, comment.to)}>
              <span className="block truncate border-l-2 border-amber-400 pl-1.5 text-[11px] italic text-[#6e6e73]">{comment.text}</span>
            </button>
            <div className="mt-1 text-[11px] text-[#6e6e73]"><span className="font-semibold text-[#3a3a3c]">{comment.attrs.author || "Unknown"}</span> · {when(comment.attrs.date)}</div>
            {editing?.id === comment.id ? (
              <div className="mt-1">
                <textarea className="we-input h-14 w-full resize-none py-1" value={editing.text} onChange={(event) => setEditing({ ...editing, text: event.target.value })} />
                <div className="mt-1 flex justify-end gap-1"><Button onClick={() => setEditing(null)}>Cancel</Button><Button primary onClick={() => { updateComment(editor, comment.id, { text: editing.text }); setEditing(null); }}>Save</Button></div>
              </div>
            ) : (
              <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] text-[#111827]">{comment.attrs.text}</p>
            )}
            {(comment.attrs.replies || []).map((item, index) => (
              <div key={index} className="ml-3 mt-1.5 border-l border-[#e5e5ea] pl-2">
                <div className="text-[11px] text-[#6e6e73]"><span className="font-semibold text-[#3a3a3c]">{item.author}</span> · {when(item.date)}</div>
                <p className="whitespace-pre-wrap">{item.text}</p>
              </div>
            ))}
            {reply.id === comment.id && (
              <div className="ml-3 mt-1.5">
                <textarea className="we-input h-12 w-full resize-none py-1" value={reply.text} onChange={(event) => setReply({ id: comment.id, text: event.target.value })} placeholder="Reply…" autoFocus />
                <div className="mt-1 flex justify-end gap-1">
                  <Button onClick={() => setReply({ id: "", text: "" })}>Cancel</Button>
                  <Button primary disabled={!reply.text.trim()} onClick={() => {
                    updateComment(editor, comment.id, { replies: [...(comment.attrs.replies || []), { author: user?.name || "", date: new Date().toISOString(), text: reply.text.trim() }] });
                    setReply({ id: "", text: "" });
                  }}>Reply</Button>
                </div>
              </div>
            )}
            {!readOnly && editing?.id !== comment.id && reply.id !== comment.id && (
              <div className="mt-1.5 flex gap-2 text-[11px]">
                <button type="button" className="inline-flex items-center gap-0.5 text-[#7c3aed] hover:underline" onClick={() => setReply({ id: comment.id, text: "" })}><Reply className="h-3 w-3" /> Reply</button>
                <button type="button" className="text-[#7c3aed] hover:underline" onClick={() => setEditing({ id: comment.id, text: comment.attrs.text })}>Edit</button>
                <button type="button" className="inline-flex items-center gap-0.5 text-[#047857] hover:underline" onClick={() => deleteComment(editor, comment.id)}><Check className="h-3 w-3" /> Resolve</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

// ---------- tracked changes ----------

export function ChangesPanel({ editor, readOnly, onClose }) {
  const changes = collectChanges(editor.state.doc);
  return (
    <PanelShell title={`Tracked changes (${changes.length})`} icon={Reply} onClose={onClose} actions={!readOnly && changes.length > 0 ? (
      <span className="flex gap-1">
        <Button onClick={() => resolveAllChanges(editor, true)}>Accept all</Button>
        <Button onClick={() => resolveAllChanges(editor, false)}>Reject all</Button>
      </span>
    ) : null}>
      {changes.length === 0 && <p className="text-[11.5px] text-[#a1a1a6]">No tracked changes. Turn on Track Changes in the Review tab to record edits.</p>}
      <ul className="grid gap-1.5">
        {changes.map((change) => (
          <li key={`${change.type}-${change.id}`} className="rounded border border-[#e5e5ea] p-2">
            <div className="text-[11px] text-[#6e6e73]"><span className={change.type === "insertion" ? "font-semibold text-[#047857]" : "font-semibold text-rose-700"}>{change.type === "insertion" ? "Inserted" : "Deleted"}</span> · {change.attrs.author || "Unknown"} · {when(change.attrs.date)}</div>
            <button type="button" className={`mt-0.5 line-clamp-3 text-left ${change.type === "deletion" ? "text-rose-700 line-through" : "text-[#047857] underline"}`} onClick={() => selectRange(editor, change.from, change.to)}>{change.text}</button>
            {!readOnly && (
              <div className="mt-1.5 flex gap-1">
                <Button onClick={() => resolveChange(editor, change, true)}><Check className="h-3.5 w-3.5 text-emerald-600" /> Accept</Button>
                <Button onClick={() => resolveChange(editor, change, false)}><X className="h-3.5 w-3.5 text-rose-600" /> Reject</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

// ---------- navigation ----------

export function NavigationPane({ editor, onClose }) {
  const items = listSections(editor.state.doc);
  const { from } = editor.state.selection;
  const activePos = [...items].reverse().find((item) => item.pos <= from)?.pos;
  return (
    <aside className="flex h-full w-[230px] shrink-0 flex-col border-r border-[#e5e5ea] bg-white">
      <div className="flex items-center justify-between border-b border-[#f2f2f7] px-3 py-2">
        <h2 className="text-[13px] font-semibold">Navigation</h2>
        <button type="button" className="grid h-7 w-7 place-items-center rounded hover:bg-[#f5f5f7]" onClick={onClose} aria-label="Close navigation"><X className="h-4 w-4" /></button>
      </div>
      <nav className="min-h-0 flex-1 overflow-auto p-1.5 text-[12.5px]" aria-label="Report sections">
        {items.length === 0 && <p className="p-2 text-[#a1a1a6]">No headings in this report.</p>}
        {items.map((item) => (
          <button key={item.pos} type="button" className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left ${item.pos === activePos ? "bg-[#ede9fe] text-[#5b21b6]" : "hover:bg-[#f5f5f7]"}`} style={{ paddingLeft: 8 + (item.level - 1) * 12 }} onClick={() => scrollToPos(editor, item.pos)}>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.key && item.empty && ["findings", "impression"].includes(item.key) && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">empty</span>}
          </button>
        ))}
      </nav>
    </aside>
  );
}

// ---------- find and replace ----------

export function FindPanel({ editor, replaceMode, readOnly, onClose }) {
  const [query, setQuery] = useState(() => (editor.state.selection.empty ? searchState(editor)?.query || "" : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ").slice(0, 80)));
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [showReplace, setShowReplace] = useState(replaceMode);
  const input = useRef(null);
  const state = searchState(editor);

  useEffect(() => setShowReplace(replaceMode), [replaceMode]);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    setSearch(editor, { query, caseSensitive, wholeWord });
  }, [query, caseSensitive, wholeWord]);
  useEffect(() => () => setSearch(editor, { query: "" }), []);

  const count = state?.matches.length || 0;
  const position = count ? state.index + 1 : 0;
  return (
    <div className="absolute right-4 top-3 z-20 w-[340px] rounded-lg border border-[#e5e5ea] bg-white p-2.5 shadow-xl" role="search">
      <div className="flex items-center gap-1.5">
        <SearchIcon className="h-4 w-4 text-[#6e6e73]" />
        <input ref={input} className="we-input flex-1" placeholder="Find in report" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") goToMatch(editor, event.shiftKey ? -1 : 1);
          if (event.key === "Escape") onClose();
        }} aria-label="Find" />
        <span className="w-14 text-center text-[11px] tabular-nums text-[#6e6e73]">{query ? `${position} of ${count}` : ""}</span>
        <button type="button" className="grid h-7 w-7 place-items-center rounded hover:bg-[#f5f5f7] disabled:opacity-40" disabled={!count} onClick={() => goToMatch(editor, -1)} aria-label="Previous match"><ArrowUp className="h-4 w-4" /></button>
        <button type="button" className="grid h-7 w-7 place-items-center rounded hover:bg-[#f5f5f7] disabled:opacity-40" disabled={!count} onClick={() => goToMatch(editor, 1)} aria-label="Next match"><ArrowDown className="h-4 w-4" /></button>
        <button type="button" className="grid h-7 w-7 place-items-center rounded hover:bg-[#f5f5f7]" onClick={onClose} aria-label="Close find"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-1.5 flex items-center gap-3 pl-6 text-[11.5px] text-[#48484a]">
        <label className="flex items-center gap-1"><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} /> Match case</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} /> Whole words</label>
        {!readOnly && <button type="button" className="ml-auto text-[#7c3aed] hover:underline" onClick={() => setShowReplace(!showReplace)}>{showReplace ? "Hide replace" : "Replace…"}</button>}
      </div>
      {showReplace && !readOnly && (
        <div className="mt-2 flex items-center gap-1.5 pl-6">
          <input className="we-input flex-1" placeholder="Replace with" value={replacement} onChange={(event) => setReplacement(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") replaceCurrent(editor, replacement); }} aria-label="Replace with" />
          <Button disabled={!count} onClick={() => replaceCurrent(editor, replacement)}>Replace</Button>
          <Button disabled={!count} onClick={() => replaceAll(editor, replacement)}>All</Button>
        </div>
      )}
    </div>
  );
}
