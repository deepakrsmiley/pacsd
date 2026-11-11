import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Archive,
  ArrowLeftRight,
  Bell,
  Building2,
  ClipboardList,
  FileText,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  Library,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  ScanLine,
  ScrollText,
  Shield,
  Siren,
  Stethoscope,
  UserRound,
  Users,
} from "lucide-react";
import { useAuth } from "./auth.jsx";
import { useFacility } from "./facility.jsx";
import Logo from "./logo.jsx";

const ROLE_LABEL = {
  system_admin: "System administrator",
  facility_admin: "Facility administrator",
  radiologist: "Radiologist",
  technologist: "Technologist",
  referring_physician: "Referring physician",
};

const CLINICAL = ["system_admin", "facility_admin", "radiologist", "technologist", "referring_physician"];
const DICOM_READ = ["system_admin", "facility_admin", "radiologist", "technologist"];

const NAV = [
  { group: "Workspace", items: [
    { to: "/viewer", icon: ScanLine, label: "DICOM Viewer", roles: DICOM_READ },
    { to: "/studies", icon: FolderOpen, label: "Studies", roles: CLINICAL },
    { to: "/worklist", icon: ClipboardList, label: "Imaging Worklist", roles: CLINICAL },
    { to: "/my-worklist", icon: UserRound, label: "My Worklist", roles: ["radiologist", "system_admin"] },
    { to: "/review", icon: Stethoscope, label: "Clinical Review", roles: ["radiologist", "facility_admin", "system_admin", "referring_physician"] },
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", roles: CLINICAL },
  ] },
  { group: "Clinical", items: [
    { to: "/reports", icon: FileText, label: "Radiology Reports", roles: ["radiologist", "facility_admin", "system_admin", "referring_physician"] },
    { to: "/vocabulary", icon: Library, label: "Medical Vocabulary", roles: ["radiologist", "facility_admin", "system_admin"] },
    { to: "/patients", icon: Users, label: "Patient Management", roles: CLINICAL },
    { to: "/critical", icon: Siren, label: "Critical Findings", roles: CLINICAL },
  ] },
  { group: "Enterprise", items: [
    { to: "/referring", icon: UserRound, label: "Referring Doctors", roles: ["facility_admin", "system_admin"] },
    { to: "/nodes", icon: Network, label: "DICOM Nodes", roles: ["facility_admin", "system_admin"] },
    { to: "/transfers", icon: ArrowLeftRight, label: "Transfer Queue", roles: ["facility_admin", "system_admin", "technologist"] },
    { to: "/archive", icon: Archive, label: "PACS Archive", roles: ["facility_admin", "system_admin"] },
    { to: "/integrations", icon: Plug, label: "Integrations", roles: ["facility_admin", "system_admin"] },
    { to: "/notifications", icon: Bell, label: "Notifications", roles: ["facility_admin", "system_admin", "radiologist"] },
    { to: "/organization", icon: Building2, label: "Organization Settings", roles: ["system_admin"] },
    { to: "/storage", icon: HardDrive, label: "Storage and Backup", roles: ["facility_admin", "system_admin"] },
    { to: "/health", icon: Activity, label: "System Health", roles: ["facility_admin", "system_admin"] },
  ] },
  { group: "Administration", items: [
    { to: "/audit", icon: ScrollText, label: "Audit Logs", roles: ["facility_admin", "system_admin"] },
    { to: "/settings", icon: Shield, label: "Users and Roles", roles: ["facility_admin", "system_admin"] },
  ] },
];

const TITLES = {
  "/viewer": "DICOM Viewer",
  "/studies": "Studies",
  "/worklist": "Imaging Worklist",
  "/my-worklist": "My Worklist",
  "/review": "Clinical Review",
  "/dashboard": "Dashboard",
  "/reports": "Radiology Reports",
  "/vocabulary": "Medical Vocabulary",
  "/audit": "Audit Logs",
  "/settings": "Users and Roles",
  "/patients": "Patient Management",
  "/critical": "Critical Findings",
  "/nodes": "DICOM Nodes",
  "/transfers": "Transfer Queue",
  "/archive": "PACS Archive",
  "/integrations": "Integrations",
  "/notifications": "Notifications",
  "/organization": "Organization Settings",
  "/storage": "Storage and Backup",
  "/health": "System Health",
  "/referring": "Referring Doctors",
};

