const DEFAULT_TIMEOUT_MS = 30000;

function isAbortError(error) {
  if (!error) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  if (error.code === "ABORT_ERR") return true;
  return isAbortError(error.cause);
}

export function orthancConfigured() {
  return Boolean(String(process.env.ORTHANC_URL || "").trim());
}

export function orthancReady() {
  return Boolean(orthancBase() && process.env.ORTHANC_USERNAME && process.env.ORTHANC_PASSWORD);
}

export function orthancBase() {
  return String(process.env.ORTHANC_URL || "").replace(/\/$/, "");
}

export function orthancHeaders(extra = {}) {
  const headers = { ...extra };
  if (process.env.ORTHANC_USERNAME) {
    headers.authorization = `Basic ${Buffer.from(`${process.env.ORTHANC_USERNAME}:${process.env.ORTHANC_PASSWORD || ""}`).toString("base64")}`;
  }
  return headers;
}

export function orthancError(message, status, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function describeOrthancFailure(status) {
  if (status === 401 || status === 403) return "Orthanc rejected the archive credentials";
  if (status === 404) return "Orthanc did not find that resource";
  return `Orthanc request failed (${status})`;
}

export function createOrthancAbortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

export async function orthancFetch(path, options = {}, fetchImpl = globalThis.fetch) {
  const base = orthancBase();
  if (!base) throw orthancError("Orthanc is not configured", 503);
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base}${path}`, {
      method: options.method || "GET",
      headers: orthancHeaders(options.headers || {}),
      body: options.body,
      signal: options.signal || controller.signal,
    });
    if (!response.ok) {
      throw orthancError(describeOrthancFailure(response.status), 502, { orthancStatus: response.status });
    }
    return response;
  } catch (error) {
    if (isAbortError(error)) throw orthancError("Orthanc did not respond before the timeout", 504);
    if (error.status) throw error;
    throw orthancError("Orthanc is unavailable", 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function orthancJson(path, options = {}, fetchImpl = globalThis.fetch) {
  const response = await orthancFetch(path, options, fetchImpl);
  return response.json();
}

export async function orthancBytes(path, options = {}, fetchImpl = globalThis.fetch) {
  const response = await orthancFetch(path, options, fetchImpl);
  return Buffer.from(await response.arrayBuffer());
}

export async function orthancText(path, options = {}, fetchImpl = globalThis.fetch) {
  const response = await orthancFetch(path, { ...options, method: options.method || "GET" }, fetchImpl);
  return response.text();
}

export async function orthancSystem(fetchImpl = globalThis.fetch) {
  if (!orthancConfigured()) return { configured: false, reachable: false };
  try {
    const system = await orthancJson("/system", {}, fetchImpl);
    return {
      configured: true,
      reachable: true,
      version: system.Version || "",
      name: system.Name || "",
      dicomAet: system.DicomAet || "",
      dicomPort: system.DicomPort || null,
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      error: error.message,
    };
  }
}
