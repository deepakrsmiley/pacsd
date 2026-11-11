import { createContext, useCallback, useContext, useMemo, useState } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const dismiss = useCallback((id) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const push = useCallback((tone, message) => {
    const text = String(message || "").trim();
    if (!text) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setItems((current) => [...current.slice(-3), { id, tone, message: text }]);
    window.setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);
  const value = useMemo(() => ({
    success(message) { push("success", message); },
    error(message) { push("error", message); },
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100%-2rem))] flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto border px-3 py-2 text-sm shadow-lg ${item.tone === "error" ? "border-rose-300/40 bg-[#3b1720] text-rose-50" : "border-emerald-300/40 bg-[#13261c] text-emerald-50"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <p>{item.message}</p>
              <button type="button" aria-label="Dismiss message" className="shrink-0 text-xs uppercase tracking-wide" onClick={() => dismiss(item.id)}>Close</button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts() {
  return useContext(ToastContext);
}
