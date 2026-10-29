import { rowValues } from "./formula.ts";
import { rowLabel } from "./links.ts";
import type { CellValue, Column, Report, Table, Workspace } from "./types.ts";

// Totals that show up automatically under columns, in the summary view and in
// reports: no SUM() to write, no range to select, no pivot table to build.

export interface ColumnSummary {
  count: number;
  sum?: number;
  avg?: number;
  min?: number;
  max?: number;
  /** For checkbox columns. */
  checked?: number;
}

const SUMMABLE = ["number", "money", "formula", "lookup"];

export function computedRows(table: Table, today: string, ws?: Workspace): Record<string, CellValue>[] {
  return table.rows.map((r) => rowValues(table, r, today, ws));
}

export function summarizeColumn(column: Column, values: CellValue[]): ColumnSummary {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  const summary: ColumnSummary = { count: present.length };
  if (column.type === "checkbox") {
    summary.checked = present.filter((v) => v === true).length;
    return summary;
  }
  const nums = present.filter((v): v is number => typeof v === "number");
  if (nums.length && SUMMABLE.includes(column.type)) {
    summary.sum = nums.reduce((a, b) => a + b, 0);
    summary.avg = summary.sum / nums.length;
    summary.min = Math.min(...nums);
    summary.max = Math.max(...nums);
  }
  return summary;
}

export function summarizeTable(table: Table, today: string, ws?: Workspace): Record<string, ColumnSummary> {
  const rows = computedRows(table, today, ws);
  const out: Record<string, ColumnSummary> = {};
  for (const col of table.columns) out[col.id] = summarizeColumn(col, rows.map((r) => r[col.id] ?? null));
  return out;
}

export interface Group {
  key: string;
  count: number;
  sum: number;
}

/** Group key for one cell: link → the linked row's name, date (by month) → YYYY-MM. */
function keyOf(ws: Workspace | undefined, column: Column, value: CellValue | undefined, byMonth: boolean): string {
  if (value === null || value === undefined || value === "") return "";
  if (byMonth) return typeof value === "string" ? value.slice(0, 7) : "";
  if (column.type === "link") {
    const target = ws?.tables.find((t) => t.id === column.linkTableId);
    const row = target?.rows.find((r) => r.id === value);
    return target && row ? rowLabel(target, row) : "";
  }
  return String(value);
}

/**
 * Split a table's rows into groups and total a measure per group.
 * Months come out oldest → newest; everything else largest first.
 */
export function aggregate(
  table: Table,
  spec: Pick<Report, "groupBy" | "measure">,
  today: string,
  ws?: Workspace,
): (Group & { value: number })[] {
  const groupCol = table.columns.find((c) => c.id === spec.groupBy.columnId);
  if (!groupCol) return [];
  const byMonth = spec.groupBy.kind === "month";
  const rows = computedRows(table, today, ws);
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = keyOf(ws, groupCol, r[groupCol.id], byMonth);
    const g = groups.get(key) ?? { key, count: 0, sum: 0 };
    g.count++;
    const v = spec.measure.columnId ? r[spec.measure.columnId] : null;
    if (typeof v === "number") g.sum += v;
    groups.set(key, g);
  }
  const list = [...groups.values()].map((g) => ({
    ...g,
    value: spec.measure.agg === "count" ? g.count : spec.measure.agg === "avg" ? (g.count ? g.sum / g.count : 0) : g.sum,
  }));
  if (byMonth) return list.sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.key.localeCompare(b.key)));
  return list.sort((a, b) => b.value - a.value || b.count - a.count);
}

/** e.g. expenses by category: group by a column, sum a numeric one. Largest first. */
export function groupBy(table: Table, groupColumnId: string, valueColumnId: string | null, today: string, ws?: Workspace): Group[] {
  return aggregate(table, { groupBy: { kind: "column", columnId: groupColumnId }, measure: { agg: valueColumnId ? "sum" : "count", columnId: valueColumnId } }, today, ws).map(
    ({ key, count, sum }) => ({ key, count, sum }),
  );
}

/** Group by month of a date column (YYYY-MM keys, newest first). */
export function groupByMonth(table: Table, dateColumnId: string, valueColumnId: string | null, today: string, ws?: Workspace): Group[] {
  const list = aggregate(table, { groupBy: { kind: "month", columnId: dateColumnId }, measure: { agg: valueColumnId ? "sum" : "count", columnId: valueColumnId } }, today, ws);
  return [...list.filter((g) => g.key !== "").reverse(), ...list.filter((g) => g.key === "")];
}
