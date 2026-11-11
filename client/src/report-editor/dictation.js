import { findSection, insertSection } from "./documentUtils.js";
import { parseDictation } from "../../../shared/dictation/commands.js";
import { downsample, encodeWav, rms } from "../../../shared/dictation/wav.js";

export const DICTATION_LANGUAGES = [
  ["en-IN", "Indian English"],
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["ta-IN", "Tamil"],
];

const TARGET_RATE = 16000;
const CHUNK_MS = 5000;
const MIN_SECONDS = 0.45;
const SILENCE = 0.012;

export function speechSupported() {
  return typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
}

export async function ensureMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

export function dictationError(code) {
  if (code === "not-allowed") return "Microphone permission was denied. Allow the microphone for this site, then try again.";
  if (code === "audio-capture") return "No microphone was found.";
  if (code === "network") return "Speech recognition could not reach its service. Your report text was not changed.";
  return "Speech recognition stopped. Your report text was not changed.";
}

export function formatUtterance(raw) {
  return parseDictation(raw).text;
}

function focusSection(editor, key) {
  const existing = findSection(editor.state.doc, key);
  if (!existing) {
    insertSection(editor, key);
    return;
  }
  const pos = Math.max(1, existing.to - 1);
  editor.chain().focus().setTextSelection(pos).run();
}

function insertPlain(editor, value) {
  editor.chain().focus().insertContent(`${value} `).run();
}

export function deleteLastSentence(editor) {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false;
  const $from = editor.state.selection.$from;
  if (!$from.parent.isTextblock) return false;
  const before = $from.parent.textContent.slice(0, $from.parentOffset).replace(/\s+$/, "");
  if (!before) return false;
  const parts = before.split(/(?<=[.!?])\s+/);
  const last = parts[parts.length - 1] || "";
  const start = before.length - last.length;
  editor.chain().focus().deleteRange({ from: $from.start() + start, to: $from.start() + before.length }).run();
  return true;
}

export function replaceSpokenTerm(editor, from, to) {
  if (!editor || !from || !to) return false;
  const needle = from.toLowerCase();
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const hay = node.text.toLowerCase();
    let index = hay.lastIndexOf(needle);
    while (index >= 0) {
      const left = index === 0 || !/[a-z0-9]/i.test(hay[index - 1]);
      const right = index + needle.length >= hay.length || !/[a-z0-9]/i.test(hay[index + needle.length]);
      if (left && right) {
        found = { from: pos + index, to: pos + index + from.length };
        return false;
      }
      index = hay.lastIndexOf(needle, index - 1);
    }
    return undefined;
  });
  if (!found) return false;
  editor.chain().focus().insertContentAt(found, to).run();
  return true;
}

export function applyDictationEvents(editor, events, helpers = {}) {
  if (!editor || editor.isDestroyed || !editor.isEditable) return;
  for (const event of events || []) {
    if (event.type === "command") {
      if (event.command === "paragraph") editor.chain().focus().splitBlock().run();
      else if (event.command === "section" && event.key) focusSection(editor, event.key);
      else if (event.command === "nextSection") helpers.nextSection?.();
      else if (event.command === "deleteLastSentence") deleteLastSentence(editor);
      else if (event.command === "undo") editor.chain().focus().undo().run();
      else if (event.command === "stop") helpers.stop?.();
      else if (event.command === "resume") helpers.resume?.();
    } else if (event.value?.trim()) insertPlain(editor, event.value.trim());
  }
}

export function applyDictation(editor, raw, helpers) {
  const events = Array.isArray(raw?.events) ? raw.events : parseDictation(typeof raw === "string" ? raw : raw?.text || "").events;
  applyDictationEvents(editor, events, helpers);
}

export function insertStructuredReport(editor, formatted) {
  const keys = ["clinical", "technique", "comparison", "findings", "impression", "recommendations"];
  let count = 0;
  for (const key of keys) {
    const value = String(formatted?.[key] || "").trim();
    if (!value) continue;
    focusSection(editor, key);
    insertPlain(editor, value);
    count += 1;
  }
  return count;
}

