import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { canReadDicom, useAuth } from "../auth.jsx";
import { useFacility } from "../facility.jsx";
import { useToasts } from "../feedback.jsx";
import { Field, fieldClass } from "../ui.jsx";

const MODALITIES = ["CT", "MR", "DX", "CR", "US", "MG", "PT", "XA", "OT"];

export default function StudyDatabase() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { facilityId } = useFacility();
  const canOrder = user?.role === "technologist" || user?.role === "system_admin";
  const showViewer = canReadDicom(user);
  const [query, setQuery] = useState("");
  const [modality, setModality] = useState("");
  const [patients, setPatients] = useState([]);
  const [studies, setStudies] = useState([]);
  const [series, setSeries] = useState([]);
  const [patient, setPatient] = useState(null);
  const [study, setStudy] = useState(null);
  const toasts = useToasts();
  const [ordering, setOrdering] = useState(false);
  const [form, setForm] = useState({ name: "", mrn: "", birthDate: "", sex: "U", accession: "", modality: "CT", description: "", priority: "routine" });

  async function loadPatients(nextQuery = query) {
    const data = await api(`/api/patients?q=${encodeURIComponent(nextQuery)}`);
    setPatients(data.patients);
  }

  useEffect(() => {
    setPatient(null);
    setStudy(null);
    setStudies([]);
    setSeries([]);
    loadPatients().catch((error) => toasts.error(error.message));
  }, [facilityId]);

  async function choosePatient(next) {
    setPatient(next);
    setStudy(null);
    setSeries([]);
    const data = await api(`/api/studies?patientId=${next._id}${modality ? `&modality=${modality}` : ""}`);
    setStudies(data.studies);
  }

  async function chooseStudy(next) {
    setStudy(next);
    const data = await api(`/api/studies/${next._id}/series`);
    setSeries(data.series);
  }

  async function onSearch(event) {
    event.preventDefault();
    setPatient(null);
    setStudy(null);
    setStudies([]);
    setSeries([]);
    await loadPatients(query);
  }

  async function onDrop(event) {
    event.preventDefault();
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    const body = new FormData();
    body.append("facilityId", sessionStorage.getItem("pacsd_facility") || "");
    files.forEach((file) => body.append("files", file));
    toasts.success("Storing DICOM…");
    try {
      const result = await api("/api/dicom", { method: "POST", body });
      const storedMessage = `Stored ${result.stored.length}. Rejected ${result.rejected.length}.`;
      if (result.rejected.length) toasts.error(storedMessage);
      else toasts.success(storedMessage);
      await loadPatients();
    } catch (error) {
      toasts.error(error.message);
    }
  }

  async function createOrder(event) {
    event.preventDefault();
    const facilityId = sessionStorage.getItem("pacsd_facility");
    try {
      const created = await api("/api/patients", {
        method: "POST",
        body: { facilityId, name: form.name, mrn: form.mrn, birthDate: form.birthDate, sex: form.sex },
      });
      await api("/api/studies", {
        method: "POST",
        body: {
          patientId: created.patient._id,
          facilityId,
          accession: form.accession,
          modality: form.modality,
          description: form.description,
          priority: form.priority,
        },
      });
      setOrdering(false);
      await loadPatients();
      toasts.success("Order booked.");
    } catch (error) {
      toasts.error(error.message);
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#0b0b0f] px-5 pt-7 lg:px-8" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-violet-300/90">Study database</div>
          <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.02em] text-white md:text-[32px]">Studies</h1>
          <p className="mt-1 text-[14px] text-white/50">Patients, studies, and series for this facility</p>
        </div>
        <div className="flex gap-2 text-[12px] font-medium text-white/60">
          <span className="rounded-full bg-white/[0.06] px-3 py-1">{patients.length} patients</span>
          <span className="rounded-full bg-white/[0.06] px-3 py-1">{studies.length} studies</span>
          <span className="rounded-full bg-white/[0.06] px-3 py-1">{series.length} series</span>
        </div>
      </div>
      <form onSubmit={onSearch} className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl bg-[#1c1c21] p-4 ring-1 ring-white/[0.06]">
        <Field label="Search">
          <input
            className={`${fieldClass} max-w-xs`}
            placeholder="Patient, MRN, accession"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <Field label="Modality">
          <select className={fieldClass} value={modality} onChange={(event) => setModality(event.target.value)}>
            <option value="">All modalities</option>
            {MODALITIES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <button className="h-10 rounded-full bg-violet-600 px-5 text-[14px] font-medium text-white hover:bg-violet-500">Search</button>
        {canOrder && (
          <button type="button" className="h-10 rounded-full bg-white/[0.08] px-5 text-[14px] font-medium text-white/85 hover:bg-white/[0.12]" onClick={() => setOrdering((value) => !value)}>
            New order
          </button>
        )}
        <span className="ml-auto text-[12px] text-white/40">Drop a DICOM file on this page to store it.</span>
      </form>
      {ordering && (
        <form onSubmit={createOrder} className="mb-4 grid grid-cols-1 gap-3 rounded-2xl bg-[#1c1c21] p-4 text-sm ring-1 ring-white/[0.06] sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Patient name"><input required className={fieldClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="MRN"><input required className={fieldClass} value={form.mrn} onChange={(event) => setForm({ ...form, mrn: event.target.value })} /></Field>
          <Field label="Birth date"><input type="date" className={fieldClass} value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} /></Field>
          <Field label="Sex">
            <select className={fieldClass} value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })}>
              <option value="F">F</option><option value="M">M</option><option value="O">O</option><option value="U">U</option>
            </select>
          </Field>
          <Field label="Accession"><input required className={fieldClass} value={form.accession} onChange={(event) => setForm({ ...form, accession: event.target.value })} /></Field>
          <Field label="Modality">
            <select className={fieldClass} value={form.modality} onChange={(event) => setForm({ ...form, modality: event.target.value })}>
              {MODALITIES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Description"><input className={fieldClass} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
          <div className="flex items-end gap-2">
            <Field label="Priority">
              <select className={fieldClass} value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
                <option value="routine">routine</option><option value="urgent">urgent</option><option value="stat">stat</option>
              </select>
            </Field>
            <button className="h-10 rounded-full bg-violet-600 px-5 text-[14px] font-medium text-white hover:bg-violet-500">Book</button>
          </div>
        </form>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto xl:grid-cols-[minmax(220px,300px)_minmax(0,1fr)_minmax(220px,300px)] xl:overflow-hidden">
        <Pane title="Patients" empty={!patients.length} emptyText="No patients in this facility or search.">
          {patients.map((item) => (
            <button key={item._id} className={`block w-full rounded-xl px-3 py-2.5 text-left text-[14px] ${patient?._id === item._id ? "bg-violet-500/20 text-white" : "hover:bg-white/[0.05]"}`} onClick={() => choosePatient(item)}>
              <div className="font-medium">{item.name}</div>
              <div className="mt-0.5 text-[12px] text-white/45">{item.mrn}{item.synthetic ? " · demonstration" : ""}</div>
            </button>
          ))}
        </Pane>
        <Pane title="Studies" empty={!patient} emptyText="Select a patient.">
          {studies.map((item) => (
            <button
              key={item._id}
              className={`block w-full rounded-xl px-3 py-2.5 text-left text-[14px] ${study?._id === item._id ? "bg-violet-500/20 text-white" : "hover:bg-white/[0.05]"}`}
              onClick={() => chooseStudy(item)}
              onDoubleClick={showViewer ? () => navigate(`/viewer/${item._id}`) : undefined}
            >
              <div className="font-medium">{item.modality} · {item.accession}</div>
              <div className="mt-0.5 text-[12px] text-white/45">{item.description || "No description"} · {item.status} · {item.priority}</div>
            </button>
          ))}
        </Pane>
        <Pane title="Series" empty={!study} emptyText={showViewer ? "Select a study. Double-click a study to open the viewer." : "Select a study."}>
          {series.map((item) => (
            <div key={item._id} className="rounded-xl px-3 py-2.5 text-[14px]">
              <div className="font-medium">Series {item.seriesNumber}</div>
              <div className="mt-0.5 text-[12px] text-white/45">{item.modality} · {item.description || "No description"}</div>
            </div>
          ))}
          {study && !series.length && <p className="px-3 py-6 text-[14px] text-white/45">No images stored for this study yet.</p>}
        </Pane>
      </div>
      <footer className="flex items-center justify-between py-3 text-[12px] text-white/45">
        <span>Drop a DICOM part 10 file here to store it in this facility.</span>
        {showViewer && (
          <button
            className="h-9 rounded-full bg-white px-4 text-[13px] font-medium text-black hover:bg-white/85 disabled:bg-white/10 disabled:text-white/40"
            disabled={!study}
            onClick={() => navigate(`/viewer/${study._id}`)}
          >
            Open viewer
          </button>
        )}
      </footer>
    </div>
  );
}

function Pane({ title, empty, emptyText, children }) {
  return (
    <section className="flex min-h-[220px] flex-col overflow-hidden rounded-2xl bg-[#1c1c21] ring-1 ring-white/[0.06] xl:min-h-0">
      <h2 className="px-5 pb-2 pt-4 text-[15px] font-semibold tracking-tight text-white">{title}</h2>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {empty ? <p className="px-3 py-6 text-[14px] leading-6 text-white/45">{emptyText}</p> : children}
      </div>
    </section>
  );
}
