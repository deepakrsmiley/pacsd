import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { statusLabel } from "../../../shared/reportDocument.js";
import { api } from "../api.js";
import { useFacility } from "../facility.jsx";
import { useToasts } from "../feedback.jsx";
import { Badge, DataGrid, Metrics, Page, fieldClass, toneFor } from "../ui.jsx";

export default function Reports() {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(true);
  const { facilityId } = useFacility();
  const toasts = useToasts();

  useEffect(() => {
    let cancel = false;
    setReports([]);
    setStudies([]);
    setLoading(true);
    Promise.all([api("/api/reports"), api("/api/studies")])
      .then(([reportData, studyData]) => {
        if (cancel) return;
        setReports(reportData.reports);
        setStudies(studyData.studies);
      })
      .catch((err) => { if (!cancel) toasts.error(err.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [facilityId, toasts]);

  async function openForStudy(studyId) {
    const data = await api("/api/reports", { method: "POST", body: { studyId } });
    navigate(`/reports/${data.report._id}`);
  }

  const byStudy = new Map(studies.map((study) => [String(study._id), study]));
  const rows = reports.map((report) => {
    const study = byStudy.get(String(report.studyId));
    return { ...report, accession: study?.accession || "", modality: study?.modality || "", patient: study?.patientId?.name || "" };
  });

  return (
    <Page
      kicker="Reporting"
      title="Radiology reports"
      summary="Open a report in the Word-style editor, or start one from a study. A finalized report stays locked until an amendment is created."
      actions={(
        <select className={`${fieldClass} w-64`} aria-label="Start from a study" defaultValue="" onChange={(event) => event.target.value && openForStudy(event.target.value)}>
          <option value="" disabled>Start from a study</option>
          {studies.map((study) => <option key={study._id} value={study._id}>{study.accession} · {study.modality}</option>)}
        </select>
      )}
    >
      <Metrics items={[
        { label: "Reports", value: rows.length, detail: "In this facility" },
        { label: "Draft", value: rows.filter((row) => statusLabel(row) === "Draft" || statusLabel(row) === "In Progress").length, detail: "Still being written" },
        { label: "Pending signature", value: rows.filter((row) => statusLabel(row) === "Pending Signature").length, detail: "Released, not finalized" },
        { label: "Finalized", value: rows.filter((row) => statusLabel(row) === "Finalized" || statusLabel(row) === "Amended").length, detail: "Signed and locked" },
      ]} />
      <DataGrid
        columns={[
          { key: "patient", label: "Patient" },
          { key: "accession", label: "Accession" },
          { key: "modality", label: "Modality" },
          { key: "status", label: "Status", render: (row) => <Badge tone={toneFor(row.status)}>{statusLabel(row)}</Badge> },
          { key: "images", label: "Images", render: (row) => <Link className="text-violet-200 underline-offset-2 hover:underline" to={`/viewer/${row.studyId}`}>Viewer</Link> },
          { key: "updated", label: "Updated", render: (row) => row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—" },
          { key: "open", label: "Open", render: (row) => <Link className="text-violet-200 underline-offset-2 hover:underline" to={`/reports/${row._id}`}>Report</Link> },
          { key: "view", label: "Signed copy", render: (row) => <Link className="text-violet-200 underline-offset-2 hover:underline" to={`/reports/${row._id}/print`}>{row.status === "draft" ? "Preview" : "View signed report"}</Link> },
        ]}
        rows={rows}
        loading={loading}
        rowKey={(row) => row._id}
        empty="No reports in this facility yet."
      />
    </Page>
  );
}
