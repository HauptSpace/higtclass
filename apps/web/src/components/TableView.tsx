import {
  computedRows,
  displayColumn,
  formatDate,
  formatDateNumeric,
  formatNumber,
  formatValue,
  FLOW_FILTER,
  goalProgress,
  ledgerOf,
  ledgerTotals,
  newId,
  periodColumn,
  previousPeriod,
  scopeRows,
  summarizeValues,
  type CellValue,
  type Column,
  type ColumnSummary,
  type SavedView,
  type Table,
  type ViewMode,
} from "@higtclass/core";
import { useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { exportCsv, exportXlsx } from "../exporter.ts";
import { leadColumn, periodLabel, useCellText, useIsMobile, useToday } from "../lib.ts";
import { DEFAULT_UI, useStore, useTableUi, type TableUi } from "../store.ts";
import { AssistantBar } from "./AssistantBar.tsx";
import { BoardView, boardColumnsOf, CalendarView } from "./BoardCalendar.tsx";
import { CardsView } from "./CardsView.tsx";
import { ColumnDialog } from "./ColumnDialog.tsx";
import { DeadlineBanner } from "./ForYou.tsx";
import { GridView, type SortState } from "./GridView.tsx";
import { ImportDialog } from "./ImportDialog.tsx";
import { RecordDialog } from "./RecordDialog.tsx";
import { SummaryView } from "./SummaryView.tsx";
import { GoalDialog, LedgerDialog } from "./TableSettings.tsx";
import { Button, useDismiss } from "./ui.tsx";
import { FilterBar, FlowSwitch, PeriodPicker } from "./ViewControls.tsx";

function compare(a: CellValue | undefined, b: CellValue | undefined): number {
  const empty = (v: CellValue | undefined) => v === null || v === undefined || v === "";
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

const SUMMABLE = (s: Record<string, ColumnSummary>) => (c: Column) => s[c.id]?.sum !== undefined;

function sameView(ui: TableUi, v: SavedView) {
  return JSON.stringify(ui.filters) === JSON.stringify(v.filters) && JSON.stringify(ui.period) === JSON.stringify(v.period ?? DEFAULT_UI.period) && (ui.mode === (v.mode ?? "grid"));
}

export function TableView({ table }: { table: Table }) {
  const t = useT();
  const today = useToday();
  const mobile = useIsMobile();
  const settings = useStore((s) => s.settings);
  const ws = useStore((s) => s.ws);
  const dispatch = useStore((s) => s.dispatch);
  const showToast = useStore((s) => s.showToast);
  const setUiRaw = useStore((s) => s.setUi);
  const ui = useTableUi(table.id);
  const setUi = (patch: Partial<TableUi>) => setUiRaw(table.id, patch);
  const text = useCellText();

  const dateCol = periodColumn(table, ui.period) ?? null;
  const [query, setQuery] = useState("");
  const [record, setRecord] = useState<{ rowId: string | null; preset?: Record<string, string>; linked?: { tableId: string; rowId: string } } | null>(null);
  const [column, setColumn] = useState<{ columnId: string | null } | null>(null);
  const [dialog, setDialog] = useState<"ledger" | "goal" | "import" | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, menu, () => setMenu(false));

  // Every row computed once; then the period and filters; then the search.
  const all = useMemo(() => computedRows(table, today, ws), [table, today, ws]);
  const scoped = useMemo(() => scopeRows(table, all, { filters: ui.filters, period: ui.period }, today, ws), [table, all, ui.filters, ui.period, today, ws]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? (v: Record<string, CellValue>) => table.columns.some((c) => text(table, c, v[c.id]).toLowerCase().includes(q)) : null;
  }, [query, table, text]);
  const visible = useMemo(() => {
    let idx = scoped;
    if (matches) idx = idx.filter((i) => matches(all[i]));
    if (ui.sort) {
      const { columnId, dir } = ui.sort;
      idx = idx.slice().sort((a, b) => compare(all[a][columnId], all[b][columnId]) * dir);
    } else {
      // By date when there is one (entries for yesterday below today's), else in the order written;
      // newest first by default: what you just wrote is what you want to see.
      const date = table.columns.find((c) => c.type === "date");
      const order = idx.slice();
      if (date) order.sort((a, b) => compare(all[a][date.id], all[b][date.id]) || a - b);
      idx = ui.oldestFirst ? order : order.reverse();
    }
    return idx;
  }, [scoped, matches, ui.sort, ui.oldestFirst, table, all]);
  const rows = useMemo(() => visible.map((i) => table.rows[i]), [visible, table.rows]);
  const values = useMemo(() => visible.map((i) => all[i]), [visible, all]);
  const summary = useMemo(() => summarizeValues(table, values), [table, values]);

  const filtered = ui.filters.length > 0 || ui.period.kind !== "all" || query.trim() !== "";

  const rename = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== table.name) dispatch({ type: "table.update", tableId: table.id, patch: { name: trimmed } }, t("table.rename"));
  };

  const removeTable = () => {
    setMenu(false);
    if (confirm(t("table.deleteConfirm", { name: table.name }))) dispatch({ type: "table.delete", tableId: table.id }, t("table.delete"));
  };

  const saveView = () => {
    const name = prompt(t("view.namePrompt"))?.trim();
    if (!name) return;
    const view: SavedView = { id: newId.report().replace(/^p_/, "v_"), name, filters: ui.filters, period: ui.period, sort: ui.sort ?? undefined, mode: ui.mode === "summary" ? "grid" : ui.mode };
    if (dispatch({ type: "table.update", tableId: table.id, patch: { views: [...(table.views ?? []), view] } }, t("view.save"))) setUi({ viewId: view.id });
  };
  const deleteView = (id: string) => {
    dispatch({ type: "table.update", tableId: table.id, patch: { views: (table.views ?? []).filter((v) => v.id !== id) } }, t("view.delete"));
    setUi({ viewId: null });
  };
  const activeView = table.views?.find((v) => v.id === ui.viewId);
  const viewDirty = activeView ? !sameView(ui, activeView) : ui.filters.length > 0 || ui.period.kind !== "all";

  const modes: (ViewMode | "summary")[] = ["grid", "cards"];
  if (boardColumnsOf(table).length) modes.push("board");
  if (table.columns.some((c) => c.type === "date")) modes.push("calendar");
  modes.push("summary");
  const mode = modes.includes(ui.mode) ? ui.mode : "grid";

  const exportShown = (kind: "xlsx" | "csv") => {
    setMenu(false);
    const opts = { rows, values, title: filtered ? `${table.name} — ${periodLabel(t, ui.period, settings.locale)}` : table.name, t };
    if (kind === "xlsx") void exportXlsx(ws, table, settings, opts);
    else exportCsv(ws, table, settings, opts);
  };

  const menuItem = "w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-soft";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:overflow-hidden">
      <DeadlineBanner />
      <header className="px-4 pt-5 md:px-10 md:pt-7">
        <div className="flex items-start gap-3">
          <TableTitle name={table.name} onRename={rename} />
          <div className="ml-auto flex shrink-0 items-center gap-2 pt-1 md:pt-3">
            {!mobile && (
              <Button variant="primary" onClick={() => setRecord({ rowId: null })}>
                ＋ {t("table.record")}
              </Button>
            )}
            <div className="relative" ref={menuRef}>
              <Button variant="outline" onClick={() => setMenu((m) => !m)} aria-label={t("table.menu")} aria-expanded={menu} className="!px-3">
                ⋯
              </Button>
              {menu && (
                <div className="absolute right-0 z-40 mt-2 max-h-[70dvh] w-64 overflow-y-auto rounded-xl border-2 border-ink bg-paper p-1.5 shadow-xl">
                  <div className="px-3 pt-1.5 pb-1 text-xs font-semibold text-ink-2">{t("table.settings")}</div>
                  <button type="button" className={menuItem} onClick={() => (setMenu(false), setDialog("ledger"))}>
                    {t("table.money")}
                  </button>
                  {ledgerOf(table)?.kind !== "income" && (
                    <button type="button" className={menuItem} onClick={() => (setMenu(false), setDialog("goal"))}>
                      {t("table.goal")}
                    </button>
                  )}
                  <hr className="my-1 border-line" />
                  <div className="px-3 pt-1.5 pb-1 text-xs font-semibold text-ink-2">{t("table.columns")}</div>
                  {table.columns.map((c) => (
                    <button key={c.id} type="button" className={`${menuItem} truncate`} onClick={() => (setMenu(false), setColumn({ columnId: c.id }))}>
                      {c.name} <span className="text-ink-2">· {t(`type.${c.type}`)}</span>
                    </button>
                  ))}
                  <button type="button" className={`${menuItem} font-semibold`} onClick={() => (setMenu(false), setColumn({ columnId: null }))}>
                    ＋ {t("column.new")}
                  </button>
                  <hr className="my-1 border-line" />
                  <div className="px-3 pt-1.5 pb-1 text-xs font-semibold text-ink-2">{t("table.file")}</div>
                  <button type="button" className={menuItem} onClick={() => exportShown("xlsx")}>
                    {t("table.exportXlsx")}
                  </button>
                  <button type="button" className={menuItem} onClick={() => exportShown("csv")}>
                    {t("table.exportCsv")}
                  </button>
                  {filtered && <p className="px-3 pb-1 text-xs text-ink-2">{t("table.exportShown", { n: rows.length })}</p>}
                  <button type="button" className={menuItem} onClick={() => (setMenu(false), setDialog("import"))}>
                    {t("table.importHere")}
                  </button>
                  <hr className="my-1 border-line" />
                  <button type="button" className={`${menuItem} font-semibold text-late`} onClick={removeTable}>
                    {t("table.delete")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {(table.views?.length ?? 0) > 0 && (
          <div className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist" aria-label={t("view.save")}>
            <button
              type="button"
              role="tab"
              aria-selected={!activeView}
              onClick={() => setUi({ viewId: null, filters: [], period: { kind: "all" } })}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold ${!activeView ? "bg-soft text-ink" : "text-ink-2 hover:text-ink"}`}
            >
              {t("view.all")}
            </button>
            {table.views!.map((v) => (
              <span key={v.id} className={`flex shrink-0 items-center rounded-lg ${activeView?.id === v.id ? "bg-soft" : ""}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeView?.id === v.id}
                  onClick={() => setUi({ viewId: v.id, filters: v.filters, period: v.period ?? { kind: "all" }, sort: v.sort ?? null, mode: v.mode ?? "grid" })}
                  className={`px-3 py-1.5 text-sm font-bold ${activeView?.id === v.id ? "text-ink" : "text-ink-2 hover:text-ink"}`}
                >
                  {v.name}
                </button>
                {activeView?.id === v.id && (
                  <button type="button" aria-label={t("view.delete")} title={t("view.delete")} onClick={() => deleteView(v.id)} className="pr-2 text-sm text-ink-2 hover:text-late">
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {dateCol && (
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
              <PeriodPicker value={ui.period} onChange={(period) => setUi({ period })} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <FlowSwitch table={table} filters={ui.filters} onChange={(filters) => setUi({ filters })} />
            <FilterBar table={table} filters={ui.filters} onChange={(filters) => setUi({ filters })} />
            {viewDirty && (
              <button type="button" onClick={saveView} className="text-sm font-semibold text-ink-2 underline underline-offset-4 hover:text-ink">
                {t("view.save")}
              </button>
            )}
          </div>
        </div>
      </header>

      <Figures table={table} values={values} all={all} ui={ui} summary={summary} today={today} onGoal={() => setDialog("goal")} matches={matches} />

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-10">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist">
          {modes
            .filter((m) => !(mobile && m === "cards"))
            .map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={mode === v}
                onClick={() => setUi({ mode: v })}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-bold transition ${mode === v ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"}`}
              >
                {t(`view.${v}`)}
              </button>
            ))}
        </div>
        {mode !== "summary" && table.rows.length > 0 && (
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

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-28 md:px-10 md:pb-6">
        {mode === "summary" ? (
          <div className="min-h-0 flex-1 md:overflow-y-auto">
            <SummaryView table={table} values={values} summary={summary} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col border-t-2 border-rule">
            <AssistantBar tableId={table.id} onEdit={(preset) => setRecord({ rowId: null, preset })} />
            {table.rows.length === 0 && (mobile || mode !== "grid") ? (
              <EmptyRows />
            ) : rows.length === 0 && mode === "grid" && !mobile ? (
              <>
                <GridView
                  table={table}
                  rows={rows}
                  summary={summary}
                  sort={ui.sort}
                  onSort={(sort: SortState) => setUi({ sort })}
                  oldestFirst={!!ui.oldestFirst}
                  onToggleOrder={() => setUi({ oldestFirst: !ui.oldestFirst, sort: null })}
                  onOpenRow={(rowId) => setRecord({ rowId })}
                  onOpenLinked={(tableId, rowId) => setRecord({ rowId: null, linked: { tableId, rowId } })}
                  onEditColumn={(columnId) => setColumn({ columnId })}
                  onAddColumn={() => setColumn({ columnId: null })}
                />
                {table.rows.length === 0 ? <EmptyRows /> : <p className="py-6 text-center text-ink-2">{t("table.noMatches")}</p>}
              </>
            ) : rows.length === 0 && mode !== "calendar" && mode !== "board" ? (
              <p className="py-10 text-center text-ink-2">{t("table.noMatches")}</p>
            ) : mode === "board" ? (
              <BoardView table={table} rows={rows} columnId={ui.boardColumnId} onColumn={(id) => setUi({ boardColumnId: id })} onOpenRow={(rowId) => setRecord({ rowId })} />
            ) : mode === "calendar" ? (
              <div className="min-h-0 flex-1 md:overflow-y-auto">
                <CalendarView
                  table={table}
                  rows={rows}
                  period={ui.period}
                  onOpenRow={(rowId) => setRecord({ rowId })}
                  onNewAt={(date) => {
                    const col = table.columns.find((c) => c.type === "date");
                    setRecord({ rowId: null, preset: col ? { [col.id]: formatDateNumeric(date, settings.locale) } : undefined });
                  }}
                />
              </div>
            ) : mobile || mode === "cards" ? (
              <div className="min-h-0 flex-1 md:overflow-y-auto">
                <CardsView table={table} rows={rows} onOpenRow={(rowId) => setRecord({ rowId })} grid={!mobile} />
              </div>
            ) : (
              <GridView
                table={table}
                rows={rows}
                summary={summary}
                sort={ui.sort}
                onSort={(sort: SortState) => setUi({ sort })}
                oldestFirst={!!ui.oldestFirst}
                onToggleOrder={() => {
                  setUi({ oldestFirst: !ui.oldestFirst, sort: null });
                  showToast(!ui.oldestFirst ? t("grid.oldestFirst") : t("grid.newestFirst"), false);
                }}
                onOpenRow={(rowId) => setRecord({ rowId })}
                onOpenLinked={(tableId, rowId) => setRecord({ rowId: null, linked: { tableId, rowId } })}
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

      <RecordDialog table={table} rowId={record?.rowId ?? null} preset={record?.preset} linked={record?.linked ?? null} open={record !== null} onClose={() => setRecord(null)} />
      <ColumnDialog table={table} columnId={column?.columnId ?? null} open={column !== null} onClose={() => setColumn(null)} />
      <LedgerDialog table={table} open={dialog === "ledger"} onClose={() => setDialog(null)} />
      <GoalDialog table={table} open={dialog === "goal"} onClose={() => setDialog(null)} />
      <ImportDialog open={dialog === "import"} onClose={() => setDialog(null)} targetTableId={table.id} />
    </div>
  );
}

/** The table name as a big headline; click to rename. Wraps between words, not inside numbers. */
function TableTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const cls = "min-w-0 flex-1 text-[34px] leading-[0.98] font-extrabold tracking-[-0.045em] text-balance md:text-[60px]";
  // "Відпустка 30 000" must not break inside the number.
  const shown = name.replace(/(\d)\s(?=\d{3}\b)/g, "$1 ");
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
        {shown}
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

function Figure({ value, label, big, tone }: { value: string; label: React.ReactNode; big?: boolean; tone?: "late" | "paid" }) {
  return (
    <div className={`min-w-0 ${big ? "col-span-2 md:col-span-1" : ""}`}>
      <div
        className={`font-display leading-none font-bold tracking-[-0.04em] whitespace-nowrap tabular ${big ? "text-[30px] md:text-[42px]" : "text-[19px] sm:text-[24px] md:text-[30px]"} ${tone === "late" ? "text-late" : ""}`}
      >
        {value}
      </div>
      <div className="mt-2 text-ink-2">{label}</div>
    </div>
  );
}

function Figures({
  table,
  values,
  all,
  ui,
  summary,
  today,
  onGoal,
  matches,
}: {
  matches: ((v: Record<string, CellValue>) => boolean) | null;
  table: Table;
  values: Record<string, CellValue>[];
  all: Record<string, CellValue>[];
  ui: TableUi;
  summary: Record<string, ColumnSummary>;
  today: string;
  onGoal: () => void;
}) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const ws = useStore((s) => s.ws);
  const dispatch = useStore((s) => s.dispatch);
  const [choosing, setChoosing] = useState(false);
  const chooseRef = useRef<HTMLDivElement>(null);
  useDismiss(chooseRef, choosing, () => setChoosing(false));
  const ledger = ledgerOf(table);
  // A list that other tables point to (products, staff, clients) has prices and rates, not amounts:
  // adding them up means nothing. Show how many there are and what's below zero instead.
  const catalog = !ledger && !table.figure && !table.columns.some((c) => c.type === "date") && ws.tables.some((x) => x.columns.some((c) => c.type === "link" && c.linkTableId === table.id));
  const lead = catalog ? null : leadColumn(table, ws, SUMMABLE(summary));
  const money = (n: number) => formatNumber(n, settings.locale, (lead && displayColumn(table, lead, ws).currency) || settings.currency);
  const prevKind = previousPeriod(ui.period.kind);

  // The same filters over the previous period, for "vs last month".
  const prevValues = useMemo(() => {
    if (!prevKind) return null;
    const idx = scopeRows(table, all, { filters: ui.filters, period: { ...ui.period, kind: prevKind } }, today, ws);
    const list = idx.map((i) => all[i]);
    // The search applies to last month too, so "coffee vs last month" compares coffee with coffee.
    return matches ? list.filter(matches) : list;
  }, [prevKind, table, all, ui.filters, ui.period, today, ws, matches]);

  const delta = (now: number, before: number | null) => {
    if (before === null || before === 0) return null;
    const d = (now - before) / Math.abs(before);
    return Math.abs(d) < 0.005 ? null : d;
  };
  const vsKey = ui.period.kind === "quarter" ? "figures.vsPrevQuarter" : ui.period.kind === "year" ? "figures.vsPrevYear" : "figures.vsPrev";
  // ", +12% vs last month" — or nothing at all (no stray comma) when there's nothing to compare.
  const deltaText = (d: number | null, upIsGood: boolean) =>
    d === null ? null : (
      <>
        {", "}
        <b className={(d >= 0) === upIsGood ? "text-paid" : "text-late"}>{t(vsKey, { delta: `${d >= 0 ? "+" : "−"}${Math.round(Math.abs(d) * 100)}%` })}</b>
      </>
    );

  const items: React.ReactNode[] = [];

  if (table.goal) {
    const p = goalProgress(table.goal, all, today, ledger);
    const goalMoney = (n: number) => formatNumber(n, settings.locale, displayColumn(table, table.columns.find((c) => c.id === table.goal!.columnId) ?? table.columns[0], ws).currency || settings.currency);
    items.push(
      <div key="goal" className="col-span-2 md:col-span-2">
        <button type="button" onClick={onGoal} className="w-full text-left">
          <div className="font-display text-[26px] leading-tight font-bold tracking-[-0.04em] md:text-[42px]">{t("goal.of", { saved: goalMoney(p.saved), amount: goalMoney(p.amount) })}</div>
          <div className="mt-3 h-3 bg-line" aria-hidden="true">
            <div className="h-full bg-accent" style={{ width: `${p.share * 100}%` }} />
          </div>
          <div className="mt-2 text-ink-2">
            {p.left === 0 ? (
              <b className="text-paid">{t("goal.done")}</b>
            ) : (
              <>
                <b className="text-ink">{t("goal.left", { left: goalMoney(p.left) })}</b>
                {p.perMonth !== undefined && table.goal.date && (
                  <> · {t("goal.perMonth", { sum: goalMoney(Math.ceil(p.perMonth)), date: formatDate(table.goal.date, settings.locale) })}</>
                )}
              </>
            )}
          </div>
        </button>
      </div>,
    );
  } else if (table.template === "savings") {
    items.push(
      <div key="goal" className="col-span-2">
        <p className="text-ink-2">{t("goal.prompt")}</p>
        <Button variant="primary" className="mt-3" onClick={onGoal}>
          {t("goal.set")}
        </Button>
      </div>,
    );
  }

  if (ledger) {
    const now = ledgerTotals(ledger, values);
    const before = prevValues ? ledgerTotals(ledger, prevValues) : null;
    const business = !!table.template && table.template !== "budget";
    const only = ui.filters.find((f) => f.columnId === FLOW_FILTER)?.values?.[0] as "income" | "expense" | undefined;
    if (ledger.kind === "both" && only) {
      // "Expenses only": the big number is what was spent, not a scary red "loss".
      items.push(
        <Figure
          key="side"
          big={!table.goal}
          value={money(now[only])}
          label={<>{only === "income" ? t("figures.income") : t("figures.expense")}{before && deltaText(delta(now[only], before[only]), only === "income")}</>}
        />,
      );
    } else if (ledger.kind === "both") {
      items.push(
        <Figure
          key="bal"
          big={!table.goal}
          value={money(now.balance)}
          tone={now.balance < 0 ? "late" : undefined}
          label={
            <>
              {business ? (now.balance < 0 ? t("figures.loss") : t("figures.profit")) : t("figures.balance")}
              {before && deltaText(delta(now.balance, before.balance), true)}
            </>
          }
        />,
        <Figure key="in" value={money(now.income)} label={<>{t("figures.income")}{before && deltaText(delta(now.income, before.income), true)}</>} />,
        <Figure key="out" value={money(now.expense)} label={<>{t("figures.expense")}{before && deltaText(delta(now.expense, before.expense), false)}</>} />,
      );
    } else {
      const side = ledger.kind;
      const v = now[side];
      items.push(
        <Figure
          key="lead"
          big={!table.goal}
          value={money(v)}
          label={
            <>
              {side === "income" ? t("figures.income") : t("figures.expense")}
              {before && deltaText(delta(v, before[side]), side === "income")}
            </>
          }
        />,
      );
      if (now.pendingCount) items.push(<Figure key="pending" value={money(now.pending)} label={t("figures.pendingOf", { n: now.pendingCount })} tone="late" />);
    }
  } else if (lead && !table.goal) {
    const sum = summary[lead.id]?.sum ?? 0;
    const prevSum = prevValues ? prevValues.reduce((a, v) => a + (typeof v[lead.id] === "number" ? (v[lead.id] as number) : 0), 0) : null;
    items.push(
      <div key="lead" ref={chooseRef} className="relative col-span-2 min-w-0 md:col-span-1">
        <div className="font-display text-[30px] leading-none font-bold tracking-[-0.04em] whitespace-nowrap tabular md:text-[42px]">
          {formatValue(displayColumn(table, lead, ws), sum, settings)}
        </div>
        <div className="mt-2 text-ink-2">
          <button type="button" onClick={() => setChoosing((c) => !c)} className="underline decoration-line decoration-2 underline-offset-4 hover:text-ink" title={t("figures.choose")}>
            {lead.name} ▾
          </button>
          {prevSum !== null && deltaText(delta(sum, prevSum), true)}
        </div>
        {choosing && (
          <div className="absolute z-30 mt-2 w-60 rounded-xl border-2 border-ink bg-paper p-1.5 shadow-xl">
            <div className="px-3 pt-1 pb-1 text-xs font-semibold text-ink-2">{t("figures.choose")}</div>
            {table.columns
              .filter(SUMMABLE(summary))
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    dispatch({ type: "table.update", tableId: table.id, patch: { figure: c.id } }, t("figures.choose"));
                    setChoosing(false);
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-soft ${c.id === lead.id ? "font-bold" : ""}`}
                >
                  {c.name}
                </button>
              ))}
          </div>
        )}
      </div>,
    );
  }

  const room = 4 - items.length;
  const others: { value: string; label: string }[] = [];
  if (room > 0) others.push({ value: formatNumber(values.length, settings.locale), label: t("figures.entries") });
  if (catalog) {
    for (const c of table.columns) {
      if (others.length >= room || (c.type !== "formula" && c.type !== "rollup")) continue;
      const below = values.filter((v) => typeof v[c.id] === "number" && (v[c.id] as number) < 0).length;
      if (below) others.push({ value: formatNumber(below, settings.locale), label: t("figures.belowZero", { column: c.name }) });
    }
  }
  for (const c of table.columns) {
    if (others.length >= room || catalog) break;
    if (c === lead || c.id === ledger?.amountId || summary[c.id]?.sum === undefined || c.type === "lookup") continue;
    // Unit prices pulled from a link don't add up to anything meaningful.
    others.push({ value: formatValue(displayColumn(table, c, ws).type === "money" ? displayColumn(table, c, ws) : { ...c, type: c.type === "number" ? "number" : "formula" }, summary[c.id].sum!, settings), label: c.name });
  }
  for (const c of table.columns) {
    if (c.type !== "checkbox" || others.length >= room || c.id === ledger?.paidColumnId) continue;
    others.push({ value: t("figures.of", { a: summary[c.id]?.checked ?? 0, b: values.length }), label: t("figures.checked", { name: c.name }) });
  }

  if (!items.length && !others.length) return null;
  return (
    <section className="mx-4 mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-b-[3px] border-rule pb-5 md:mx-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
      {items}
      {others.map((f, i) => (
        <Figure key={`o${i}`} value={f.value} label={f.label} />
      ))}
    </section>
  );
}
