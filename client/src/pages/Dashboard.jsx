import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useFacility } from "../facility.jsx";
import { useToasts } from "../feedback.jsx";
import { Badge, DashboardSkeleton, Metrics, Page, Panel, toneFor } from "../ui.jsx";

export default function Dashboard() {
  const { facilityId } = useFacility();
  const toasts = useToasts();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setData(null);
    setLoading(true);
    api("/api/dashboard")
      .then((next) => { if (!cancel) setData(next); })
      .catch((err) => { if (!cancel) toasts.error(err.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [facilityId, toasts]);

  const total = data ? Object.values(data.counts).reduce((sum, value) => sum + value, 0) : 0;
  const modalities = data ? Object.entries(data.modalities) : [];
  const peak = modalities.reduce((max, [, count]) => Math.max(max, count), 1);

  return (
    <Page kicker="Facility operations" title="Dashboard" summary="Counts come from studies stored for the selected facility. Empty values are zero, not estimates." actions={<Link className="inline-flex h-9 items-center rounded-full bg-white px-4 text-[13px] font-medium text-black transition hover:bg-white/85" to="/worklist">Open worklist</Link>}>
      {loading && <DashboardSkeleton />}
      {data && (
        <>
          <Metrics items={[
            { label: "Studies", value: total, detail: "All statuses in this facility" },
            { label: "STAT", value: data.stat, detail: "Priority recorded as STAT" },
            { label: "Remote reading", value: data.remote, detail: "Assigned to another facility" },
            { label: "Sign-off, 7 days", value: data.tatMinutes == null ? "—" : `${data.tatMinutes} min`, detail: data.tatMinutes == null ? "Not enough finalized studies" : "Mean time from acquisition to sign-off" },
          ]} />
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <Panel title="Workflow">
              <ul className="divide-y divide-white/5">
                {[
                  ["Booked", data.counts.booked, "booked"],
                  ["Acquired", data.counts.acquired, "acquired"],
                  ["Reporting", data.counts.reporting, "reporting"],
                  ["Preliminary", data.counts.preliminary, "preliminary"],
                  ["Finalized", data.counts.finalized, "finalized"],
                ].map(([label, value, tone]) => (
                  <li key={label} className="flex items-center gap-4 px-5 py-3.5">
                    <span className="w-24 shrink-0"><Badge tone={toneFor(tone)}>{label}</Badge></span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-500" style={{ width: `${total ? Math.round((value / total) * 100) : 0}%` }} />
                    </div>
                    <span className="w-8 text-right tabular-nums">{value || 0}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Modalities">
              {!modalities.length && <p className="px-5 pb-6 pt-2 text-[14px] text-white/45">No studies stored for this facility.</p>}
              <ul className="pb-2">
                {modalities.map(([name, count]) => (
                  <li key={name} className="grid grid-cols-[48px_1fr_32px] items-center gap-4 border-t border-white/[0.05] px-5 py-3.5 first:border-t-0">
                    <span className="font-medium">{name}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500" style={{ width: `${Math.round((count / peak) * 100)}%` }} /></div>
                    <span className="text-right tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </Page>
  );
}
