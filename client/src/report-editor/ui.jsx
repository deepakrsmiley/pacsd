import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";

// Buttons keep the editor selection: mousedown is cancelled so focus stays in the page.
function keepSelection(event) {
  if (event.target.closest("input, select, textarea")) return;
  event.preventDefault();
}

export function RibbonButton({ icon: Icon, label, onClick, active, disabled, large, showLabel, shortcut, className = "", children, ...rest }) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  if (large) {
    return (
      <button
        type="button"
        className={`we-ribbon-button h-[58px] min-w-[52px] flex-col px-1.5 text-[11px] leading-tight ${className}`}
        onMouseDown={keepSelection}
        onClick={onClick}
        disabled={disabled}
        aria-pressed={active === undefined ? undefined : Boolean(active)}
        title={title}
        aria-label={label}
        {...rest}
      >
        {Icon && <Icon className="h-[22px] w-[22px] text-[#7c3aed]" strokeWidth={1.6} />}
        <span className="max-w-[72px] whitespace-normal text-center">{children || label}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`we-ribbon-button h-[26px] ${showLabel ? "px-1.5 text-[12px]" : "w-[26px]"} ${className}`}
      onMouseDown={keepSelection}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : Boolean(active)}
      title={title}
      aria-label={label}
      {...rest}
    >
      {Icon && <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.8} />}
      {showLabel && <span>{children || label}</span>}
    </button>
  );
}

export function RibbonGroup({ label, children, className = "" }) {
  return (
    <div className={`flex shrink-0 flex-col border-r border-[#e3e7ee] px-2 last:border-r-0 ${className}`}>
      <div className="flex min-h-[60px] flex-1 items-center gap-1">{children}</div>
      <div className="pb-0.5 pt-0.5 text-center text-[10.5px] text-[#6b7280]">{label}</div>
    </div>
  );
}

export function Stack({ children }) {
  return <div className="flex flex-col gap-[3px]">{children}</div>;
}

export function Row({ children, className = "" }) {
  return <div className={`flex items-center gap-[2px] ${className}`}>{children}</div>;
}

export function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-[#e3e7ee]" />;
}

// A popover anchored to its trigger and rendered in a portal so ribbon overflow cannot clip it.
export function Dropdown({ trigger, children, width = 220, align = "left", disabled, label, open: controlledOpen, onOpenChange }) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (value) => {
    if (onOpenChange) onOpenChange(value);
    else setOwnOpen(value);
  };
  const anchor = useRef(null);
  const panel = useRef(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const left = align === "right" ? rect.right - width : rect.left;
    setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - width - 8)), top: rect.bottom + 2 });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (panel.current?.contains(event.target) || anchor.current?.contains(event.target)) return;
      setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  });

  const close = () => setOpen(false);
  return (
    <>
      <span ref={anchor} className="inline-flex">
        {trigger({ open, toggle: () => !disabled && setOpen(!open), disabled, label })}
      </span>
      {open && createPortal(
        <div
          ref={panel}
          className="we-app we-menu fixed z-[80] max-h-[70vh] overflow-auto p-1"
          style={{ left: position.left, top: position.top, width }}
          onMouseDown={keepSelection}
          role="menu"
        >
          {typeof children === "function" ? children(close) : children}
        </div>,
        document.body,
      )}
    </>
  );
}

export function DropButton({ icon: Icon, label, large, showLabel, disabled, active, children, width, align, shortcut }) {
  return (
    <Dropdown
      width={width}
      align={align}
      disabled={disabled}
      label={label}
      trigger={({ toggle, open }) => (large ? (
        <button type="button" className="we-ribbon-button h-[58px] min-w-[52px] flex-col px-1.5 text-[11px] leading-tight" onMouseDown={keepSelection} onClick={toggle} disabled={disabled} aria-expanded={open} aria-haspopup="menu" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} aria-pressed={active === undefined ? undefined : Boolean(active)}>
          {Icon && <Icon className="h-[22px] w-[22px] text-[#7c3aed]" strokeWidth={1.6} />}
          <span className="flex items-center gap-0.5 whitespace-normal text-center">{label}<ChevronDown className="h-3 w-3" /></span>
        </button>
      ) : (
        <button type="button" className={`we-ribbon-button h-[26px] ${showLabel ? "px-1.5 text-[12px]" : "px-1"}`} onMouseDown={keepSelection} onClick={toggle} disabled={disabled} aria-expanded={open} aria-haspopup="menu" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} aria-pressed={active === undefined ? undefined : Boolean(active)}>
          {Icon && <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />}
          {showLabel && <span>{label}</span>}
          <ChevronDown className="h-3 w-3 text-[#6b7280]" />
        </button>
      ))}
    >
      {children}
    </Dropdown>
  );
}

export function SplitButton({ icon: Icon, label, onClick, disabled, active, children, width, shortcut, swatch }) {
  return (
    <span className="inline-flex items-stretch">
      <button type="button" className="we-ribbon-button relative h-[26px] w-[24px] rounded-r-none" onMouseDown={keepSelection} onClick={onClick} disabled={disabled} aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} aria-pressed={active === undefined ? undefined : Boolean(active)}>
        {Icon && <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />}
        {swatch !== undefined && <span className="absolute bottom-[3px] left-[5px] right-[5px] h-[3px] rounded-sm" style={{ background: swatch || "transparent", border: swatch ? "none" : "1px solid #d1d1d6" }} />}
      </button>
      <Dropdown
        width={width}
        disabled={disabled}
        trigger={({ toggle, open }) => (
          <button type="button" className="we-ribbon-button h-[26px] w-[14px] rounded-l-none" onMouseDown={keepSelection} onClick={toggle} disabled={disabled} aria-expanded={open} aria-label={`${label} options`} title={`${label} options`}>
            <ChevronDown className="h-3 w-3 text-[#6b7280]" />
          </button>
        )}
      >
        {children}
      </Dropdown>
    </span>
  );
}

