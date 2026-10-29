import {
  computeRow,
  displayColumn,
  formatValue,
  NUMERIC_TYPES,
  updateCells,
  type ColumnSummary,
  type Row,
  type Table,
} from "@higtclass/core";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
import { draftOf, problemText, useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { FieldInput } from "./FieldInput.tsx";
import { statusColor } from "./ui.tsx";

export type SortState = { columnId: string; dir: 1 | -1 } | null;

export function StatusMark({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold">
      <i className="h-2.5 w-2.5 shrink-0" style={{ background: statusColor(value) ?? "var(--ink-2)" }} />
      {value}
    </span>
  );
}

export function GridView({
  table,
  rows,
  summary,
  sort,
  onSort,
  onOpenRow,
  onEditColumn,
  onAddColumn,
}: {
  table: Table;
  rows: Row[];
  summary: Record<string, ColumnSummary>;
  sort: SortState;
  onSort: (s: SortState) => void;
  onOpenRow: (rowId: string) => void;
  onEditColumn: (columnId: string) => void;
  onAddColumn: () => void;
}) {
  const t = useT();
  const today = useToday();
  const settings = useStore((s) => s.settings);
  const dispatch = useStore((s) => s.dispatch);
  const showToast = useStore((s) => s.showToast);
  const [editing, setEditing] = useState<{ rowId: string; columnId: string; draft: string } | null>(null);
  const position = new Map(table.rows.map((r, i) => [r.id, i + 1]));

  const commit = (value?: string) => {
    if (!editing) return;
    const res = updateCells(table, [{ rowId: editing.rowId, column: editing.columnId, value: value ?? editing.draft }], {
      locale: settings.locale,
    });
    setEditing(null);
    if (res.problems.length) return showToast(problemText(t, res.problems[0]), false);
    if (res.op.type !== "batch" || res.op.ops.length) dispatch(res.op, t("record.edit"));
  };

  const toggleSort = (columnId: string) =>
    onSort(!sort || sort.columnId !== columnId ? { columnId, dir: 1 } : sort.dir === 1 ? { columnId, dir: -1 } : null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[15px]">
        <thead>
          <tr>
            <th className="w-12 border-b-2 border-rule py-3 pr-2 text-left text-sm font-semibold text-ink-2">№</th>
            {table.columns.map((col) => {
              const numeric = NUMERIC_TYPES.includes(col.type);
              const sorted = sort?.columnId === col.id;
              return (
                <th key={col.id} className={`group border-b-2 border-rule px-3 py-3 text-sm font-semibold text-ink-2 ${numeric ? "text-right" : "text-left"}`}>
                  <span className={`inline-flex items-center gap-1 ${numeric ? "flex-row-reverse" : ""}`}>
                    <button type="button" onClick={() => onEditColumn(col.id)} className="hover:text-ink" title={t("column.edit")}>
                      {col.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.id)}
                      className={`px-0.5 ${sorted ? "text-ink" : "opacity-0 group-hover:opacity-100"}`}
                      aria-label={`${col.name}: sort`}
                    >
                      {sorted ? (sort.dir === 1 ? "↑" : "↓") : "↕"}
                    </button>
                  </span>
                </th>
              );
            })}
            <th className="w-10 border-b-2 border-rule">
              <button type="button" onClick={onAddColumn} className="w-full py-2 text-xl text-ink-2 hover:text-ink" title={t("column.new")} aria-label={t("column.new")}>
                +
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const computed = computeRow(table, row, today);
            return (
              <tr key={row.id} className="group hover:bg-soft">
                <td className="border-b border-line py-3.5 pr-2 text-sm text-ink-2">
                  <button type="button" onClick={() => onOpenRow(row.id)} className="w-full text-left hover:text-ink" title={t("record.edit")}>
                    <span className="group-hover:hidden">{position.get(row.id)}</span>
                    <span className="hidden font-bold group-hover:inline">↗</span>
                  </button>
                </td>
                {table.columns.map((col) => {
                  const numeric = NUMERIC_TYPES.includes(col.type);
                  const base = `border-b border-line px-3 py-3.5 ${numeric ? "text-right font-bold" : ""}`;
                  if (col.type === "formula") {
                    const c = computed[col.id];
                    return (
                      <td key={col.id} className={base}>
                        {c && "value" in c ? (
                          formatValue(displayColumn(table, col), c.value, settings)
                        ) : (
                          <span className="text-sm font-semibold text-late">{c ? t(`formula.${c.error}`) : ""}</span>
                        )}
                      </td>
                    );
                  }
                  if (col.type === "checkbox") {
                    const checked = row.values[col.id] === true;
                    return (
                      <td key={col.id} className={base}>
                        <input
                          type="checkbox"
                          aria-label={col.name}
                          className="h-[18px] w-[18px] accent-[var(--accent)]"
                          checked={checked}
                          onChange={() =>
                            dispatch(
                              { type: "cells.set", tableId: table.id, cells: [{ rowId: row.id, columnId: col.id, value: checked ? null : true }] },
                              t("record.edit"),
                            )
                          }
                        />
                      </td>
                    );
                  }
                  if (editing?.rowId === row.id && editing.columnId === col.id) {
                    return (
                      <td key={col.id} className={`${base} !py-1.5`} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && commit()}>
                        <FieldInput compact column={col} value={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} onEnter={() => commit()} autoFocus />
                      </td>
                    );
                  }
                  const value = row.values[col.id] ?? null;
                  return (
                    <td
                      key={col.id}
                      className={`${base} cursor-text ${col.type === "text" && col === table.columns.find((c) => c.type === "text") ? "font-bold" : ""}`}
                      onClick={() => setEditing({ rowId: row.id, columnId: col.id, draft: draftOf(col, row.values[col.id], settings.locale) })}
                    >
                      {col.type === "select" && typeof value === "string" ? (
                        <StatusMark value={value} />
                      ) : (
                        formatValue(col, value, settings) || <span className="text-transparent">·</span>
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-line" />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="border-t-2 border-rule py-3 text-sm font-semibold text-ink-2">Σ</td>
            {table.columns.map((col) => {
              const s = summary[col.id];
              let text = "";
              if (s?.sum !== undefined) text = formatValue(displayColumn(table, col), s.sum, settings);
              else if (col.type === "checkbox" && s) text = t("figures.of", { a: s.checked ?? 0, b: rows.length });
              return (
                <td key={col.id} className={`border-t-2 border-rule px-3 py-3 font-extrabold ${NUMERIC_TYPES.includes(col.type) ? "text-right" : ""}`}>
                  {text}
                </td>
              );
            })}
            <td className="border-t-2 border-rule" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
