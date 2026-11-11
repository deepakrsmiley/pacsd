import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useToasts } from "../feedback.jsx";
import { fieldClass } from "../ui.jsx";

const CATEGORIES = ["anatomy", "organ", "bone", "muscle", "vessel", "finding", "disease", "clinical", "imaging", "abbreviation", "phrase"];
const EMPTY = { term: "", spoken: "", category: "finding", abbreviation: "", source: "custom", code: "", codeSystem: "", licenseAcknowledged: false };

export default function Vocabulary() {
  const { user } = useAuth();
  const toasts = useToasts();
  const canWrite = user.role === "system_admin" || user.role === "facility_admin";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [context, setContext] = useState("");
  const [data, setData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState("");

  function load() {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    if (context) params.set("context", context);
    params.set("limit", "150");
    api(`/api/vocabulary?${params.toString()}`)
      .then(setData)
      .catch((error) => toasts.error(error.message));
  }

  useEffect(() => { load(); }, [category, context]);

  async function save(event) {
    event.preventDefault();
    const body = {
      term: form.term,
      spoken: form.spoken.split(",").map((item) => item.trim()).filter(Boolean),
      category: form.category,
      abbreviation: form.abbreviation,
      source: form.source,
      code: form.code,
      codeSystem: form.codeSystem,
      licenseAcknowledged: form.licenseAcknowledged,
    };
    try {
      if (editing) await api(`/api/vocabulary/${editing}`, { method: "PATCH", body });
      else await api("/api/vocabulary", { method: "POST", body });
      setForm(EMPTY);
      setEditing("");
      toasts.success(editing ? "Term updated." : "Term added.");
      load();
    } catch (error) {
      toasts.error(error.message);
    }
  }

  async function retire(term) {
    if (!term.id || !window.confirm(`Remove “${term.term}” from the facility vocabulary?`)) return;
    try {
      await api(`/api/vocabulary/${term.id}`, { method: "DELETE" });
      toasts.success("Term removed.");
      load();
    } catch (error) {
      toasts.error(error.message);
    }
  }

  return (
    <div className="h-full overflow-auto bg-[#0b0b0f] text-white">
      <header className="px-5 pb-6 pt-7 lg:px-8">
        <div className="text-[13px] font-semibold text-violet-300/90">Medical vocabulary</div>
        <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.02em] md:text-[32px]">Radiology terminology</h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-6 text-white/50">{data?.notice?.curated} {data?.notice?.licensed}</p>
      </header>
      <div className="grid gap-4 px-5 pb-10 lg:px-8 xl:grid-cols-[300px_minmax(0,1fr)]">
        {canWrite && (
          <form onSubmit={save} className="h-fit rounded-2xl bg-[#1c1c21] p-5 ring-1 ring-white/[0.06]">
            <h2 className="text-[15px] font-semibold tracking-tight">{editing ? "Edit term" : "Add a term"}</h2>
            <label className="mt-3 block text-[13px] font-medium text-white/60">Term
              <input required className={`mt-1.5 ${fieldClass}`} value={form.term} onChange={(event) => setForm({ ...form, term: event.target.value })} />
            </label>
            <label className="mt-3 block text-[13px] font-medium text-white/60">Spoken alternatives, comma separated
              <input className={`mt-1.5 ${fieldClass}`} value={form.spoken} onChange={(event) => setForm({ ...form, spoken: event.target.value })} />
            </label>
            <label className="mt-3 block text-[13px] font-medium text-white/60">Category
              <select className={`mt-1.5 ${fieldClass}`} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="mt-3 block text-[13px] font-medium text-white/60">Abbreviation
              <input className={`mt-1.5 ${fieldClass}`} value={form.abbreviation} onChange={(event) => setForm({ ...form, abbreviation: event.target.value })} />
            </label>
            <label className="mt-3 block text-[13px] font-medium text-white/60">Source
              <select className={`mt-1.5 ${fieldClass}`} value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>
                <option value="custom">Custom</option>
                <option value="radlex">RadLex</option>
                <option value="snomed">SNOMED CT</option>
                <option value="icd10">ICD-10</option>
                <option value="loinc">LOINC</option>
              </select>
            </label>
            <label className="mt-3 block text-[13px] font-medium text-white/60">Code, if licensed
              <input className={`mt-1.5 ${fieldClass}`} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
            </label>
            <label className="mt-3 block text-[13px] font-medium text-white/60">Code system
              <input className={`mt-1.5 ${fieldClass}`} value={form.codeSystem} onChange={(event) => setForm({ ...form, codeSystem: event.target.value })} />
            </label>
            {form.source !== "custom" && (
              <label className="mt-3 flex items-start gap-2 text-[13px] text-white/70">
                <input type="checkbox" className="mt-0.5" checked={form.licenseAcknowledged} onChange={(event) => setForm({ ...form, licenseAcknowledged: event.target.checked })} />
                This facility has accepted the publisher license for this terminology.
              </label>
            )}
            <div className="mt-5 flex gap-2">
              <button className="h-10 flex-1 rounded-full bg-violet-600 px-5 text-[14px] font-medium text-white hover:bg-violet-500" type="submit">{editing ? "Save" : "Add term"}</button>
              {editing && <button type="button" className="h-10 rounded-full bg-white/[0.08] px-5 text-[14px] font-medium text-white/85 hover:bg-white/[0.12]" onClick={() => { setEditing(""); setForm(EMPTY); }}>Cancel</button>}
            </div>
          </form>
        )}
        <div className="min-w-0 overflow-hidden rounded-2xl bg-[#1c1c21] ring-1 ring-white/[0.06]">
          <div className="flex flex-wrap gap-2 border-b border-white/[0.06] p-4">
            <input className={`${fieldClass} min-w-[180px] flex-1 !w-auto`} placeholder="Search anatomy, findings, abbreviations" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") load(); }} />
            <select className={`${fieldClass} !w-auto`} aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select className={`${fieldClass} !w-auto`} aria-label="Imaging context" value={context} onChange={(event) => setContext(event.target.value)}>
              <option value="">All studies</option>
              <option value="ct-brain">CT brain</option>
              <option value="mri-brain">MRI brain</option>
              <option value="mri-lumbar">MRI lumbar spine</option>
              <option value="chest-xray">Chest X-ray</option>
              <option value="us-abdomen">Ultrasound abdomen</option>
              <option value="mammography">Mammography</option>
            </select>
            <button type="button" className="h-10 rounded-full bg-violet-600 px-5 text-[14px] font-medium text-white hover:bg-violet-500" onClick={load}>Search</button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="text-[12px] text-white/45">
                <tr>
                  <th className="px-3 py-2 font-medium">Term</th>
                  <th className="px-3 py-2 font-medium">Spoken as</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  {canWrite && <th className="px-3 py-2 font-medium"> </th>}
                </tr>
              </thead>
              <tbody>
                {(data?.terms || []).map((term) => (
                  <tr key={`${term.source}-${term.id || term.term}`} className="border-t border-white/[0.05] transition-colors hover:bg-white/[0.035]">
                    <td className="px-3 py-2.5 font-medium text-white">{term.term}{term.abbreviation ? ` (${term.abbreviation})` : ""}</td>
                    <td className="px-3 py-2.5 text-white/50">{(term.spoken || []).join(", ")}</td>
                    <td className="px-3 py-2.5"><span className="rounded-full bg-white/[0.07] px-2.5 py-0.5 text-[12px] capitalize text-white/75">{term.category}</span></td>
                    <td className="px-3 py-2.5 capitalize text-white/60">{term.source}{term.code ? ` ${term.code}` : ""}</td>
                    {canWrite && (
                      <td className="px-3 py-2 text-right">
                        {term.managed && (
                          <>
                            <button type="button" className="text-violet-300 hover:text-violet-200" onClick={() => { setEditing(term.id); setForm({ ...EMPTY, ...term, spoken: (term.spoken || []).join(", "), licenseAcknowledged: false }); }}>Edit</button>
                            <button type="button" className="ml-3 text-rose-400 hover:text-rose-300" onClick={() => retire(term)}>Remove</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {data && !data.terms.length && <p className="px-5 py-10 text-center text-[14px] text-white/45">No terms match that search.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
