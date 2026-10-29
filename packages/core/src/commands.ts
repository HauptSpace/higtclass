import { findColumnByName, validateFormula } from "./formula.ts";
import { matchLinkTarget, rowLabel } from "./links.ts";
import type { CellChange, Op } from "./ops.ts";
import type { CellValue, Column, ColumnType, Locale, Row, Table, Workspace } from "./types.ts";
import { convertValue, parseValue } from "./values.ts";

// User-level actions built on top of operations. Commands take raw input
// (strings the user typed or dictated), validate and parse it, and return
// ready-to-apply operations. The UI and the AI assistant share them.

export interface CommandContext {
  locale: Locale;
  now?: Date;
  /** Needed to resolve linked-table values ("Альфа" → the Alpha row in Clients). */
  ws?: Workspace;
}

export interface ColumnDraft {
  name: string;
  type: ColumnType;
  options?: string[];
  formula?: string;
  currency?: string;
  linkTableId?: string;
  lookup?: { viaColumnId: string; columnId: string };
}

export interface Problem {
  columnId?: string;
  column?: string;
  input?: unknown;
  reason: "unknown_column" | "invalid_value" | "invalid_formula" | "formula_column" | "unknown_row";
}

export type CommandResult<T = object> = { op: Op; problems: Problem[] } & T;

function randomId(prefix: string): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

export const newId = {
  table: () => randomId("t_"),
  column: () => randomId("c_"),
  row: () => randomId("r_"),
  report: () => randomId("p_"),
};

function uniqueName(name: string, taken: string[]): string {
  const base = name.trim() || "?";
  const lower = taken.map((n) => n.toLowerCase());
  if (!lower.includes(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!lower.includes(candidate.toLowerCase())) return candidate;
  }
}

export function buildColumn(draft: ColumnDraft, taken: string[]): { column: Column; problems: Problem[] } {
  const column: Column = { id: newId.column(), name: uniqueName(draft.name, taken), type: draft.type };
  const problems: Problem[] = [];
  if (draft.type === "select") column.options = dedupe(draft.options ?? []);
  if (draft.type === "money" && draft.currency) column.currency = draft.currency.toUpperCase();
  if (draft.type === "formula") {
    column.formula = draft.formula ?? "";
    try {
      validateFormula(column.formula);
    } catch {
      problems.push({ column: column.name, input: draft.formula, reason: "invalid_formula" });
    }
  }
  if (draft.type === "link") column.linkTableId = draft.linkTableId;
  if (draft.type === "lookup" && draft.lookup) column.lookup = { ...draft.lookup };
  return { column, problems };
}

function dedupe(options: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of options.map((x) => x.trim()).filter(Boolean)) {
    if (!seen.has(o.toLowerCase())) {
      seen.add(o.toLowerCase());
      out.push(o);
    }
  }
  return out;
}

/** Raw values keyed by column id or (case-insensitive) column name. */
export type RawRecord = Record<string, unknown>;

function resolveColumn(columns: Column[], key: string): Column | undefined {
  return columns.find((c) => c.id === key) ?? findColumnByName(columns, key);
}

/**
 * Parse raw records against a table's columns. New choices for `select`
 * columns are added to the column instead of being rejected.
 */
function parseRecords(
  columns: Column[],
  records: RawRecord[],
  ctx: CommandContext,
): { values: Record<string, CellValue>[]; problems: Problem[]; optionOps: (tableId: string) => Op[] } {
  const problems: Problem[] = [];
  const newOptions = new Map<string, string[]>();
  const values = records.map((record) => {
    const out: Record<string, CellValue> = {};
    for (const [key, raw] of Object.entries(record)) {
      const col = resolveColumn(columns, key);
      if (!col) {
        problems.push({ column: key, input: raw, reason: "unknown_column" });
        continue;
      }
      if (col.type === "formula" || col.type === "lookup") {
        problems.push({ columnId: col.id, column: col.name, input: raw, reason: "formula_column" });
        continue;
      }
      let v = parseValue(col, raw, ctx.locale, ctx.now);
      if (col.type === "link" && typeof v === "string") v = matchLinkTarget(ctx.ws, col, v) ?? undefined;
      if (v === undefined) {
        problems.push({ columnId: col.id, column: col.name, input: raw, reason: "invalid_value" });
        continue;
      }
      if (v !== null) out[col.id] = v;
      if (col.type === "select" && typeof v === "string") {
        const known = [...(col.options ?? []), ...(newOptions.get(col.id) ?? [])];
        if (!known.some((o) => o.toLowerCase() === v.toLowerCase())) {
          newOptions.set(col.id, [...(newOptions.get(col.id) ?? []), v]);
        } else {
          // Normalize casing to the existing option.
          out[col.id] = known.find((o) => o.toLowerCase() === v.toLowerCase())!;
        }
      }
    }
    return out;
  });
  const optionOps = (tableId: string): Op[] =>
    [...newOptions].map(([columnId, added]) => ({
      type: "column.update",
      tableId,
      columnId,
      patch: { options: [...(columns.find((c) => c.id === columnId)!.options ?? []), ...added] },
    }));
  return { values, problems, optionOps };
}

