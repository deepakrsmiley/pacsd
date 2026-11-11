import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const AUTOSAVE_DELAY = 2500;
const BACKUP_DELAY = 500;

export function backupKey(reportId) {
  return `pacsd.report.${reportId}.backup`;
}

export function readBackup(reportId) {
  try {
    const raw = localStorage.getItem(backupKey(reportId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearBackup(reportId) {
  try {
    localStorage.removeItem(backupKey(reportId));
  } catch {
    // Ignore storage errors.
  }
}

// Saves the document with the revision it was loaded at. The server refuses a stale
// revision (409), so two windows cannot silently overwrite each other.
export function useAutosave({ editor, reportId, revision: initialRevision, enabled, getLayout, onSaved }) {
  const [status, setStatus] = useState("saved");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(null);
  const revision = useRef(initialRevision || 0);
  const changes = useRef(0);
  const saved = useRef(0);
  const inflight = useRef(null);
  const timer = useRef(0);
  const backupTimer = useRef(0);
  const retries = useRef(0);
  const blocked = useRef(false);
  const latest = useRef({ editor, getLayout, onSaved, enabled });
  latest.current = { editor, getLayout, onSaved, enabled };

  const writeBackup = useCallback(() => {
    window.clearTimeout(backupTimer.current);
    backupTimer.current = window.setTimeout(() => {
      const current = latest.current.editor;
      if (!current || current.isDestroyed) return;
      try {
        localStorage.setItem(backupKey(reportId), JSON.stringify({
          doc: current.getJSON(),
          layout: latest.current.getLayout(),
          baseRevision: revision.current,
          savedAt: new Date().toISOString(),
        }));
      } catch {
        // A very large document can exceed local storage; the server copy still saves.
      }
    }, BACKUP_DELAY);
  }, [reportId]);

  const save = useCallback(async (reason = "manual") => {
    const { editor: current, enabled: canSave } = latest.current;
    if (!current || current.isDestroyed || !canSave || blocked.current) return false;
    if (inflight.current) {
      await inflight.current;
      if (reason === "autosave" && changes.current === saved.current) return true;
    }
    const sequence = changes.current;
    if (reason === "autosave" && sequence === saved.current) {
      setStatus("saved");
      return true;
    }
    window.clearTimeout(timer.current);
    setStatus("saving");
    const run = api(`/api/reports/${reportId}`, {
      method: "PATCH",
      body: { doc: current.getJSON(), layout: latest.current.getLayout(), baseRevision: revision.current, reason },
    }).then((data) => {
      revision.current = data.report.revision || revision.current + 1;
      saved.current = Math.max(saved.current, sequence);
      retries.current = 0;
      setError("");
      setLastSavedAt(new Date());
      latest.current.onSaved?.(data.report);
      if (changes.current === saved.current) {
        clearBackup(reportId);
        setStatus("saved");
      } else {
        setStatus("dirty");
        timer.current = window.setTimeout(() => save("autosave"), AUTOSAVE_DELAY);
      }
      return true;
    }).catch((failure) => {
      if (failure.status === 409 && failure.data?.conflict) {
        blocked.current = true;
        setConflict(failure.data);
        setStatus("conflict");
        return false;
      }
      if (!failure.status || failure.status >= 500 || failure.status === 429) {
        setStatus("offline");
        const delay = Math.min(30000, 3000 * 2 ** retries.current);
        retries.current += 1;
        timer.current = window.setTimeout(() => save("autosave"), delay);
        return false;
      }
      setStatus("error");
      setError(failure.message);
      return false;
    }).finally(() => {
      inflight.current = null;
    });
    inflight.current = run;
    return run;
  }, [reportId]);

  const markChanged = useCallback(() => {
    if (!latest.current.enabled) return;
    changes.current += 1;
    writeBackup();
    if (blocked.current) return;
    setStatus((value) => (value === "offline" ? value : "dirty"));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save("autosave"), AUTOSAVE_DELAY);
  }, [save, writeBackup]);

  const flush = useCallback(async (reason = "manual") => {
    window.clearTimeout(timer.current);
    if (blocked.current) return false;
    if (changes.current === saved.current && !inflight.current) return true;
    return save(reason);
  }, [save]);

  const resolveConflict = useCallback(async (choice, serverRevision) => {
    blocked.current = false;
    setConflict(null);
    if (choice === "overwrite") {
      revision.current = serverRevision;
      return save("manual");
    }
    revision.current = serverRevision;
    changes.current = 0;
    saved.current = 0;
    clearBackup(reportId);
    setStatus("saved");
    return true;
  }, [reportId, save]);

  const reset = useCallback((nextRevision) => {
    revision.current = nextRevision || 0;
    changes.current = 0;
    saved.current = 0;
    blocked.current = false;
    window.clearTimeout(timer.current);
    setConflict(null);
    setStatus("saved");
  }, []);

  useEffect(() => {
    const beforeUnload = (event) => {
      if (changes.current === saved.current && !inflight.current) return undefined;
      event.preventDefault();
      event.returnValue = "";
      return "";
    };
    const online = () => {
      if (changes.current !== saved.current) save("autosave");
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("online", online);
      window.clearTimeout(timer.current);
      window.clearTimeout(backupTimer.current);
    };
  }, [save]);

  return {
    status,
    error,
    conflict,
    lastSavedAt,
    dirty: status !== "saved",
    revision,
    save,
    flush,
    markChanged,
    resolveConflict,
    reset,
    hasUnsaved: () => changes.current !== saved.current || Boolean(inflight.current),
  };
}
