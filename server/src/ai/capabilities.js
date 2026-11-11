const SUPPORTED_MODALITIES = new Set(["CT", "MR", "DX", "CR", "US", "MG", "XA", "PT"]);

export function providerCapabilities(env = process.env) {
  const baseUrl = String(env.AI_BASE_URL || "").trim();
  const apiKey = String(env.AI_API_KEY || "").trim();
  const configured = Boolean(baseUrl && apiKey);
  return {
    configured,
    provider: String(env.AI_PROVIDER || "openai-compatible"),
    model: String(env.AI_MODEL || ""),
    medicalDevice: false,
    tasks: {
      analyzeImage: configured,
      analyzeSeries: false,
      generateReportDraft: configured,
      annotations: false,
      segmentation: false,
      dicomNative: false,
      volumetric: false,
    },
    limitations: [
      "The configured provider is a general-purpose model. It is not a validated medical imaging device.",
      "It does not provide calibrated coordinates, segmentation masks, or clinical confidence scores.",
      "Only the one image you select is sent. The rest of the study is not analyzed.",
      "Patient name, medical record number, and date of birth are not included in the provider request.",
    ],
  };
}

export function modalitySupport(modality) {
  const code = String(modality || "").trim().toUpperCase();
  if (!code) return { supported: false, reason: "The study has no modality, so image analysis is disabled." };
  if (!SUPPORTED_MODALITIES.has(code)) {
    return { supported: false, reason: `${code} is not enabled for this AI provider.` };
  }
  return { supported: true, reason: "" };
}

export function timeoutMs(env = process.env) {
  const value = Number(env.AI_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1000 ? value : 90000;
}

export function maxImageBytes(env = process.env) {
  const megabytes = Number(env.AI_MAX_IMAGE_SIZE_MB);
  const size = Number.isFinite(megabytes) && megabytes > 0 ? megabytes : 4;
  return Math.round(size * 1024 * 1024);
}
