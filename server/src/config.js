import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function dataDir() {
  return process.env.DICOM_DIR || path.join(serverRoot, "data");
}

export function backupDir() {
  return process.env.BACKUP_DIR || path.join(serverRoot, "pacsd-backups");
}

export function assertProductionConfig(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  if (env.SEED_DEMO === "true") {
    throw new Error("SEED_DEMO must not be true in production");
  }
  const secret = String(env.SESSION_SECRET || "");
  if (secret.length < 32 || secret.includes("replace-this")) {
    throw new Error("SESSION_SECRET must be at least 32 characters and must not contain replace-this");
  }
  const base = String(env.PUBLIC_BASE_URL || "");
  if (!base || /localhost|127\.0\.0\.1/i.test(base)) {
    throw new Error("PUBLIC_BASE_URL is required in production and must not contain localhost");
  }
  if (env.ORTHANC_URL && (!env.ORTHANC_USERNAME || !env.ORTHANC_PASSWORD)) {
    throw new Error("ORTHANC_USERNAME and ORTHANC_PASSWORD are required when ORTHANC_URL is set");
  }
}

export function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production");
  }
  return "pacsd-development-secret";
}

export function publicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    return `http://localhost:${process.env.PORT || 8080}`;
  }
  return "http://localhost:5173";
}

export function cookieSecure() {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function webOrigin() {
  return process.env.WEB_ORIGIN || "http://localhost:5173";
}