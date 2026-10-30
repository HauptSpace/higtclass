import { displayColumn, rowValues } from "./formula.ts";
import { ledgerOf, rowFlow, rowSide } from "./ledger.ts";
import { rowLabel } from "./links.ts";
import { dateKey, inRange, keysBetween, periodRange } from "./periods.ts";
import type { CellValue, Column, Filter, GroupKind, Period, Report, Row, Table, Workspace } from "./types.ts";

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

const SUMMABLE = ["number", "money", "formula", "lookup", "rollup"];

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

/** Totals for each column over already computed rows (what is on screen). */
export function summarizeValues(table: Table, rows: Record<string, CellValue>[]): Record<string, ColumnSummary> {
  const out: Record<string, ColumnSummary> = {};
  for (const col of table.columns) out[col.id] = summarizeColumn(col, rows.map((r) => r[col.id] ?? null));
  return out;
}

export function summarizeTable(table: Table, today: string, ws?: Workspace): Record<string, ColumnSummary> {
  return summarizeValues(table, computedRows(table, today, ws));
}

/** Special filter column: the income/expense side of a ledger table. */
export const FLOW_FILTER = "$flow";

const emptyValue = (v: CellValue | undefined) => v === null || v === undefined || v === "";

/** Text a filter compares against: linked rows by name, everything else as stored. */
function filterText(ws: Workspace | undefined, table: Table, column: Column, value: CellValue | undefined): string {
  if (emptyValue(value)) return "";
  const shown = column.type === "lookup" ? displayColumn(table, column, ws) : column;
  if (shown.type === "link") {
    const target = ws?.tables.find((t) => t.id === shown.linkTableId);
    const row = target?.rows.find((r) => r.id === value);
    return target && row ? rowLabel(target, row) : "";
  }
  return String(value);
}

export function matchesFilter(ws: Workspace | undefined, table: Table, values: Record<string, CellValue>, f: Filter): boolean {
  if (f.columnId === FLOW_FILTER) {
    const ledger = ledgerOf(table);
    if (!ledger) return true;
    const side = rowSide(ledger, values);
    const inList = side !== null && (f.values ?? []).includes(side);
    return f.op === "notIn" ? !inList : inList;
  }
  const column = table.columns.find((c) => c.id === f.columnId);
  if (!column) return true;
  const v = values[column.id];
  switch (f.op) {
    case "empty":
      return emptyValue(v) || v === false;
    case "notEmpty":
      return !emptyValue(v) && v !== false;
    case "in":
    case "notIn": {
      const wanted = (f.values ?? []).map((x) => x.toLowerCase());
      let hit: boolean;
      if (column.type === "checkbox") hit = wanted.includes(v === true ? "true" : "false");
      else if (column.type === "link") hit = typeof v === "string" && (f.values ?? []).includes(v);
      else hit = !emptyValue(v) && wanted.includes(String(v).toLowerCase());
      return f.op === "in" ? hit : !hit;
    }
    case "contains":
      return filterText(ws, table, column, v).toLowerCase().includes(String(f.value ?? "").toLowerCase());
    case "gte":
    case "lte": {
      if (emptyValue(v) || f.value === undefined || f.value === "") return false;
      const a = typeof v === "number" ? v : String(v);
      const b = typeof v === "number" ? Number(f.value) : String(f.value);
      return f.op === "gte" ? a >= b : a <= b;
    }
  }
}

export interface Scope {
  filters?: Filter[] | null;
  period?: Period | null;
}

/** The date column a period applies to. */
export function periodColumn(table: Table, period: Period | null | undefined): Column | undefined {
  return table.columns.find((c) => c.id === period?.columnId) ?? table.columns.find((c) => c.type === "date");
}

/** Indexes of rows that pass a period and filters. */
export function scopeRows(table: Table, values: Record<string, CellValue>[], scope: Scope, today: string, ws?: Workspace): number[] {
  const range = periodRange(scope.period, today);
  const dateCol = range ? periodColumn(table, scope.period) : undefined;
  const out: number[] = [];
  values.forEach((v, i) => {
    if (range && dateCol && !inRange(v[dateCol.id], range)) return;
    if (scope.filters?.some((f) => !matchesFilter(ws, table, v, f))) return;
    out.push(i);
  });
  return out;
}

