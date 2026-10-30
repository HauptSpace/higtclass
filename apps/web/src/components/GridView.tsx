import {
  addRecords,
  cellText,
  computeRow,
  displayColumn,
  formatValue,
  isComputed,
  ledgerOf,
  ledgerTotals,
  NUMERIC_TYPES,
  optionsFor,
  updateCells,
  type CellChange,
  type CellValue,
  type Column,
  type ColumnSummary,
  type Op,
  type RawRecord,
  type Row,
  type Table,
  rowSide,
} from "@higtclass/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { draftOf, problemText, useStockWarnings, useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { FieldInput } from "./FieldInput.tsx";
import { optionColor } from "./ui.tsx";

// The desktop grid works like a spreadsheet where it matters: arrows move,
// Shift extends a selection, typing replaces, Enter edits, Escape cancels,
// Ctrl+C/V/D copy, paste and fill down, Delete clears. Columns stay typed,
// headers stay on screen, and long tables only render what is visible.

export type SortState = { columnId: string; dir: 1 | -1 } | null;

export function StatusMark({ value, column }: { value: string; column?: Column }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold">
      <i className="h-2.5 w-2.5 shrink-0" style={{ background: optionColor(column, value) ?? "var(--ink-2)" }} />
      {value}
    </span>
  );
}

const ROW_H = 41;
const VIRTUAL_FROM = 150;

const MIN_WIDTH: Partial<Record<Column["type"], string>> = {
  text: "min-w-40",
  link: "min-w-40",
  select: "min-w-36",
  date: "min-w-32",
  money: "min-w-28",
  number: "min-w-24",
  formula: "min-w-28",
  lookup: "min-w-32",
  rollup: "min-w-28",
  checkbox: "min-w-20",
};

type Pos = { r: number; c: number };

