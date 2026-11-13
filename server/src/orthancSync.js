import { DicomNode, Facility, Instance, OrthancCursor, Study, TransferJob } from "./models.js";
import { parseDicomBuffer } from "./dicom.js";
import { ingestDicomBuffer } from "./ingest.js";
import { orthancBytes, orthancConfigured, orthancJson, orthancText } from "./orthancClient.js";
import { settleInactiveTransfers, verifyStudyQuiet } from "./transferProgress.js";

const CURSOR_KEY = "changes";
const BACKFILL_LIMIT = 300;
const IMPORT_CONCURRENCY = 8;
const CHANGES_PAGE = 50;
const CHANGES_PER_SYNC = 150;

const listedStudies = new Set();
const expectedCache = new Map();

export async function syncOrthancOnce(fetchImpl = globalThis.fetch) {
  if (!orthancConfigured()) return { skipped: true };
  const studyIds = (await orthancJson("/studies", {}, fetchImpl)) || [];
  await listNewStudies(studyIds, fetchImpl);
  const cursor = await OrthancCursor.findOne({ key: CURSOR_KEY });
  let since = cursor?.lastSeq || 0;
  let last = since;
  let processed = 0;
  let more = false;
  for (;;) {
    const page = await orthancJson(`/changes?since=${since}&limit=${CHANGES_PAGE}`, {}, fetchImpl);
    for (const change of page.Changes || []) {
      if (change.ChangeType === "NewInstance") await importOrthancInstance(change.ID, fetchImpl);
      if (change.ChangeType === "StableStudy") {
        try {
          await handleStableStudy(change.ID, fetchImpl);
        } catch {
          // Study may still be importing; the inactivity settler retries.
        }
      }
    }
    processed += (page.Changes || []).length;
    last = Number.isFinite(page.Last) ? page.Last : since;
    await OrthancCursor.findOneAndUpdate({ key: CURSOR_KEY }, { key: CURSOR_KEY, lastSeq: last }, { upsert: true });
    if (page.Done !== false || last === since) break;
    if (processed >= CHANGES_PER_SYNC) {
      more = true;
      break;
    }
    since = last;
  }
  if (await reconcileMissingStudies(studyIds, fetchImpl)) more = true;
  await settleInactiveTransfers();
  return { lastSeq: last, more };
}

async function listNewStudies(studyIds, fetchImpl) {
  for (const studyId of studyIds) {
    if (listedStudies.has(studyId)) continue;
    const info = await orthancJson(`/studies/${studyId}`, {}, fetchImpl);
    const uid = info?.MainDicomTags?.StudyInstanceUID || "";
    if (!uid) continue;
    const existing = await Study.findOne({ $or: [{ studyUid: uid }, { aliases: uid }] }).select("_id orthancStudyId");
    if (!existing) {
      const instances = await orthancJson(`/studies/${studyId}/instances`, {}, fetchImpl);
      if (!instances?.[0]?.ID) continue;
      await importOrthancInstance(instances[0].ID, fetchImpl);
    } else if (!existing.orthancStudyId) {
      await Study.updateOne({ _id: existing._id }, { orthancStudyId: studyId });
    }
    listedStudies.add(studyId);
  }
}

async function reconcileMissingStudies(studyIds, fetchImpl) {
  let budget = BACKFILL_LIMIT;
  for (const studyId of studyIds || []) {
    if (budget <= 0) return true;
    budget -= await backfillOrthancStudy(studyId, budget, fetchImpl);
  }
  return budget <= 0;
}

async function mapPool(items, limit, worker) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

async function importQuietly(orthancId, fetchImpl) {
  try {
    await importInstanceNow(orthancId, fetchImpl);
  } catch {
    // The transfer log records the rejection and the next pass retries it.
  }
}

const studyBackfills = new Map();

// The first image of each series goes through the queue so the study and series
// rows exist before the rest of that series is pulled in parallel.
function backfillOrthancStudy(orthancStudyId, limit, fetchImpl) {
  if (studyBackfills.has(orthancStudyId)) return studyBackfills.get(orthancStudyId).then(() => 0);
  const job = (async () => {
    const instances = (await orthancJson(`/studies/${orthancStudyId}/instances`, {}, fetchImpl)) || [];
    const ids = instances.map((item) => item.ID).filter(Boolean);
    const known = new Set((await Instance.find({ orthancId: { $in: ids } }).select("orthancId")).map((item) => item.orthancId));
    const pending = instances.filter((item) => item.ID && !known.has(item.ID)).slice(0, limit);
    const bySeries = new Map();
    for (const item of pending) {
      const key = item.ParentSeries || "";
      if (!bySeries.has(key)) bySeries.set(key, []);
      bySeries.get(key).push(item.ID);
    }
    const groups = [...bySeries.values()];
    for (const group of groups) {
      await importOrthancInstance(group[0], fetchImpl).catch(() => {});
    }
    await mapPool(groups.flatMap((group) => group.slice(1)), IMPORT_CONCURRENCY, (id) => importQuietly(id, fetchImpl));
    return pending.length;
  })().finally(() => studyBackfills.delete(orthancStudyId));
  studyBackfills.set(orthancStudyId, job);
  return job;
}

async function orthancStudyIdFor(studyUid) {
  const matches = await orthancJson("/tools/lookup", { method: "POST", body: studyUid, timeoutMs: 5000 });
  return (matches || []).find((item) => item.Type === "Study")?.ID || "";
}

