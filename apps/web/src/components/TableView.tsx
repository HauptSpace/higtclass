import {
  computedRows,
  displayColumn,
  formatNumber,
  formatValue,
  NUMERIC_TYPES,
  summarizeTable,
  type CellValue,
  type Column,
  type Table,
} from "@higtclass/core";
import { useMemo, useState } from "react";
import { useT } from "../i18n/index.ts";
import { useIsMobile, useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { AssistantBar } from "./AssistantBar.tsx";
import { CardsView } from "./CardsView.tsx";
import { ColumnDialog } from "./ColumnDialog.tsx";
import { GridView, type SortState } from "./GridView.tsx";
import { RecordDialog } from "./RecordDialog.tsx";
import { SummaryView } from "./SummaryView.tsx";
import { Button } from "./ui.tsx";

type Period = "all" | "month" | "prev" | "year";

function monthKey(iso: string, shift = 0): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(y, m - 1 + shift, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function inPeriod(date: CellValue, period: Period, today: string): boolean {
  if (period === "all") return true;
  if (typeof date !== "string") return false;
  if (period === "year") return date.slice(0, 4) === today.slice(0, 4);
  return date.slice(0, 7) === monthKey(today, period === "prev" ? -1 : 0);
}

function compare(a: CellValue | undefined, b: CellValue | undefined): number {
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

  const dateCol = table.columns.find((c) => c.type === "date") ?? null;
  const [period, setPeriod] = useState<Period>("all");
  const [view, setView] = useState<"grid" | "summary">("grid");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [record, setRecord] = useState<{ rowId: string | null } | null>(null);
  const [column, setColumn] = useState<{ columnId: string | null } | null>(null);
  const [menu, setMenu] = useState(false);

  // Rows in the chosen period, with formula values computed once.
  const scoped = useMemo(() => {
    const all = computedRows(table, today);
    const keep = table.rows.map((_, i) => !dateCol || inPeriod(all[i][dateCol.id], period, today));
    return {
      table: { ...table, rows: table.rows.filter((_, i) => keep[i]) },
      values: all.filter((_, i) => keep[i]),
      all,
    };
  }, [table, today, period, dateCol]);

  const summary = useMemo(() => summarizeTable(scoped.table, today), [scoped, today]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let pairs = scoped.table.rows.map((row, i) => ({ row, values: scoped.values[i] }));
    if (q) {
      pairs = pairs.filter(({ values }) =>
        table.columns.some((c) => formatValue(c, values[c.id] ?? null, settings).toLowerCase().includes(q)),
      );
    }
    if (sort) pairs = pairs.slice().sort((a, b) => compare(a.values[sort.columnId], b.values[sort.columnId]) * sort.dir);
    // Newest first by default: what you just wrote is what you want to see.
    else pairs = pairs.slice().reverse();
    return pairs.map((p) => p.row);
  }, [scoped, query, sort, table.columns, settings]);

  const rename = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== table.name) dispatch({ type: "table.update", tableId: table.id, patch: { name: trimmed } }, t("table.rename"));
  };

  const removeTable = () => {
    setMenu(false);
    if (confirm(t("table.deleteConfirm", { name: table.name }))) dispatch({ type: "table.delete", tableId: table.id }, t("table.delete"));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:overflow-hidden">
      <header className="px-4 pt-5 md:px-10 md:pt-8">
        <div className="flex items-start gap-3">
          <TableTitle name={table.name} onRename={rename} />
          <div className="ml-auto flex shrink-0 items-center gap-2 pt-1 md:pt-3">
            {!mobile && (
              <Button variant="primary" onClick={() => setRecord({ rowId: null })}>
                ＋ {t("table.record")}
              </Button>
            )}
            <div className="relative">
              <Button variant="outline" onClick={() => setMenu((m) => !m)} aria-label={t("table.menu")} aria-expanded={menu} className="!px-3">
                ⋯
              </Button>
              {menu && (
                <div className="absolute right-0 z-30 mt-2 w-60 rounded-xl border-2 border-ink bg-paper p-1.5 shadow-xl">
                  <div className="px-3 pt-1.5 pb-1 text-xs font-semibold text-ink-2">{t("table.columns")}</div>
                  {table.columns.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-soft"
                      onClick={() => {
                        setMenu(false);
                        setColumn({ columnId: c.id });
                      }}
                    >
                      {c.name} <span className="text-ink-2">· {t(`type.${c.type}`)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-soft"
                    onClick={() => {
                      setMenu(false);
                      setColumn({ columnId: null });
                    }}
                  >
                    ＋ {t("column.new")}
                  </button>
                  <hr className="my-1 border-line" />
                  <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-late hover:bg-soft" onClick={removeTable}>
                    {t("table.delete")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {dateCol && (
          <div className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0" role="group">
            {(["all", "month", "prev", "year"] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                className={`shrink-0 rounded-full border-2 px-3 py-1 text-sm font-semibold whitespace-nowrap transition ${period === p ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
              >
                {t(`period.${p}`)}
              </button>
            ))}
          </div>
        )}
      </header>

      <Figures table={table} scoped={scoped} summary={summary} dateCol={dateCol} period={period} today={today} />

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-10">
        <div className="flex gap-1" role="tablist">
          {(["grid", "summary"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-bold transition ${view === v ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"}`}
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
            placeholder={t("table.search")}
            aria-label={t("table.search")}
            className="ml-auto w-full rounded-full border-2 border-line bg-paper px-4 py-1.5 text-sm outline-none focus:border-ink sm:w-64"
          />
        )}
      </div>

      <div className="min-h-0 flex-1 px-4 pb-28 md:overflow-auto md:px-10 md:pb-10">
        {view === "summary" ? (
          <SummaryView table={scoped.table} summary={summary} />
        ) : (
          <div className="border-t-2 border-rule">
            <AssistantBar tableId={table.id} />
            {table.rows.length === 0 ? (
              <EmptyRows />
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-ink-2">{t("table.noMatches", { query })}</p>
            ) : mobile ? (
              <CardsView table={table} rows={rows} onOpenRow={(rowId) => setRecord({ rowId })} />
            ) : (
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
            )}
          </div>
        )}
      </div>

      {mobile && (
        <button
          type="button"
          onClick={() => setRecord({ rowId: null })}
          className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 rounded-full bg-accent px-6 py-4 text-base font-bold text-on-accent shadow-xl active:scale-95"
        >
          ＋ {t("table.record")}
        </button>
      )}

      <RecordDialog table={table} rowId={record?.rowId ?? null} open={record !== null} onClose={() => setRecord(null)} />
      <ColumnDialog table={table} columnId={column?.columnId ?? null} open={column !== null} onClose={() => setColumn(null)} />
    </div>
  );
}

/** The table name as a big headline; click to rename. Wraps instead of being cut off. */
function TableTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const cls = "min-w-0 flex-1 text-[38px] leading-[0.95] font-extrabold tracking-[-0.045em] break-words md:text-[64px]";
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={name}
        aria-label={t("table.rename")}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          onRename(e.target.value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className={`${cls} w-full rounded-lg bg-soft outline-none`}
      />
    );
  }
  return (
    <h1 className={cls}>
      <button type="button" onClick={() => setEditing(true)} title={t("table.rename")} className="text-left">
        {name}
      </button>
    </h1>
  );
}

function EmptyRows() {
  const t = useT();
  return (
    <div className="py-14 text-center">
      <p className="text-2xl font-extrabold tracking-tight">{t("table.empty")}</p>
      <p className="mx-auto mt-2 max-w-sm text-ink-2">{t("table.emptyHint")}</p>
    </div>
  );
}

function Figures({
  table,
  scoped,
  summary,
  dateCol,
  period,
  today,
}: {
  table: Table;
  scoped: { table: Table; values: Record<string, CellValue>[]; all: Record<string, CellValue>[] };
  summary: ReturnType<typeof summarizeTable>;
  dateCol: Column | null;
  period: Period;
  today: string;
}) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const numeric = table.columns.filter((c) => NUMERIC_TYPES.includes(c.type) && summary[c.id]?.sum !== undefined);
  const lead = numeric.find((c) => displayColumn(table, c).type === "money") ?? numeric[0] ?? null;

  // Daily (or monthly) bars for the lead figure.
  const bars = useMemo(() => {
    if (!lead || !dateCol || period === "all") return null;
    const byKey = new Map<string, number>();
    scoped.values.forEach((v) => {
      const d = v[dateCol.id];
      const n = v[lead.id];
      if (typeof d !== "string" || typeof n !== "number") return;
      const key = period === "year" ? d.slice(5, 7) : d.slice(8, 10);
      byKey.set(key, (byKey.get(key) ?? 0) + n);
    });
    const ym = period === "year" ? null : monthKey(today, period === "prev" ? -1 : 0);
    const count = ym ? new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate() : 12;
    const current = period === "month" ? Number(today.slice(8, 10)) : period === "year" ? Number(today.slice(5, 7)) : -1;
    return Array.from({ length: count }, (_, i) => ({
      value: byKey.get(String(i + 1).padStart(2, "0")) ?? 0,
      current: i + 1 === current,
      future: current > 0 && i + 1 > current,
    }));
  }, [lead, dateCol, period, scoped, today]);

  // Change against the previous month for "this month".
  const delta = useMemo(() => {
    if (!lead || !dateCol || period !== "month") return null;
    const prev = monthKey(today, -1);
    let sum = 0;
    let any = false;
    scoped.all.forEach((v) => {
      const d = v[dateCol.id];
      const n = v[lead.id];
      if (typeof d === "string" && d.startsWith(prev) && typeof n === "number") {
        sum += n;
        any = true;
      }
    });
    if (!any || sum === 0) return null;
    return ((summary[lead.id].sum ?? 0) - sum) / Math.abs(sum);
  }, [lead, dateCol, period, scoped, summary, today]);

  const others: { value: string; label: string }[] = [];
  others.push({ value: formatNumber(scoped.table.rows.length, settings.locale), label: t("figures.entries") });
  for (const c of numeric) {
    if (c === lead || others.length >= 3) continue;
    others.push({ value: formatValue(displayColumn(table, c), summary[c.id].sum!, settings), label: c.name });
  }
  for (const c of table.columns) {
    if (c.type !== "checkbox" || others.length >= 3) continue;
    others.push({
      value: t("figures.of", { a: summary[c.id]?.checked ?? 0, b: scoped.table.rows.length }),
      label: t("figures.checked", { name: c.name }),
    });
  }

  const maxBar = bars ? Math.max(1, ...bars.map((b) => b.value)) : 1;

  return (
    <section className="mx-4 mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-b-[3px] border-rule pb-5 md:mx-10 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
      {lead ? (
        <div className="col-span-2 md:col-span-1">
          <div className="font-display text-[34px] leading-none font-bold tracking-[-0.04em] md:text-[42px]">
            {formatValue(displayColumn(table, lead), summary[lead.id].sum ?? 0, settings)}
          </div>
          <div className="mt-2 text-ink-2">
            {lead.name}
            {delta !== null && (
              <>
                {", "}
                <b className={delta >= 0 ? "text-paid" : "text-late"}>
                  {t("figures.vsPrev", { delta: `${delta >= 0 ? "+" : "−"}${Math.round(Math.abs(delta) * 100)}%` })}
                </b>
              </>
            )}
          </div>
          {bars && (
            <div className="mt-3 flex h-9 items-end gap-[3px]" aria-hidden="true">
              {bars.map((b, i) => (
                <i
                  key={i}
                  className={`flex-1 ${b.current ? "bg-accent" : b.future ? "bg-line" : b.value ? "bg-ink" : "bg-line"}`}
                  style={{ height: `${b.future || !b.value ? 12 : Math.max(12, (b.value / maxBar) * 100)}%` }}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
      {others.map((f, i) => (
        <div key={i}>
          <div className="font-display text-[26px] leading-none font-bold tracking-[-0.04em] md:text-[32px]">{f.value}</div>
          <div className="mt-2 text-ink-2">{f.label}</div>
        </div>
      ))}
    </section>
  );
}
