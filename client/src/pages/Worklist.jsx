import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, FileText, RotateCcw, Search } from "lucide-react";
import { api } from "../api.js";
import { canReadDicom, useAuth } from "../auth.jsx";
import { useFacility } from "../facility.jsx";
import { useToasts } from "../feedback.jsx";
import { Badge, TableSkeleton, toneFor } from "../ui.jsx";
import { patientAge } from "../../../shared/reportDocument.js";

const TITLES = {
  all: ["Worklist", "Studies for the selected facility."],
  mine: ["My worklist", "Studies assigned to you."],
  review: ["Clinical review", "Studies in reporting or preliminary status."],
};

const EMPTY_FILTERS = {
  patientId: "",
  name: "",
  accession: "",
  modality: "",
  study: "",
  reportStatus: "",
  timeFrame: "",
  searchBy: "received",
};

const PAGE_SIZE = 12;

export default function Worklist({ mode }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { facilityId } = useFacility();
  const showViewer = canReadDicom(user);
  const canAssign = ["system_admin", "radiologist", "technologist"].includes(user?.role);
  const toasts = useToasts();
  const [studies, setStudies] = useState([]);
  const [reports, setReports] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ key: "date", direction: "desc" });
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState("");

  async function load() {
    const params = new URLSearchParams();
    if (mode === "mine") params.set("mine", "1");
    if (mode === "review") params.set("status", "reporting");
    if (mode === "all") params.set("remote", "0");
    const [studyData, reportData] = await Promise.all([
      api(`/api/studies?${params.toString()}`),
      api("/api/reports").catch(() => ({ reports: [] })),
    ]);
    const next = mode === "review"
      ? studyData.studies.filter((study) => study.status === "reporting" || study.status === "preliminary")
      : studyData.studies;
    setStudies(next);
    setReports(reportData.reports || []);
  }

  useEffect(() => {
    setSelectedId("");
    setStudies([]);
    setPage(0);
    setLoading(true);
    load().catch((err) => toasts.error(err.message)).finally(() => setLoading(false));
    api("/api/assignees").then((data) => setAssignees(data.users)).catch(() => setAssignees([]));
  }, [mode, facilityId, toasts]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return undefined;
    const source = new EventSource("/api/events", { withCredentials: true });
    let pending;
    const refresh = () => {
      clearTimeout(pending);
      pending = setTimeout(() => load().catch(() => {}), 300);
    };
    source.addEventListener("study.created", refresh);
    source.addEventListener("study.updated", refresh);
    return () => {
      clearTimeout(pending);
      source.close();
    };
  }, [mode, facilityId]);

  async function assign(study, assignedTo) {
    try {
      await api(`/api/studies/${study._id}`, { method: "PATCH", body: { assignedTo: assignedTo || null } });
      await load();
      toasts.success(assignedTo ? "Study assigned." : "Assignment cleared.");
    } catch (err) {
      toasts.error(err.message);
    }
  }

  async function openReport(study) {
    try {
      const data = await api("/api/reports", { method: "POST", body: { studyId: study._id } });
      navigate(`/reports/${data.report._id}`);
    } catch (err) {
      const found = reports.find((item) => String(item.studyId) === String(study._id));
      if (found) navigate(`/reports/${found._id}`);
      else toasts.error(err.message || "A report has not been started for this study.");
    }
  }

  const modalities = useMemo(() => [...new Set(studies.map((study) => study.modality).filter(Boolean))].sort(), [studies]);
  const rows = useMemo(() => {
    const filtered = studies.filter((study) => matches(study, filters, reports));
    const sorted = [...filtered].sort((a, b) => compareStudies(a, b, sort));
    return sorted;
  }, [studies, reports, filters, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const [title, summary] = TITLES[mode];

  function toggleSort(key) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0b0f] px-5 pt-7 text-zinc-100 lg:px-8">
      <header className="mb-5">
        <div className="text-[13px] font-semibold text-violet-300/90">Imaging</div>
        <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.02em] text-white md:text-[32px]">{title}</h1>
        <p className="mt-1 text-[14px] text-white/50">{summary}</p>
      </header>
      <form
        className="mb-4 grid gap-3 rounded-2xl bg-[#1c1c21] p-4 ring-1 ring-white/[0.06] md:grid-cols-3 xl:grid-cols-6"
        onSubmit={(event) => { event.preventDefault(); setFilters(draft); setPage(0); }}
      >
        <Filter label="Patient ID">
          <input className={inputClass} value={draft.patientId} onChange={(event) => setDraft({ ...draft, patientId: event.target.value })} />
        </Filter>
        <Filter label="Patient name">
          <input className={inputClass} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </Filter>
        <Filter label="Accession number">
          <input className={inputClass} value={draft.accession} onChange={(event) => setDraft({ ...draft, accession: event.target.value })} />
        </Filter>
        <Filter label="Modality">
          <select className={inputClass} value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value })}>
            <option value="">All</option>
            {modalities.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Filter>
        <Filter label="Study">
          <input className={inputClass} value={draft.study} onChange={(event) => setDraft({ ...draft, study: event.target.value })} />
        </Filter>
        <Filter label="Report status">
          <select className={inputClass} value={draft.reportStatus} onChange={(event) => setDraft({ ...draft, reportStatus: event.target.value })}>
            <option value="">All</option>
            <option value="none">No report</option>
            <option value="draft">Draft</option>
            <option value="preliminary">Preliminary</option>
            <option value="final">Final</option>
          </select>
        </Filter>
        <Filter label="Search by">
          <select className={inputClass} value={draft.searchBy} onChange={(event) => setDraft({ ...draft, searchBy: event.target.value })}>
            <option value="received">Receiving date</option>
            <option value="study">Study date</option>
          </select>
        </Filter>
        <Filter label="Time frame">
          <select className={inputClass} value={draft.timeFrame} onChange={(event) => setDraft({ ...draft, timeFrame: event.target.value })}>
            <option value="">All dates</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </Filter>
        <div className="flex items-end gap-2 md:col-span-2">
          <button className="inline-flex h-10 items-center gap-1.5 rounded-full bg-violet-600 px-5 text-[14px] font-medium text-white hover:bg-violet-500" type="submit">
            <Search className="h-4 w-4" aria-hidden="true" /> Find
          </button>
          <button
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/[0.08] px-5 text-[14px] font-medium text-white/85 hover:bg-white/[0.12]"
            type="button"
            onClick={() => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setPage(0); }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset
          </button>
        </div>
      </form>
      <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-[#1c1c21] ring-1 ring-white/[0.06]">
        {loading ? <TableSkeleton /> : (
          <table className="w-max min-w-full border-collapse text-left text-[14px]" aria-label="Worklist">
            <thead className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#1c1c21]/95 text-[12px] text-white/45 backdrop-blur">
              <tr>
                <th className="px-3 py-2 font-medium">Open</th>
                <SortHeader label="Patient ID" active={sort.key === "mrn"} onClick={() => toggleSort("mrn")} />
                <SortHeader label="Patient name" active={sort.key === "name"} onClick={() => toggleSort("name")} />
                <SortHeader label="Age" active={sort.key === "age"} onClick={() => toggleSort("age")} />
                <SortHeader label="Sex" active={sort.key === "sex"} onClick={() => toggleSort("sex")} />
                <SortHeader label="Study date" active={sort.key === "date"} onClick={() => toggleSort("date")} />
                <th className="px-3 py-2 font-medium">Study time</th>
                <SortHeader label="Study" active={sort.key === "study"} onClick={() => toggleSort("study")} />
                <SortHeader label="Modality" active={sort.key === "modality"} onClick={() => toggleSort("modality")} />
                <th className="px-3 py-2 font-medium">Report</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Assignee</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((study) => {
                const when = studyWhen(study);
                const age = patientAge({ patient: study.patientId, study });
                const reportStatus = reportStatusFor(study._id, reports);
                const selected = selectedId === study._id;
                return (
                  <tr
                    key={study._id}
                    tabIndex={0}
                    aria-selected={selected}
                    className={`border-t border-white/[0.05] transition-colors ${selected ? "bg-violet-500/15" : "hover:bg-white/[0.035]"}`}
                    onClick={() => setSelectedId(study._id)}
                    onDoubleClick={() => { if (showViewer) navigate(`/viewer/${study._id}`); else openReport(study); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        if (showViewer) navigate(`/viewer/${study._id}`);
                        else openReport(study);
                      }
                    }}
                  >
                    <td className="px-3 py-2">
                      <span className="flex gap-1">
                        {showViewer && (
                          <button type="button" className="grid h-7 w-7 place-items-center border border-violet-300/40 text-violet-100" aria-label={`Open ${study.accession} in the viewer`} onClick={(event) => { event.stopPropagation(); navigate(`/viewer/${study._id}`); }}>
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                        <button type="button" className="grid h-7 w-7 place-items-center border border-white/15 text-zinc-100" aria-label={`Open the report for ${study.accession}`} onClick={(event) => { event.stopPropagation(); openReport(study); }}>
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-violet-100">{study.patientId?.mrn || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={study.priority === "stat" ? "bg-amber-400/20 px-1.5 py-0.5 text-amber-100" : study.priority === "urgent" ? "bg-violet-400/20 px-1.5 py-0.5 text-violet-100" : ""}>
                        {study.patientId?.name || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {age == null ? "—" : <span className={age.unit === "Y" && age.count >= 80 ? "bg-amber-500/20 px-1.5 py-0.5 text-amber-100" : ""}>{ageLabel(age)}</span>}
                    </td>
                    <td className="px-3 py-2">{study.patientId?.sex || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{when.date}</td>
                    <td className="whitespace-nowrap px-3 py-2">{when.time}</td>
                    <td className="max-w-[220px] truncate px-3 py-2">{study.description || "—"}</td>
                    <td className="px-3 py-2">{study.modality}</td>
                    <td className="px-3 py-2"><Badge tone={toneFor(reportStatus === "none" ? "" : reportStatus)}>{reportStatus === "none" ? "No report" : reportStatus}</Badge></td>
                    <td className="px-3 py-2"><Badge tone={toneFor(study.status)}>{study.status}</Badge></td>
                    <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                      {canAssign ? (
                        <select className="h-8 max-w-[160px] border border-white/10 bg-black/40 px-2 text-xs" aria-label={`Assignee for ${study.accession}`} value={study.assignedTo?._id || ""} onChange={(event) => assign(study, event.target.value)}>
                          <option value="">Unassigned</option>
                          {assignees.map((person) => <option key={person._id} value={person._id}>{person.name}</option>)}
                        </select>
                      ) : (study.assignedTo?.name || "Unassigned")}
                    </td>
                  </tr>
                );
              })}
              {!visible.length && (
                <tr><td className="px-3 py-16 text-center text-[14px] text-white/45" colSpan={12}>No studies match this worklist.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 py-3 text-[12px] text-white/45">
        <span>Eye opens the viewer. Document opens the report. Amber marks STAT priority and age of 80 or more.</span>
        <span className="flex items-center gap-2">
          <span>Showing {rows.length ? safePage * PAGE_SIZE + 1 : 0} to {Math.min(rows.length, safePage * PAGE_SIZE + PAGE_SIZE)} of {rows.length}</span>
          <button type="button" className="border border-white/15 px-2 py-1 disabled:opacity-40" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
          <button type="button" className="border border-white/15 px-2 py-1 disabled:opacity-40" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => current + 1)}>Next</button>
        </span>
      </footer>
    </div>
  );
}

const inputClass = "h-10 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-[14px] text-white outline-none focus:border-violet-400/60 focus:ring-4 focus:ring-violet-500/15";

function Filter({ label, children }) {
  return (
    <label className="block text-[13px] font-medium text-white/60">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function SortHeader({ label, active, onClick }) {
  return (
    <th className="px-3 py-2 font-medium">
      <button type="button" className={active ? "text-white" : ""} onClick={onClick}>{label}</button>
    </th>
  );
}

function matches(study, filters, reports) {
  const patient = study.patientId || {};
  if (filters.patientId && !String(patient.mrn || "").toLowerCase().includes(filters.patientId.trim().toLowerCase())) return false;
  if (filters.name && !String(patient.name || "").toLowerCase().includes(filters.name.trim().toLowerCase())) return false;
  if (filters.accession && !String(study.accession || "").toLowerCase().includes(filters.accession.trim().toLowerCase())) return false;
  if (filters.modality && study.modality !== filters.modality) return false;
  if (filters.study && !String(study.description || "").toLowerCase().includes(filters.study.trim().toLowerCase())) return false;
  const status = reportStatusFor(study._id, reports);
  if (filters.reportStatus && status !== filters.reportStatus) return false;
  if (filters.timeFrame) {
    const days = Number(filters.timeFrame);
    const stamp = filters.searchBy === "study" ? dateFromStudy(study.studyDate) : new Date(study.createdAt);
    if (!stamp || Number.isNaN(stamp.getTime())) return false;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    if (stamp.getTime() < cutoff) return false;
  }
  return true;
}

function compareStudies(a, b, sort) {
  const left = sortValue(a, sort.key);
  const right = sortValue(b, sort.key);
  const order = left < right ? -1 : left > right ? 1 : 0;
  return sort.direction === "asc" ? order : -order;
}

function sortValue(study, key) {
  if (key === "mrn") return study.patientId?.mrn || "";
  if (key === "name") return study.patientId?.name || "";
  if (key === "age") return ageSortValue(study);
  if (key === "sex") return study.patientId?.sex || "";
  if (key === "date") return (dateFromStudy(study.studyDate) || new Date(study.createdAt) || new Date(0)).getTime();
  if (key === "study") return study.description || "";
  if (key === "modality") return study.modality || "";
  return "";
}

function reportStatusFor(studyId, reports) {
  const matchesForStudy = reports.filter((item) => String(item.studyId) === String(studyId));
  if (!matchesForStudy.length) return "none";
  if (matchesForStudy.some((item) => item.status === "final")) return "final";
  if (matchesForStudy.some((item) => item.status === "preliminary")) return "preliminary";
  return "draft";
}

function studyWhen(study) {
  const parsed = dateFromStudy(study.studyDate) || (study.createdAt ? new Date(study.createdAt) : null);
  const timeSource = study.acquiredAt || study.createdAt;
  return {
    date: parsed ? parsed.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "—",
    time: timeSource ? new Date(timeSource).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—",
  };
}

function dateFromStudy(value) {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageLabel(age) {
  const plural = { Y: "years", M: "months", W: "weeks", D: "days" }[age.unit] || "years";
  return `${age.count} ${age.count === 1 ? plural.slice(0, -1) : plural}`;
}

function ageSortValue(study) {
  const age = patientAge({ patient: study.patientId, study });
  if (!age) return -1;
  if (age.unit === "M") return age.count / 12;
  if (age.unit === "W") return age.count / 52;
  if (age.unit === "D") return age.count / 365;
  return age.count;
}
