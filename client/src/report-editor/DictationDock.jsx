import { useEffect, useRef, useState } from "react";
import { ChevronDown, Mic, Pause, Play, Square } from "lucide-react";
import { decorateTranscript } from "../../../shared/dictation/review.js";
import { DICTATION_LANGUAGES } from "./dictation.js";
import { Button } from "./ui.jsx";

const MARK = {
  plain: "",
  term: "we-dictation-mark-term",
  verify: "we-dictation-mark-verify",
  measure: "we-dictation-mark-measure",
};

function keepEditorSelection(event) {
  if (event.target.closest("input, select, textarea, audio")) return;
  event.preventDefault();
}

function Waveform({ active, subscribe }) {
  const canvasRef = useRef(null);
  const bars = useRef(Array.from({ length: 32 }, () => 0));
  useEffect(() => subscribe((value) => {
    bars.current = bars.current.slice(1).concat(value || 0);
  }), [subscribe]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) return undefined;
    let frame = 0;
    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      context.strokeStyle = "#d1d1d6";
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();
      if (active) {
        const slot = width / bars.current.length;
        bars.current.forEach((level, index) => {
          const bar = Math.max(2, level * (height - 6));
          context.fillStyle = "#7c3aed";
          context.fillRect(index * slot + 1, (height - bar) / 2, Math.max(2, slot - 2), bar);
        });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return <canvas ref={canvasRef} width="168" height="28" className="we-dictation-wave" aria-hidden="true" />;
}

function Transcript({ text, review }) {
  if (!text) return <p className="we-dictation-help">Dictated words appear here exactly as returned. Nothing is added to the report until you insert it.</p>;
  const pieces = decorateTranscript(text, review);
  return (
    <p>
      {pieces.map((piece, index) => (
        <span key={`${piece.mark}-${index}`} className={MARK[piece.mark] || ""}>{piece.text}</span>
      ))}
    </p>
  );
}

function SectionBlock({ label, value, note, primary }) {
  return (
    <div className={`we-dictation-section${primary ? " is-primary" : ""}`}>
      <strong>{label}</strong>
      <p>{value || "Not dictated."}</p>
      {note && <em>{note}</em>}
    </div>
  );
}

function Group({ label, children }) {
  return (
    <div className="we-dictation-group">
      <div className="we-dictation-controls">{children}</div>
      <div className="we-dictation-caption">{label}</div>
    </div>
  );
}

export default function DictationDock({
  open,
  onOpen,
  compact = false,
  readOnly,
  listening,
  paused,
  pending,
  lang,
  speech,
  contextLabel,
  interim,
  review,
  formatted,
  clips,
  coding,
  savedCodes,
  onToggle,
  onPause,
  onStop,
  onLang,
  onUpload,
  onClear,
  onUndo,
  onRedo,
  onSave,
  onInsert,
  onCopyImpression,
  onApproveReport,
  onAcceptSuggestion,
  onApproveCodes,
  onToggleCode,
  selectedCodes,
  subscribeLevel,
}) {
  const [manual, setManual] = useState({ system: "ICD-10-CM", code: "", description: "" });
  const status = !listening ? "Ready" : paused ? "Paused" : pending || interim ? "Transcribing" : "Listening";
  const statusClass = listening && !paused ? (pending || interim ? "is-wait" : "is-live") : "";
  const impressionNote = formatted?.impressionCopied
    ? "Copied from dictated findings. No new statement was added."
    : formatted?.impressionDictated ? "" : "Impression stays empty until you dictate it or explicitly copy the findings.";
  return (
    <section className={`we-dictation${compact ? " is-compact" : ""}`} aria-label="Dictation" title={speech && !speech.configured ? "Transcription is not enabled for this facility." : undefined} onMouseDown={keepEditorSelection}>
      <div className="we-dictation-bar">
        <Group label="Microphone">
          <button type="button" className={`we-dictation-mic${listening && !paused ? " is-live" : ""}`} disabled={readOnly} onClick={onToggle}>
            <Mic className="h-3.5 w-3.5" />
            {listening ? "Stop" : "Start"}
          </button>
          <button type="button" className="we-dictation-quiet" disabled={readOnly || !listening} onClick={onPause}>
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" className="we-dictation-quiet" disabled={!listening} onClick={onStop}>
            <Square className="h-3 w-3" /> Stop
          </button>
        </Group>
        <Group label="Recording status">
          <span className="we-dictation-status">
            <span className={`we-dictation-dot ${statusClass}`} />
            {status}
          </span>
        </Group>
        {(!compact || (listening && !paused)) && (
          <Group label="Audio waveform">
            <Waveform active={listening && !paused} subscribe={subscribeLevel} />
          </Group>
        )}
        <Group label="Language">
          <select className="we-dictation-select" aria-label="Dictation language" value={lang} onChange={(event) => onLang(event.target.value)}>
            {DICTATION_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Group>
        {!compact && (
          <Group label="Study context">
            <span className="we-dictation-context" title={contextLabel || "General radiology"}>{contextLabel || "General radiology"}</span>
          </Group>
        )}
        <div className="we-dictation-group we-dictation-toggle-wrap">
          <div className="we-dictation-controls">
            <button type="button" className="we-dictation-toggle" aria-expanded={open} onClick={onOpen}>
              Live transcription
              <ChevronDown className={`h-3.5 w-3.5 ${open ? "rotate-180" : ""}`} />
            </button>
          </div>
          <div className="we-dictation-caption">Report preview</div>
        </div>
      </div>
      {!compact && speech && !speech.configured && (
        <p className="we-dictation-note">Transcription is not enabled for this facility.</p>
      )}
      {!compact && speech?.configured && <p className="we-dictation-meta">Transcription model: {speech.model}. Medical terms stay as dictated until you apply a suggestion.</p>}
      {open && (
        <div className="we-dictation-panel">
          <div className="we-dictation-card">
            <div className="we-dictation-title">Live transcription</div>
            <div className="we-dictation-legend" aria-label="Medical term highlighting">
              <span className="we-dictation-swatch"><i className="we-dictation-mark-term" /> Medical term highlighting</span>
              <span className="we-dictation-swatch"><i className="we-dictation-mark-verify" /> Verify</span>
              <span className="we-dictation-swatch"><i className="we-dictation-mark-measure" /> Measurement</span>
            </div>
            <div className="we-dictation-transcript">
              <Transcript text={review?.originalText || ""} review={review} />
              {interim && <p className="we-dictation-help">{interim}</p>}
            </div>
            {!!review?.verify?.length && (
              <ul className="we-dictation-list">
                {review.verify.map((item) => (
                  <li key={`${item.index}-${item.term}`} className="we-dictation-verify">
                    Verify “{item.term}”. Could be confused with {item.alternatives.join(" or ")}. Left unchanged.
                  </li>
                ))}
              </ul>
            )}
            {!!review?.suggestions?.length && (
              <ul className="we-dictation-list">
                {review.suggestions.map((item) => (
                  <li key={`${item.index}-${item.from}-${item.to}`}>
                    <span>Suggestion: “{item.from}” → “{item.to}”. {item.reason}</span>
                    <button type="button" className="we-dictation-link" disabled={readOnly} onClick={() => onAcceptSuggestion(item)}>Apply</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="we-dictation-facts">
              {!!review?.preserved?.laterality?.length && <span>Laterality: {review.preserved.laterality.join(", ")}</span>}
              {!!review?.preserved?.measurements?.length && <span>Measurements: {review.preserved.measurements.join(", ")}</span>}
              {!!review?.preserved?.negations?.length && <span>Negation kept: {review.preserved.negations.length}</span>}
            </div>
            {!!clips?.length && clips.slice(-4).map((clip) => (
              <div key={clip.audioUrl} className="we-dictation-audio">
                <audio controls preload="none" src={clip.audioUrl} />
                <span className="truncate">{clip.text || (clip.error ? "Transcription is not enabled for this facility." : "Audio segment")}</span>
              </div>
            ))}
          </div>
          <div className="we-dictation-card">
            <div className="we-dictation-title">Report preview</div>
            <p className="we-dictation-help">Findings and Impression contain only dictated words. Inserting this preview does not sign the report.</p>
            <div className="we-dictation-sections">
              <SectionBlock label="Study description" value={formatted?.studyDescription} note="From the study record, not from dictation." />
              <SectionBlock label="Clinical indication" value={formatted?.clinical} />
              <SectionBlock label="Technique" value={formatted?.technique} note={formatted?.techniqueSources?.length ? `Dictated: ${formatted.techniqueSources.join(" ")}` : ""} />
              <SectionBlock label="Findings" value={formatted?.findings} primary />
              <SectionBlock label="Impression" value={formatted?.impression} note={impressionNote} primary />
              <SectionBlock label="Recommendations" value={formatted?.recommendations} />
            </div>
            <div className="we-dictation-actions">
              <Button disabled={readOnly} onClick={onSave}>Save Draft</Button>
              <Button disabled={readOnly} onClick={onClear}>Clear</Button>
              <Button disabled={readOnly} onClick={onUndo}>Undo</Button>
              <Button disabled={readOnly} onClick={onRedo}>Redo</Button>
              <Button primary disabled={readOnly} title="Opens the signature review. The report is not signed until you confirm it there." onClick={onApproveReport}>Approve Report</Button>
            </div>
            <div className="we-dictation-actions">
              <Button disabled={readOnly || !formatted?.findings} onClick={onCopyImpression}>Use findings as impression</Button>
              <Button disabled={readOnly || (!formatted?.findings && !formatted?.technique && !formatted?.impression)} onClick={onInsert}>Insert dictated sections</Button>
              <label className="we-dictation-upload">
                Upload audio
                <input type="file" accept="audio/wav,audio/webm,audio/mpeg,audio/mp4,audio/ogg,.wav,.webm,.mp3,.m4a,.ogg" className="sr-only" onChange={(event) => { onUpload(event.target.files?.[0]); event.target.value = ""; }} />
              </label>
            </div>
            <div className="we-dictation-codes">
              <div className="we-dictation-title">Coding suggestions</div>
              <p className="we-dictation-help">{coding?.note || "Codes are optional and stay unsaved until you approve them."}</p>
              {!coding?.suggestions?.length && <p className="we-dictation-help">No code is suggested from the current impression.</p>}
              <ul className="we-dictation-list">
                {(coding?.suggestions || []).map((item) => (
                  <li key={`${item.system}-${item.code}`}>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={Boolean(selectedCodes?.[`${item.system}:${item.code}`])} onChange={() => onToggleCode(item)} />
                      <span>
                        <span className="font-medium">{item.system} {item.code}</span> — {item.description}
                        <span className="text-[#6e6e73]"> · confidence {Math.round((item.confidence || 0) * 100)}% · “{item.sourceText}”</span>
                        {item.caveat && <span className="block text-[#92400e]">{item.caveat}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {!!savedCodes?.length && <p className="we-dictation-help" style={{ color: "#166534" }}>Approved on this draft: {savedCodes.map((item) => `${item.system} ${item.code}`).join(", ")}</p>}
              <div className="we-dictation-manual">
                <input aria-label="Manual code system" value={manual.system} onChange={(event) => setManual({ ...manual, system: event.target.value })} />
                <input aria-label="Manual code" placeholder="Code" value={manual.code} onChange={(event) => setManual({ ...manual, code: event.target.value })} />
                <input aria-label="Manual code description" placeholder="Description you have checked" value={manual.description} onChange={(event) => setManual({ ...manual, description: event.target.value })} />
              </div>
              <div className="we-dictation-actions">
                <Button disabled={readOnly || (!Object.values(selectedCodes || {}).some(Boolean) && !manual.code)} onClick={() => onApproveCodes(manual.code ? manual : null)}>Approve selected codes</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
