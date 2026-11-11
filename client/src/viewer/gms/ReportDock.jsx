import { useEffect, useState } from "react";
import { api } from "../../api.js";
import WordReport from "../../report-editor/WordReport.jsx";

const MODES = [
  ["image", "Images"],
  ["split", "Split"],
  ["report", "Report"],
];

export default function ReportDock({ studyId, workspace, onWorkspace, width, tab, onTab, children }) {
  const [reportId, setReportId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!studyId) {
      setReportId("");
      setMessage("Open a study to write the report.");
      return undefined;
    }
    let cancel = false;
    setMessage("");
    api("/api/reports", { method: "POST", body: { studyId } })
      .then((data) => { if (!cancel) setReportId(data.report._id); })
      .catch(async (error) => {
        if (cancel) return;
        if (error.status === 403) {
          try {
            const data = await api(`/api/reports?studyId=${studyId}`);
            const existing = data.reports?.[0];
            if (!cancel) {
              setReportId(existing?._id || "");
              setMessage(existing ? "" : "You can view images. Report writing is not enabled for this account.");
            }
          } catch (failure) {
            if (!cancel) setMessage(failure.message);
          }
          return;
        }
        if (!cancel) setMessage(error.message);
      });
    return () => { cancel = true; };
  }, [studyId]);

  const showReport = workspace !== "image" && tab === "report";
  const style = workspace === "report"
    ? { flex: "1 1 auto", minWidth: 0 }
    : workspace === "image"
      ? { width: 330, flex: "0 0 auto" }
      : { width, maxWidth: "68%", minWidth: 0, flex: "0 1 auto" };
  const segment = (active) => `h-7 shrink-0 whitespace-nowrap rounded-lg px-3.5 text-[12.5px] font-medium transition ${active ? "bg-white/[0.14] text-white shadow-sm" : "text-zinc-400 hover:text-white"}`;
  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-white/[0.06] bg-[#111115]" style={style}>
      <div className="flex h-[52px] min-w-0 shrink-0 items-center gap-2 overflow-x-auto border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-0.5 rounded-xl bg-white/[0.05] p-1" role="tablist" aria-label="View">
          {MODES.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={workspace === key} className={segment(workspace === key)} onClick={() => { onWorkspace(key); if (key === "report") onTab("report"); }}>{label}</button>
          ))}
        </div>
        {workspace !== "image" && (
          <div className="ml-auto flex items-center gap-0.5 rounded-xl bg-white/[0.05] p-1" role="tablist" aria-label="Panel">
            <button type="button" role="tab" aria-selected={tab === "report"} className={segment(tab === "report")} onClick={() => onTab("report")}>Report</button>
            <button type="button" role="tab" aria-selected={tab === "study"} className={segment(tab === "study")} onClick={() => onTab("study")}>Study</button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className={showReport ? "h-full" : "hidden"}>
          {reportId ? <WordReport key={reportId} reportId={reportId} embedded onReportChange={setReportId} /> : <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.05] ring-1 ring-white/[0.06]"><svg viewBox="0 0 24 24" className="h-7 w-7 text-white/40" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M7 3h7l5 5v13H7z" strokeLinejoin="round" /><path d="M14 3v5h5M10 13h6M10 17h4" strokeLinecap="round" /></svg></div><p className="max-w-xs text-[14px] text-white/50">{message || "Preparing the report…"}</p></div>}
        </div>
        {(workspace === "image" || tab === "study") && (
          <div className="h-full overflow-hidden [&_.gms2-right]:h-full [&_.gms2-right]:w-full [&_.gms2-right]:border-l-0">{children}</div>
        )}
      </div>
    </aside>
  );
}