export function createTable(
  input: { name: string; icon?: string; columns: ColumnDraft[]; rows?: RawRecord[] },
  ctx: CommandContext,
): CommandResult<{ table: Table }> {
  const problems: Problem[] = [];
  const columns: Column[] = [];
  for (const draft of input.columns) {
    const built = buildColumn(draft, columns.map((c) => c.name));
    columns.push(built.column);
    problems.push(...built.problems);
  }
  const parsed = parseRecords(columns, input.rows ?? [], ctx);
  problems.push(...parsed.problems);
  const now = (ctx.now ?? new Date()).getTime();
  const table: Table = {
    id: newId.table(),
    name: input.name.trim() || "?",
    icon: input.icon || "📋",
    createdAt: now,
    columns,
    rows: parsed.values.map((values, i) => ({ id: newId.row(), createdAt: now + i, values })),
  };
  // Fold new select options straight into the column definitions.
  for (const op of parsed.optionOps(table.id)) {
    if (op.type !== "column.update") continue;
    const col = table.columns.find((c) => c.id === op.columnId)!;
    col.options = op.patch.options;
  }
  return { op: { type: "table.create", table }, problems, table };
}

export function addColumn(
  table: Table,
  draft: ColumnDraft,
  index?: number,
): CommandResult<{ column: Column }> {
  const { column, problems } = buildColumn(draft, table.columns.map((c) => c.name));
  return { op: { type: "column.add", tableId: table.id, column, index }, problems, column };
}

export function addRecords(
  table: Table,
  records: RawRecord[],
  ctx: CommandContext,
): CommandResult<{ rows: Row[] }> {
  const parsed = parseRecords(table.columns, records, ctx);
  const now = (ctx.now ?? new Date()).getTime();
  const rows = parsed.values.map((values, i) => ({ id: newId.row(), createdAt: now + i, values }));
  const ops: Op[] = [...parsed.optionOps(table.id), { type: "rows.insert", tableId: table.id, rows }];
  return { op: ops.length === 1 ? ops[0] : { type: "batch", ops }, problems: parsed.problems, rows };
}

export function updateCells(
  table: Table,
  updates: { rowId: string; column: string; value: unknown }[],
  ctx: CommandContext,
): CommandResult {
  const problems: Problem[] = [];
  const rowIds = new Set(table.rows.map((r) => r.id));
  const valid = updates.filter((u) => {
    if (rowIds.has(u.rowId)) return true;
    problems.push({ column: u.column, input: u.rowId, reason: "unknown_row" });
    return false;
  });
  const parsed = parseRecords(
    table.columns,
    valid.map((u) => ({ [u.column]: u.value })),
    ctx,
  );
  problems.push(...parsed.problems);
  const cells: CellChange[] = [];
  valid.forEach((u, i) => {
    const col = resolveColumn(table.columns, u.column);
    if (!col || col.type === "formula" || col.type === "lookup") return;
    const rawEmpty = u.value === null || u.value === undefined || String(u.value).trim() === "";
    if (col.id in parsed.values[i]) cells.push({ rowId: u.rowId, columnId: col.id, value: parsed.values[i][col.id] });
    else if (rawEmpty) cells.push({ rowId: u.rowId, columnId: col.id, value: null });
  });
  const ops: Op[] = [...parsed.optionOps(table.id)];
  if (cells.length) ops.push({ type: "cells.set", tableId: table.id, cells });
  return { op: ops.length === 1 ? ops[0] : { type: "batch", ops }, problems };
}

/** Change a column's type, converting stored values where possible. */
export function changeColumnType(
  table: Table,
  columnId: string,
  type: ColumnType,
  ctx: CommandContext,
  extra: { options?: string[]; formula?: string; linkTableId?: string; lookup?: Column["lookup"] } = {},
): CommandResult {
  const col = table.columns.find((c) => c.id === columnId);
  if (!col) return { op: { type: "batch", ops: [] }, problems: [{ columnId, reason: "unknown_column" }] };
  const target: Column = { ...col, type };
  const problems: Problem[] = [];
  const patch: Partial<Column> = { type };
  if (type === "select") {
    const fromValues = table.rows.map((r) => r.values[columnId]).filter((v) => v !== undefined && v !== null);
    patch.options = dedupe([...(extra.options ?? col.options ?? []), ...fromValues.map((v) => convertValue(v, { ...target, type: "text" }, ctx.locale) as string)]);
  }
  if (type === "formula") {
    patch.formula = extra.formula ?? col.formula ?? "";
    try {
      validateFormula(patch.formula);
    } catch {
      problems.push({ columnId, column: col.name, input: patch.formula, reason: "invalid_formula" });
    }
  }
  if (type === "link") patch.linkTableId = extra.linkTableId ?? col.linkTableId;
  if (type === "lookup") patch.lookup = extra.lookup ?? col.lookup;
  const next: Column = { ...target, ...patch } as Column;
  // A link shows a name; converting away from it keeps that name, converting to it
  // finds the row with that name ("ООО Альфа" text → the Alpha client).
  const linkedFrom = col.type === "link" ? ctx.ws?.tables.find((t) => t.id === col.linkTableId) : undefined;
  const cells: CellChange[] = [];
  for (const r of table.rows) {
    const v = r.values[columnId];
    if (v === undefined) continue;
    let source: CellValue = v;
    if (col.type === "link") {
      const linkedRow = linkedFrom?.rows.find((x) => x.id === v);
      source = linkedRow && linkedFrom ? rowLabel(linkedFrom, linkedRow) : null;
    }
    const converted =
      type === "link" ? (source === null ? null : matchLinkTarget(ctx.ws, next, source)) : convertValue(source, next, ctx.locale);
    if (converted !== v) cells.push({ rowId: r.id, columnId, value: converted });
  }
  const ops: Op[] = [];
  if (cells.length) ops.push({ type: "cells.set", tableId: table.id, cells });
  ops.push({ type: "column.update", tableId: table.id, columnId, patch });
  return { op: { type: "batch", ops }, problems };
}
