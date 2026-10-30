import { renameFormulaRefs } from "./formula.ts";
import type { CellValue, Column, Report, Row, Table, TablePatch, Workspace } from "./types.ts";

// Every change to a workspace is an operation. Operations are plain JSON,
// applied by one pure function on every device and on the server, and each
// one has an inverse — that is what powers undo, history, sync and the
// "here's what the AI changed" preview.

export interface CellChange {
  rowId: string;
  columnId: string;
  value: CellValue;
}

export type ColumnPatch = Partial<Omit<Column, "id">>;

export type Op =
  | { type: "table.create"; table: Table; index?: number }
  | { type: "table.delete"; tableId: string }
  | { type: "table.update"; tableId: string; patch: TablePatch }
  | { type: "column.add"; tableId: string; column: Column; index?: number }
  | { type: "column.update"; tableId: string; columnId: string; patch: ColumnPatch }
  | { type: "column.delete"; tableId: string; columnId: string }
  | { type: "column.move"; tableId: string; columnId: string; index: number }
  | { type: "rows.insert"; tableId: string; rows: Row[]; indexes?: number[] }
  | { type: "rows.delete"; tableId: string; rowIds: string[] }
  | { type: "cells.set"; tableId: string; cells: CellChange[] }
  | { type: "report.create"; report: Report; index?: number }
  | { type: "report.update"; reportId: string; patch: Partial<Omit<Report, "id">> }
  | { type: "report.delete"; reportId: string }
  | { type: "batch"; ops: Op[] };

export class OpError extends Error {}

function findTable(ws: Workspace, tableId: string): Table {
  const t = ws.tables.find((x) => x.id === tableId);
  if (!t) throw new OpError(`No table ${tableId}`);
  return t;
}

function findColumn(table: Table, columnId: string): Column {
  const c = table.columns.find((x) => x.id === columnId);
  if (!c) throw new OpError(`No column ${columnId}`);
  return c;
}

function updateTable(ws: Workspace, tableId: string, fn: (t: Table) => Table): Workspace {
  findTable(ws, tableId);
  return { ...ws, tables: ws.tables.map((t) => (t.id === tableId ? fn(t) : t)) };
}

function insertAt<T>(list: T[], item: T, index?: number): T[] {
  const copy = list.slice();
  const i = index === undefined ? copy.length : Math.max(0, Math.min(index, copy.length));
  copy.splice(i, 0, item);
  return copy;
}

function findReport(ws: Workspace, reportId: string): Report {
  const r = ws.reports?.find((x) => x.id === reportId);
  if (!r) throw new OpError(`No report ${reportId}`);
  return r;
}

