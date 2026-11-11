export function Page({ kicker, title, summary, actions, children }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0b0f]">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1600px] px-5 pb-10 pt-7 lg:px-8">
          <header className="mb-7 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
            <div className="min-w-0">
              {kicker && <div className="text-[13px] font-semibold text-violet-300/90">{kicker}</div>}
              <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.02em] text-white md:text-[32px]">{title}</h1>
              {summary && <p className="mt-2 max-w-3xl text-[14px] leading-6 text-white/50">{summary}</p>}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Metrics({ items }) {
  return (
    <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <article key={item.label} className="rounded-2xl bg-[#1c1c21] p-5 ring-1 ring-white/[0.06] transition hover:bg-[#222228]">
          <div className="text-[13px] font-medium text-white/55">{item.label}</div>
          <div className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-white">{item.value}</div>
          {item.detail && <div className="mt-2 text-[12px] text-white/40">{item.detail}</div>}
        </article>
      ))}
    </section>
  );
}

export function Badge({ tone = "neutral", children }) {
  const tones = {
    neutral: "bg-white/[0.08] text-white/80",
    good: "bg-emerald-400/15 text-emerald-300",
    warn: "bg-amber-400/15 text-amber-300",
    bad: "bg-rose-500/15 text-rose-300",
    info: "bg-violet-400/15 text-violet-300",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium capitalize ${tones[tone] || tones.neutral}`}>{children}</span>;
}

export function Panel({ title, action, children, className = "" }) {
  return (
    <section className={`overflow-hidden rounded-2xl bg-[#1c1c21] ring-1 ring-white/[0.06] ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-white">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block text-[13px] font-medium text-white/60">
      {label}
      <div className="mt-1.5 text-white">{children}</div>
    </label>
  );
}

export const fieldClass = "h-10 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-[14px] text-white placeholder:text-white/30 outline-none transition focus:border-violet-400/60 focus:bg-white/[0.08] focus:ring-4 focus:ring-violet-500/15";

export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-xl bg-white/[0.07] ${className}`} />;
}

export function TableSkeleton({ rows = 6 }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-[#1c1c21] ring-1 ring-white/[0.06]" role="status" aria-label="Loading records">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3 border-t border-white/[0.05] px-5 py-4 first:border-t-0">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/5" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard">
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

export function DataGrid({ columns, rows, rowKey, selectedKey, onSelect, empty, loading }) {
  if (loading) return <TableSkeleton />;
  if (!rows?.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl bg-[#1c1c21] px-6 py-16 text-center ring-1 ring-white/[0.06]">
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-white/[0.06]">
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-white/40" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" /></svg>
        </div>
        <p className="max-w-md text-[14px] text-white/55">{empty || "No records for this facility."}</p>
      </div>
    );
  }
  return (
    <div className="max-w-full overflow-x-auto rounded-2xl bg-[#1c1c21] ring-1 ring-white/[0.06]">
      <table className="w-max min-w-full border-collapse text-left text-[14px]" aria-label="Records">
        <thead className="sticky top-0 bg-[#1c1c21]/95 text-[12px] font-medium text-white/45 backdrop-blur">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="whitespace-nowrap border-b border-white/[0.06] px-5 py-3 font-medium">{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = rowKey(row, index);
            const active = selectedKey != null && String(selectedKey) === String(key);
            return (
              <tr
                key={key}
                tabIndex={onSelect ? 0 : undefined}
                aria-selected={onSelect ? active : undefined}
                className={`${active ? "bg-violet-500/15" : "hover:bg-white/[0.035]"} ${onSelect ? "cursor-pointer" : ""} border-t border-white/[0.05] transition-colors first:border-t-0`}
                onClick={onSelect ? () => onSelect(row) : undefined}
                onKeyDown={onSelect ? (event) => onRowKey(event, row, onSelect) : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className="px-5 py-3 align-middle text-white/85">
                    {column.render ? column.render(row) : display(row[column.key])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Inspector({ title, rows, empty }) {
  return (
    <Panel title={title} className="min-h-[220px]">
      {!rows ? (
        <p className="px-5 pb-6 pt-2 text-[14px] leading-6 text-white/45">{empty || "Select a row to inspect it."}</p>
      ) : (
        <dl className="px-2 pb-3">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[108px_1fr] gap-2 border-t border-white/[0.05] px-3 py-2.5 text-[14px] first:border-t-0">
              <dt className="text-white/45">{label}</dt>
              <dd className="break-words text-white/90">{value === 0 ? "0" : value || "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

export function Alert({ tone = "info", children }) {
  const tones = {
    info: "bg-violet-500/10 text-violet-200 ring-violet-400/20",
    warn: "bg-amber-400/10 text-amber-200 ring-amber-300/20",
  };
  return <p className={`mb-4 rounded-xl px-4 py-3 text-[14px] ring-1 ${tones[tone] || tones.info}`} role="status">{children}</p>;
}

function onRowKey(event, row, onSelect) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelect(row);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const rows = [...event.currentTarget.parentElement.querySelectorAll("tr[tabindex]")];
  const current = rows.indexOf(event.currentTarget);
  const next = event.key === "ArrowDown" ? rows[current + 1] : rows[current - 1];
  next?.focus();
}

function display(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m ${rest}s`;
}

export function toneFor(value) {
  const text = String(value || "").toLowerCase();
  if (["final", "finalized", "stored", "connected", "active", "succeeded", "configured", "yes", "true"].includes(text)) return "good";
  if (["stat", "rejected", "revoked", "failed"].includes(text)) return "bad";
  if (["urgent", "preliminary", "reporting", "duplicate", "not tested", "copied"].includes(text)) return "warn";
  if (["booked", "acquired", "draft"].includes(text)) return "info";
  return "neutral";
}
