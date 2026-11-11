import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { canReadDicom, useAuth } from "../auth.jsx";
import { useFacility } from "../facility.jsx";
import { useToasts } from "../feedback.jsx";
import { Badge, DataGrid, Field, Inspector, Metrics, Page, Panel, TableSkeleton, fieldClass, formatBytes, formatDuration, toneFor } from "../ui.jsx";

const MODALITIES = ["CT", "MR", "DX", "CR", "US", "MG", "PT", "XA", "OT"];
const CHANNELS = [
  { key: "orthanc", name: "Orthanc archive", detail: "Receives C-STORE and runs C-ECHO when ORTHANC_URL is set." },
  { key: "smtp", name: "Email delivery", detail: "Sends a finalized report when SMTP credentials are set." },
  { key: "whatsapp", name: "WhatsApp Business", detail: "Sends a report notice when the WhatsApp API is set." },
  { key: "ai", name: "Report assist", detail: "Drafts findings only when an assist endpoint is set." },
  { key: "mpr", name: "MPR, MIP, and 3D", detail: "Volume reconstruction is not part of this workstation." },
];

export default function Operations({ kind }) {
  const { user } = useAuth();
  const { facilityId } = useFacility();
  const showViewer = canReadDicom(user);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState("");
  const toasts = useToasts();
  function fail(err) {
    const message = err?.message || "Request failed";
    setError(message);
    toasts.error(message);
  }
  function ok(message) {
    setNotice(message);
    toasts.success(message);
  }
  const [nodeForm, setNodeForm] = useState({ name: "", aeTitle: "", host: "", port: "4242", modality: "CT" });
  const [orgForm, setOrgForm] = useState(null);

  async function load(nextQuery = query) {
    setError("");
    const routes = {
      patients: `/api/patients?q=${encodeURIComponent(nextQuery)}`,
      critical: "/api/critical",
      nodes: "/api/dicom-nodes",
      transfers: "/api/transfers",
      archive: "/api/archive",
      integrations: "/api/system/status",
      notifications: "/api/notifications",
      organization: "/api/organization",
      storage: "/api/archive/backups",
      health: "/api/system/health",
      referring: "/api/referring-doctors",
      portal: "/api/notifications",
      billing: null,
    };
    if (!routes[kind]) {
      setData({ unavailable: true });
      return;
    }
    const payload = await api(routes[kind]);
    setData(payload);
    if (kind === "organization" && payload.organization) {
      setOrgForm({
        legalName: payload.organization.legalName || "",
        timezone: payload.organization.timezone || "",
        locale: payload.organization.locale || "",
        supportEmail: payload.organization.supportEmail || "",
      });
    }
  }

  useEffect(() => {
    setNotice("");
    setError("");
    setData(null);
    setSelected(null);
    setFilter("");
    setQuery("");
    load("").catch(fail);
  }, [kind, facilityId]);

  async function addNode(event) {
    event.preventDefault();
    setNotice("");
    setBusy("node");
    try {
      await api("/api/dicom-nodes", {
        method: "POST",
        body: {
          facilityId: sessionStorage.getItem("pacsd_facility"),
          name: nodeForm.name,
          aeTitle: nodeForm.aeTitle,
          host: nodeForm.host,
          port: Number(nodeForm.port),
          modality: nodeForm.modality,
        },
      });
      setNodeForm({ name: "", aeTitle: "", host: "", port: "4242", modality: "CT" });
      await load();
      ok("Node saved for this facility.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  }

  async function echoNode(id) {
    setNotice("");
    setError("");
    setBusy(id);
    try {
      const result = await api(`/api/dicom-nodes/${id}/echo`, { method: "POST" });
      const echoMessage = result.echo ? `C-ECHO succeeded in ${result.durationMs} ms.` : result.error || "C-ECHO did not succeed.";
      if (result.echo) ok(echoMessage);
      else fail({ message: echoMessage });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  }

  async function saveOrg(event) {
    event.preventDefault();
    setBusy("org");
    try {
      await api("/api/organization", { method: "PATCH", body: orgForm });
      ok("Organization settings saved.");
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  }

  async function revokeShare(id) {
    setNotice("");
    setBusy(id);
    try {
      await api(`/api/shares/${id}/revoke`, { method: "POST" });
      ok("Share link revoked.");
      setSelected(null);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  }

  async function copyArchive() {
    setNotice("");
    setBusy("backup");
    try {
      const result = await api("/api/archive/backup", { method: "POST" });
      ok(result.note);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  }

  const meta = MODULES[kind];
  const view = useMemo(() => buildView(kind, data, filter, showViewer), [kind, data, filter, showViewer]);
  const rows = (view.rows || []).map((row) => (
    kind === "nodes" ? { ...row, testing: busy === row._id, onEcho: () => echoNode(row._id) } : row
  ));

  return (
    <Page kicker={meta.kicker} title={meta.title} summary={meta.summary} actions={headerActions(kind, data, { copyArchive, busy })}>
      {!data && !error && kind !== "billing" && <TableSkeleton />}
      {view.metrics && <Metrics items={view.metrics} />}
      {kind === "nodes" && <NodeForm form={nodeForm} setForm={setNodeForm} onSubmit={addNode} busy={busy === "node"} listener={data?.listener?.detail} />}
      {kind === "organization" && orgForm && <OrganizationForm form={orgForm} setForm={setOrgForm} onSubmit={saveOrg} busy={busy === "org"} />}
      {kind === "billing" && <BillingBoard />}
      {kind === "integrations" && <ChannelBoard status={data} />}
      {kind === "health" && data && <HealthBoard data={data} />}
      {kind === "archive" && data && <ArchiveBoard data={data} />}
      {kind === "patients" && (
          <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); load(query).catch(fail); }}>
          <Field label="Search patients">
            <input className={`${fieldClass} max-w-sm`} placeholder="Name or MRN" value={query} onChange={(event) => setQuery(event.target.value)} />
          </Field>
          <button className="h-9 bg-[#5b21b6] px-4 text-sm text-white">Search registry</button>
        </form>
      )}
      {view.grid && (
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            {view.filterable && (
              <div className="mb-3 max-w-sm">
                <Field label="Filter records">
                  <input
                    className={fieldClass}
                    placeholder="Action, name, or identifier"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  />
                </Field>
              </div>
            )}
            <DataGrid
              columns={view.columns}
              rows={rows}
              rowKey={(row, index) => row._id || row.id || index}
              selectedKey={selected?._id || selected?.id}
              onSelect={setSelected}
              empty={view.empty}
            />
          </div>
          <div>
            <Inspector title="Record detail" rows={view.detail?.(selected)} empty="Select a row. The detail stays limited to fields stored for that record." />
            {(kind === "notifications" || kind === "portal") && selected && !selected.revoked && (
              <button type="button" className="mt-3 h-9 w-full border border-white/15 text-sm text-zinc-100 disabled:opacity-60" disabled={busy === selected.id} onClick={() => revokeShare(selected.id)}>Revoke</button>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}

const MODULES = {
  patients: { kicker: "Clinical registry", title: "Patient management", summary: "Facility registry of registered patients. Search uses the name and MRN stored for this site." },
  critical: { kicker: "Clinical safety", title: "Critical findings", summary: "Studies recorded with STAT priority. An empty board means none are stored for this facility." },
  nodes: { kicker: "DICOM connectivity", title: "DICOM nodes", summary: "Remote application entities for this facility. Test connection opens a socket to the address you saved." },
  transfers: { kicker: "DICOM connectivity", title: "Transfer queue", summary: "Inbound files accepted, duplicated, or rejected by this server." },
  archive: { kicker: "Archive", title: "PACS archive", summary: "Instance counts and bytes from the database and the local DICOM folder." },
  integrations: { kicker: "Platform", title: "Integrations", summary: "A channel is configured only when its environment variables are present. Configured does not mean a message was delivered." },
  notifications: { kicker: "Communications", title: "Notifications", summary: "Share attempts for this facility. Email and WhatsApp remain unsent until those providers are configured." },
  organization: { kicker: "Organization", title: "Organization settings", summary: "Identity of this deployment. Password sign-in is the only access method." },
  storage: { kicker: "Archive", title: "Storage and backup", summary: "Copies the local DICOM folder. A copy stays unverified until a restore is tested." },
  health: { kicker: "Platform", title: "System health", summary: "Live process and database readings from this API server." },
  referring: { kicker: "Clinical directory", title: "Referring doctors", summary: "Referring physician accounts inside your facility scope." },
  portal: { kicker: "Communications", title: "Patient portal", summary: "Finalized reports are shared with an expiring link. The link does not include the DICOM file, and there is no separate patient password." },
  billing: { kicker: "Commercial", title: "Subscription and billing", summary: "No payment provider is connected. Clinical images are not removed because billing is absent." },
};

function headerActions(kind, data, { copyArchive, busy }) {
  if (kind === "storage") {
    return <button type="button" className="h-9 bg-[#5b21b6] px-4 text-sm text-white disabled:opacity-60" disabled={busy === "backup"} onClick={copyArchive}>{busy === "backup" ? "Copying…" : "Copy archive now"}</button>;
  }
  if (kind === "critical") {
    return <Badge tone={(data?.studies || []).length ? "bad" : "neutral"}>{(data?.studies || []).length} STAT</Badge>;
  }
  return null;
}

function buildView(kind, data, filter, showViewer) {
  if (!data || kind === "billing" || kind === "integrations" || kind === "health" || kind === "archive" || kind === "organization") return {};
  const needle = filter.trim().toLowerCase();
  const match = (row) => !needle || JSON.stringify(row).toLowerCase().includes(needle);
  if (kind === "patients") {
    const rows = (data.patients || []).filter(match);
    return {
      grid: true,
      metrics: [
        { label: "Patients", value: data.patients?.length || 0, detail: "Matching the current search" },
        { label: "With phone", value: (data.patients || []).filter((item) => item.phone).length, detail: "Stored contact number" },
        { label: "Demonstration", value: (data.patients || []).filter((item) => item.synthetic).length, detail: "Synthetic records, not clinical cases" },
        { label: "Sex recorded", value: (data.patients || []).filter((item) => item.sex && item.sex !== "U").length, detail: "F, M, or O" },
      ],
      columns: [
        { key: "name", label: "Patient" },
        { key: "mrn", label: "MRN" },
        { key: "birthDate", label: "Birth date" },
        { key: "sex", label: "Sex" },
        { key: "phone", label: "Phone" },
        { key: "synthetic", label: "Record", render: (row) => <Badge tone={row.synthetic ? "warn" : "good"}>{row.synthetic ? "Demonstration" : "Registered"}</Badge> },
      ],
      rows,
      empty: "No patients match this search.",
      detail: (row) => row && [
        ["Name", row.name],
        ["MRN", row.mrn],
        ["Birth date", row.birthDate],
        ["Sex", row.sex],
        ["Phone", row.phone],
        ["Record", row.synthetic ? "Demonstration patient" : "Registered patient"],
      ],
    };
  }
  if (kind === "critical") {
    const rows = (data.studies || []).filter(match).map((study) => ({
      ...study,
      patient: study.patientId?.name || "",
      mrn: study.patientId?.mrn || "",
      assignee: study.assignedTo?.name || "Unassigned",
    }));
    return {
      grid: true,
      metrics: [
        { label: "STAT studies", value: rows.length, detail: "Priority recorded as STAT" },
        { label: "Assigned", value: rows.filter((row) => row.assignee !== "Unassigned").length, detail: "Has a reporting radiologist" },
        { label: "Unassigned", value: rows.filter((row) => row.assignee === "Unassigned").length, detail: "Still waiting for an assignee" },
        { label: "Modalities", value: new Set(rows.map((row) => row.modality).filter(Boolean)).size, detail: "Distinct modalities in the list" },
      ],
      columns: [
        { key: "patient", label: "Patient" },
        { key: "mrn", label: "MRN" },
        { key: "accession", label: "Accession" },
        { key: "modality", label: "Modality" },
        { key: "status", label: "Status", render: (row) => <Badge tone={toneFor(row.status)}>{row.status}</Badge> },
        { key: "assignee", label: "Assignee" },
        ...(showViewer ? [{ key: "open", label: "Open", render: (row) => <Link className="text-violet-200 underline-offset-2 hover:underline" to={`/viewer/${row._id}`} onClick={(event) => event.stopPropagation()}>Viewer</Link> }] : []),
      ],
      rows,
      empty: "No STAT studies are recorded for this facility.",
      detail: (row) => row && [
        ["Patient", row.patient],
        ["MRN", row.mrn],
        ["Accession", row.accession],
        ["Modality", row.modality],
        ["Status", row.status],
        ["Priority", "STAT"],
        ["Assignee", row.assignee],
      ],
    };
  }
  if (kind === "nodes") {
    const rows = (data.nodes || []).filter(match);
    return {
      grid: true,
      filterable: true,
      metrics: [
        { label: "Nodes", value: rows.length, detail: "Saved for this facility" },
        { label: "Echo succeeded", value: rows.filter((row) => row.lastEchoOk).length, detail: "Last test returned C-ECHO" },
        { label: "Echo failed", value: rows.filter((row) => row.lastEchoAt && !row.lastEchoOk).length, detail: "Last test did not succeed" },
        { label: "Not tested", value: rows.filter((row) => !row.lastEchoAt).length, detail: "No connection attempt yet" },
      ],
      columns: [
        { key: "name", label: "Node" },
        { key: "aeTitle", label: "AE title" },
        { key: "modality", label: "Modality" },
        { key: "address", label: "Address", render: (row) => `${row.host}:${row.port}` },
        { key: "echo", label: "Last test", render: (row) => <Badge tone={row.lastEchoOk ? "good" : row.lastEchoAt ? "bad" : "neutral"}>{row.lastEchoOk ? "C-ECHO ok" : row.lastEchoAt ? "Failed" : "Not tested"}</Badge> },
        { key: "test", label: "Action", render: (row) => <button type="button" className="border border-white/20 px-2 py-1 text-xs disabled:opacity-60" disabled={row.testing} onClick={(event) => { event.stopPropagation(); row.onEcho?.(); }}>{row.testing ? "Testing…" : "Test connection"}</button> },
      ],
      rows,
      empty: "No DICOM nodes are configured.",
      detail: (row) => row && [
        ["Name", row.name],
        ["AE title", row.aeTitle],
        ["Host", row.host],
        ["Port", row.port],
        ["Modality", row.modality],
        ["Last result", row.lastEchoOk ? "C-ECHO succeeded" : row.lastEchoError || "Not tested"],
        ["Tested", row.lastEchoAt ? new Date(row.lastEchoAt).toLocaleString() : ""],
      ],
    };
  }
  return generic(kind, data, match);
}

function generic(kind, data, match) {
  if (kind === "transfers") {
    const jobs = (data.jobs || []).filter(match);
    return {
      grid: true,
      filterable: true,
      metrics: [
        { label: "Stored", value: data.counts?.stored || 0, detail: "New instances accepted" },
        { label: "Duplicate", value: data.counts?.duplicate || 0, detail: "SOP instance UID already stored" },
        { label: "Rejected", value: data.counts?.rejected || 0, detail: "File was not stored" },
        { label: "Visible", value: jobs.length, detail: "Jobs in the current list" },
      ],
      columns: [
        { key: "when", label: "Received" },
        { key: "status", label: "Status", render: (row) => <Badge tone={toneFor(row.status)}>{row.status}</Badge> },
        { key: "modality", label: "Modality" },
        { key: "accession", label: "Accession" },
        { key: "fileName", label: "File" },
        { key: "bytes", label: "Size", render: (row) => formatBytes(row.bytes) },
      ],
      rows: jobs.map((job) => ({ ...job, when: new Date(job.createdAt).toLocaleString() })),
      empty: "No transfers have been recorded for this facility.",
      detail: (row) => row && [
        ["Received", row.when],
        ["Status", row.status],
        ["Modality", row.modality],
        ["Accession", row.accession],
        ["File", row.fileName],
        ["Size", formatBytes(row.bytes)],
        ["Error", row.error],
      ],
    };
  }
  if (kind === "notifications" || kind === "portal") {
    const rows = (data.notifications || []).filter(match).map((item) => ({
      ...item,
      when: item.createdAt ? new Date(item.createdAt).toLocaleString() : "",
      expires: item.expiresAt ? new Date(item.expiresAt).toLocaleString() : "",
    }));
    return {
      grid: true,
      filterable: true,
      metrics: [
        { label: "Shares", value: rows.length, detail: kind === "portal" ? "Expiring report links" : "Recorded delivery attempts" },
        { label: "Delivered", value: rows.filter((row) => row.delivery === "sent").length, detail: "Provider accepted the message" },
        { label: "Not sent", value: rows.filter((row) => row.delivery !== "sent").length, detail: "Includes unconfigured channels" },
        { label: "Revoked", value: rows.filter((row) => row.revoked).length, detail: "Link withdrawn" },
      ],
      columns: [
        { key: "when", label: "Created" },
        { key: "channel", label: "Channel" },
        { key: "recipient", label: "Recipient" },
        { key: "delivery", label: "Delivery", render: (row) => <Badge tone={toneFor(row.delivery)}>{row.delivery || "pending"}</Badge> },
        { key: "revoked", label: "Link", render: (row) => <Badge tone={row.revoked ? "bad" : "neutral"}>{row.revoked ? "Revoked" : "Active"}</Badge> },
      ],
      rows,
      empty: "No share attempts are recorded.",
      detail: (row) => row && [
        ["Channel", row.channel],
        ["Recipient", row.recipient],
        ["Delivery", row.delivery],
        ["Detail", row.deliveryDetail],
        ["Expires", row.expires],
        ["Revoked", row.revoked ? "Yes" : "No"],
      ],
    };
  }
  if (kind === "storage") {
    const rows = (data.jobs || []).filter(match).map((job) => ({
      ...job,
      when: new Date(job.createdAt).toLocaleString(),
      size: formatBytes(job.bytes),
      verified: job.restoreTested ? "Restore tested" : "Not restore-tested",
    }));
    return {
      grid: true,
      metrics: [
        { label: "Copies", value: rows.length, detail: "Backup jobs on record" },
        { label: "Latest files", value: rows[0]?.fileCount ?? 0, detail: "Files in the newest copy" },
        { label: "Latest size", value: rows[0] ? formatBytes(rows[0].bytes) : "0 B", detail: "Bytes in the newest copy" },
        { label: "Restore tested", value: rows.filter((row) => row.restoreTested).length, detail: "Copies with a recorded restore drill" },
      ],
      columns: [
        { key: "when", label: "Copied" },
        { key: "status", label: "Status", render: (row) => <Badge tone={toneFor(row.status)}>{row.status}</Badge> },
        { key: "fileCount", label: "Files" },
        { key: "size", label: "Size" },
        { key: "verified", label: "Restore", render: (row) => <Badge tone={row.restoreTested ? "good" : "warn"}>{row.verified}</Badge> },
      ],
      rows,
      empty: "No archive copies have been made.",
      detail: (row) => row && [
        ["Copied", row.when],
        ["Status", row.status],
        ["Files", row.fileCount],
        ["Size", row.size],
        ["Restore", row.verified],
      ],
    };
  }
  if (kind === "referring") {
    const rows = (data.users || []).filter(match);
    return {
      grid: true,
      filterable: true,
      metrics: [
        { label: "Physicians", value: rows.length, detail: "Referring accounts in scope" },
        { label: "Active", value: rows.filter((row) => row.active !== false).length, detail: "Able to sign in" },
        { label: "Inactive", value: rows.filter((row) => row.active === false).length, detail: "Sign-in disabled" },
        { label: "Role", value: "Referring", detail: "Fixed to referring physician" },
      ],
      columns: [
        { key: "name", label: "Physician" },
        { key: "email", label: "Email" },
        { key: "active", label: "Account", render: (row) => <Badge tone={row.active === false ? "bad" : "good"}>{row.active === false ? "Inactive" : "Active"}</Badge> },
      ],
      rows,
      empty: "No referring physicians are in this scope.",
      detail: (row) => row && [
        ["Name", row.name],
        ["Email", row.email],
        ["Account", row.active === false ? "Inactive" : "Active"],
        ["Role", "Referring physician"],
      ],
    };
  }
  return {};
}

function NodeForm({ form, setForm, onSubmit, busy, listener }) {
  return (
    <Panel title="Register a remote AE" className="mb-4">
      <form className="grid gap-3 p-3 md:grid-cols-5" onSubmit={onSubmit}>
        <Field label="Node name"><input required className={fieldClass} aria-label="Node name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="AE title"><input required className={fieldClass} aria-label="AE title" value={form.aeTitle} onChange={(event) => setForm({ ...form, aeTitle: event.target.value })} /></Field>
        <Field label="Host"><input required className={fieldClass} aria-label="Host" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} /></Field>
        <Field label="Port"><input required className={fieldClass} aria-label="Port" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></Field>
        <Field label="Modality">
          <select className={fieldClass} aria-label="Modality" value={form.modality} onChange={(event) => setForm({ ...form, modality: event.target.value })}>
            {MODALITIES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <div className="md:col-span-5 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-300">{listener}</p>
          <button className="h-9 bg-[#5b21b6] px-4 text-sm text-white disabled:opacity-60" disabled={busy}>{busy ? "Saving…" : "Save node"}</button>
        </div>
      </form>
    </Panel>
  );
}

function OrganizationForm({ form, setForm, onSubmit, busy }) {
  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
      <Panel title="Organization profile">
        <form className="grid gap-3 p-3 sm:grid-cols-2" onSubmit={onSubmit}>
          <Field label="Legal name"><input className={fieldClass} value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} /></Field>
          <Field label="Support email"><input className={fieldClass} value={form.supportEmail} onChange={(event) => setForm({ ...form, supportEmail: event.target.value })} /></Field>
          <Field label="Timezone"><input className={fieldClass} value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></Field>
          <Field label="Locale"><input className={fieldClass} value={form.locale} onChange={(event) => setForm({ ...form, locale: event.target.value })} /></Field>
          <div className="sm:col-span-2"><button className="h-9 bg-[#5b21b6] px-4 text-sm text-white disabled:opacity-60" disabled={busy}>{busy ? "Saving…" : "Save organization"}</button></div>
        </form>
      </Panel>
      <Panel title="Access methods">
        <ul className="divide-y divide-white/5 text-sm">
          <li className="flex items-center justify-between px-3 py-2"><span>Password sign-in</span><Badge tone="good">Active</Badge></li>
        </ul>
      </Panel>
    </div>
  );
}

function BillingBoard() {
  const cards = [
    ["Payment provider", "Not connected", "No gateway credentials are stored."],
    ["Invoices", "None", "PACSD has not recorded an invoice or receipt."],
    ["Subscription", "Unconfigured", "There is no paid plan on this deployment."],
    ["Image retention", "Unchanged", "Studies are not deleted because billing is absent."],
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {cards.map(([title, state, detail]) => (
        <Panel key={title} title={title}>
          <div className="px-3 py-4">
            <Badge tone="warn">{state}</Badge>
            <p className="mt-3 text-sm text-zinc-300">{detail}</p>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function ChannelBoard({ status }) {
  if (!status) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {CHANNELS.map((channel) => {
        const on = Boolean(status[channel.key]);
        return (
          <Panel key={channel.key} title={channel.name}>
            <div className="px-3 py-4">
              <Badge tone={on ? "good" : "neutral"}>{on ? "Configured" : "Not configured"}</Badge>
              <p className="mt-3 text-sm leading-5 text-zinc-300">{channel.detail}</p>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function HealthBoard({ data }) {
  const services = [
    ["Database", data.database === "connected" ? "Connected" : data.database, data.database === "connected" ? "good" : "bad"],
    ["DICOM listener", data.dicomListener ? "Listening" : "Not listening", data.dicomListener ? "good" : "warn"],
    ["Orthanc", data.integrations?.orthanc ? "Configured" : "Not configured", data.integrations?.orthanc ? "good" : "neutral"],
    ["Email", data.integrations?.smtp ? "Configured" : "Not configured", data.integrations?.smtp ? "good" : "neutral"],
    ["WhatsApp", data.integrations?.whatsapp ? "Configured" : "Not configured", data.integrations?.whatsapp ? "good" : "neutral"],
    ["Report assist", data.integrations?.ai ? "Configured" : "Not configured", data.integrations?.ai ? "good" : "neutral"],
  ];
  return (
    <>
      <Metrics items={[
        { label: "Uptime", value: formatDuration(data.uptimeSeconds), detail: "This API process" },
        { label: "Heap", value: formatBytes(data.memory?.heapUsed), detail: "Memory in use" },
        { label: "Rejected transfers", value: data.rejectedTransfers ?? 0, detail: "Files the server refused" },
        { label: "Listener", value: data.dicomListener ? "On" : "Off", detail: "PACSD does not open a DICOM port" },
      ]} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {services.map(([name, state, tone]) => (
          <Panel key={name} title={name}>
            <div className="px-3 py-4"><Badge tone={tone}>{state}</Badge></div>
          </Panel>
        ))}
      </div>
    </>
  );
}

function ArchiveBoard({ data }) {
  return (
    <>
      <Metrics items={[
        { label: "Instances", value: data.instanceCount ?? 0, detail: "Stored for this facility" },
        { label: "Indexed", value: formatBytes(data.indexedBytes), detail: "Sum of instance records" },
        { label: "Folder", value: formatBytes(data.directoryBytes), detail: `${data.directoryFiles ?? 0} files on disk` },
        { label: "Orthanc", value: data.orthancConfigured ? "Configured" : "Not configured", detail: "External archive" },
      ]} />
      <Panel title="How these numbers are counted">
        <p className="px-3 py-3 text-sm leading-5 text-zinc-300">{data.note}</p>
      </Panel>
    </>
  );
}
