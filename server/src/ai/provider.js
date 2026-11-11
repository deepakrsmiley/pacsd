import { providerCapabilities, timeoutMs } from "./capabilities.js";
import { extractJson } from "./response.js";

export async function completeChat({ messages, fetchImpl = globalThis.fetch, env = process.env, signal }) {
  const capabilities = providerCapabilities(env);
  if (!capabilities.configured) {
    const error = new Error("AI is not configured. Set AI_BASE_URL and AI_API_KEY on the server.");
    error.status = 503;
    throw error;
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs(env));
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetchImpl(String(env.AI_BASE_URL).trim(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(env.AI_API_KEY).trim()}`,
      },
      body: JSON.stringify({
        model: capabilities.model || "gpt-4o-mini",
        temperature: 0.1,
        messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error("The AI provider rejected the request");
      error.status = 502;
      throw error;
    }
    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content || "";
    return extractJson(text);
  } catch (error) {
    if (error.name === "AbortError") {
      const stopped = new Error(timedOut ? "The AI provider did not answer before the timeout" : "The analysis was cancelled");
      stopped.status = timedOut ? 504 : 499;
      throw stopped;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

const ANALYSIS_INSTRUCTIONS = [
  "You are assisting a radiologist. You are not a medical device and you must not give a diagnosis.",
  "Use only what is visible in the supplied image and the metadata in this request.",
  "Do not invent patient history, comparisons, measurements, prior studies, or negative findings.",
  "Do not return image coordinates, masks, or confidence percentages.",
  "If the image is not sufficient, set status to insufficient_quality and leave findings empty.",
  "Return JSON with keys status, findings, limitations, and draft.",
  "status is one of review_recommended, insufficient_quality, unsupported.",
  "findings is an array of objects with title, location, description, evidence, limitations, followUp.",
  "draft has clinical, technique, comparison, findings, impression, recommendations.",
  "Write 'Not assessed from the supplied image.' for any draft section you cannot support.",
].join(" ");

export function analysisMessages({ modality, description, rows, columns, frame, image }) {
  const facts = {
    modality: modality || "",
    description: description || "",
    rows,
    columns,
    frame,
    imagesSent: 1,
  };
  const content = [{ type: "text", text: JSON.stringify(facts) }];
  if (image?.base64) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${image.mediaType || "image/png"};base64,${image.base64}` },
    });
  }
  return [
    { role: "system", content: ANALYSIS_INSTRUCTIONS },
    { role: "user", content },
  ];
}

export function draftMessages({ modality, description, clinical, findings }) {
  return [
    {
      role: "system",
      content: "Write a radiology draft from the supplied notes only. Do not add history, measurements, comparisons, or normal findings that are not in the notes. Return JSON with keys clinical, technique, comparison, findings, impression, recommendations. Use 'Not stated.' when a section has no source.",
    },
    {
      role: "user",
      content: JSON.stringify({ modality, description, clinical, findings }),
    },
  ];
}
