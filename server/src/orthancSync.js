import { DicomNode, Facility, Instance, OrthancCursor, Study, TransferJob } from "./models.js";
import { parseDicomBuffer } from "./dicom.js";
import { ingestDicomBuffer } from "./ingest.js";
import { orthancBytes, orthancConfigured, orthancJson, orthancText } from "./orthancClient.js";

const CURSOR_KEY = "changes";
const BACKFILL_LIMIT = 40;

export async function syncOrthancOnce(fetchImpl = globalThis.fetch) {
  if (!orthancConfigured()) return { skipped: true };
  const cursor = await OrthancCursor.findOne({ key: CURSOR_KEY });
  let since = cursor?.lastSeq || 0;
  let last = since;
  for (;;) {
    const page = await orthancJson(`/changes?since=${since}&limit=100`, {}, fetchImpl);
    for (const change of page.Changes || []) {
      if (change.ChangeType === "NewInstance") await importOrthancInstance(change.ID, fetchImpl);
    }
    last = Number.isFinite(page.Last) ? page.Last : since;
    if (page.Done !== false || last === since) break;
    since = last;
  }
  await OrthancCursor.findOneAndUpdate({ key: CURSOR_KEY }, { key: CURSOR_KEY, lastSeq: last }, { upsert: true });
  await reconcileMissingStudies(fetchImpl);
  return { lastSeq: last };
}

async function reconcileMissingStudies(fetchImpl) {
  const studyIds = await orthancJson("/studies", {}, fetchImpl);
  let imported = 0;
  const remainder = [];
  for (const studyId of studyIds || []) {
    const info = await orthancJson(`/studies/${studyId}`, {}, fetchImpl);
    const uid = info?.MainDicomTags?.StudyInstanceUID || "";
    const instances = await orthancJson(`/studies/${studyId}/instances`, {}, fetchImpl);
    const existing = uid
      ? await Study.findOne({ $or: [{ studyUid: uid }, { aliases: uid }] }).select("_id")
      : null;
    if (!existing && instances?.[0]?.ID) {
      await importOrthancInstance(instances[0].ID, fetchImpl);
      imported += 1;
      remainder.push(...instances.slice(1));
      continue;
    }
    if (!existing) continue;
    const count = await Instance.countDocuments({ studyId: existing._id });
    if (count < (instances || []).length) remainder.push(...instances);
  }
  for (const instance of remainder) {
    if (imported >= BACKFILL_LIMIT) break;
    const orthancId = instance.ID || instance;
    const already = await Instance.findOne({ orthancId }).select("_id");
    await importOrthancInstance(orthancId, fetchImpl);
    if (!already) imported += 1;
  }
}

async function defaultFacilityId() {
  const named = await Facility.findOne({ code: "GNW", active: { $ne: false } }).select("_id");
  if (named) return named._id;
  const first = await Facility.findOne({ active: { $ne: false } }).sort({ createdAt: 1 }).select("_id");
  return first?._id || null;
}

async function importOrthancInstance(orthancId, fetchImpl) {
  const already = await Instance.findOne({ orthancId }).select("_id");
  if (already) return;
  let aeTitle = "";
  try {
    aeTitle = (await orthancText(`/instances/${orthancId}/metadata/RemoteAET`, {}, fetchImpl)).trim().toUpperCase();
  } catch {
    aeTitle = "";
  }
  const node = aeTitle ? await DicomNode.findOne({ aeTitle, enabled: true }) : null;
  let facilityId = node?.facilityId || null;
  if (!facilityId) facilityId = await defaultFacilityId();
  if (!facilityId) {
    const prior = await TransferJob.findOne({ source: "orthanc", fileName: orthancId, error: "Unknown AE title" });
    if (!prior) {
      await TransferJob.create({
        direction: "inbound",
        source: "orthanc",
        fileName: orthancId,
        status: "rejected",
        error: "Unknown AE title",
      });
    }
    return;
  }
  if (aeTitle && !node) {
    await DicomNode.findOneAndUpdate(
      { aeTitle },
      {
        $setOnInsert: {
          name: aeTitle,
          aeTitle,
          host: "127.0.0.1",
          port: 104,
          facilityId,
          enabled: true,
        },
      },
      { upsert: true },
    );
  }
  const buffer = await orthancBytes(`/instances/${orthancId}/file`, {}, fetchImpl);
  const parsed = parseDicomBuffer(buffer);
  const existing = await Instance.findOne({ sopUid: parsed.sopUid }).select("studyId");
  if (existing) {
    const study = await Study.findById(existing.studyId).select("facilityId");
    if (study && String(study.facilityId) === String(facilityId)) return;
    const prior = await TransferJob.findOne({ source: "orthanc", fileName: `${orthancId}.dcm`, status: "rejected" });
    if (prior) return;
  }
  await ingestDicomBuffer({
    buffer,
    facilityId,
    source: "orthanc",
    fileName: `${orthancId}.dcm`,
    orthancId,
  });
}

let timer;
let inFlight = false;
let lastError = "";

export function startOrthancPoller() {
  if (!orthancConfigured() || timer) return;
  const tick = () => {
    if (inFlight) return;
    inFlight = true;
    syncOrthancOnce()
      .then(() => {
        if (lastError) console.log("Orthanc sync resumed");
        lastError = "";
      })
      .catch((error) => {
        if (error.message !== lastError) {
          console.error(`Orthanc sync failed: ${error.message}`);
          lastError = error.message;
        }
      })
      .finally(() => {
        inFlight = false;
      });
  };
  timer = setInterval(tick, 10000);
  if (typeof timer.unref === "function") timer.unref();
  tick();
}