export default function Shell() {
  const { user, logout } = useAuth();
  const { facilities, facilityId, setFacility } = useFacility();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
    if (!location.pathname.startsWith("/viewer")) sessionStorage.setItem("pacsd_last_page", `${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  const title = location.pathname.startsWith("/viewer")
    ? "DICOM Viewer"
    : location.pathname.startsWith("/reports/")
      ? "Report"
      : TITLES[location.pathname] || "PACSD";

  function chooseFacility(id) {
    setFacility(id);
  }

  const facility = facilities.find((item) => item._id === facilityId);
  const initials = String(user.name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "U";
  const reportWorkspace = /^\/reports\/[^/]+/.test(location.pathname);
  const printPage = /\/print$/.test(location.pathname);

  if (reportWorkspace) {
    return (
      <div className={printPage ? "print-root h-full overflow-auto bg-[#dbe4f5] text-[#1e1b4b]" : "h-full overflow-hidden bg-[#0c0616] text-white"}>
        <Outlet />
      </div>
    );
  }

  if (location.pathname.startsWith("/viewer") && !location.pathname.includes("/classic")) {
    return (
      <div className="h-full overflow-hidden bg-[#0b0b0f] text-[#f5f5f7]">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#0b0b0f] text-[#f5f5f7]">
      <header className="relative z-50 flex h-16 shrink-0 items-center gap-4 border-b border-white/[0.06] bg-[#0b0b0f]/80 px-4 backdrop-blur-xl backdrop-saturate-150 lg:px-6">
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-full text-white/80 transition hover:bg-white/10 lg:hidden"
          aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-3">
          <Logo className="h-8 w-auto" />
          <div className="hidden sm:block">
            <div className="text-[15px] font-semibold leading-none tracking-tight text-white">PACSD</div>
            <div className="mt-1 text-[11px] font-medium leading-none text-white/45">Galactic Medical Systems</div>
          </div>
        </div>
        <div className="hidden h-6 w-px bg-white/10 md:block" />
        <div className="hidden min-w-0 md:block">
          <div className="truncate text-[15px] font-semibold tracking-tight text-white">{title}</div>
          <div className="truncate text-xs text-white/45">{facility ? `${facility.name} · ${facility.code}` : "All facilities"}</div>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {facilities.length > 0 && (
            <select
              aria-label="Facility"
              className="h-9 max-w-[11rem] rounded-full border border-white/10 bg-white/[0.06] px-4 text-[13px] font-medium text-white outline-none transition hover:bg-white/10 focus:ring-2 focus:ring-violet-400/50 md:max-w-[16rem]"
              value={facilityId}
              onChange={(event) => chooseFacility(event.target.value)}
            >
              {facilities.map((item) => (
                <option key={item._id} value={item._id} className="bg-[#1c1c22]">{item.name}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-3 rounded-full py-1 pl-1 pr-1 sm:pr-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 text-[13px] font-semibold text-white shadow-lg shadow-violet-900/40 ring-1 ring-white/20">
              {initials}
            </div>
            <div className="hidden text-left sm:block">
              <div className="text-[13px] font-semibold leading-none text-white">{user.name}</div>
              <div className="mt-1 text-[11px] leading-none text-white/45">{ROLE_LABEL[user.role] || user.role}</div>
            </div>
          </div>
          <button
            className="h-9 rounded-full bg-white px-4 text-[13px] font-medium text-black transition hover:bg-white/85 active:scale-[0.98]"
            onClick={async () => { await logout(); navigate("/login"); }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        {drawerOpen && (
          <button type="button" className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />
        )}
        <aside className={`${drawerOpen ? "translate-x-0" : "-translate-x-full"} ${collapsed ? "lg:w-[4.5rem]" : "lg:w-64"} absolute inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-white/[0.06] bg-[#111115] transition-all duration-300 ease-out lg:static lg:translate-x-0`}>
          <nav className="min-h-0 flex-1 overflow-auto px-3 py-4" aria-label="Main menu">
            {NAV.map((section) => {
              const items = section.items.filter((item) => !item.roles || item.roles.includes(user.role));
              if (!items.length) return null;
              return (
                <div key={section.group} className="mb-5">
                  <div className={`px-3 pb-1.5 text-[11px] font-semibold text-white/35 ${collapsed ? "lg:hidden" : ""}`}>{section.group}</div>
                  <div className="space-y-0.5">
                    {items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          title={item.label}
                          aria-label={item.label}
                          className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition ${collapsed ? "lg:justify-center lg:px-0" : ""} ${isActive ? "bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" : "text-white/60 hover:bg-white/[0.05] hover:text-white"}`}
                        >
                          {({ isActive }) => (
                            <>
                              <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-violet-300" : "text-white/50 group-hover:text-white/80"}`} strokeWidth={1.75} aria-hidden="true" />
                              <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
          <button
            className="mx-3 mb-3 hidden items-center justify-center gap-2 rounded-xl border border-white/[0.06] py-2 text-[12px] font-medium text-white/50 transition hover:bg-white/[0.05] hover:text-white lg:flex"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
            <span className={collapsed ? "lg:hidden" : ""}>Collapse</span>
          </button>
        </aside>
        <main className="ui-apple min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
