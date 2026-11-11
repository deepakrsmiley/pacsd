import { useEffect, useState } from "react";
import { api } from "./api.js";
import { acceptedAnnotations } from "./imageGeometry.js";

const STATUS_LABEL = {
  completed: "AI analysis completed",
  review_recommended: "Review recommended",
  insufficient_quality: "Insufficient image quality",
  unsupported: "Unsupported image type",
  failed: "Analysis failed",
};

const SECTIONS = [
  ["clinical", "Clinical information"],
  ["technique", "Examination technique"],
  ["comparison", "Comparison"],
  ["findings", "Findings"],
  ["impression", "Impression"],
  ["recommendations", "Recommendations"],
];

export const AI_NOTICE = "AI-generated findings require review by a qualified radiologist. Do not use AI output alone for diagnosis or treatment.";

export function useAiAnalysis(studyId) {
  const [capabilities, setCapabilities] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    api("/api/ai/capabilities").then((data) => { if (!cancel) setCapabilities(data.capabilities); }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (!studyId) return undefined;
    let cancel = false;
    api(`/api/ai/analyses?studyId=${studyId}`).then((data) => {
      if (!cancel) setAnalysis(data.analyses?.[0] || null);
    }).catch(() => { if (!cancel) setAnalysis(null); });
    return () => { cancel = true; };
  }, [studyId]);

  async function analyze(instanceId, frame = 0) {
    setBusy("analyze");
    setError("");
    try {
      const data = await api("/api/ai/analyses", { method: "POST", body: { studyId, instanceId, frame } });
      setAnalysis(data.analysis);
      return data.analysis;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function review(index, body) {
    const data = await api(`/api/ai/analyses/${analysis._id}/findings/${index}`, { method: "POST", body });
    setAnalysis(data.analysis);
  }

  async function draft(clinical) {
    setBusy("draft");
    setError("");
    try {
      const data = await api(`/api/ai/analyses/${analysis._id}/draft`, { method: "POST", body: { clinical } });
      setAnalysis(data.analysis);
      const hasText = SECTIONS.some(([key]) => data.analysis?.draft?.[key]);
      if (!hasText) setError("The model did not return any report text.");
      return data.analysis;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function recordSections(sections) {
    if (!analysis?._id) return;
    const data = await api(`/api/ai/analyses/${analysis._id}/sections`, { method: "POST", body: { sections } });
    setAnalysis(data.analysis);
  }

  const boxes = acceptedAnnotations(analysis?.findings, {
    columns: analysis?.columns,
    rows: analysis?.rows,
    annotationsSupported: analysis?.annotationsSupported,
  });

  return { capabilities, analysis, busy, error, analyze, review, draft, recordSections, boxes };
}

export default function AiPanel({ studyId, instanceId, frame = 0, instances = [], onInstance, report, onInsert, onOpenReport, onChange }) {
  const ai = useAiAnalysis(studyId);
  const [showMarks, setShowMarks] = useState(true);
  useEffect(() => { onChange?.({ analysis: ai.analysis, showMarks }); }, [ai.analysis, showMarks]);
  if (!studyId) return null;
  const configured = ai.capabilities?.configured;
  return (
    <aside className="flex max-h-full w-full flex-col overflow-auto border-white/10 bg-[#140a24] p-3 text-sm text-violet-50">
      <h2 className="text-base font-semibold">AI assistant</h2>
      <p className="mt-2 rounded-lg border border-amber-300/40 bg-amber-950/40 p-2 text-xs leading-5 text-amber-100">{AI_NOTICE}</p>
      <p className="mt-2 text-xs text-violet-200/80">
        {ai.capabilities ? `${ai.capabilities.provider} · ${ai.capabilities.model || "model not set"} · text suggestions only` : "Checking the AI provider…"}
      </p>
      {!configured && ai.capabilities && <p className="mt-2 text-xs text-rose-200">AI is not configured on the server. Set AI_BASE_URL and AI_API_KEY, then restart the API.</p>}
      {instances.length > 1 && (
        <label className="mt-3 block text-xs">
          Image to analyze
          <select className="mt-1 h-8 w-full rounded border border-white/15 bg-black/30 px-2" value={instanceId || ""} onChange={(event) => onInstance?.(event.target.value)}>
            {instances.map((item, index) => <option key={item._id} value={item._id}>Image {index + 1}</option>)}
          </select>
        </label>
      )}
      <button type="button" className="mt-3 h-9 rounded-lg bg-[#6d28d9] text-sm font-semibold disabled:opacity-50" disabled={!configured || !instanceId || ai.busy === "analyze"} onClick={() => ai.analyze(instanceId, frame)}>
        {ai.busy === "analyze" ? "Analyzing the selected image…" : "Analyze with AI"}
      </button>
      <p className="mt-2 text-xs text-violet-200/70">Only this image is sent. The rest of the study stays on this computer.</p>
      {ai.error && <p className="mt-2 text-xs text-rose-200" role="alert">{ai.error}</p>}
      {ai.analysis && <AnalysisView analysis={ai.analysis} showMarks={showMarks} setShowMarks={setShowMarks} onReview={ai.review} onDraft={() => generateAndInsert(ai, report, onInsert)} drafting={ai.busy === "draft"} report={report} onInsert={onInsert} onOpenReport={onOpenReport} recordSections={ai.recordSections} />}
    </aside>
  );
}

function AnalysisView({ analysis, showMarks, setShowMarks, onReview, onDraft, drafting, report, onInsert, onOpenReport, recordSections }) {
  const boxes = acceptedAnnotations(analysis.findings, {
    columns: analysis.columns,
    rows: analysis.rows,
    annotationsSupported: analysis.annotationsSupported,
  });
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-200">{STATUS_LABEL[analysis.status] || analysis.status}</p>
      {analysis.error && <p className="text-xs text-rose-200">{analysis.error}</p>}
      <p className="text-[11px] text-violet-200/70">{new Date(analysis.createdAt).toLocaleString()} · {analysis.model || "model not recorded"} · frame {analysis.frame ?? 0}</p>
      {!analysis.annotationsSupported && <p className="text-xs text-violet-200/80">This model did not supply validated image coordinates, so no markers are drawn on the image.</p>}
      {analysis.annotationsSupported && (
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showMarks} onChange={(event) => setShowMarks(event.target.checked)} /> Show AI markers ({boxes.length})</label>
      )}
      {(analysis.findings || []).map((finding, index) => (
        <article key={`${finding.title}-${index}`} className="rounded-xl border border-white/10 bg-white/5 p-2">
          <h3 className="font-semibold">{index + 1}. {finding.title}</h3>
          {finding.location && <p className="text-xs text-violet-200">Location: {finding.location}</p>}
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5">{finding.description}</p>
          {finding.evidence && <p className="mt-1 text-xs text-violet-200/80">Evidence: {finding.evidence}</p>}
          {finding.limitations && <p className="mt-1 text-xs text-amber-100/90">Limitation: {finding.limitations}</p>}
          {finding.followUp && <p className="mt-1 text-xs">Further review: {finding.followUp}</p>}
          <p className="mt-1 text-[11px] uppercase tracking-wide text-violet-300">Image {finding.instanceId ? "referenced" : "selected"} · slice {Number(finding.frame) + 1} · {finding.decision}</p>
          <div className="mt-2 flex gap-1">
            <button type="button" className="h-7 rounded border border-white/15 px-2 text-xs" onClick={() => onReview(index, { decision: "accepted" })}>Accept</button>
            <button type="button" className="h-7 rounded border border-white/15 px-2 text-xs" onClick={() => onReview(index, { decision: "rejected" })}>Reject</button>
          </div>
        </article>
      ))}
      {(analysis.limitations || []).map((item) => <p key={item} className="text-xs text-violet-200/70">{item}</p>)}
      <button type="button" className="h-9 w-full rounded-lg border border-violet-300/40 text-sm disabled:opacity-50" disabled={drafting || analysis.status === "failed"} onClick={onDraft}>
        {drafting ? "Writing the draft into the report…" : "Generate report draft"}
      </button>
      <p className="text-xs text-violet-200/70">This copies the draft into the report editor and saves it. It does not sign the report.</p>
      {analysis.draft && SECTIONS.some(([key]) => analysis.draft[key]) && (
        <div id="ai-draft-sections" className="space-y-2">
          {SECTIONS.map(([key, label]) => analysis.draft[key] ? (
            <div key={key} className="rounded-lg border border-white/10 p-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide">{label}</h4>
                {onInsert && <button type="button" className="h-7 rounded bg-[#6d28d9] px-2 text-xs" onClick={() => insertOne(key, analysis.draft[key], report, onInsert, recordSections)}>Insert into report</button>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-5">{analysis.draft[key]}</p>
            </div>
          ) : null)}
          {onInsert && <button type="button" className="h-9 w-full rounded-lg bg-[#6d28d9] text-sm font-semibold" onClick={() => insertAll(analysis.draft, report, onInsert, recordSections)}>Insert all after review</button>}
          {!onInsert && onOpenReport && <button type="button" className="h-9 w-full rounded-lg border border-white/15 text-sm" onClick={onOpenReport}>Open the report to insert this draft</button>}
        </div>
      )}
    </div>
  );
}

async function generateAndInsert(ai, report, onInsert) {
  const next = await ai.draft(report?.clinical || "");
  if (!next?.draft || !onInsert) return;
  const keys = SECTIONS.filter(([key]) => next.draft[key]).map(([key]) => key);
  if (!keys.length) return;
  const occupied = keys.filter((key) => String(report?.[key] || "").replace(/<[^>]+>/g, "").trim());
  const chosen = occupied.length && !window.confirm("Some report sections already have text. Replace those sections with the AI draft?")
    ? keys.filter((key) => !occupied.includes(key))
    : keys;
  if (!chosen.length) {
    document.getElementById("ai-draft-sections")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  onInsert(Object.fromEntries(chosen.map((key) => [key, next.draft[key]])));
  ai.recordSections(chosen).catch(() => {});
}

function insertOne(key, text, report, onInsert, recordSections) {
  const current = String(report?.[key] || "").replace(/<[^>]+>/g, "").trim();
  if (current && !window.confirm(`Replace the current ${key} text with the AI suggestion?`)) return;
  onInsert({ [key]: text });
  recordSections([key]).catch(() => {});
}

function insertAll(draft, report, onInsert, recordSections) {
  const occupied = SECTIONS.filter(([key]) => String(report?.[key] || "").replace(/<[^>]+>/g, "").trim() && draft[key]);
  if (occupied.length && !window.confirm("Some report sections already have text. Replace those sections with the AI draft?")) return;
  const next = {};
  const keys = [];
  for (const [key] of SECTIONS) {
    if (!draft[key]) continue;
    next[key] = draft[key];
    keys.push(key);
  }
  onInsert(next);
  recordSections(keys).catch(() => {});
}

export { acceptedAnnotations };
