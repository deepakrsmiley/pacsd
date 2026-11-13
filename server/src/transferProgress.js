import { Instance, Patient, Series, Study } from "./models.js";
import { orthancConfigured, orthancJson } from "./orthancClient.js";
import { publishTransferEvent } from "./liveEvents.js";

export const ACTIVE_TRANSFER_PHASES = ["waiting", "receiving", "finalizing", "verifying", "processing", "indexing"];
const OPEN_PHASES = ["waiting", "receiving", "processing", "indexing"];

const rateSamples = new Map();
const quietTimers = new Map();
const verifying = new Set();

function quietMs() {
  const raw = Number(process.env.TRANSFER_QUIET_MS || process.env.TRANSFER_STABLE_MS);
  if (Number.isFinite(raw) && raw >= 5000) return Math.min(raw, 120000);
  return 20000;
}

function verifyGapMs() {
  const raw = Number(process.env.TRANSFER_VERIFY_GAP_MS);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(raw, 30000);
  return 4000;
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function bytesPerSecond(studyId, receivedBytes) {
  const key = String(studyId);
  const now = Date.now();
  const prev = rateSamples.get(key);
  rateSamples.set(key, { at: now, bytes: receivedBytes });
  if (!prev || now <= prev.at) return prev?.bps || 0;
  const deltaBytes = Math.max(0, receivedBytes - prev.bytes);
  const deltaSec = (now - prev.at) / 1000;
  if (deltaSec < 0.05) return prev.bps || 0;
  const bps = deltaBytes / deltaSec;
  rateSamples.set(key, { at: now, bytes: receivedBytes, bps });
  return bps;
}

function eventTypeFor(phase, fallback) {
  if (fallback) return fallback;
  if (phase === "finalizing") return "dicom:study_finalizing";
  if (phase === "verifying") return "dicom:study_verifying";
  if (phase === "completed") return "dicom:study_completed";
  if (phase === "failed" || phase === "incomplete" || phase === "interrupted") return "dicom:study_failed";
  return "dicom:study_receiving";
}

export function transferPayload(study, patient = null, extras = {}) {
  const declared = Number(study.expectedInstances);
  const expected = Number.isFinite(declared) && declared > 0 ? declared : null;
  const received = Number(study.receivedInstances) || 0;
  const phase = study.transferPhase || "receiving";
  const percent = phase === "completed"
    ? 100
    : (expected ? Math.min(99, Math.round((received / expected) * 100)) : null);
  return {
    type: extras.type || eventTypeFor(phase),
    studyId: String(study._id),
    facilityId: String(study.facilityId),
    transferPhase: phase,
    receivedInstances: received,
    expectedInstances: expected,
    receivedBytes: Number(study.receivedBytes) || 0,
    bytesPerSecond: extras.bytesPerSecond ?? 0,
    percent,
    seriesCount: extras.seriesCount ?? null,
    modality: study.modality || "",
    description: study.description || "",
    accession: study.accession || "",
    orthancStudyId: study.orthancStudyId || "",
    patientName: patient?.name || extras.patientName || "",
    patientMrn: patient?.mrn || extras.patientMrn || "",
    transferStartedAt: study.transferStartedAt || null,
    transferCompletedAt: study.transferCompletedAt || null,
    lastInstanceAt: study.lastInstanceAt || null,
    transferError: study.transferError || "",
  };
}

export async function publishStudyTransfer(study, type) {
  if (!study?._id) return null;
  const patient = study.patientId?.name
    ? study.patientId
    : await Patient.findById(study.patientId).select("name mrn").lean();
  const event = transferPayload(study, patient, {
    type: type || eventTypeFor(study.transferPhase),
    bytesPerSecond: type && type !== "dicom:study_receiving" && type !== "dicom:instance_received"
      ? 0
      : bytesPerSecond(study._id, Number(study.receivedBytes) || 0),
  });
  publishTransferEvent(event);
  if (event.type === "dicom:study_completed") {
    publishTransferEvent({ ...event, type: "transfer.completed" });
  }
  if (event.type === "dicom:study_failed") {
    publishTransferEvent({ ...event, type: "transfer.failed" });
  }
  return event;
}

export function armStudyQuietTimer(studyId) {
  const key = String(studyId);
  const existing = quietTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    quietTimers.delete(key);
    verifyStudyQuiet(key).catch((error) => {
      console.error(`Study verify failed: ${error.message}`);
    });
  }, quietMs());
  timer.unref?.();
  quietTimers.set(key, timer);
}

