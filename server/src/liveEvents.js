import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(0);

const UPDATE_DELAY_MS = 1500;
const pendingUpdates = new Map();

export function publishStudyChange(facilityId, studyId, type = "study.updated") {
  const event = { type, facilityId: String(facilityId), studyId: String(studyId) };
  if (type !== "study.updated") {
    bus.emit("study", event);
    return;
  }
  if (pendingUpdates.has(event.studyId)) return;
  const timer = setTimeout(() => {
    pendingUpdates.delete(event.studyId);
    bus.emit("study", event);
  }, UPDATE_DELAY_MS);
  timer.unref?.();
  pendingUpdates.set(event.studyId, timer);
}

export function subscribeStudyChanges(listener) {
  bus.on("study", listener);
  return () => bus.off("study", listener);
}