function concatSamples(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

export function createDictation({ lang, getContext, transcribe, onFinal, onClip, onInterim, onState, onError, onLevel }) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let language = lang || "en-IN";
  let audioContext = null;
  let stream = null;
  let processor = null;
  let want = false;
  let paused = false;
  let samples = [];
  let timer = 0;
  let raf = 0;
  let analyser = null;
  let chain = Promise.resolve();

  function emit(listening) {
    onState?.({ listening, paused: Boolean(listening && paused) });
  }

  function stopMeter() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function meter() {
    if (!analyser || !want || paused) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let index = 0; index < data.length; index += 1) {
      const value = (data[index] - 128) / 128;
      sum += value * value;
    }
    onLevel?.(Math.min(1, Math.sqrt(sum / data.length) * 3.4));
    raf = requestAnimationFrame(meter);
  }

  async function flush() {
    if (!samples.length || !audioContext) return;
    const pending = samples.splice(0);
    const merged = downsample(concatSamples(pending), audioContext.sampleRate, TARGET_RATE);
    if (merged.length < TARGET_RATE * MIN_SECONDS || rms(merged) < SILENCE) return;
    const blob = new Blob([encodeWav(merged, TARGET_RATE)], { type: "audio/wav" });
    const audioUrl = URL.createObjectURL(blob);
    const meta = typeof getContext === "function" ? (getContext() || {}) : {};
    onInterim?.("Transcribing…");
    try {
      const result = await transcribe(blob, { ...meta, language });
      onInterim?.("");
      onClip?.({ audioUrl, text: result?.originalText || "" });
      onFinal?.(result || {});
    } catch (error) {
      onInterim?.("");
      onClip?.({ audioUrl, text: "", error: error.message || "Transcription failed." });
      onError?.(error.message || "Transcription failed. The report was not changed.");
    }
  }

  function enqueue() {
    chain = chain.then(flush, flush);
    return chain;
  }

  function release() {
    stopMeter();
    if (timer) clearInterval(timer);
    timer = 0;
    try { processor?.disconnect(); } catch { /* already stopped */ }
    try { stream?.getTracks().forEach((track) => track.stop()); } catch { /* already stopped */ }
    const closing = audioContext;
    processor = null;
    stream = null;
    analyser = null;
    audioContext = null;
    if (closing) closing.close().catch(() => {});
  }

  return {
    async start() {
      if (!speechSupported()) {
        onError?.("This browser cannot capture microphone audio. Upload a WAV, WebM, or MP3 file instead.");
        return false;
      }
      if (!transcribe) {
        onError?.("Dictation is not connected to the transcription service.");
        return false;
      }
      want = true;
      paused = false;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        audioContext = new AudioCtx();
        await audioContext.resume();
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        const mute = audioContext.createGain();
        mute.gain.value = 0;
        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(mute);
        mute.connect(audioContext.destination);
        processor.onaudioprocess = (event) => {
          if (!want || paused) return;
          samples.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        };
        timer = window.setInterval(() => { if (want && !paused) enqueue(); }, CHUNK_MS);
        emit(true);
        meter();
        return true;
      } catch {
        want = false;
        release();
        onError?.("Microphone permission was denied. Allow the microphone for this site, then try again.");
        emit(false);
        return false;
      }
    },
    pause() {
      if (!want) return;
      paused = true;
      stopMeter();
      emit(true);
      return enqueue();
    },
    resume() {
      if (!want) return this.start();
      paused = false;
      emit(true);
      meter();
      return true;
    },
    async stop() {
      const running = want;
      want = false;
      paused = false;
      if (running) await enqueue();
      release();
      onInterim?.("");
      emit(false);
    },
    setLang(next) {
      language = next || "en-IN";
    },
  };
}
