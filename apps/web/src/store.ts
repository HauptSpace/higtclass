import {
  applyOp,
  currencyForLanguage,
  DEFAULT_RULES,
  type Filter,
  type Period,
  type ViewMode,
  type Profile,
  type RulePack,
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
  /** Country and tax situation, for tips and deadlines. null until the person answers. */
  profile: Profile | null;
  /** Deadline reminders the person hid, as "id@date". */
  dismissed: string[];
  /** Browser language with region ("en-GB"), for date and number formats. */
  region: string;
}

/** How one table is looked at right now: remembered per table on this device. */
export interface TableUi {
  period: Period;
  filters: Filter[];
  sort: { columnId: string; dir: 1 | -1 } | null;
  mode: ViewMode | "summary";
  /** Row order when not sorted. */
  oldestFirst?: boolean;
  /** Saved view the settings came from. */
  viewId?: string | null;
  /** Column the board groups by. */
  boardColumnId?: string | null;
}

export const DEFAULT_UI: TableUi = { period: { kind: "all" }, filters: [], sort: null, mode: "grid" };

interface State {
  ws: Workspace;
  settings: AppSettings;
  activeTableId: string | null;
  /** When set, the report is shown instead of a table. */
  activeReportId: string | null;
  /** A page instead of a table or report. */
  page: "foryou" | null;
  /** Tips and deadlines, refreshed from the server when online. */
  rules: RulePack;
  past: HistoryEntry[];
  future: HistoryEntry[];
  toast: Toast | null;
  /** Saved data has been read from the device; nothing is written before that. */
  hydrated: boolean;
  ui: Record<string, TableUi>;

  dispatch: (op: Op, label?: string) => boolean;
  undo: () => void;
  redo: () => void;
  setActiveTable: (id: string | null) => void;
  openReport: (id: string | null) => void;
  openPage: (page: "foryou" | null) => void;
  setRules: (rules: RulePack) => void;
  dismiss: (key: string) => void;
  setSettings: (patch: Partial<AppSettings>) => void;
  showToast: (text: string, undoable?: boolean) => void;
  hideToast: () => void;
  setUi: (tableId: string, patch: Partial<TableUi>) => void;
}

const HISTORY_LIMIT = 200;

function initialSettings(): AppSettings {
  const languages = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  const locale = detectLocale(languages);
  const region = languages.find((l) => l.toLowerCase().startsWith(locale)) ?? languages[0] ?? LOCALE_RULES[locale].tag;
  return { locale, currency: currencyForLanguage(region, locale), theme: "system", accent: null, profile: null, dismissed: [], region };
}

// Writes are held back until the saved state has been read: otherwise an
// early update (rules arriving, a setting) would save an empty workspace over
// the person's data.
let canWrite = false;

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
    if (!canWrite) return;
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
      page: null,
      rules: DEFAULT_RULES,
      past: [],
      future: [],
      toast: null,
      hydrated: false,
      ui: {},

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
        setState({ activeTableId: id, activeReportId: null, page: null });
      },

      openReport(id) {
        setState({ activeReportId: id, page: null });
      },

      openPage(page) {
        setState({ page });
      },

      setRules(rules) {
        if (rules.version >= getState().rules.version) setState({ rules });
      },

      dismiss(key) {
        const { settings } = getState();
        setState({ settings: { ...settings, dismissed: [...settings.dismissed.slice(-50), key] } });
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

      setUi(tableId, patch) {
        const { ui } = getState();
        setState({ ui: { ...ui, [tableId]: { ...DEFAULT_UI, ...ui[tableId], ...patch } } });
      },
    }),
    {
      name: "zifra:v1",
      version: 4,
      migrate: (persisted, version) => {
        const state = persisted as Partial<State>;
        if (version < 4 && state.settings) state.settings = { ...initialSettings(), ...state.settings };
        return state as State;
      },
      onRehydrateStorage: () => () => {
        canWrite = true;
        useStore.setState({ hydrated: true });
      },
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({
        ws: s.ws,
        settings: s.settings,
        activeTableId: s.activeTableId,
        activeReportId: s.activeReportId,
        page: s.page,
        rules: s.rules,
        ui: s.ui,
      }),
    },
  ),
);

/** The table currently open, falling back to the first one. */
export function useActiveTable() {
  return useStore((s) => s.ws.tables.find((t) => t.id === s.activeTableId) ?? s.ws.tables[0] ?? null);
}

/** View settings of a table, with defaults. */
export function useTableUi(tableId: string): TableUi {
  return useStore((s) => s.ui[tableId]) ?? DEFAULT_UI;
}
