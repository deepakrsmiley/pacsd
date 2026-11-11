import { orthancBytes, orthancConfigured } from "../orthancClient.js";
import { maxImageBytes } from "./capabilities.js";

export async function loadAnalysisImage(instance) {
  if (!instance?.orthancId || !orthancConfigured()) {
    return {
      ok: false,
      status: "insufficient_quality",
      message: "This image has no Orthanc preview, so it was not sent to the AI provider.",
    };
  }
  let bytes;
  try {
    bytes = await orthancBytes(`/instances/${encodeURIComponent(instance.orthancId)}/preview`);
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error.message || "Orthanc did not return a preview",
    };
  }
  if (!bytes?.length) {
    return { ok: false, status: "insufficient_quality", message: "Orthanc returned an empty preview." };
  }
  if (bytes.length > maxImageBytes()) {
    return {
      ok: false,
      status: "insufficient_quality",
      message: "The preview is larger than AI_MAX_IMAGE_SIZE_MB, so it was not sent.",
    };
  }
  return { ok: true, bytes, mediaType: "image/png" };
}
