import { buildSpeechPrompt, interpretDictation } from "../../../shared/dictation/pipeline.js";

const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/flac",
  "application/octet-stream",
  "",
]);

export function resolveSpeechModel(env = process.env) {
  if (env.SPEECH_MODEL) return String(env.SPEECH_MODEL).slice(0, 80);
  if (/api\.openai\.com/i.test(env.SPEECH_BASE_URL || "")) return "gpt-4o-mini-transcribe";
  return "whisper-1";
}

export function speechStatus(env = process.env) {
  const configured = Boolean(env.SPEECH_BASE_URL);
  return { configured, model: configured ? resolveSpeechModel(env) : "" };
}

export function hasAudioSignature(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const head = buffer.subarray(0, 12).toString("latin1");
  if (head.startsWith("RIFF") && buffer.subarray(8, 12).toString("latin1") === "WAVE") return true;
  if (head.startsWith("OggS") || head.startsWith("ID3") || head.startsWith("fLaC")) return true;
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true;
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return true;
  if (buffer.subarray(4, 8).toString("latin1") === "ftyp") return true;
  return false;
}

export function inspectAudio(file) {
  if (!file?.buffer?.length) return "An audio file is required";
  if (file.size > 8 * 1024 * 1024) return "Audio must be 8 MB or smaller";
  const mime = String(file.mimetype || "").toLowerCase().split(";")[0].trim();
  if (!AUDIO_TYPES.has(mime)) return "Upload a WAV, WebM, MP3, M4A, or Ogg audio file.";
  if (!hasAudioSignature(file.buffer)) return "The file is not a recognized audio recording.";
  return "";
}

export async function transcribeAudio({ bytes, filename, mime, language, prompt }) {
  if (!process.env.SPEECH_BASE_URL) {
    const error = new Error("Server transcription is not configured. Set SPEECH_BASE_URL and SPEECH_API_KEY on the server.");
    error.status = 503;
    throw error;
  }
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime || "audio/wav" }), filename || "dictation.wav");
  form.append("model", resolveSpeechModel());
  const lang = String(language || "en").slice(0, 12).split("-")[0];
  if (lang) form.append("language", lang);
  if (prompt && process.env.SPEECH_SEND_PROMPT !== "false") form.append("prompt", String(prompt).slice(0, 700));
  form.append("response_format", "json");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.SPEECH_TIMEOUT_MS || 30000));
  try {
    const response = await fetch(process.env.SPEECH_BASE_URL, {
      method: "POST",
      headers: process.env.SPEECH_API_KEY ? { authorization: `Bearer ${process.env.SPEECH_API_KEY}` } : {},
      body: form,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.text !== "string") {
      const error = new Error(response.status === 401 || response.status === 403
        ? "The transcription service rejected the server API key."
        : "Transcription failed. The report was not changed.");
      error.status = 502;
      throw error;
    }
    return body.text;
  } catch (error) {
    if (error?.status) throw error;
    if (error?.name === "AbortError") {
      const timeout = new Error("Transcription timed out. The report was not changed.");
      timeout.status = 504;
      throw timeout;
    }
    const wrapped = new Error("Transcription could not reach the speech service. The report was not changed.");
    wrapped.status = 502;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeDictation({ bytes, filename, mime, language, modality, description, bodyPart, vocabulary }) {
  const prompt = buildSpeechPrompt({ modality, description, bodyPart, vocabulary });
  const text = await transcribeAudio({ bytes, filename, mime, language, prompt });
  const interpreted = interpretDictation(text, { modality, description, bodyPart, vocabulary });
  return {
    text: interpreted.text,
    originalText: text,
    events: interpreted.events,
    commands: interpreted.commands.map((command) => ({ command: command.command, key: command.key || "" })),
    formatted: interpreted.formatted,
    review: {
      verify: interpreted.review.verify,
      suggestions: interpreted.review.suggestions,
      preserved: interpreted.review.preserved,
      recognized: interpreted.review.recognized,
      replaced: false,
    },
    context: { key: interpreted.context.key, label: interpreted.context.label },
    coding: interpreted.formatted.impression ? interpreted.coding : { ...interpreted.coding, suggestions: interpreted.formatted.impression ? interpreted.coding.suggestions : [] },
    model: resolveSpeechModel(),
    configured: true,
  };
}
