import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(0);

// Short coalesce so multi-instance C-STORE bursts refresh the worklist once, not once per file.
const UPDATE_DELAY_MS = Number(process.env.STUDY_EVENT_DELAY_MS || 250);
const pendingUpdates = new Map();
const pendingTransfers = new Map();

export function publishStudyChange(facilityId, studyId, type = "study.updated") {
  const event = { type, facilityId: String(facilityId), studyId: String(studyId) };
  if (type !== "study.updated") {
    bus.emit("study", event);
    return;
  }
  const existing = pendingUpdates.get(event.studyId);
  if (existing) clearTimeout(existing);
  const delay = Number.isFinite(UPDATE_DELAY_MS) && UPDATE_DELAY_MS >= 0 ? UPDATE_DELAY_MS : 250;
  const timer = setTimeout(() => {
    pendingUpdates.delete(event.studyId);
    bus.emit("study", event);
  }, delay);
  timer.unref?.();
  pendingUpdates.set(event.studyId, timer);
}

const IMMEDIATE_TRANSFER = new Set([
  "transfer.completed",
  "transfer.failed",
  "dicom:study_finalizing",
  "dicom:study_verifying",
  "dicom:study_completed",
  "dicom:study_failed",
]);

export function publishTransferEvent(event) {
  const studyId = String(event.studyId || "");
  const type = event.type || "transfer.progress";
  if (IMMEDIATE_TRANSFER.has(type)) {
    const pending = pendingTransfers.get(studyId);
    if (pending) {
      clearTimeout(pending);
      pendingTransfers.delete(studyId);
    }
    bus.emit("study", { ...event, type, facilityId: String(event.facilityId), studyId });
    return;
  }
  const existing = pendingTransfers.get(studyId);
  if (existing) clearTimeout(existing);
  const delay = Number.isFinite(UPDATE_DELAY_MS) && UPDATE_DELAY_MS >= 0 ? Math.min(UPDATE_DELAY_MS, 200) : 200;
  const timer = setTimeout(() => {
    pendingTransfers.delete(studyId);
    bus.emit("study", { ...event, type, facilityId: String(event.facilityId), studyId });
  }, delay);
  timer.unref?.();
  pendingTransfers.set(studyId, timer);
}

export function subscribeStudyChanges(listener) {
  bus.on("study", listener);
  return () => bus.off("study", listener);
}
