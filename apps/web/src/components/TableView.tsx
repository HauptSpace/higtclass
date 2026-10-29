import { computeRow, formatValue, summarizeTable, type CellValue, type Table } from "@higtclass/core";
import { useMemo, useState } from "react";
import { useT } from "../i18n/index.ts";
import { useIsMobile, useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { CardsView } from "./CardsView.tsx";
import { ColumnDialog } from "./ColumnDialog.tsx";
import { GridView, type SortState } from "./GridView.tsx";
import { RecordDialog } from "./RecordDialog.tsx";
import { SummaryView } from "./SummaryView.tsx";
import { Button, inputClass } from "./ui.tsx";

const ICONS = ["📋", "🐷", "🧾", "💰", "📦", "🤝", "🏠", "🚗", "🍔", "💊", "🎓", "✈️", "🛒", "💼", "📈", "⭐", "🎁", "🐶", "⚽", "🔧"];

function compareValues(a: CellValue | undefined, b: CellValue | undefined): number {
  const empty = (v: CellValue | undefined) => v === null || v === undefined || v === "";
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function TableView({ table }: { table: Table }) {
  const t = useT();
  const today = useToday();
  const mobile = useIsMobile();
  const settings = useStore((s) => s.settings);
  const dispatch = useStore((s) => s.dispatch);

  const [view, setView] = useState<"grid" | "summary">("grid");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [record, setRecord] = useState<{ rowId: string | null } | null>(null);
  const [column, setColumn] = useState<{ columnId: string | null } | null>(null);
  const [menu, setMenu] = useState(false);

  const summary = useMemo(() => summarizeTable(table, today), [table, today]);

  const rows = useMemo(() => {
    let list = table.rows;
    const q = query.trim().toLowerCase();
    if (q || sort) {
      const withValues = list.map((row) => {
        const computed = computeRow(table, row, today);
        const values: Record<string, CellValue> = { ...row.values };
        for (const [id, c] of Object.entries(computed)) values[id] = "value" in c ? c.value : null;
        return { row, values };
      });
      let filtered = withValues;
      if (q) {
        filtered = withValues.filter(({ values }) =>
          table.columns.some((c) => formatValue(c, values[c.id] ?? null, settings).toLowerCase().includes(q)),
        );
      }
      if (sort) filtered = filtered.slice().sort((a, b) => compareValues(a.values[sort.columnId], b.values[sort.columnId]) * sort.dir);
      list = filtered.map((x) => x.row);
    } else {
      // Newest first by default: what you just wrote is what you want to see.
      list = list.slice().reverse();
    }
    return list;
  }, [table, query, sort, today, settings]);

  const rename = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== table.name) dispatch({ type: "table.update", tableId: table.id, patch: { name: trimmed } }, t("table.rename"));
  };

  const removeTable = () => {
    setMenu(false);
    if (confirm(t("table.deleteConfirm", { name: table.name }))) {
      dispatch({ type: "table.delete", tableId: table.id }, t("table.delete"));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3 md:px-8 md:pt-6">
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-xl p-1 text-3xl leading-none hover:bg-zinc-100 dark:hover:bg-zinc-800" title={t("table.icon")}>
            {table.icon}
          </summary>
          <div className="absolute z-20 mt-2 grid w-56 grid-cols-5 gap-1 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            {ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                className="rounded-lg p-1.5 text-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={(e) => {
                  dispatch({ type: "table.update", tableId: table.id, patch: { icon } }, t("table.icon"));
                  e.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                {icon}
              </button>
            ))}
          </div>
        </details>
        <input
          key={table.id + table.name}
          defaultValue={table.name}
          onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="min-w-0 flex-1 rounded-lg bg-transparent px-1 text-2xl font-bold outline-none focus:ring-2 focus:ring-brand-500/30 md:text-3xl"
          aria-label={t("table.rename")}
        />
        <div className="flex items-center gap-2">
          {!mobile && (
            <Button variant="primary" onClick={() => setRecord({ rowId: null })}>
              ＋ {t("table.record")}
            </Button>
          )}
          <div className="relative">
            <Button variant="ghost" onClick={() => setMenu((m) => !m)} aria-label="Menu">
              ⋯
            </Button>
            {menu && (
              <div className="absolute right-0 z-20 mt-2 w-52 rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                <button
                  type="button"
                  className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => {
                    setMenu(false);
                    setColumn({ columnId: null });
                  }}
                >
                  ＋ {t("column.new")}
                </button>
                {table.columns.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full truncate rounded-xl px-3 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    onClick={() => {
                      setMenu(false);
                      setColumn({ columnId: c.id });
                    }}
                  >
                    ⚙ {c.name}
                  </button>
                ))}
                <hr className="my-1 border-zinc-100 dark:border-zinc-800" />
                <button type="button" className="w-full rounded-xl px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950" onClick={removeTable}>
                  {t("table.delete")}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 md:px-8">
        <div className="inline-flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
          {(["grid", "summary"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${view === v ? "bg-white shadow-sm dark:bg-zinc-950" : "text-zinc-500"}`}
            >
              {v === "grid" ? t("table.viewGrid") : t("table.viewSummary")}
            </button>
          ))}
        </div>
        {view === "grid" && table.rows.length > 0 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("common.search")}
            className={`${inputClass} !w-auto min-w-0 flex-1 !py-1.5 sm:max-w-64`}
          />
        )}
        <span className="ml-auto text-sm text-zinc-500">{t("table.count", { n: table.rows.length })}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-28 md:px-8 md:pb-8">
        {view === "summary" ? (
          <SummaryView table={table} summary={summary} />
        ) : table.rows.length === 0 && mobile ? (
          <EmptyRows onAdd={() => setRecord({ rowId: null })} />
        ) : mobile ? (
          <CardsView table={table} rows={rows} onOpenRow={(rowId) => setRecord({ rowId })} />
        ) : (
          <>
            <GridView
              table={table}
              rows={rows}
              summary={summary}
              sort={sort}
              onSort={setSort}
              onOpenRow={(rowId) => setRecord({ rowId })}
              onEditColumn={(columnId) => setColumn({ columnId })}
              onAddColumn={() => setColumn({ columnId: null })}
            />
            {table.rows.length === 0 && <EmptyRows onAdd={() => setRecord({ rowId: null })} />}
          </>
        )}
      </div>

      {mobile && (
        <button
          type="button"
          onClick={() => setRecord({ rowId: null })}
          className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 rounded-full bg-brand-600 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-brand-600/30 active:scale-95"
        >
          ＋ {t("table.record")}
        </button>
      )}

      <RecordDialog table={table} rowId={record?.rowId ?? null} open={record !== null} onClose={() => setRecord(null)} />
      <ColumnDialog table={table} columnId={column?.columnId ?? null} open={column !== null} onClose={() => setColumn(null)} />
    </div>
  );
}

function EmptyRows({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  return (
    <div className="mt-6 flex flex-col items-center gap-2 text-center">
      <div className="text-4xl">✍️</div>
      <p className="font-medium">{t("table.empty")}</p>
      <p className="max-w-xs text-sm text-zinc-500">{t("table.emptyHint")}</p>
      <Button variant="primary" className="mt-2" onClick={onAdd}>
        ＋ {t("table.record")}
      </Button>
    </div>
  );
}
