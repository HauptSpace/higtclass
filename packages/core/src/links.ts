import { displayColumn, resolveLink } from "./formula.ts";
import type { CellValue, Column, Row, Settings, Table, Workspace } from "./types.ts";
import { formatValue } from "./values.ts";

// Linked tables: an "Orders.Client" cell stores the id of a row in "Clients"
// and shows that row's name. These helpers turn ids into labels and back.

/** The column that names a row: the first text column, else the first typed-in one. */
export function primaryColumn(table: Table): Column | undefined {
  return (
    table.columns.find((c) => c.type === "text") ??
    table.columns.find((c) => c.type !== "formula" && c.type !== "lookup" && c.type !== "link")
  );
}

export function rowLabel(table: Table, row: Row, settings?: Settings): string {
  const col = primaryColumn(table);
  const value = col ? row.values[col.id] : undefined;
  if (value === undefined || value === null || value === "") return `#${table.rows.indexOf(row) + 1}`;
  return settings && col ? formatValue(col, value, settings) : String(value);
}

/** What a cell shows: links become the linked row's name, everything else is formatted by type. */
export function cellText(ws: Workspace | undefined, table: Table, column: Column, value: CellValue | undefined, settings: Settings): string {
  if (column.type === "link") {
    const hit = resolveLink(ws, column, value);
    return hit ? rowLabel(hit.table, hit.row, settings) : "";
  }
  return formatValue(displayColumn(table, column, ws), value ?? null, settings);
}

/** Find the row a typed or dictated name refers to: by id, then by exact name, then by prefix. */
export function matchLinkTarget(ws: Workspace | undefined, column: Column, raw: unknown): string | null {
  const target = ws?.tables.find((t) => t.id === column.linkTableId);
  if (!target || raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (target.rows.some((r) => r.id === text)) return text;
  const norm = (s: string) => s.toLowerCase().replace(/[«»"'“”„]/g, "").replace(/\s+/g, " ").trim();
  const wanted = norm(text);
  const labels = target.rows.map((r) => ({ id: r.id, label: norm(rowLabel(target, r)) }));
  const exact = labels.filter((l) => l.label === wanted);
  if (exact.length === 1) return exact[0].id;
  const partial = labels.filter((l) => l.label.includes(wanted) || wanted.includes(l.label));
  return partial.length === 1 ? partial[0].id : null;
}

export interface Backlink {
  table: Table;
  column: Column;
  rows: Row[];
}

/** Rows in other tables that link to this row — "all orders of this client". */
export function backlinks(ws: Workspace, tableId: string, rowId: string): Backlink[] {
  const out: Backlink[] = [];
  for (const table of ws.tables) {
    for (const column of table.columns) {
      if (column.type !== "link" || column.linkTableId !== tableId) continue;
      const rows = table.rows.filter((r) => r.values[column.id] === rowId);
      if (rows.length) out.push({ table, column, rows });
    }
  }
  return out;
}
