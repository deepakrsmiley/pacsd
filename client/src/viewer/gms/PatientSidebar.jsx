import { useMemo, useState } from "react";
import { Bone, Brain, ChevronDown, ChevronRight, Layers, PersonStanding, ScanLine, Search, UserRound } from "lucide-react";
import { patientAge, patientSexCode } from "../../../../shared/reportDocument.js";
import { formatSex, formatStudyDate } from "./format.js";

export default function PatientSidebar({
  collapsed,
  onToggle,
  patient,
  studies,
  studyId,
  imageCount,
  previewUrl,
  onOpen,
  seriesList = [],
  seriesId = "",
  onSeries,
  slice = 0,
  onSlice,
}) {
  const [tab, setTab] = useState("patient");
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(true);
  const mine = useMemo(() => {
    if (!patient?.mrn) return studies;
    const matched = studies.filter((item) => item.patientId?.mrn === patient.mrn);
    return matched.length ? matched : studies.filter((item) => item._id === studyId);
  }, [studies, patient?.mrn, studyId]);
  const source = tab === "patient" ? mine : studies;
  const openStudy = (studies || []).find((item) => item._id === studyId);
  const badge = patientBadge(patient, openStudy);
  const filtered = source.filter((item) => {
    const text = `${item.patientId?.name || ""} ${item.patientId?.mrn || ""} ${item.description || ""} ${item.modality || ""} ${item.accession || ""}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  if (collapsed) {
    return (
      <div className="flex w-0">
        <button type="button" className="absolute left-0 top-28 z-20 grid h-9 w-6 place-items-center rounded-r-xl bg-[#1c1c21] text-zinc-300 shadow-lg ring-1 ring-white/10 transition hover:text-white" aria-label="Expand patient sidebar" onClick={onToggle}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <aside className="gms2-left relative flex w-[315px] min-w-0 flex-col border-r border-white/[0.06] bg-[#111115]">
      <div className="mx-3 mt-3 flex h-10 items-center gap-1 rounded-xl bg-white/[0.05] p-1">
        <TabButton active={tab === "patient"} icon={UserRound} label="Patient" onClick={() => setTab("patient")} />
        <TabButton active={tab === "studies"} icon={Layers} label="Studies" onClick={() => setTab("studies")} />
        <button type="button" className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-zinc-400 transition hover:bg-white/10 hover:text-white" aria-label="Collapse patient sidebar" onClick={onToggle}>
          <ChevronDown className="h-4 w-4 rotate-90" />
        </button>
      </div>
      <div className="p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input aria-label="Search patient" value={query} placeholder="Search patient (Name / ID)" className="h-10 w-full rounded-xl border border-transparent bg-white/[0.06] pl-9 pr-3 text-[13px] outline-none transition placeholder:text-zinc-500 focus:border-violet-400/60 focus:ring-4 focus:ring-violet-500/15" onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "patient" && (
          <div className="mx-3 mb-3 flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3.5 ring-1 ring-white/[0.06]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#3b2a5c] text-[#c4b5fd]">
              <UserRound className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{patient?.name || "No study open"}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                <span className="truncate">ID: {patient?.mrn || "—"}</span>
                {badge.age && <span className="rounded bg-[#2a2a31] px-1.5 py-0.5 text-[10px] text-zinc-200">Age: {badge.age}</span>}
                {badge.sex && <span className="rounded bg-[#2a2a31] px-1.5 py-0.5 text-[10px] text-zinc-200">{badge.sex}</span>}
              </p>
            </div>
          </div>
        )}
        <div className="px-3 pb-3">
          <button type="button" className="mb-2 flex w-full items-center gap-1 text-[12px] font-semibold text-zinc-200" onClick={() => setListOpen((open) => !open)}>
            <ChevronDown className={`h-3.5 w-3.5 transition ${listOpen ? "" : "-rotate-90"}`} />
            Studies ({filtered.length})
          </button>
          {listOpen && filtered.map((study) => (
            <div key={study._id}>
              <StudyCard
                study={study}
                active={study._id === studyId}
                images={study._id === studyId ? imageCount : null}
                previewUrl={study._id === studyId ? previewUrl : ""}
                onOpen={() => onOpen(study._id)}
              />
              {study._id === studyId && seriesList.length > 0 && (
                <SeriesList
                  seriesList={seriesList}
                  seriesId={seriesId}
                  slice={slice}
                  onSeries={onSeries}
                  onSlice={onSlice}
                />
              )}
            </div>
          ))}
          {listOpen && filtered.length === 0 && <p className="px-1 text-[12px] text-zinc-500">No studies match this search.</p>}
        </div>
      </div>
    </aside>
  );
}

function TabButton({ active, icon: Icon, label, onClick }) {
  return (
    <button type="button" data-active={active ? "true" : "false"} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-zinc-400 transition hover:text-white data-[active=true]:bg-white/[0.12] data-[active=true]:text-white data-[active=true]:shadow-sm" onClick={onClick}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

export function StudyCard({ study, active, images, previewUrl, onOpen }) {
  const Icon = iconFor(study);
  return (
    <button type="button" data-active={active ? "true" : "false"} className="mb-1.5 flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-white/[0.05] data-[active=true]:bg-violet-500/15 data-[active=true]:shadow-[inset_0_0_0_1px_rgba(167,139,250,0.35)]" onClick={onOpen}>
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-black text-zinc-300">
        {previewUrl ? <img alt="" src={previewUrl} className="h-full w-full object-cover" /> : <Icon className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="rounded bg-[#2a2a31] px-1.5 py-0.5 text-[10px] font-semibold text-[#c4b5fd]">{study.modality || "OT"}</span>
          <span className="truncate text-[13px] font-semibold">{study.description || "Study"}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400">
          <Layers className="h-3 w-3" aria-hidden="true" />
          {formatStudyDate(study.studyDate) || "Date not recorded"}
          {Number.isFinite(images) ? ` · ${images} images` : ""}
        </span>
      </span>
    </button>
  );
}

function SeriesList({ seriesList, seriesId, slice, onSeries, onSlice }) {
  const active = seriesList.find((item) => item._id === seriesId) || seriesList[0];
  const images = active?.instances || [];
  return (
    <div className="mb-2 ml-3 border-l border-white/10 pl-2">
      {seriesList.map((item) => (
        <button
          key={item._id}
          type="button"
          data-active={item._id === active?._id ? "true" : "false"}
          className="mb-1 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-zinc-300 hover:bg-white/[0.05] data-[active=true]:bg-white/[0.08] data-[active=true]:text-white"
          onClick={() => onSeries?.(item._id)}
        >
          <span className="min-w-0 truncate">Se {item.seriesNumber || "—"} · {item.description || item.modality || "Series"}</span>
          <span className="shrink-0 tabular-nums text-zinc-400">{item.imageCount || item.instances?.length || 0}</span>
        </button>
      ))}
      {images.length > 0 && (
        <div className="mt-1 max-h-52 overflow-auto rounded-lg bg-black/30 p-1">
          {images.map((instance, index) => (
            <button
              key={instance._id || index}
              type="button"
              data-active={index === slice ? "true" : "false"}
              className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] text-zinc-400 hover:bg-white/10 data-[active=true]:bg-violet-500/25 data-[active=true]:text-white"
              onClick={() => onSlice?.(index)}
            >
              <span>Im {instance.instanceNumber || index + 1}</span>
              <span className="tabular-nums">{index + 1}/{images.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function patientBadge(patient, study) {
  const age = patientAge({ patient, study });
  const sex = formatSex(patientSexCode({ patient }));
  return {
    age: age ? `${age.count}${age.unit}` : "",
    sex: sex && sex !== "U" ? sex : "",
  };
}

function iconFor(study) {
  const text = `${study.description || ""} ${study.modality || ""}`.toLowerCase();
  if (text.includes("brain") || text.includes("head")) return Brain;
  if (text.includes("chest") || text.includes("lung")) return PersonStanding;
  if (text.includes("spine") || text.includes("bone") || text.includes("pelvis")) return Bone;
  return ScanLine;
}
