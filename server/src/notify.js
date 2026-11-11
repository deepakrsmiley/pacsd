import nodemailer from "nodemailer";
import { extractJson, normalizeDraft, plainText } from "./ai/response.js";
import { speechStatus } from "./dictation/transcribe.js";
import { orthancBytes, orthancConfigured, orthancJson } from "./orthancClient.js";

export function integrationStatus() {
  const speech = speechStatus();
  return {
    smtp: Boolean(process.env.SMTP_HOST),
    whatsapp: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    whatsappTemplate: Boolean(process.env.WHATSAPP_TEMPLATE_NAME),
    ai: Boolean(process.env.AI_BASE_URL),
    orthanc: Boolean(process.env.ORTHANC_URL),
    speech: speech.configured,
    speechModel: speech.model,
  };
}

function mailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || "" }
      : undefined,
  });
}

export async function sendReportEmail({ to, subject, text, pdf, filename }) {
  const transport = mailer();
  if (!transport) {
    const error = new Error("Email is not configured");
    error.status = 503;
    throw error;
  }
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
  });
}

export function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export function whatsappWebUrl(phone, text) {
  const digits = String(phone || "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text || "")}`;
}

export function normalizePhone(recipient, countryCode = "") {
  const raw = String(recipient || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+") || raw.startsWith("00")) return digits.replace(/^00/, "");
  const code = String(countryCode || "").replace(/\D/g, "");
  if (code && !digits.startsWith(code)) return `${code}${digits}`;
  return digits;
}

function whatsappEndpoint(suffix) {
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
  return `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/${suffix}`;
}

export async function sendWhatsAppDocument({ to, filename, pdf, caption }) {
  if (!whatsappConfigured()) {
    const error = new Error("WhatsApp Business is not configured");
    error.status = 503;
    throw error;
  }
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([pdf], { type: "application/pdf" }), filename || "report.pdf");
  const uploaded = await fetch(whatsappEndpoint("media"), {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    body: form,
  });
  const uploadedBody = await uploaded.json().catch(() => ({}));
  if (!uploaded.ok || !uploadedBody.id) {
    const error = new Error("WhatsApp Business rejected the PDF upload");
    error.status = 502;
    error.detail = JSON.stringify(uploadedBody).slice(0, 500);
    throw error;
  }
  const response = await fetch(whatsappEndpoint("messages"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { id: uploadedBody.id, filename: filename || "report.pdf", caption: String(caption || "").slice(0, 1024) },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("WhatsApp Business rejected the document message");
    error.status = 502;
    error.detail = JSON.stringify(body).slice(0, 500);
    throw error;
  }
  return body.messages?.[0]?.id || uploadedBody.id;
}

export async function sendWhatsApp({ to, patientName, link }) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    const error = new Error("WhatsApp Business is not configured");
    error.status = 503;
    throw error;
  }
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
  const url = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = process.env.WHATSAPP_TEMPLATE_NAME
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE_NAME,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: patientName },
                { type: "text", text: link },
              ],
            },
          ],
        },
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: `Galactic Medical Systems report for ${patientName}: ${link}` },
      };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error("WhatsApp Business rejected the message");
    error.status = 502;
    error.detail = detail.slice(0, 500);
    throw error;
  }
}

export { transcribeAudio } from "./dictation/transcribe.js";

export async function requestReportAssist({ findings, impression, modality, description }) {
  if (!process.env.AI_BASE_URL) {
    const error = new Error("AI assist is not configured");
    error.status = 503;
    throw error;
  }
  const response = await fetch(process.env.AI_BASE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.AI_API_KEY ? { authorization: `Bearer ${process.env.AI_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You help a radiologist structure a draft. Return JSON with keys findings and impression. Do not invent measurements or findings that are absent from the input. If information is missing, say it is not stated.",
        },
        {
          role: "user",
          content: JSON.stringify({ modality, description, findings, impression }),
        },
      ],
    }),
  });
  if (!response.ok) {
    const error = new Error("AI assist endpoint returned an error");
    error.status = 502;
    throw error;
  }
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content || "";
  try {
    const draft = normalizeDraft(extractJson(text));
    if (!draft.findings && !draft.impression) return { findings: plainText(text, 8000), impression: "" };
    return { findings: draft.findings, impression: draft.impression };
  } catch {
    return { findings: plainText(text, 8000), impression: "" };
  }
}

export async function storeInOrthanc(buffer) {
  if (!orthancConfigured()) return "";
  const payload = await orthancJson("/instances", {
    method: "POST",
    headers: { "content-type": "application/dicom" },
    body: buffer,
  });
  return payload.ID || payload.id || "";
}

export async function orthancPreview(orthancId) {
  if (!orthancConfigured() || !orthancId) return null;
  try {
    return await orthancBytes(`/instances/${encodeURIComponent(orthancId)}/preview`);
  } catch {
    return null;
  }
}
