import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";
import { Instance } from "./models.js";
import { orthancBytes, orthancConfigured } from "./orthancClient.js";

const restoring = new Map();

export function localDicomName(sopUid) {
  return `${String(sopUid || "").replace(/[^0-9.]/g, "_")}.dcm`;
}

async function restoreFromOrthanc(instance) {
  const buffer = await orthancBytes(`/instances/${encodeURIComponent(instance.orthancId)}/file`, { timeoutMs: 60000 });
  fs.mkdirSync(dataDir(), { recursive: true });
  const filePath = path.join(dataDir(), localDicomName(instance.sopUid));
  const partial = `${filePath}.${process.pid}.part`;
  await fs.promises.writeFile(partial, buffer);
  await fs.promises.rename(partial, filePath);
  await Instance.updateOne({ _id: instance._id }, { filePath, byteLength: buffer.length });
  return filePath;
}

// Disks on hosted plans are wiped on restart, so the archive copy is the fallback.
export async function localDicomPath(instance) {
  if (instance.filePath && fs.existsSync(instance.filePath)) return instance.filePath;
  if (!instance.orthancId || !orthancConfigured()) return "";
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
