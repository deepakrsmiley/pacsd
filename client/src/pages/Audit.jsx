import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useFacility } from "../facility.jsx";
import { useToasts } from "../feedback.jsx";
import { Badge, DataGrid, Field, Metrics, Page, fieldClass } from "../ui.jsx";

export default function Audit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const { facilityId } = useFacility();
  const toasts = useToasts();

  useEffect(() => {
    let cancel = false;
    setLogs([]);
    setLoading(true);
    api("/api/audit")
      .then((data) => { if (!cancel) setLogs(data.logs); })
      .catch((err) => { if (!cancel) toasts.error(err.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [facilityId, toasts]);

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return logs.filter((log) => !needle || `${log.action} ${log.actorEmail} ${log.entity}`.toLowerCase().includes(needle));
  }, [logs, filter]);
  const actions = new Set(logs.map((log) => log.action)).size;

  return (
    <Page kicker="Administration" title="Audit logs" summary="Actions recorded by this server for the facilities you can access. The list is the stored log, not a sample.">
      <Metrics items={[
        { label: "Events", value: logs.length, detail: "Loaded from the audit store" },
        { label: "Shown", value: rows.length, detail: "After the text filter" },
        { label: "Action types", value: actions, detail: "Distinct action names" },
        { label: "Actors", value: new Set(logs.map((log) => log.actorEmail).filter(Boolean)).size, detail: "Distinct signed-in accounts" },
      ]} />
      <div className="mb-3 max-w-sm">
        <Field label="Filter audit events">
          <input className={fieldClass} placeholder="Action, actor, or entity" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </Field>
      </div>
      <DataGrid
        columns={[
          { key: "when", label: "When", render: (log) => new Date(log.createdAt).toLocaleString() },
          { key: "action", label: "Action", render: (log) => <Badge tone="info">{log.action}</Badge> },
          { key: "actorEmail", label: "Actor" },
          { key: "entity", label: "Entity" },
          { key: "entityId", label: "Record" },
        ]}
        rows={rows}
        loading={loading}
        rowKey={(log) => log._id}
        empty="No audit events match this filter."
      />
    </Page>
  );
}