export function applyOp(ws: Workspace, op: Op): Workspace {
  switch (op.type) {
    case "report.create":
      if (ws.reports?.some((r) => r.id === op.report.id)) throw new OpError(`Report ${op.report.id} exists`);
      return { ...ws, reports: insertAt(ws.reports ?? [], op.report, op.index) };

    case "report.update":
      findReport(ws, op.reportId);
      return { ...ws, reports: ws.reports!.map((r) => (r.id === op.reportId ? { ...r, ...op.patch } : r)) };

    case "report.delete":
      findReport(ws, op.reportId);
      {
        const reports = ws.reports!.filter((r) => r.id !== op.reportId);
        if (reports.length) return { ...ws, reports };
        const { reports: _, ...rest } = ws;
        return rest;
      }

    case "batch":
      return op.ops.reduce(applyOp, ws);

    case "table.create":
      if (ws.tables.some((t) => t.id === op.table.id)) throw new OpError(`Table ${op.table.id} exists`);
      return { ...ws, tables: insertAt(ws.tables, op.table, op.index) };

    case "table.delete":
      findTable(ws, op.tableId);
      return { ...ws, tables: ws.tables.filter((t) => t.id !== op.tableId) };

    case "table.update":
      return updateTable(ws, op.tableId, (t) => {
        const next: Table = { ...t, ...op.patch };
        // `undefined` in a patch removes the field (that's how inverses clear a goal).
        for (const [k, v] of Object.entries(op.patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
        return next;
      });

    case "column.add":
      return updateTable(ws, op.tableId, (t) => {
        if (t.columns.some((c) => c.id === op.column.id)) throw new OpError(`Column ${op.column.id} exists`);
        return { ...t, columns: insertAt(t.columns, op.column, op.index) };
      });

    case "column.update":
      return updateTable(ws, op.tableId, (t) => {
        const old = findColumn(t, op.columnId);
        const renamed = op.patch.name !== undefined && op.patch.name !== old.name;
        const columns = t.columns.map((c) => {
          if (c.id === op.columnId) {
            const next: Column = { ...c, ...op.patch };
            for (const [k, v] of Object.entries(op.patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
            return next;
          }
          if (renamed && c.formula) return { ...c, formula: renameFormulaRefs(c.formula, old.name, op.patch.name!) };
          return c;
        });
        return { ...t, columns };
      });

    case "column.delete":
      return updateTable(ws, op.tableId, (t) => {
        findColumn(t, op.columnId);
        const next: Table = {
          ...t,
          columns: t.columns.filter((c) => c.id !== op.columnId),
          rows: t.rows.map((r) => {
            if (!(op.columnId in r.values)) return r;
            const { [op.columnId]: _, ...values } = r.values;
            return { ...r, values };
          }),
        };
        return next;
      });

    case "column.move":
      return updateTable(ws, op.tableId, (t) => {
        const col = findColumn(t, op.columnId);
        return { ...t, columns: insertAt(t.columns.filter((c) => c.id !== op.columnId), col, op.index) };
      });

    case "rows.insert":
      return updateTable(ws, op.tableId, (t) => {
        let rows = t.rows;
        const existing = new Set(rows.map((r) => r.id));
        op.rows.forEach((row, i) => {
          if (existing.has(row.id)) throw new OpError(`Row ${row.id} exists`);
          rows = insertAt(rows, row, op.indexes?.[i]);
        });
        return { ...t, rows };
      });

    case "rows.delete":
      return updateTable(ws, op.tableId, (t) => {
        const ids = new Set(op.rowIds);
        return { ...t, rows: t.rows.filter((r) => !ids.has(r.id)) };
      });

    case "cells.set":
      return updateTable(ws, op.tableId, (t) => {
        const byRow = new Map<string, CellChange[]>();
        for (const c of op.cells) {
          findColumn(t, c.columnId);
          byRow.set(c.rowId, [...(byRow.get(c.rowId) ?? []), c]);
        }
        const rows = t.rows.map((r) => {
          const changes = byRow.get(r.id);
          if (!changes) return r;
          byRow.delete(r.id);
          const values = { ...r.values };
          for (const c of changes) {
            if (c.value === null) delete values[c.columnId];
            else values[c.columnId] = c.value;
          }
          return { ...r, values };
        });
        if (byRow.size) throw new OpError(`No row ${[...byRow.keys()][0]}`);
        return { ...t, rows };
      });
  }
}

/** The operation that undoes `op` when applied to `applyOp(ws, op)`. */
export function invertOp(ws: Workspace, op: Op): Op {
  switch (op.type) {
    case "report.create":
      return { type: "report.delete", reportId: op.report.id };

    case "report.delete": {
      const report = findReport(ws, op.reportId);
      return { type: "report.create", report, index: ws.reports!.indexOf(report) };
    }

    case "report.update": {
      const report = findReport(ws, op.reportId);
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(op.patch)) patch[key] = report[key as keyof Report];
      return { type: "report.update", reportId: op.reportId, patch };
    }

    case "batch": {
      const inverses: Op[] = [];
      let state = ws;
      for (const sub of op.ops) {
        inverses.unshift(invertOp(state, sub));
        state = applyOp(state, sub);
      }
      return { type: "batch", ops: inverses };
    }

    case "table.create":
      return { type: "table.delete", tableId: op.table.id };

    case "table.delete": {
      const index = ws.tables.findIndex((t) => t.id === op.tableId);
      return { type: "table.create", table: findTable(ws, op.tableId), index };
    }

    case "table.update": {
      const t = findTable(ws, op.tableId);
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(op.patch)) patch[key] = t[key as keyof TablePatch];
      return { type: "table.update", tableId: op.tableId, patch: patch as TablePatch };
    }

    case "column.add":
      return { type: "column.delete", tableId: op.tableId, columnId: op.column.id };

    case "column.update": {
      const col = findColumn(findTable(ws, op.tableId), op.columnId);
      const patch: ColumnPatch = {};
      for (const key of Object.keys(op.patch) as (keyof ColumnPatch)[]) {
        (patch as Record<string, unknown>)[key] = col[key];
      }
      return { type: "column.update", tableId: op.tableId, columnId: op.columnId, patch };
    }

    case "column.delete": {
      const t = findTable(ws, op.tableId);
      const column = findColumn(t, op.columnId);
      const index = t.columns.indexOf(column);
      const cells: CellChange[] = t.rows
        .filter((r) => r.values[op.columnId] !== undefined)
        .map((r) => ({ rowId: r.id, columnId: op.columnId, value: r.values[op.columnId] }));
      const restore: Op[] = [{ type: "column.add", tableId: op.tableId, column, index }];
      if (cells.length) restore.push({ type: "cells.set", tableId: op.tableId, cells });
      return { type: "batch", ops: restore };
    }

    case "column.move": {
      const t = findTable(ws, op.tableId);
      const index = t.columns.findIndex((c) => c.id === op.columnId);
      return { type: "column.move", tableId: op.tableId, columnId: op.columnId, index };
    }

    case "rows.insert":
      return { type: "rows.delete", tableId: op.tableId, rowIds: op.rows.map((r) => r.id) };

    case "rows.delete": {
      const t = findTable(ws, op.tableId);
      const ids = new Set(op.rowIds);
      const rows: Row[] = [];
      const indexes: number[] = [];
      t.rows.forEach((r, i) => {
        if (ids.has(r.id)) {
          rows.push(r);
          indexes.push(i);
        }
      });
      return { type: "rows.insert", tableId: op.tableId, rows, indexes };
    }

    case "cells.set": {
      const t = findTable(ws, op.tableId);
      const rows = new Map(t.rows.map((r) => [r.id, r]));
      return {
        type: "cells.set",
        tableId: op.tableId,
        cells: op.cells
          .slice()
          .reverse()
          .map((c) => ({ rowId: c.rowId, columnId: c.columnId, value: rows.get(c.rowId)?.values[c.columnId] ?? null })),
      };
    }
  }
}

/** Apply and return the inverse in one step. */
export function applyWithInverse(ws: Workspace, op: Op): { ws: Workspace; inverse: Op } {
  const inverse = invertOp(ws, op);
  return { ws: applyOp(ws, op), inverse };
}