export interface Group {
  key: string;
  count: number;
  sum: number;
}

/** Group key for one cell: link → the linked row's name, dates → week/month/quarter/year. */
function keyOf(ws: Workspace | undefined, table: Table, column: Column, value: CellValue | undefined, kind: GroupKind): string {
  if (emptyValue(value)) return "";
  if (kind !== "column") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? dateKey(kind, value) : "";
  return filterText(ws, table, column, value);
}

type Spec = Pick<Report, "groupBy" | "measure"> & Partial<Pick<Report, "filters" | "period" | "flow" | "split">>;

function measureOf(table: Table, spec: Spec) {
  const ledger = spec.flow ? ledgerOf(table) : null;
  return (v: Record<string, CellValue>): { counted: boolean; amount: number } => {
    if (ledger && spec.flow) {
      const f = rowFlow(ledger, v);
      const side = rowSide(ledger, v);
      if (side !== spec.flow) return { counted: false, amount: 0 };
      return { counted: true, amount: spec.measure.agg === "count" ? 0 : f[spec.flow] };
    }
    const n = spec.measure.columnId ? v[spec.measure.columnId] : null;
    return { counted: true, amount: typeof n === "number" ? n : 0 };
  };
}

function finish(list: Group[], spec: Spec): (Group & { value: number })[] {
  return list.map((g) => ({
    ...g,
    value: spec.measure.agg === "count" ? g.count : spec.measure.agg === "avg" ? (g.count ? g.sum / g.count : 0) : g.sum,
  }));
}

function sortGroups(list: (Group & { value: number })[], kind: GroupKind) {
  if (kind !== "column") return list.sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.key.localeCompare(b.key)));
  return list.sort((a, b) => b.value - a.value || b.count - a.count);
}

/** Missing weeks/months between the first and last one, as zeros, so charts keep their rhythm. */
function fillGaps(list: (Group & { value: number })[], kind: GroupKind) {
  if (kind === "column") return list;
  const dated = list.filter((g) => g.key !== "");
  if (dated.length < 2) return list;
  const have = new Map(dated.map((g) => [g.key, g]));
  const keys = keysBetween(kind, dated[0].key, dated.at(-1)!.key);
  return [...keys.map((k) => have.get(k) ?? { key: k, count: 0, sum: 0, value: 0 }), ...list.filter((g) => g.key === "")];
}

/**
 * Split a table's rows into groups and total a measure per group, after the
 * report's period and filters. Dates come out oldest → newest with empty
 * periods filled in; everything else largest first.
 */
export function aggregate(table: Table, spec: Spec, today: string, ws?: Workspace): (Group & { value: number })[] {
  const groupCol = table.columns.find((c) => c.id === spec.groupBy.columnId);
  if (!groupCol) return [];
  const all = computedRows(table, today, ws);
  const rows = scopeRows(table, all, spec, today, ws).map((i) => all[i]);
  const measure = measureOf(table, spec);
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const m = measure(r);
    if (!m.counted) continue;
    const key = keyOf(ws, table, groupCol, r[groupCol.id], spec.groupBy.kind);
    const g = groups.get(key) ?? { key, count: 0, sum: 0 };
    g.count++;
    g.sum += m.amount;
    groups.set(key, g);
  }
  return fillGaps(sortGroups(finish([...groups.values()], spec), spec.groupBy.kind), spec.groupBy.kind);
}

export interface Pivot {
  rows: string[];
  columns: string[];
  /** cells[row][column] */
  cells: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  columnTotals: Record<string, number>;
  total: number;
}

