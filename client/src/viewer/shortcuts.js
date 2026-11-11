export const DEFAULT_SHORTCUTS = {
  window: "w",
  zoom: "z",
  pan: "p",
  scroll: "s",
  length: "m",
  reset: "r",
  invert: "i",
  fullscreen: "f",
  previous: "arrowleft",
  next: "arrowright",
};

const RESERVED = new Set(["f5", "f11", "control", "alt", "meta", "shift", "os", "tab", "escape"]);

export function shortcutMap(overrides = {}) {
  return { ...DEFAULT_SHORTCUTS, ...overrides };
}

export function matchShortcut(event, overrides) {
  if (event.ctrlKey || event.metaKey || event.altKey) return "";
  const key = String(event.key || "").toLowerCase();
  if (!key || RESERVED.has(key)) return "";
  const map = shortcutMap(overrides);
  return Object.keys(map).find((name) => map[name] === key) || "";
}

export function bindingFromEvent(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return "";
  const key = String(event.key || "").toLowerCase();
  if (!key || RESERVED.has(key) || key === "enter" || key === "backspace") return "";
  return key;
}
