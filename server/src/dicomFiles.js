import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";
import { Instance } from "./models.js";
import { orthancBytes, orthancConfigured, orthancFetch, orthancJson } from "./orthancClient.js";

const restoring = new Map();

export function localDicomName(sopUid) {
  return `${String(sopUid || "").replace(/[^0-9.]/g, "_")}.dcm`;
}

export function candidateDicomPaths(instance) {
  const paths = [];
  const stored = String(instance?.filePath || "").trim();
  if (stored) paths.push(stored);
  const name = localDicomName(instance?.sopUid);
  if (name && name !== ".dcm") paths.push(path.join(dataDir(), name));
  if (stored) {
    const base = path.basename(stored);
    if (base && base.endsWith(".dcm")) paths.push(path.join(dataDir(), base));
  }
  return [...new Set(paths.filter(Boolean))];
}

export function fileOnDisk(instance) {
  return candidateDicomPaths(instance).some((filePath) => fs.existsSync(filePath));
}

export function existingDicomPath(instance) {
  return candidateDicomPaths(instance).find((filePath) => fs.existsSync(filePath)) || "";
}

async function resolveOrthancId(instance) {
  if (!orthancConfigured()) return "";
  if (instance.orthancId) {
    try {
      await orthancFetch(`/instances/${encodeURIComponent(instance.orthancId)}`, { timeoutMs: 5000 });
      return instance.orthancId;
    } catch {
      // Stale ids are common when Mongo is shared across hosts; look up by SOP UID next.
    }
  }
  const sopUid = String(instance.sopUid || "").trim();
  if (!sopUid) return "";
  try {
    const matches = await orthancJson("/tools/lookup", { method: "POST", body: sopUid, timeoutMs: 5000 });
    const id = (matches || []).find((item) => item.Type === "Instance")?.ID || "";
    if (id && id !== instance.orthancId) {
      await Instance.updateOne({ _id: instance._id }, { orthancId: id });
      instance.orthancId = id;
    }
    return id;
  } catch {
    return "";
  }
}

async function restoreFromOrthanc(instance) {
  const orthancId = await resolveOrthancId(instance);
  if (!orthancId) return "";
  const buffer = await orthancBytes(`/instances/${encodeURIComponent(orthancId)}/file`, { timeoutMs: 60000 });
  fs.mkdirSync(dataDir(), { recursive: true });
  const filePath = path.join(dataDir(), localDicomName(instance.sopUid));
  const partial = `${filePath}.${process.pid}.part`;
  await fs.promises.writeFile(partial, buffer);
  await fs.promises.rename(partial, filePath);
  await Instance.updateOne({ _id: instance._id }, { filePath, byteLength: buffer.length, orthancId });
  return filePath;
}

// Disks on hosted plans are wiped on restart, so the archive copy is the fallback.
export async function localDicomPath(instance) {
  const existing = existingDicomPath(instance);
  if (existing) {
    if (existing !== instance.filePath) {
      instance.filePath = existing;
      Instance.updateOne({ _id: instance._id }, { filePath: existing }).catch(() => {});
    }
    return existing;
  }
  if (!orthancConfigured()) return "";
  const key = String(instance._id);
  if (!restoring.has(key)) {
    const job = restoreFromOrthanc(instance)
      .catch(() => "")
      .finally(() => restoring.delete(key));
    restoring.set(key, job);
  }
  const filePath = await restoring.get(key);
  if (filePath) instance.filePath = filePath;
  return filePath;
}
