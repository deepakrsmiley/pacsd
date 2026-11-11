import { Component, lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { canReadDicom, homeFor, useAuth } from "./auth.jsx";
import Shell from "./shell.jsx";
import Login from "./pages/Login.jsx";
import StudyDatabase from "./pages/StudyDatabase.jsx";
import Worklist from "./pages/Worklist.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Reports from "./pages/Reports.jsx";
import ReportEditor from "./pages/ReportEditor.jsx";
import ReportPrint from "./pages/ReportPrint.jsx";
import Viewer from "./pages/Viewer.jsx";
import Operations from "./pages/Operations.jsx";
import Audit from "./pages/Audit.jsx";
import Settings from "./pages/Settings.jsx";
import Vocabulary from "./pages/Vocabulary.jsx";
import Share from "./pages/Share.jsx";
import { Skeleton } from "./ui.jsx";

const Workstation = lazy(() => import("./viewer/Workstation.jsx"));

class ViewerErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center bg-[#12141c] p-8 text-center text-sm text-zinc-200" role="alert">
        <div>
          <p className="text-base font-semibold">The DICOM workstation could not start.</p>
          <p className="mt-2 max-w-xl text-zinc-400">{this.state.error.message}</p>
        </div>
      </div>
    );
  }
}

function ViewerRoute() {
  return (
    <ViewerErrorBoundary>
      <Suspense fallback={<div className="grid h-full place-items-center text-sm text-zinc-300">Opening the DICOM workstation…</div>}>
        <Workstation />
      </Suspense>
    </ViewerErrorBoundary>
  );
}

function RoleHome() {
  const { user } = useAuth();
  return <Navigate to={homeFor(user)} replace />;
}

function DicomOnly({ children }) {
  const { user } = useAuth();
  if (!canReadDicom(user)) return <Navigate to={homeFor(user)} replace />;
  return children;
}

function Private({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return (
      <div className="grid h-full place-items-center bg-[#121214]" role="status" aria-label="Opening PACSD">
        <Skeleton className="h-16 w-64" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && location.pathname !== "/settings") return <Navigate to="/settings" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/share/:token" element={<Share />} />
      <Route path="/" element={<Private><Shell /></Private>}>
        <Route index element={<RoleHome />} />
        <Route path="studies" element={<StudyDatabase />} />
        <Route path="worklist" element={<Worklist mode="all" />} />
        <Route path="my-worklist" element={<Worklist mode="mine" />} />
        <Route path="review" element={<Worklist mode="review" />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/:reportId/print" element={<ReportPrint />} />
        <Route path="reports/:reportId" element={<ReportEditor />} />
        <Route path="viewer/:studyId/classic" element={<DicomOnly><Viewer /></DicomOnly>} />
        <Route path="viewer" element={<DicomOnly><ViewerRoute /></DicomOnly>} />
        <Route path="viewer/:studyId" element={<DicomOnly><ViewerRoute /></DicomOnly>} />
        <Route path="patients" element={<Operations kind="patients" />} />
        <Route path="critical" element={<Operations kind="critical" />} />
        <Route path="nodes" element={<Operations kind="nodes" />} />
        <Route path="transfers" element={<Operations kind="transfers" />} />
        <Route path="archive" element={<Operations kind="archive" />} />
        <Route path="integrations" element={<Operations kind="integrations" />} />
        <Route path="notifications" element={<Operations kind="notifications" />} />
        <Route path="organization" element={<Operations kind="organization" />} />
        <Route path="storage" element={<Operations kind="storage" />} />
        <Route path="health" element={<Operations kind="health" />} />
        <Route path="referring" element={<Operations kind="referring" />} />
        <Route path="portal" element={<Operations kind="portal" />} />
        <Route path="billing" element={<Operations kind="billing" />} />
        <Route path="audit" element={<Audit />} />
        <Route path="settings" element={<Settings />} />
        <Route path="vocabulary" element={<Vocabulary />} />
      </Route>
    </Routes>
  );
}
