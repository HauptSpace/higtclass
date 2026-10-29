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
import { TYPE_ICONS } from "./ColumnDialog.tsx";
import { FieldInput } from "./FieldInput.tsx";

export type SortState = { columnId: string; dir: 1 | -1 } | null;

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

  const commit = (value?: string) => {
    if (!editing) return;
    const draft = value ?? editing.draft;
    const res = updateCells(table, [{ rowId: editing.rowId, column: editing.columnId, value: draft }], {
      locale: settings.locale,
    });
    setEditing(null);
    if (res.problems.length) {
      showToast(problemText(t, res.problems[0]), false);
      return;
    }
    if (res.op.type !== "batch" || res.op.ops.length) dispatch(res.op, t("record.edit"));
  };

  const toggleSort = (columnId: string) =>
    onSort(!sort || sort.columnId !== columnId ? { columnId, dir: 1 } : sort.dir === 1 ? { columnId, dir: -1 } : null);

  return (
    <div className="overflow-auto rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-zinc-50/95 backdrop-blur dark:bg-zinc-900/95">
          <tr>
            <th className="w-10 border-b border-zinc-200 dark:border-zinc-800" />
            {table.columns.map((col) => (
              <th
                key={col.id}
                className="group min-w-36 border-b border-l border-zinc-200 px-3 py-2 text-left font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onEditColumn(col.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 hover:text-brand-600"
                    title={t("column.edit")}
                  >
                    <span className="font-mono text-[11px] text-zinc-400">{TYPE_ICONS[col.type]}</span>
                    <span className="truncate">{col.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSort(col.id)}
                    className={`rounded px-1 text-xs ${sort?.columnId === col.id ? "text-brand-600" : "text-zinc-300 opacity-0 group-hover:opacity-100"}`}
                    aria-label="Sort"
                  >
                    {sort?.columnId === col.id ? (sort.dir === 1 ? "↑" : "↓") : "↕"}
                  </button>
                </div>
              </th>
            ))}
            <th className="w-12 border-b border-l border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={onAddColumn}
                className="h-full w-full px-3 py-2 text-lg text-zinc-400 hover:text-brand-600"
                title={t("column.new")}
              >
                +
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const computed = computeRow(table, row, today);
            return (
              <tr key={row.id} className="group hover:bg-brand-50/40 dark:hover:bg-zinc-800/40">
                <td className="border-b border-zinc-100 text-center text-xs text-zinc-400 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => onOpenRow(row.id)}
                    className="h-full w-full py-2 group-hover:text-brand-600"
                    title={t("record.edit")}
                  >
                    <span className="group-hover:hidden">{i + 1}</span>
                    <span className="hidden group-hover:inline">⤢</span>
                  </button>
                </td>
                {table.columns.map((col) => {
                  const isEditing = editing?.rowId === row.id && editing.columnId === col.id;
                  const numeric = NUMERIC_TYPES.includes(col.type);
                  const base = `border-b border-l border-zinc-100 px-3 py-2 dark:border-zinc-800 ${numeric ? "tabular text-right" : ""}`;
                  if (col.type === "formula") {
                    const c = computed[col.id];
                    return (
                      <td key={col.id} className={`${base} bg-zinc-50/60 text-zinc-700 dark:bg-zinc-800/30 dark:text-zinc-300`}>
                        {c && "value" in c ? (
                          formatValue(displayColumn(table, col), c.value, settings)
                        ) : (
                          <span className="text-xs text-red-500" title={c ? t(`formula.${c.error}`) : ""}>
                            ⚠ {c ? t(`formula.${c.error}`) : ""}
                          </span>
                        )}
                      </td>
                    );
                  }
                  if (col.type === "checkbox") {
                    const checked = row.values[col.id] === true;
                    return (
                      <td key={col.id} className={`${base} text-center`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-600"
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
                  if (isEditing) {
                    return (
                      <td key={col.id} className={`${base} p-1`} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && commit()}>
                        <FieldInput
                          compact
                          column={col}
                          value={editing.draft}
                          onChange={(draft) => setEditing({ ...editing, draft })}
                          onEnter={() => commit()}
                          autoFocus
                        />
                      </td>
                    );
                  }
                  return (
                    <td
                      key={col.id}
                      className={`${base} cursor-text`}
                      onClick={() => setEditing({ rowId: row.id, columnId: col.id, draft: draftOf(col, row.values[col.id], settings.locale) })}
                    >
                      {col.type === "select" && row.values[col.id] ? (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-100">
                          {String(row.values[col.id])}
                        </span>
                      ) : (
                        formatValue(col, row.values[col.id] ?? null, settings) || <span className="text-transparent">·</span>
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-l border-zinc-100 dark:border-zinc-800" />
              </tr>
            );
          })}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="sticky bottom-0 bg-zinc-50/95 font-medium backdrop-blur dark:bg-zinc-900/95">
            <tr>
              <td className="border-t border-zinc-200 px-2 py-2 text-xs text-zinc-500 dark:border-zinc-800">Σ</td>
              {table.columns.map((col) => {
                const s = summary[col.id];
                let text = "";
                if (s?.sum !== undefined) text = formatValue(displayColumn(table, col), s.sum, settings);
                else if (col.type === "checkbox" && s) text = `${s.checked} / ${rows.length}`;
                return (
                  <td
                    key={col.id}
                    className={`border-t border-l border-zinc-200 px-3 py-2 dark:border-zinc-800 ${NUMERIC_TYPES.includes(col.type) ? "tabular text-right" : "text-center"}`}
                  >
                    {text}
                  </td>
                );
              })}
              <td className="border-t border-l border-zinc-200 dark:border-zinc-800" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
