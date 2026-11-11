import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  FileText,
  FolderOpen,
  Menu,
  ScanLine,
  Search,
  Sparkles,
  CircleHelp,
} from "lucide-react";
import Logo from "../../logo.jsx";

const LINKS = [
  { to: "/viewer", label: "Viewer", icon: ScanLine, match: (path) => path.startsWith("/viewer") },
  { to: "/worklist", label: "Worklist", icon: ClipboardList },
  { to: "/studies", label: "Studies", icon: FolderOpen },
  { to: "/reports", label: "Reports", icon: FileText },
];

const MENU = [
  ["DICOM Viewer", "/viewer"],
  ["Studies", "/studies"],
  ["Imaging Worklist", "/worklist"],
  ["Radiology Reports", "/reports"],
  ["Patients", "/patients"],
  ["Notifications", "/notifications"],
  ["Settings", "/settings"],
];

export default function ViewerHeader({
  user,
  query,
  onQuery,
  studies,
  onOpenAi,
  onLogout,
  toolItems,
}) {
  const navigate = useNavigate();
  const searchRef = useRef(null);
  const menuRef = useRef(null);
  const toolsRef = useRef(null);
  const helpRef = useRef(null);
  const accountRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const initial = String(user?.name || "D").trim().slice(0, 1).toUpperCase();
  const matches = studies.filter((item) => studyText(item).includes(query.trim().toLowerCase())).slice(0, 8);

  useEffect(() => {
    function onKey(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setMenuOpen(false);
        setToolsOpen(false);
        setHelpOpen(false);
        setAccountOpen(false);
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openStudy(id) {
    setSearchOpen(false);
    onQuery("");
    navigate(`/viewer/${id}`);
  }

  function goBack() {
    closeMenus();
    navigate(sessionStorage.getItem("pacsd_last_page") || "/worklist");
  }

  function closeMenus() {
    setMenuOpen(false);
    setToolsOpen(false);
    setHelpOpen(false);
    setAccountOpen(false);
    setSearchOpen(false);
  }

  const dimMenu = menuOpen || toolsOpen || helpOpen || accountOpen;

  return (
    <header className="relative z-[80] flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#0b0b0f]/85 px-3 backdrop-blur-xl backdrop-saturate-150">
      <button type="button" className="flex h-9 items-center gap-0.5 rounded-full pl-1.5 pr-3 text-[14px] font-medium text-violet-300 transition hover:bg-white/[0.08] hover:text-violet-200 active:scale-95" aria-label="Go back" title="Back" onClick={goBack}>
        <ChevronLeft className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
        <span className="hidden sm:inline">Back</span>
      </button>
      <span className="h-5 w-px bg-white/10" aria-hidden="true" />
      <button ref={menuRef} type="button" className="grid h-9 w-9 place-items-center rounded-md text-zinc-300 hover:bg-white/10" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => { setToolsOpen(false); setHelpOpen(false); setAccountOpen(false); setMenuOpen((open) => !open); }}>
        <Menu className="h-[18px] w-[18px]" />
      </button>
      <Logo className="h-9 w-9" />
      <div className="mr-2 hidden min-w-0 sm:block">
        <div className="text-[15px] font-semibold leading-none tracking-tight">PACSD</div>
        <div className="mt-1 text-[11px] font-medium leading-none text-white/45">Galactic Medical Systems</div>
      </div>
      <nav className="ml-2 hidden items-center gap-0.5 rounded-full bg-white/[0.05] p-1 lg:flex" aria-label="Workspace">
        {LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition ${(item.match ? item.match(window.location.pathname) : isActive) ? "bg-white/[0.14] text-white shadow-sm" : "text-zinc-400 hover:text-white"}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {item.label}
            </NavLink>
          );
        })}
        <button type="button" className="flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-zinc-400 transition hover:text-white" onClick={onOpenAi}>
          <Sparkles className="h-3.5 w-3.5 text-violet-300" aria-hidden="true" />
          AI Assist
        </button>
        <div className="relative">
          <button ref={toolsRef} type="button" className="flex h-8 items-center gap-1 rounded-full px-3.5 text-[13px] font-medium text-zinc-400 transition hover:text-white" aria-expanded={toolsOpen} onClick={() => { setMenuOpen(false); setToolsOpen((open) => !open); }}>
            Tools
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </nav>
      <div className="relative ml-auto w-[280px] max-w-[34vw]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          ref={searchRef}
          aria-label="Search patients and studies"
          value={query}
          placeholder="Search Patient / Accession / Study..."
          className="h-9 w-full rounded-full border border-transparent bg-white/[0.06] pl-9 pr-16 text-[13px] text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-violet-400/60 focus:bg-white/[0.08] focus:ring-4 focus:ring-violet-500/15"
          onChange={(event) => { onQuery(event.target.value); setSearchOpen(true); }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={(event) => { if (event.key === "Enter" && matches[0]) openStudy(matches[0]._id); }}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-medium text-zinc-400">Ctrl K</span>
      </div>
      <button type="button" className="grid h-9 w-9 place-items-center rounded-md text-zinc-300 hover:bg-white/10" aria-label="Notifications" title="Notifications" onClick={() => navigate("/notifications")}>
        <Bell className="h-4 w-4" />
      </button>
      <button ref={helpRef} type="button" className="grid h-9 w-9 place-items-center rounded-md text-zinc-300 hover:bg-white/10" aria-label="Help" title="Keyboard shortcuts" onClick={() => { setMenuOpen(false); setHelpOpen((open) => !open); }}>
        <CircleHelp className="h-4 w-4" />
      </button>
      <button ref={accountRef} type="button" className="ml-1 grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 text-[13px] font-semibold text-white shadow-lg shadow-violet-900/40 ring-1 ring-white/20 transition hover:brightness-110" aria-label="Account" title={user?.name || "Account"} onClick={() => { setMenuOpen(false); setAccountOpen((open) => !open); }}>
        {initial}
      </button>
      {dimMenu && createPortal(
        <button type="button" className="fixed inset-0 z-[190] cursor-default bg-black/20" aria-label="Close menu" onClick={closeMenus} />,
        document.body,
      )}
      <Flyout open={menuOpen} anchorRef={menuRef} width={260}>
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-zinc-500">Workspace</p>
        {MENU.map(([label, to]) => (
          <button key={to} type="button" className="block h-9 w-full rounded-lg px-3 text-left text-[13px] text-zinc-100 transition hover:bg-violet-500/80 hover:text-white" onClick={() => { closeMenus(); navigate(to); }}>{label}</button>
        ))}
      </Flyout>
      <Flyout open={toolsOpen} anchorRef={toolsRef} width={240}>
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-zinc-500">Tools</p>
        {toolItems.map((item) => (
          <button key={item.label} type="button" className="block h-9 w-full rounded-lg px-3 text-left text-[13px] text-zinc-100 transition hover:bg-violet-500/80 hover:text-white" onClick={() => { closeMenus(); item.onClick(); }}>{item.label}</button>
        ))}
      </Flyout>
      <Flyout open={searchOpen && Boolean(query.trim())} anchorRef={searchRef} width={320} align="right">
        {matches.length === 0 && <p className="px-3 py-2 text-xs text-zinc-400">No matching study</p>}
        {matches.map((item) => (
          <button key={item._id} type="button" className="block w-full px-3 py-2 text-left text-[13px] hover:bg-white/10" onClick={() => openStudy(item._id)}>
            <span className="block truncate text-zinc-100">{item.patientId?.name || "Patient"}</span>
            <span className="block truncate text-[11px] text-zinc-400">{item.modality} · {item.accession} · {item.description || "Study"}</span>
          </button>
        ))}
      </Flyout>
      <Flyout open={helpOpen} anchorRef={helpRef} width={280} align="right">
        <div className="p-3 text-[12px] text-zinc-300">
          <p className="mb-2 font-semibold text-zinc-100">Shortcuts</p>
          <p>W window · Z zoom · P pan · S scroll · M length</p>
          <p className="mt-1">R reset · I invert · F fullscreen</p>
          <p className="mt-1">Arrow keys change slice · Ctrl+K search</p>
          <p className="mt-2 text-zinc-400">Right-drag zooms. Middle-drag pans. The wheel scrolls slices.</p>
        </div>
      </Flyout>
      <Flyout open={accountOpen} anchorRef={accountRef} width={220} align="right">
        <p className="px-3 py-2 text-[13px] text-zinc-100">{user?.name || "Signed in"}</p>
        <button type="button" className="block h-8 w-full rounded-lg px-3 text-left text-[13px] text-zinc-100 transition hover:bg-violet-500/80 hover:text-white" onClick={() => { closeMenus(); navigate("/settings"); }}>Settings</button>
        <button type="button" className="block h-8 w-full rounded-lg px-3 text-left text-[13px] text-zinc-100 transition hover:bg-violet-500/80 hover:text-white" onClick={() => { closeMenus(); onLogout(); }}>Sign out</button>
      </Flyout>
    </header>
  );
}

function Flyout({ open, anchorRef, width = 256, align = "left", children }) {
  const [box, setBox] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const node = anchorRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const left = align === "right" ? rect.right - width : rect.left;
      setBox({ top: rect.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, width, anchorRef]);
  if (!open || !box) return null;
  return createPortal(
    <div className="fixed z-[200] overflow-hidden rounded-2xl bg-[#1c1c21]/95 p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.55)] ring-1 ring-white/10 backdrop-blur-2xl" style={{ top: box.top, left: box.left, width }}>
      {children}
    </div>,
    document.body,
  );
}

function studyText(item) {
  return `${item.patientId?.name || ""} ${item.patientId?.mrn || ""} ${item.accession || ""} ${item.modality || ""} ${item.description || ""}`.toLowerCase();
}