export async function recordInstanceReceived({
  study,
  bytes = 0,
  isNewInstance = true,
  orthancStudyId = "",
  expectedFromDicom = null,
}) {
  if (!study) return null;
  const now = new Date();
  if (!study.transferStartedAt) study.transferStartedAt = now;
  study.lastInstanceAt = now;
  study.transferCompletedAt = undefined;
  study.transferError = "";
  if (orthancStudyId) study.orthancStudyId = orthancStudyId;
  const reopen = ["completed", "incomplete", "failed", "interrupted", "finalizing", "verifying", "indexing", "processing"];
  if (!study.transferPhase || study.transferPhase === "waiting" || reopen.includes(study.transferPhase)) {
    study.transferPhase = "receiving";
  }
  if (isNewInstance) {
    study.receivedInstances = (Number(study.receivedInstances) || 0) + 1;
    study.receivedBytes = (Number(study.receivedBytes) || 0) + (Number(bytes) || 0);
  }
  // Only a sender-provided DICOM count is an expected total. Orthanc's live count is not.
  const declared = Number(expectedFromDicom);
  if (Number.isFinite(declared) && declared > 0) {
    study.expectedInstances = Math.max(Number(study.expectedInstances) || 0, declared);
  }
  await study.save();
  armStudyQuietTimer(study._id);
  return publishStudyTransfer(study, isNewInstance ? "dicom:instance_received" : "dicom:study_receiving");
}