/** Split clipboard text from Excel/Sheets into rows of cells. */
function parseClipboard(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

export function GridView({
  table,
  rows,
  summary,
  sort,
  onSort,
  oldestFirst,
  onToggleOrder,
  onOpenRow,
  onOpenLinked,
  onEditColumn,
  onAddColumn,
}: {
  table: Table;
  rows: Row[];
  summary: Record<string, ColumnSummary>;
  sort: SortState;
  onSort: (s: SortState) => void;
  oldestFirst: boolean;
  onToggleOrder: () => void;
  onOpenRow: (rowId: string) => void;
  onOpenLinked: (tableId: string, rowId: string) => void;
  onEditColumn: (columnId: string) => void;
  onAddColumn: () => void;
}) {
  const t = useT();
  const today = useToday();
  const settings = useStore((s) => s.settings);
  const ws = useStore((s) => s.ws);
  const dispatch = useStore((s) => s.dispatch);
  const showToast = useStore((s) => s.showToast);
  const warnStock = useStockWarnings();
  const cols = table.columns;
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Pos | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; draft: string } | null>(null);
  const dragging = useRef(false);
  // Leaving an editor by Enter, Tab or Escape also blurs it: that blur must not save again.
  const settled = useRef(false);
  const [view, setView] = useState({ top: 0, height: 800 });
  const position = useMemo(() => new Map(table.rows.map((r, i) => [r.id, i + 1])), [table.rows]);
  const firstText = cols.find((c) => c.type === "text");
  const ledger = ledgerOf(table);
  const signed = ledger?.kind === "both" ? ledger.amountId : null;

  // Keep the selection inside the table when rows or columns change.
  useEffect(() => {
    if (!active) return;
    if (active.r >= rows.length || active.c >= cols.length) {
      setActive(null);
      setAnchor(null);
      setEditing(null);
    }
  }, [rows.length, cols.length, active]);

  const range = useMemo(() => {
    if (!active) return null;
    const a = anchor ?? active;
    return { r0: Math.min(a.r, active.r), r1: Math.max(a.r, active.r), c0: Math.min(a.c, active.c), c1: Math.max(a.c, active.c) };
  }, [active, anchor]);
  const inRange = (r: number, c: number) => !!range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
  const rangeSize = range ? (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1) : 0;

  const ctx = { locale: settings.locale, ws, currency: settings.currency };

  const apply = useCallback(
    (op: Op, label: string, touched: string[]) => {
      if (op.type === "batch" && !op.ops.length) return;
      const before = useStore.getState().ws;
      if (dispatch(op, label)) warnStock(before, table.id, touched);
    },
    [dispatch, table.id, warnStock],
  );

  /** Write raw text into cells (typing, paste, fill); computed columns are skipped. */
  const writeCells = (cells: { r: number; c: number; raw: string }[], label: string) => {
    const updates = cells
      .filter((x) => rows[x.r] && cols[x.c] && !isComputed(cols[x.c]))
      .map((x) => ({ rowId: rows[x.r].id, column: cols[x.c].id, value: cols[x.c].type === "checkbox" ? (x.raw.trim() ? x.raw : "") : x.raw }));
    if (!updates.length) return;
    const res = updateCells(table, updates, ctx);
    const problems = res.problems.filter((p) => p.reason !== "formula_column");
    if (problems.length) showToast(problemText(t, problems[0]), false);
    apply(res.op, label, updates.map((u) => u.rowId));
    return updates.length;
  };

  const startEdit = (pos: Pos, initial?: string) => {
    const col = cols[pos.c];
    const row = rows[pos.r];
    if (!col || !row || isComputed(col)) return;
    if (col.type === "checkbox") {
      writeCells([{ ...pos, raw: row.values[col.id] === true ? "" : "1" }], t("record.edit"));
      return;
    }
    settled.current = false;
    setEditing({ ...pos, draft: initial ?? draftOf(col, row.values[col.id], settings.locale) });
  };

  const commit = (move?: { dr: number; dc: number }) => {
    if (!editing) return;
    if (settled.current) {
      settled.current = false;
      return;
    }
    settled.current = true;
    const targets =
      range && rangeSize > 1 && inRange(editing.r, editing.c)
        ? Array.from({ length: range.r1 - range.r0 + 1 }, (_, i) => range.r0 + i).flatMap((r) =>
            Array.from({ length: range.c1 - range.c0 + 1 }, (_, j) => ({ r, c: range.c0 + j, raw: editing.draft })),
          )
        : [{ r: editing.r, c: editing.c, raw: editing.draft }];
    const pos = { r: editing.r, c: editing.c };
    setEditing(null);
    const original = draftOf(cols[pos.c], rows[pos.r]?.values[cols[pos.c].id], settings.locale);
    if (targets.length > 1 || editing.draft !== original) writeCells(targets, t("record.edit"));
    if (move) moveTo({ r: pos.r + move.dr, c: pos.c + move.dc }, false);
    scroller.current?.focus({ preventScroll: true });
  };

  const cancel = () => {
    settled.current = true;
    setEditing(null);
    scroller.current?.focus({ preventScroll: true });
  };

  const moveTo = (pos: Pos, extend: boolean) => {
    const next = { r: Math.max(0, Math.min(rows.length - 1, pos.r)), c: Math.max(0, Math.min(cols.length - 1, pos.c)) };
    setActive(next);
    if (!extend) setAnchor(null);
    else if (!anchor) setAnchor(active);
    // Keep the active row on screen.
    const el = scroller.current;
    if (el) {
      const y = next.r * ROW_H;
      const headerH = 48;
      if (y < el.scrollTop) el.scrollTop = y;
      else if (y + ROW_H > el.scrollTop + el.clientHeight - headerH - 48) el.scrollTop = y + ROW_H - el.clientHeight + headerH + 48;
    }
  };

  const selectedCells = () => {
    if (!range) return [];
    const out: Pos[] = [];
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) out.push({ r, c });
    return out;
  };

  const plainValue = (row: Row, col: Column, computed: Record<string, { value: CellValue } | { error: string }>) => {
    const v = isComputed(col) ? ("value" in (computed[col.id] ?? {}) ? (computed[col.id] as { value: CellValue }).value : null) : row.values[col.id];
    if (v === null || v === undefined) return "";
    if (col.type === "link") return cellText(ws, table, col, v, settings);
    if (col.type === "checkbox") return v ? "TRUE" : "FALSE";
    if (col.type === "date") return draftOf(col, v, settings.locale);
    if (typeof v === "number") return draftOf({ ...col, type: "number" }, v, settings.locale);
    return String(v);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    if (!active) {
      if (e.key.startsWith("Arrow") && rows.length) {
        e.preventDefault();
        moveTo({ r: 0, c: 0 }, false);
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const step = (dr: number, dc: number) => {
      e.preventDefault();
      if (mod) moveTo({ r: dr ? (dr > 0 ? rows.length - 1 : 0) : active.r, c: dc ? (dc > 0 ? cols.length - 1 : 0) : active.c }, e.shiftKey);
      else moveTo({ r: active.r + dr, c: active.c + dc }, e.shiftKey);
    };
    switch (e.key) {
      case "ArrowDown":
        return step(1, 0);
      case "ArrowUp":
        return step(-1, 0);
      case "ArrowRight":
        return step(0, 1);
      case "ArrowLeft":
        return step(0, -1);
      case "Tab":
        e.preventDefault();
        return moveTo({ r: active.r, c: active.c + (e.shiftKey ? -1 : 1) }, false);
      case "Enter":
      case "F2":
        e.preventDefault();
        if (e.key === "Enter" && mod) return onOpenRow(rows[active.r].id);
        return startEdit(active);
      case "Escape":
        setAnchor(null);
        return;
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        const n = writeCells(selectedCells().map((p) => ({ ...p, raw: "" })), t("grid.cleared"));
        if (n && n > 1) showToast(`${t("grid.cleared")}: ${t("grid.cells", { n })}`);
        return;
      }
      case " ":
        if (cols[active.c]?.type === "checkbox") {
          e.preventDefault();
          return startEdit(active);
        }
        break;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setActive({ r: rows.length - 1, c: cols.length - 1 });
      return;
    }
    if (mod && e.key.toLowerCase() === "d" && range) {
      // Fill down: the top cell of each selected column goes into the cells below it.
      e.preventDefault();
      const cells: { r: number; c: number; raw: string }[] = [];
      for (let c = range.c0; c <= range.c1; c++) {
        const top = rows[range.r0];
        const raw = draftOf(cols[c], top.values[cols[c].id], settings.locale);
        for (let r = range.r0 + 1; r <= range.r1; r++) cells.push({ r, c, raw });
      }
      const n = writeCells(cells, t("grid.filled"));
      if (n) showToast(`${t("grid.filled")}: ${t("grid.cells", { n })}`);
      return;
    }
    // Typing replaces the cell, like in Excel.
    if (e.key.length === 1 && !mod && !e.altKey) {
      const col = cols[active.c];
      if (col && !isComputed(col) && col.type !== "checkbox" && col.type !== "link") {
        e.preventDefault();
        startEdit(active, e.key);
      }
    }
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (editing || !range) return;
    e.preventDefault();
    const lines: string[] = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const row = rows[r];
      const computed = computeRow(table, row, today, ws);
      const cells: string[] = [];
      for (let c = range.c0; c <= range.c1; c++) cells.push(plainValue(row, cols[c], computed).replace(/\t|\n/g, " "));
      lines.push(cells.join("\t"));
    }
    e.clipboardData.setData("text/plain", lines.join("\n"));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editing || !active) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const grid = parseClipboard(text);
    const single = grid.length === 1 && grid[0].length === 1;
    const cells: { r: number; c: number; raw: string }[] = [];
    if (single && range && rangeSize > 1) {
      for (const p of selectedCells()) cells.push({ ...p, raw: grid[0][0] });
    } else {
      const start = range ? { r: range.r0, c: range.c0 } : active;
      grid.forEach((line, i) => line.forEach((raw, j) => cells.push({ r: start.r + i, c: start.c + j, raw })));
    }
    const existing = cells.filter((x) => x.r < rows.length);
    const extra = cells.filter((x) => x.r >= rows.length);
    const ops: Op[] = [];
    let touched: string[] = [];
    if (existing.length) {
      const updates = existing.filter((x) => cols[x.c] && !isComputed(cols[x.c])).map((x) => ({ rowId: rows[x.r].id, column: cols[x.c].id, value: x.raw }));
      const res = updateCells(table, updates, ctx);
      const problems = res.problems.filter((p) => p.reason !== "formula_column");
      if (problems.length) showToast(problemText(t, problems[0]), false);
      ops.push(res.op);
      touched = updates.map((u) => u.rowId);
    }
    let added = 0;
    if (extra.length) {
      // Pasting below the last row adds new entries, like in Excel.
      const byRow = new Map<number, RawRecord>();
      for (const x of extra) {
        const col = cols[x.c];
        if (!col || isComputed(col) || !x.raw.trim()) continue;
        byRow.set(x.r, { ...(byRow.get(x.r) ?? {}), [col.id]: x.raw });
      }
      if (byRow.size) {
        const res = addRecords(table, [...byRow.values()], ctx);
        ops.push(res.op);
        added = byRow.size;
      }
    }
    if (ops.length) apply({ type: "batch", ops }, t("grid.pasted"), touched);
    showToast(added ? t("grid.moreRows", { n: added }) : `${t("grid.pasted")}: ${t("grid.cells", { n: cells.length })}`);
  };

  const toggleSort = (columnId: string) =>
    onSort(!sort || sort.columnId !== columnId ? { columnId, dir: 1 } : sort.dir === 1 ? { columnId, dir: -1 } : null);

  // Only the rows on screen are rendered for long tables.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  const virtual = rows.length > VIRTUAL_FROM;
  const first = virtual ? Math.max(0, Math.floor(view.top / ROW_H) - 15) : 0;
  const last = virtual ? Math.min(rows.length, first + Math.ceil(view.height / ROW_H) + 30) : rows.length;

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        tabIndex={0}
        role="grid"
        aria-rowcount={rows.length}
        aria-label={table.name}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
        style={{ outline: "none" }}
        className="min-h-0 flex-1 scroll-pt-12 scroll-pl-14 overflow-auto"
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-[15px]">
          <thead className="sticky top-0 z-20 bg-paper">
            <tr>
              <th className="sticky left-0 z-30 w-12 border-b-2 border-rule bg-paper py-2.5 pr-2 text-left text-sm font-semibold text-ink-2">
                <button type="button" onClick={onToggleOrder} title={oldestFirst ? t("grid.oldestFirst") : t("grid.newestFirst")} className="hover:text-ink">
                  № {sort ? "" : oldestFirst ? "↓" : "↑"}
                </button>
              </th>
              {cols.map((col) => {
                const numeric = NUMERIC_TYPES.includes(displayColumn(table, col, ws).type) || col.type === "lookup" && NUMERIC_TYPES.includes(displayColumn(table, col, ws).type);
                const sorted = sort?.columnId === col.id;
                return (
                  <th key={col.id} className={`group border-b-2 border-rule px-3 py-2.5 text-sm font-semibold whitespace-nowrap text-ink-2 ${MIN_WIDTH[col.type] ?? ""} ${numeric ? "text-right" : "text-left"}`}>
                    <span className={`inline-flex items-center gap-1 ${numeric ? "flex-row-reverse" : ""}`}>
                      <button type="button" onClick={() => onEditColumn(col.id)} className="hover:text-ink" title={t("column.edit")}>
                        {col.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSort(col.id)}
                        className={`px-0.5 ${sorted ? "text-ink" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
                        aria-label={`${col.name}: sort`}
                      >
                        {sorted ? (sort.dir === 1 ? "↑" : "↓") : "↕"}
                      </button>
                    </span>
                  </th>
                );
              })}
              <th className="w-10 border-b-2 border-rule">
                <button type="button" onClick={onAddColumn} className="w-full py-1.5 text-xl text-ink-2 hover:text-ink" title={t("column.new")} aria-label={t("column.new")}>
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {first > 0 && (
              <tr aria-hidden="true">
                <td style={{ height: first * ROW_H }} colSpan={cols.length + 2} />
              </tr>
            )}
            {rows.slice(first, last).map((row, k) => {
              const r = first + k;
              const computed = computeRow(table, row, today, ws);
              return (
                <tr key={row.id} className="group" style={{ height: ROW_H }}>
                  <td className="sticky left-0 z-10 border-b border-line bg-paper pr-2 text-sm text-ink-2 group-hover:bg-soft">
                    <button type="button" onClick={() => onOpenRow(row.id)} className="flex w-full items-center gap-1 text-left hover:text-ink" title={t("grid.open")} aria-label={t("grid.open")}>
                      <span>{position.get(row.id)}</span>
                      <span className="font-bold opacity-0 group-hover:opacity-100">↗</span>
                    </button>
                  </td>
                  {cols.map((col, c) => {
                    const shown = displayColumn(table, col, ws);
                    const numeric = NUMERIC_TYPES.includes(shown.type) || shown.type === "money";
                    const isActive = active?.r === r && active?.c === c;
                    const selected = inRange(r, c) && rangeSize > 1;
                    const base = `border-b border-line px-3 whitespace-nowrap ${numeric ? "text-right font-bold tabular" : ""} ${selected ? "bg-accent/10" : "group-hover:bg-soft"} ${
                      isActive ? "outline-2 -outline-offset-2 outline-ink" : ""
                    }`;
                    if (editing?.r === r && editing.c === c) {
                      const parent = col.scope ? row.values[col.scope.columnId] : undefined;
                      return (
                        <td
                          key={col.id}
                          className={`${base} !py-1`}
                          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && commit()}
                          onKeyDown={(e) => {
                            if (e.key === "Tab") {
                              e.preventDefault();
                              commit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
                            }
                          }}
                        >
                          <FieldInput
                            compact
                            column={col}
                            value={editing.draft}
                            options={col.type === "select" ? optionsFor(col, parent) : undefined}
                            onChange={(draft) => setEditing({ ...editing, draft })}
                            onEnter={() => commit({ dr: 1, dc: 0 })}
                            onEscape={cancel}
                            autoFocus
                          />
                          {rangeSize > 1 && inRange(r, c) && <div className="mt-0.5 text-[11px] font-semibold text-ink-2">{t("grid.applyAll", { n: rangeSize })}</div>}
                        </td>
                      );
                    }
                    const cellProps = {
                      onMouseDown: (e: React.MouseEvent) => {
                        if ((e.target as HTMLElement).closest("input,button")) return;
                        e.preventDefault();
                        scroller.current?.focus({ preventScroll: true });
                        if (e.shiftKey && active) {
                          if (!anchor) setAnchor(active);
                          setActive({ r, c });
                        } else {
                          setActive({ r, c });
                          setAnchor(null);
                          dragging.current = true;
                        }
                      },
                      onMouseEnter: () => {
                        if (!dragging.current || !active) return;
                        if (!anchor) setAnchor(active);
                        setActive({ r, c });
                      },
                      onDoubleClick: () => startEdit({ r, c }),
                    };
                    if (isComputed(col)) {
                      const cell = computed[col.id];
                      const v = cell && "value" in cell ? cell.value : null;
                      const negative = typeof v === "number" && v < 0;
                      return (
                        <td key={col.id} className={`${base} ${negative ? "text-late" : ""}`} {...cellProps}>
                          {cell && "error" in cell ? (
                            <span className="text-sm font-semibold text-late">{t(`formula.${cell.error}` as "formula.syntax")}</span>
                          ) : shown.type === "select" && typeof v === "string" ? (
                            <StatusMark value={v} column={shown} />
                          ) : (
                            cellText(ws, table, col, v, settings)
                          )}
                        </td>
                      );
                    }
                    if (col.type === "checkbox") {
                      const checked = row.values[col.id] === true;
                      return (
                        <td key={col.id} className={base} {...cellProps}>
                          <input
                            type="checkbox"
                            aria-label={col.name}
                            className="h-[18px] w-[18px] accent-[var(--accent)]"
                            checked={checked}
                            onChange={() => {
                              const cells: CellChange[] = [{ rowId: row.id, columnId: col.id, value: checked ? null : true }];
                              // Ticking "Paid" records today as the payment day if none is set.
                              if (!checked && ledger?.paidColumnId === col.id && ledger.dateColumnId && !row.values[ledger.dateColumnId]) {
                                cells.push({ rowId: row.id, columnId: ledger.dateColumnId, value: today });
                              }
                              apply({ type: "cells.set", tableId: table.id, cells }, t("record.edit"), [row.id]);
                            }}
                          />
                        </td>
                      );
                    }
                    const value = row.values[col.id] ?? null;
                    if (col.type === "photo") {
                      return (
                        <td key={col.id} className={base} {...cellProps}>
                          {typeof value === "string" && value ? (
                            <button type="button" onClick={() => onOpenRow(row.id)} aria-label={col.name}>
                              <img src={value} alt="" className="h-7 w-7 rounded object-cover" />
                            </button>
                          ) : null}
                        </td>
                      );
                    }
                    let text = cellText(ws, table, col, value, settings);
                    // Income and spending look different: +18 500 in green, −85 in ink.
                    const side = signed === col.id && typeof value === "number" && ledger ? rowSide(ledger, row.values) : null;
                    if (side && text) text = `${side === "income" ? "+" : "−"}${text.replace(/^[-−]/, "")}`;
                    return (
                      <td
                        key={col.id}
                        className={`${base} max-w-[22rem] cursor-cell truncate ${col === firstText ? "font-bold" : ""} ${side === "income" ? "text-paid" : ""}`}
                        title={text.length > 30 ? text : undefined}
                        {...cellProps}
                      >
                        {col.type === "link" ? (
                          <span className="inline-flex max-w-full items-center gap-1.5">
                            <span className="truncate font-semibold">{text}</span>
                            {typeof value === "string" && text && col.linkTableId && (
                              <button
                                type="button"
                                onClick={() => onOpenLinked(col.linkTableId!, value)}
                                className="shrink-0 rounded px-1 text-sm text-ink-2 opacity-0 group-hover:opacity-100 hover:bg-paper hover:text-ink focus:opacity-100"
                                title={t("link.open")}
                                aria-label={`${t("link.open")}: ${text}`}
                              >
                                ↗
                              </button>
                            )}
                          </span>
                        ) : col.type === "select" && typeof value === "string" ? (
                          <StatusMark value={value} column={col} />
                        ) : (
                          text || <span className="text-transparent">·</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="border-b border-line group-hover:bg-soft" />
                </tr>
              );
            })}
            {last < rows.length && (
              <tr aria-hidden="true">
                <td style={{ height: (rows.length - last) * ROW_H }} colSpan={cols.length + 2} />
              </tr>
            )}
          </tbody>
          <tfoot className="sticky bottom-0 z-20 bg-paper">
            <tr>
              <td className="sticky left-0 z-30 border-t-2 border-rule bg-paper py-2.5 text-sm font-semibold text-ink-2">Σ</td>
              {cols.map((col) => {
                const s = summary[col.id];
                const shown = displayColumn(table, col, ws);
                let footer = "";
                if (signed === col.id && ledger) {
                  // Income minus spending, not the two added together.
                  const totals = ledgerTotals(ledger, rows.map((r) => r.values));
                  footer = `${totals.balance < 0 ? "−" : ""}${formatValue(shown, Math.abs(totals.balance), settings)}`;
                } else if (s?.sum !== undefined) footer = formatValue(shown.type === "money" ? shown : { ...col, type: col.type === "number" ? "number" : "formula" }, s.sum, settings);
                else if (col.type === "checkbox" && s) footer = t("figures.of", { a: s.checked ?? 0, b: rows.length });
                return (
                  <td key={col.id} className={`border-t-2 border-rule px-3 py-2.5 font-extrabold whitespace-nowrap ${NUMERIC_TYPES.includes(shown.type) || shown.type === "money" ? "text-right" : ""}`}>
                    {footer}
                  </td>
                );
              })}
              <td className="border-t-2 border-rule" />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="hidden pt-2 text-xs text-ink-2 lg:block">{t("grid.hint")}</p>
    </div>
  );
}
