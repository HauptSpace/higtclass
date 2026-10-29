import { rowValues } from "./formula.ts";
import type { CellValue, Column, Table } from "./types.ts";

// Totals that show up automatically under columns and in the "summary"
// view: no SUM() to write, no range to select.

export interface ColumnSummary {
  count: number;
  sum?: number;
  avg?: number;
  min?: number;
  max?: number;
  /** For checkbox columns. */
  checked?: number;
}

export function computedRows(table: Table, today: string): Record<string, CellValue>[] {
  return table.rows.map((r) => rowValues(table, r, today));
}

export function summarizeColumn(column: Column, values: CellValue[]): ColumnSummary {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  const summary: ColumnSummary = { count: present.length };
  if (column.type === "checkbox") {
    summary.checked = present.filter((v) => v === true).length;
    return summary;
  }
  const nums = present.filter((v): v is number => typeof v === "number");
  if (nums.length && (column.type === "number" || column.type === "money" || column.type === "formula")) {
    summary.sum = nums.reduce((a, b) => a + b, 0);
    summary.avg = summary.sum / nums.length;
    summary.min = Math.min(...nums);
    summary.max = Math.max(...nums);
  }
  return summary;
}

export function summarizeTable(table: Table, today: string): Record<string, ColumnSummary> {
  const rows = computedRows(table, today);
  const out: Record<string, ColumnSummary> = {};
  for (const col of table.columns) out[col.id] = summarizeColumn(col, rows.map((r) => r[col.id] ?? null));
  return out;
}

export interface Group {
  key: string;
  count: number;
  sum: number;
}

/** e.g. expenses by category: group by a select/text column, sum a numeric one. */
export function groupBy(table: Table, groupColumnId: string, valueColumnId: string | null, today: string): Group[] {
  const rows = computedRows(table, today);
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const raw = r[groupColumnId];
    const key = raw === null || raw === undefined || raw === "" ? "" : String(raw);
    const g = groups.get(key) ?? { key, count: 0, sum: 0 };
    g.count++;
    const v = valueColumnId ? r[valueColumnId] : null;
    if (typeof v === "number") g.sum += v;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.sum - a.sum || b.count - a.count);
}

/** Group by month of a date column (YYYY-MM keys, newest first). */
export function groupByMonth(table: Table, dateColumnId: string, valueColumnId: string | null, today: string): Group[] {
  const rows = computedRows(table, today);
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const d = r[dateColumnId];
    const key = typeof d === "string" ? d.slice(0, 7) : "";
    const g = groups.get(key) ?? { key, count: 0, sum: 0 };
    g.count++;
    const v = valueColumnId ? r[valueColumnId] : null;
    if (typeof v === "number") g.sum += v;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}
