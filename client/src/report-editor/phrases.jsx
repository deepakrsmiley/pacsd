import { useState } from "react";
import { DEFAULT_SHORTCUTS } from "../../../shared/reportDocument.js";
import { api } from "../api.js";
import { Button, Dialog, Field } from "./ui.jsx";

export { DEFAULT_SHORTCUTS };

export function expandShortcut(editor, shortcuts) {
  if (!editor || !editor.isEditable) return false;
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 16), $from.parentOffset, "\ufffc", "\ufffc");
  const match = before.match(/(^|[\s])([a-z0-9]{1,12})$/i);
  if (!match) return false;
  const trigger = match[2].toLowerCase();
  const phrase = (shortcuts || []).find((item) => item.trigger === trigger);
  if (!phrase) return false;
  const from = $from.pos - match[2].length;
  editor.chain().focus().insertContentAt({ from, to: $from.pos }, `${phrase.expansion} `).run();
  return true;
}

export function PhrasesDialog({ shortcuts, onChange, onClose, toasts }) {
  const [rows, setRows] = useState(shortcuts.map((item) => ({ ...item })));
  const [busy, setBusy] = useState(false);
  function update(index, patch) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }
  async function save() {
    setBusy(true);
    try {
      const data = await api("/api/me/report-shortcuts", {
        method: "PUT",
        body: {
          shortcuts: rows
            .map((row) => ({ trigger: row.trigger.trim().toLowerCase(), expansion: row.expansion.trim(), favourite: Boolean(row.favourite) }))
            .filter((row) => row.trigger && row.expansion),
        },
      });
      onChange(data.shortcuts || []);
      toasts.success("Personal phrases saved.");
      onClose();
    } catch (error) {
      toasts.error(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Phrases and shortcuts" onClose={onClose} width={640} footer={<><Button onClick={onClose}>Cancel</Button><Button primary disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button></>}>
      <p className="mb-3 text-[12px] text-[#6e6e73]">Type a shortcut and press Space to expand it. Favourite phrases also appear as one-click buttons. Example: nh, nch, nlf.</p>
      <div className="grid gap-2">
        {rows.map((row, index) => (
          <div key={`${row.trigger}-${index}`} className="grid grid-cols-[90px_1fr_auto_auto] items-center gap-2">
            <input className="we-input" aria-label="Shortcut" value={row.trigger} onChange={(event) => update(index, { trigger: event.target.value.toLowerCase() })} />
            <input className="we-input" aria-label="Expansion" value={row.expansion} onChange={(event) => update(index, { expansion: event.target.value })} />
            <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={Boolean(row.favourite)} onChange={(event) => update(index, { favourite: event.target.checked })} /> Favourite</label>
            <Button danger onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button>
          </div>
        ))}
      </div>
      <Button className="mt-3" onClick={() => setRows((current) => [...current, { trigger: "", expansion: "", favourite: false }])}>Add phrase</Button>
      <Field label="Restore the standard set" className="mt-3">
        <Button onClick={() => setRows(DEFAULT_SHORTCUTS.map((item) => ({ ...item })))}>Reset nh, nch and nlf</Button>
      </Field>
    </Dialog>
  );
}
