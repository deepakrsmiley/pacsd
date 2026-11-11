import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { Printer } from "lucide-react";

export default function ReportPrint() {
  const { reportId } = useParams();
  const frame = useRef(null);
  const url = `/api/reports/${reportId}/pdf`;
  return (
    <div className="flex h-full flex-col bg-[#525659]">
      <div className="no-print flex h-12 shrink-0 items-center gap-3 bg-white px-3 text-[13px] text-[#1f2937]">
        <Link className="text-[#1d4ed8] underline" to={`/reports/${reportId}`}>Back to the report</Link>
        <a className="text-[#1d4ed8] underline" href={`${url}?download=1`}>Download PDF</a>
        <a className="text-[#1d4ed8] underline" href={`/api/reports/${reportId}/docx?download=1`}>Download Word</a>
        <button type="button" className="ml-auto inline-flex items-center gap-1 rounded border border-[#d1d5db] px-2 py-1" onClick={() => frame.current?.contentWindow?.print()}>
          <Printer className="h-3.5 w-3.5" /> Print
        </button>
      </div>
      <iframe ref={frame} title="Report PDF" src={url} className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>
  );
}
