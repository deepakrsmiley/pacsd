export function ToolButton({ label, active = false, disabled = false, onClick, children, className = "" }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      data-active={active ? "true" : "false"}
      onClick={onClick}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-zinc-300 transition duration-150 hover:bg-white/[0.08] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100 data-[active=true]:bg-violet-500/25 data-[active=true]:text-violet-200 data-[active=true]:shadow-[inset_0_0_0_1px_rgba(167,139,250,0.35)] ${className}`}
    >
      {children}
    </button>
  );
}

export function Accordion({ title, icon: Icon, open, onToggle, children, extra = null }) {
  return (
    <section className="border-b border-white/[0.06]">
      <div className="flex items-center pr-2">
        <button type="button" className="flex h-11 min-w-0 flex-1 items-center gap-2 px-4 text-left text-[13px] font-semibold text-zinc-100 transition hover:text-white" onClick={onToggle}>
          {Icon ? <Icon className="h-3.5 w-3.5 text-zinc-300" aria-hidden="true" /> : null}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <svg viewBox="0 0 20 20" className={`h-4 w-4 text-zinc-400 transition ${open ? "rotate-180" : ""}`} aria-hidden="true">
            <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        {extra}
      </div>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </section>
  );
}