/** Two-way table: e.g. revenue per client (rows) per month (columns). */
export function pivot(table: Table, spec: Spec & { split: NonNullable<Report["split"]> }, today: string, ws?: Workspace): Pivot | null {
  const rowCol = table.columns.find((c) => c.id === spec.groupBy.columnId);
  const colCol = table.columns.find((c) => c.id === spec.split.columnId);
  if (!rowCol || !colCol) return null;
  const all = computedRows(table, today, ws);
  const rows = scopeRows(table, all, spec, today, ws).map((i) => all[i]);
  const measure = measureOf(table, spec);
  const sums = new Map<string, Map<string, { sum: number; count: number }>>();
  const colKeys = new Set<string>();
  for (const r of rows) {
    const m = measure(r);
    if (!m.counted) continue;
    const a = keyOf(ws, table, rowCol, r[rowCol.id], spec.groupBy.kind);
    const b = keyOf(ws, table, colCol, r[colCol.id], spec.split.kind);
    colKeys.add(b);
    const line = sums.get(a) ?? new Map();
    const cell = line.get(b) ?? { sum: 0, count: 0 };
    cell.sum += m.amount;
    cell.count++;
    line.set(b, cell);
    sums.set(a, line);
  }
  const value = (c: { sum: number; count: number }) =>
    spec.measure.agg === "count" ? c.count : spec.measure.agg === "avg" ? (c.count ? c.sum / c.count : 0) : c.sum;
  const out: Pivot = { rows: [], columns: [], cells: {}, rowTotals: {}, columnTotals: {}, total: 0 };
  const sortKeys = (keys: string[], kind: GroupKind, weight: (k: string) => number) =>
    kind === "column"
      ? keys.sort((x, y) => weight(y) - weight(x))
      : keys.sort((x, y) => (x === "" ? 1 : y === "" ? -1 : x.localeCompare(y)));
  for (const [a, line] of sums) {
    out.cells[a] = {};
    let rowSum = 0;
    for (const [b, c] of line) {
      const v = value(c);
      out.cells[a][b] = v;
      rowSum += spec.measure.agg === "avg" ? 0 : v;
      out.columnTotals[b] = (out.columnTotals[b] ?? 0) + v;
    }
    out.rowTotals[a] = rowSum;
    out.total += rowSum;
  }
  out.rows = sortKeys([...sums.keys()], spec.groupBy.kind, (k) => out.rowTotals[k]);
  let cols = sortKeys([...colKeys], spec.split.kind, (k) => out.columnTotals[k]);
  if (spec.split.kind !== "column") {
    const dated = cols.filter((k) => k !== "");
    if (dated.length > 1) cols = [...keysBetween(spec.split.kind, dated[0], dated.at(-1)!), ...cols.filter((k) => k === "")];
  }
  out.columns = cols;
  return out;
}

/** e.g. expenses by category: group by a column, sum a numeric one. Largest first. */
export function groupBy(table: Table, groupColumnId: string, valueColumnId: string | null, today: string, ws?: Workspace, extra: Partial<Spec> = {}): Group[] {
  return aggregate(
    table,
    { ...extra, groupBy: { kind: "column", columnId: groupColumnId }, measure: { agg: valueColumnId || extra.flow ? "sum" : "count", columnId: valueColumnId } },
    today,
    ws,
  ).map(({ key, count, sum }) => ({ key, count, sum }));
}

/** Group by month of a date column (YYYY-MM keys, newest first). */
export function groupByMonth(table: Table, dateColumnId: string, valueColumnId: string | null, today: string, ws?: Workspace, extra: Partial<Spec> = {}): Group[] {
  const list = aggregate(
    table,
    { ...extra, groupBy: { kind: "month", columnId: dateColumnId }, measure: { agg: valueColumnId || extra.flow ? "sum" : "count", columnId: valueColumnId } },
    today,
    ws,
  );
  return [...list.filter((g) => g.key !== "").reverse(), ...list.filter((g) => g.key === "")];
}

/** The rows of a table that a view shows, with their computed values. */
export function viewRows(table: Table, scope: Scope, today: string, ws?: Workspace): { rows: Row[]; values: Record<string, CellValue>[] } {
  const all = computedRows(table, today, ws);
  const keep = scopeRows(table, all, scope, today, ws);
  return { rows: keep.map((i) => table.rows[i]), values: keep.map((i) => all[i]) };
}
