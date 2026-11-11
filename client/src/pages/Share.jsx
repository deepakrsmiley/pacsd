import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useToasts } from "../feedback.jsx";
import Logo from "../logo.jsx";

export default function Share() {
  const { token } = useParams();
  const toasts = useToasts();
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    fetch(`/api/public/share/${token}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unavailable");
        if (!cancel) setReport(data);
      })
      .catch((err) => {
        if (cancel) return;
        setError(err.message);
        toasts.error(err.message);
      });
    return () => { cancel = true; };
  }, [token, toasts]);

  if (error) {
    return <p className="min-h-full bg-white p-8 text-zinc-900" role="alert">{error}</p>;
  }
  if (!report) {
    return (
      <div className="min-h-full bg-white p-8" role="status" aria-label="Opening shared report">
        <div className="mx-auto h-16 w-48 animate-pulse bg-zinc-200" />
        <div className="mx-auto mt-6 h-8 max-w-3xl animate-pulse bg-zinc-200" />
        <div className="mx-auto mt-4 h-40 max-w-3xl animate-pulse bg-zinc-100" />
      </div>
    );
  }

  const preliminary = report.status === "preliminary";
  const signed = report.signedAt ? new Date(report.signedAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }) : "Not signed";

  return (
    <article className="min-h-full bg-white px-6 py-8 text-zinc-900 print:bg-white print:px-0 print:py-0 print:text-black">
      <div className="mx-auto max-w-3xl">
        <header className="border-b border-zinc-200 pb-4">
          <Logo className="h-14 w-auto" />
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-violet-800">PACSD · Galactic Medical Systems</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Shared radiology report</h1>
            <StatusBadge status={report.status} />
          </div>
          <p className="mt-2 text-sm text-zinc-700">{report.facilityName} · {report.patientName} · {report.mrn}</p>
          <p className="text-sm text-zinc-700">{report.modality} · {report.accession}{report.description ? ` · ${report.description}` : ""}</p>
          <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            <div><dt className="text-xs uppercase tracking-wide text-zinc-600">Signed</dt><dd>{signed}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-zinc-600">Signed by</dt><dd>{report.signerName || "Signer not recorded"}</dd></div>
          </dl>
        </header>
        {preliminary && (
          <p className="mt-4 border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
            This report is preliminary. It is not a final report.
          </p>
        )}
        <Section title="Technique">{report.technique}</Section>
        <Section title="Findings">{report.findings}</Section>
        <Section title="Impression">{report.impression}</Section>
        <a className="no-print mt-6 inline-block border border-violet-800 bg-violet-800 px-3 py-2 text-sm font-medium text-white" href={`/api/public/share/${token}/pdf`}>Download PDF</a>
        <p className="mt-6 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-700">{report.disclaimer}</p>
      </div>
    </article>
  );
}

function StatusBadge({ status }) {
  const tone = status === "final"
    ? "border-emerald-700 bg-emerald-50 text-emerald-900"
    : status === "preliminary"
      ? "border-amber-600 bg-amber-50 text-amber-950"
      : "border-zinc-400 bg-zinc-50 text-zinc-800";
  const label = status === "final" ? "Final" : status === "preliminary" ? "Preliminary" : status || "Unknown";
  return <span className={`inline-flex items-center border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${tone}`}>{label}</span>;
}

function Section({ title, children }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-violet-900">{title}</h2>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{children || "—"}</p>
    </section>
  );
}