async function archiveCount(study) {
  if (!orthancConfigured()) return null;
  try {
    let id = study.orthancStudyId || "";
    if (!id && study.studyUid) {
      const matches = await orthancJson("/tools/lookup", { method: "POST", body: study.studyUid, timeoutMs: 8000 });
      id = (matches || []).find((item) => item.Type === "Study")?.ID || "";
      if (id) {
        study.orthancStudyId = id;
        await Study.updateOne({ _id: study._id }, { orthancStudyId: id });
      }
    }
    if (!id) return null;
    const stats = await orthancJson(`/studies/${encodeURIComponent(id)}/statistics`, { timeoutMs: 8000 });
    const count = Number(stats?.CountInstances);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

async function mongoCount(studyId) {
  const [count, bytes, seriesCount] = await Promise.all([
    Instance.countDocuments({ studyId }),
    Instance.aggregate([
      { $match: { studyId } },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$byteLength", 0] } } } },
    ]),
    Series.countDocuments({ studyId }),
  ]);
  return { mongo: count, bytes: bytes[0]?.total || 0, seriesCount };
}

export async function verifyStudyQuiet(studyId, { fromStable = false } = {}) {
  const key = String(studyId);
  if (verifying.has(key)) return null;
  const cutoff = new Date(Date.now() - quietMs());
  const claim = {
    _id: studyId,
    transferPhase: { $in: OPEN_PHASES },
  };
  if (!fromStable) claim.lastInstanceAt = { $lte: cutoff };
  const claimed = await Study.findOneAndUpdate(claim, { $set: { transferPhase: "finalizing" } }, { new: true });
  if (!claimed) return null;
  verifying.add(key);
  try {
    await publishStudyTransfer(claimed, "dicom:study_finalizing");
    const first = await mongoCount(claimed._id);
    const firstArchive = await archiveCount(claimed);
    claimed.receivedInstances = first.mongo;
    claimed.receivedBytes = first.bytes;
    claimed.transferPhase = "verifying";
    await claimed.save();
    await publishStudyTransfer(claimed, "dicom:study_verifying");
    const startedAt = claimed.lastInstanceAt ? new Date(claimed.lastInstanceAt).getTime() : 0;
    await delay(verifyGapMs());
    const fresh = await Study.findById(claimed._id);
    if (!fresh) return null;
    const moved = fresh.lastInstanceAt && new Date(fresh.lastInstanceAt).getTime() > startedAt;
    if (moved || fresh.transferPhase === "receiving") {
      if (fresh.transferPhase !== "receiving") {
        fresh.transferPhase = "receiving";
        await fresh.save();
      }
      await publishStudyTransfer(fresh, "dicom:study_receiving");
      armStudyQuietTimer(fresh._id);
      return fresh;
    }
    const second = await mongoCount(fresh._id);
    const secondArchive = await archiveCount(fresh);
    const archiveMoved = firstArchive != null && secondArchive != null && secondArchive !== firstArchive;
    const mongoMoved = second.mongo !== first.mongo;
    if (archiveMoved || mongoMoved || (secondArchive != null && second.mongo < secondArchive)) {
      fresh.transferPhase = "receiving";
      fresh.receivedInstances = second.mongo;
      fresh.receivedBytes = second.bytes;
      await fresh.save();
      await publishStudyTransfer(fresh, "dicom:study_receiving");
      armStudyQuietTimer(fresh._id);
      return fresh;
    }
    if (secondArchive == null) {
      fresh.transferPhase = "interrupted";
      fresh.transferError = "Orthanc could not be verified";
      fresh.transferCompletedAt = new Date();
      fresh.receivedInstances = second.mongo;
      fresh.receivedBytes = second.bytes;
      await fresh.save();
      return publishStudyTransfer(fresh, "dicom:study_failed");
    }
    const declared = Number(fresh.expectedInstances);
    if (Number.isFinite(declared) && declared > second.mongo) {
      fresh.transferPhase = "incomplete";
      fresh.transferError = `Received ${second.mongo} of ${declared} instances`;
      fresh.transferCompletedAt = new Date();
      fresh.receivedInstances = second.mongo;
      fresh.receivedBytes = second.bytes;
      await fresh.save();
      return publishStudyTransfer(fresh, "dicom:study_failed");
    }
    fresh.transferPhase = "completed";
    fresh.transferError = "";
    fresh.transferCompletedAt = new Date();
    fresh.receivedInstances = second.mongo;
    fresh.receivedBytes = second.bytes;
    await fresh.save();
    rateSamples.delete(key);
    const patient = await Patient.findById(fresh.patientId).select("name mrn").lean();
    const event = transferPayload(fresh, patient, {
      type: "dicom:study_completed",
      seriesCount: second.seriesCount,
      bytesPerSecond: 0,
    });
    publishTransferEvent(event);
    publishTransferEvent({ ...event, type: "transfer.completed" });
    return event;
  } finally {
    verifying.delete(key);
  }
}

export async function verifyStudyByOrthancId(orthancStudyId) {
  if (!orthancStudyId) return null;
  const study = await Study.findOne({ orthancStudyId });
  if (!study) return null;
  return verifyStudyQuiet(study._id, { fromStable: true });
}

export async function settleInactiveTransfers() {
  const cutoff = new Date(Date.now() - quietMs());
  const open = await Study.find({
    transferPhase: { $in: OPEN_PHASES },
    lastInstanceAt: { $lte: cutoff },
  }).select("_id").limit(40);
  const results = [];
  for (const study of open) results.push(await verifyStudyQuiet(study._id));
  return results;
}

export function startTransferWatcher() {
  Study.find({ transferPhase: { $in: [...OPEN_PHASES, "finalizing", "verifying"] } })
    .select("_id")
    .limit(100)
    .then((rows) => {
      for (const row of rows) armStudyQuietTimer(row._id);
    })
    .catch(() => {});
}

export function publicTransfer(study, patient) {
  return transferPayload(study, patient, { type: eventTypeFor(study.transferPhase), bytesPerSecond: 0 });
}
