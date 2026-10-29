import {
  applyOp,
  detectLocale,
  invertOp,
  LOCALE_RULES,
  type Op,
  type Settings,
  type Workspace,
} from "@higtclass/core";
import { del, get, set } from "idb-keyval";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

// All state lives in IndexedDB on the device: instant, works offline.
// Every change goes through `dispatch(op)`, which records the inverse for undo.

interface HistoryEntry {
  label: string;
  op: Op;
  inverse: Op;
}

interface Toast {
  id: number;
  text: string;
  undoable: boolean;
}

export type Theme = "system" | "light" | "dark";

export interface AppSettings extends Settings {
  theme: Theme;
  /** Company accent colour; null keeps Zifra black and white. */
  accent: string | null;
}

interface State {
  ws: Workspace;
  settings: AppSettings;
  activeTableId: string | null;
  /** When set, the report is shown instead of a table. */
  activeReportId: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  toast: Toast | null;

  dispatch: (op: Op, label?: string) => boolean;
  undo: () => void;
  redo: () => void;
  setActiveTable: (id: string | null) => void;
  openReport: (id: string | null) => void;
  setSettings: (patch: Partial<AppSettings>) => void;
  showToast: (text: string, undoable?: boolean) => void;
  hideToast: () => void;
}

const HISTORY_LIMIT = 200;

function initialSettings(): AppSettings {
  const locale = detectLocale(typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]);
  return { locale, currency: LOCALE_RULES[locale].defaultCurrency, theme: "system", accent: null };
}

// IndexedDB can be unavailable (private mode, blocked storage): the app must
// still work, just without persistence.
const idbStorage: StateStorage = {
  async getItem(name) {
    try {
      return (await get<string>(name)) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(name, value) {
    try {
      await set(name, value);
    } catch {
      /* not persisted */
    }
  },
  async removeItem(name) {
    try {
      await del(name);
    } catch {
      /* ignore */
    }
  },
};

let toastSeq = 0;

export const useStore = create<State>()(
  persist(
    (setState, getState) => ({
      ws: { tables: [] },
      settings: initialSettings(),
      activeTableId: null,
      activeReportId: null,
      past: [],
      future: [],
      toast: null,

      dispatch(op, label = "") {
        const { ws, past } = getState();
        try {
          const inverse = invertOp(ws, op);
          const next = applyOp(ws, op);
          setState({
            ws: next,
            past: [...past, { label, op, inverse }].slice(-HISTORY_LIMIT),
            future: [],
          });
          return true;
        } catch (e) {
          console.error("Operation failed", op, e);
          return false;
        }
      },

      undo() {
        const { ws, past, future } = getState();
        const entry = past.at(-1);
        if (!entry) return;
        try {
          setState({ ws: applyOp(ws, entry.inverse), past: past.slice(0, -1), future: [...future, entry] });
        } catch (e) {
          console.error("Undo failed", e);
        }
      },

      redo() {
        const { ws, past, future } = getState();
        const entry = future.at(-1);
        if (!entry) return;
        try {
          const inverse = invertOp(ws, entry.op);
          setState({
            ws: applyOp(ws, entry.op),
            past: [...past, { ...entry, inverse }],
            future: future.slice(0, -1),
          });
        } catch (e) {
          console.error("Redo failed", e);
        }
      },

      setActiveTable(id) {
        setState({ activeTableId: id, activeReportId: null });
      },

      openReport(id) {
        setState({ activeReportId: id });
      },

      setSettings(patch) {
        setState({ settings: { ...getState().settings, ...patch } });
      },

      showToast(text, undoable = true) {
        setState({ toast: { id: ++toastSeq, text, undoable } });
      },

      hideToast() {
        setState({ toast: null });
      },
    }),
    {
      name: "zifra:v1",
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Partial<State>;
        if (version < 2 && state.settings) state.settings = { ...initialSettings(), ...state.settings };
        return state as State;
      },
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ ws: s.ws, settings: s.settings, activeTableId: s.activeTableId, activeReportId: s.activeReportId }),
    },
  ),
);

/** The table currently open, falling back to the first one. */
export function useActiveTable() {
  return useStore((s) => s.ws.tables.find((t) => t.id === s.activeTableId) ?? s.ws.tables[0] ?? null);
}