async function orthancExpectedCount(orthancStudyId, fetchImpl) {
  if (!orthancStudyId) return null;
  if (expectedCache.has(orthancStudyId)) return expectedCache.get(orthancStudyId);
  try {
    const stats = await orthancJson(`/studies/${orthancStudyId}/statistics`, { timeoutMs: 5000 }, fetchImpl);
    const count = Number(stats?.CountInstances) || 0;
    const value = count > 0 ? count : null;
    expectedCache.set(orthancStudyId, value);
    return value;
  } catch {
    return null;
  }
}

export async function archiveImageCount(studyUid) {
  if (!orthancConfigured() || !studyUid) return 0;
  try {
    const id = await orthancStudyIdFor(studyUid);
    if (!id) return 0;
    const stats = await orthancJson(`/studies/${id}/statistics`, { timeoutMs: 5000 });
    return Number(stats?.CountInstances) || 0;
  } catch {
    return 0;
  }
}

export async function backfillStudyByUid(studyUid) {
  if (!orthancConfigured()) return 0;
  const id = await orthancStudyIdFor(studyUid);
  if (!id) return 0;
  return backfillOrthancStudy(id, Number.POSITIVE_INFINITY);
}

async function handleStableStudy(orthancStudyId, fetchImpl) {
  if (!orthancStudyId) return;
  expectedCache.delete(orthancStudyId);
  const info = await orthancJson(`/studies/${orthancStudyId}`, {}, fetchImpl);
  const uid = info?.MainDicomTags?.StudyInstanceUID || "";
  let study = uid
    ? await Study.findOne({ $or: [{ studyUid: uid }, { aliases: uid }, { orthancStudyId }] })
    : await Study.findOne({ orthancStudyId });
  if (!study) {
    await backfillOrthancStudy(orthancStudyId, Number.POSITIVE_INFINITY, fetchImpl);
    study = uid
      ? await Study.findOne({ $or: [{ studyUid: uid }, { aliases: uid }, { orthancStudyId }] })
      : await Study.findOne({ orthancStudyId });
  }
  if (!study) return;
  if (!study.orthancStudyId) {
    study.orthancStudyId = orthancStudyId;
    await study.save();
  }
  await verifyStudyQuiet(study._id, { fromStable: true });
}

async function defaultFacilityId() {
  const named = await Facility.findOne({ code: "GNW", active: { $ne: false } }).select("_id");
  if (named) return named._id;
  const first = await Facility.findOne({ active: { $ne: false } }).sort({ createdAt: 1 }).select("_id");
  return first?._id || null;
}

let importQueue = Promise.resolve();

function importOrthancInstance(orthancId, fetchImpl) {
  const run = importQueue.then(() => importInstanceNow(orthancId, fetchImpl));
  importQueue = run.catch(() => {});
  return run;
}

export async function importNotifiedInstance(orthancId) {
  try {
    await importOrthancInstance(orthancId);
  } finally {
    kickOrthancSync();
  }
}

async function parentStudyId(orthancId, fetchImpl) {
  try {
    const info = await orthancJson(`/instances/${encodeURIComponent(orthancId)}`, { timeoutMs: 5000 }, fetchImpl);
    return info?.ParentStudy || "";
  } catch {
    return "";
  }
}

async function importInstanceNow(orthancId, fetchImpl) {
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
  const orthancStudyId = await parentStudyId(orthancId, fetchImpl);
  const expectedFromOrthanc = await orthancExpectedCount(orthancStudyId, fetchImpl);
  const buffer = await orthancBytes(`/instances/${orthancId}/file`, {}, fetchImpl);
  const parsed = parseDicomBuffer(buffer);
  const existing = await Instance.findOne({ sopUid: parsed.sopUid }).select("studyId");
  if (existing) {
    const study = await Study.findById(existing.studyId).select("facilityId");
    if (study && String(study.facilityId) === String(facilityId)) {
      await Instance.updateOne({ _id: existing._id }, { orthancId });
      return;
    }
    const prior = await TransferJob.findOne({ source: "orthanc", fileName: `${orthancId}.dcm`, status: "rejected" });
    if (prior) return;
  }
  await ingestDicomBuffer({
    buffer,
    facilityId,
    source: "orthanc",
    fileName: `${orthancId}.dcm`,
    orthancId,
    orthancStudyId,
    expectedFromOrthanc,
  });
}

let timer;
let inFlight = false;
let rerun = false;
let lastError = "";

function tick() {
  if (inFlight) {
    rerun = true;
    return;
  }
  inFlight = true;
  rerun = false;
  syncOrthancOnce()
    .then((result) => {
      if (lastError) console.log("Orthanc sync resumed");
      lastError = "";
      if (result?.more) rerun = true;
    })
    .catch((error) => {
      if (error.message !== lastError) {
        console.error(`Orthanc sync failed: ${error.message}`);
        lastError = error.message;
      }
    })
    .finally(() => {
      inFlight = false;
      if (rerun) tick();
    });
}

export function kickOrthancSync() {
  if (timer) tick();
}

function pollIntervalMs() {
  const raw = Number(process.env.ORTHANC_POLL_MS);
  if (Number.isFinite(raw) && raw >= 500) return raw;
  return 2000;
}

export function startOrthancPoller() {
  if (!orthancConfigured() || timer) return;
  timer = setInterval(tick, pollIntervalMs());
  if (typeof timer.unref === "function") timer.unref();
  tick();
}

export function stopOrthancPoller() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
