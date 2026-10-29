import { rowValues } from "./formula.ts";
import type { Settings, Workspace } from "./types.ts";

// A compact, model-friendly picture of the workspace: every table with its
// columns, and the most recent rows keyed by column name so the assistant can
// find "the Alpha order from yesterday" without seeing the whole history.

export interface ContextOptions {
  activeTableId?: string | null;
  today: string;
  recentRows?: number;
}

export function describeWorkspace(ws: Workspace, settings: Settings, opts: ContextOptions) {
  const recent = opts.recentRows ?? 25;
  return {
    today: opts.today,
    language: settings.locale,
    currency: settings.currency,
    active_table_id: opts.activeTableId ?? null,
    tables: ws.tables.map((t) => ({
      id: t.id,
      name: t.name,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        ...(c.options?.length ? { options: c.options } : {}),
        ...(c.formula ? { formula: c.formula } : {}),
        ...(c.currency ? { currency: c.currency } : {}),
      })),
      row_count: t.rows.length,
      recent_rows: t.rows.slice(-recent).map((r) => {
        const values = rowValues(t, r, opts.today);
        const named: Record<string, unknown> = {};
        for (const c of t.columns) if (values[c.id] !== undefined && values[c.id] !== null) named[c.name] = values[c.id];
        return { id: r.id, values: named };
      }),
    })),
  };
}