export function MenuItem({ icon: Icon, label, hint, onClick, disabled, checked, danger }) {
  return (
    <button type="button" role="menuitem" className={`we-menu-item ${danger ? "text-rose-700" : ""}`} onClick={onClick} disabled={disabled}>
      <span className="grid w-4 place-items-center">{checked ? <span className="text-[#7c3aed]">✓</span> : Icon ? <Icon className="h-4 w-4 text-[#48484a]" strokeWidth={1.8} /> : null}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[11px] text-[#a1a1a6]">{hint}</span>}
    </button>
  );
}

export function MenuLabel({ children }) {
  return <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-[#a1a1a6]">{children}</div>;
}

export function MenuSeparator() {
  return <div className="my-1 border-t border-[#f2f2f7]" />;
}

export const THEME_COLORS = [
  ["#000000", "#ffffff", "#2c2c2e", "#44546a", "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"],
  ["#7f7f7f", "#f2f2f2", "#d6dce5", "#d6dce4", "#d9e2f3", "#fbe5d5", "#ededed", "#fff2cc", "#deebf6", "#e2efd9"],
  ["#595959", "#d8d8d8", "#adb9ca", "#adb9ca", "#b4c6e7", "#f7cbac", "#dbdbdb", "#fee599", "#bdd7ee", "#c5e0b3"],
  ["#3f3f3f", "#bfbfbf", "#8496b0", "#8496b0", "#8eaadb", "#f4b183", "#c9c9c9", "#ffd965", "#9cc3e5", "#a8d08d"],
  ["#262626", "#a5a5a5", "#323e4f", "#323f4f", "#2f5496", "#c55a11", "#7b7b7b", "#bf9000", "#2e75b5", "#538135"],
];
export const STANDARD_COLORS = ["#c00000", "#ff0000", "#ffc000", "#ffff00", "#92d050", "#00b050", "#00b0f0", "#0070c0", "#002060", "#7030a0"];
export const HIGHLIGHT_COLORS = ["#fff59d", "#a7f3d0", "#bae6fd", "#fbcfe8", "#fed7aa", "#ddd6fe", "#e5e7eb", "#fde047", "#86efac", "#7dd3fc"];

export function ColorGrid({ colors, onPick, automaticLabel = "Automatic", onAutomatic, custom = true }) {
  return (
    <div className="p-1.5">
      {onAutomatic && (
        <button type="button" className="we-menu-item mb-1" onClick={onAutomatic}>
          <span className="h-3.5 w-3.5 rounded-sm border border-[#a1a1a6] bg-white" /> {automaticLabel}
        </button>
      )}
      {(Array.isArray(colors[0]) ? colors : [colors]).map((row, index) => (
        <div key={index} className={`flex gap-[3px] ${index === 1 ? "mt-1.5" : "mt-[3px]"}`}>
          {row.map((color) => (
            <button key={color} type="button" className="h-[17px] w-[17px] rounded-[2px] border border-black/10 hover:scale-110 hover:border-[#7c3aed]" style={{ background: color }} onClick={() => onPick(color)} aria-label={color} title={color} />
          ))}
        </div>
      ))}
      {custom && (
        <label className="we-menu-item mt-1.5 cursor-pointer">
          <span className="h-3.5 w-3.5 rounded-sm bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" />
          More colours…
          <input type="color" className="sr-only" onChange={(event) => onPick(event.target.value)} />
        </label>
      )}
    </div>
  );
}

export function Dialog({ title, onClose, children, footer, width = 460, icon: Icon }) {
  const box = useRef(null);
  useEffect(() => {
    const escape = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("keydown", escape, true);
    const first = box.current?.querySelector("[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea, button.we-primary");
    window.setTimeout(() => first?.focus(), 20);
    return () => document.removeEventListener("keydown", escape, true);
  }, []);
  return createPortal(
    <div className="we-app fixed inset-0 z-[90] grid place-items-center bg-slate-900/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-[#d7dce4] bg-white shadow-2xl" style={{ maxWidth: width }}>
        <div className="flex items-center gap-2 border-b border-[#f2f2f7] px-4 py-2.5">
          {Icon && <Icon className="h-4 w-4 text-[#7c3aed]" />}
          <h2 className="flex-1 text-[13.5px] font-semibold text-[#111827]">{title}</h2>
          <button type="button" className="grid h-7 w-7 place-items-center rounded hover:bg-[#f5f5f7]" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-[12.5px] text-[#1d1d1f]">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-[#f2f2f7] bg-[#fafbfc] px-4 py-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Button({ children, onClick, primary, danger, disabled, type = "button", className = "", ...rest }) {
  const tone = primary
    ? "we-primary border-[#7c3aed] bg-[#7c3aed] text-white hover:bg-[#7c3aed]"
    : danger
      ? "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
      : "border-[#d1d1d6] bg-white text-[#1d1d1f] hover:bg-[#f4f6f9]";
  return (
    <button type={type} className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-[12.5px] font-medium disabled:opacity-50 ${tone} ${className}`} onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11.5px] font-medium text-[#48484a]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[#a1a1a6]">{hint}</span>}
    </label>
  );
}

export function NumberInput({ value, onChange, min, max, step = 1, suffix, className = "w-20", ...rest }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        className={`we-input ${className}`}
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        {...rest}
      />
      {suffix && <span className="text-[11.5px] text-[#6e6e73]">{suffix}</span>}
    </span>
  );
}
