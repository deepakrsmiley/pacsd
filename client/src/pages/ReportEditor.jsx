import { useParams } from "react-router-dom";
import WordReport from "../report-editor/WordReport.jsx";

export default function ReportEditor() {
  const { reportId } = useParams();
  return <WordReport key={reportId} reportId={reportId} />;
}
