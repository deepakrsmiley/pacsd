import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useFacility } from "../facility.jsx";
import { useToasts } from "../feedback.jsx";
import ProgressRing from "./ProgressRing.jsx";

const ACTIVE = new Set(["waiting", "receiving", "processing", "indexing", "incomplete"]);

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function statusLabel(phase) {
  if (phase === "waiting") return "Waiting";
  if (phase === "receiving") return "Receiving";
  if (phase === "finalizing" || phase === "processing") return "Finalizing";
  if (phase === "verifying" || phase === "indexing") return "Verifying";
  if (phase === "completed") return "Study received";
  if (phase === "incomplete") return "Incomplete";
  if (phase === "failed") return "Failed";
  if (phase === "interrupted") return "Interrupted";
  return "Receiving";
}

function upsertTransfer(list, event) {
  const next = list.filter((item) => String(item.studyId) !== String(event.studyId));
  next.unshift(event);
  return next.slice(0, 40);
}

export default function ReceivingStudies({ onStudyReady }) {
  const { facilityId } = useFacility();
  const toasts = useToasts();
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);

  async function hydrate() {
    const data = await api("/api/transfers/active");
    setTransfers(data.transfers || []);
  }

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    hydrate()
      .catch(() => { if (!cancel) setTransfers([]); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [facilityId]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return undefined;
    const source = new EventSource("/api/events", { withCredentials: true });
    const onProgress = (message) => {
      try {
        const event = JSON.parse(message.data);
        setTransfers((current) => upsertTransfer(current, event));
      } catch {
        // Ignore malformed payloads.
      }
    };
    const onDone = (message) => {
      try {
        const event = JSON.parse(message.data);
        setTransfers((current) => upsertTransfer(current, event));
        if (event.type === "dicom:study_completed" || event.type === "transfer.completed") {
          if (event.type === "dicom:study_completed" || event.type === "transfer.completed") onStudyReady?.(event);
          if (event.type !== "transfer.completed") {
            toasts.success(`${event.patientName || "Study"} received successfully (${event.receivedInstances || 0} images).`);
          }
        } else if (event.type === "dicom:study_failed") {
          toasts.error(event.transferError || "DICOM transfer failed.");
        }
      } catch {
        // Ignore malformed payloads.
      }
    };
    source.addEventListener("transfer.progress", onProgress);
    source.addEventListener("dicom:instance_received", onProgress);
    source.addEventListener("dicom:study_receiving", onProgress);
    source.addEventListener("dicom:study_finalizing", onProgress);
    source.addEventListener("dicom:study_verifying", onProgress);
    source.addEventListener("transfer.completed", onDone);
    source.addEventListener("dicom:study_completed", onDone);
    source.addEventListener("transfer.failed", onDone);
    source.addEventListener("dicom:study_failed", onDone);
    source.onerror = () => {
      setTimeout(() => hydrate().catch(() => {}), 1500);
    };
    return () => source.close();
  }, [facilityId, toasts, onStudyReady]);

  const visible = useMemo(
    () => transfers.filter((item) => ACTIVE.has(item.transferPhase) || item.transferPhase === "completed")
      .filter((item, index, list) => list.findIndex((row) => row.studyId === item.studyId) === index)
      .slice(0, 8),
    [transfers],
  );
  const activeCount = visible.filter((item) => ACTIVE.has(item.transferPhase)).length;

  if (!loading && !visible.length) return null;

  return (
    <section className="mb-3" aria-label="Receiving studies">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <div className="text-[13px] font-semibold tracking-tight text-white">Receiving</div>
        <div className="text-[12px] font-medium text-white/40">{loading ? "…" : `${activeCount} live`}</div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {visible.map((item) => {
          const complete = item.transferPhase === "completed";
          const known = Number.isFinite(item.expectedInstances) && item.expectedInstances > 0;
          const percent = complete
            ? 100
            : (known ? Math.min(99, Math.round(((item.receivedInstances || 0) / item.expectedInstances) * 100)) : null);
          const images = `${item.receivedInstances || 0}${known ? `/${item.expectedInstances}` : ""}`;
          return (
            <article
              key={item.studyId}
              className="flex min-w-[280px] max-w-[340px] flex-1 items-center gap-3 rounded-2xl bg-white/[0.06] px-3 py-2.5 ring-1 ring-white/[0.08]"
            >
              <ProgressRing
                percent={percent}
                indeterminate={!known && !complete}
                complete={complete}
                size={44}
                stroke={3.5}
                label={statusLabel(item.transferPhase)}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold tracking-tight text-white">{item.patientName || "Unknown"}</div>
                <div className="mt-0.5 truncate text-[12px] text-white/45">
                  {[item.patientMrn, item.modality, item.description || item.accession].filter(Boolean).join(" · ")}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] font-medium tabular-nums text-white/55">
                  <span className={complete ? "text-[#30D158]" : "text-[#64D2FF]"}>{statusLabel(item.transferPhase)}</span>
                  <span>{images} img</span>
                  <span>{formatBytes(item.receivedBytes)}</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
