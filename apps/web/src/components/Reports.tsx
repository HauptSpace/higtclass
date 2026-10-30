import {
  aggregate,
  dateKeyLabel,
  displayColumn,
  formatNumber,
  formatValue,
  ledgerOf,
  LOCALES,
  newId,
  pivot,
  type Column,
  type GroupKind,
  type Report,
  type Table,
  type Workspace,
} from "@higtclass/core";
import { useEffect, useMemo, useState } from "react";
import { translator, useT, type Translate } from "../i18n/index.ts";
import { periodLabel, useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { BarList, TimeChart, type Datum } from "./Charts.tsx";
import { Button, Dialog, inputClass, Label, optionColor } from "./ui.tsx";
import { FilterBar, filterText, PeriodPicker } from "./ViewControls.tsx";

// Reports: a saved question about one table — "revenue by client in Q3",
// "spending by category this year" — answered as a chart plus the numbers,
// without a pivot table.

type Draft = Omit<Report, "id">;
const DATE_KINDS: Exclude<GroupKind, "column">[] = ["week", "month", "quarter", "year"];

function measureColumns(ws: Workspace, table: Table): Column[] {
  return table.columns.filter((c) => {
    const shown = displayColumn(table, c, ws).type;
    return shown === "money" || shown === "number" || c.type === "formula" || c.type === "rollup";
  });
}

function groupColumns(table: Table): Column[] {
  return table.columns.filter((c) => ["select", "link", "lookup", "text", "checkbox", "date"].includes(c.type));
}

/** Sensible first report for a table: money by the first category, else by month. */
export function suggestReport(ws: Workspace, table: Table): Draft {
  const ledger = ledgerOf(table);
  const money = ledger ? table.columns.find((c) => c.id === ledger.amountId) : measureColumns(ws, table)[0];
  const group = table.columns.find((c) => (c.type === "select" || c.type === "link") && c.id !== ledger?.typeColumnId);
  const date = table.columns.find((c) => c.type === "date");
  const byMonth = !group && !!date;
  return {
    name: "",
    tableId: table.id,
    measure: money ? { agg: "sum", columnId: money.id } : { agg: "count", columnId: null },
    groupBy: byMonth ? { kind: "month", columnId: date!.id } : { kind: "column", columnId: (group ?? date ?? table.columns[0]).id },
    flow: ledger?.kind === "both" ? "expense" : null,
    chart: byMonth ? "columns" : "bars",
    limit: byMonth ? 0 : 10,
    filters: [],
    period: null,
    split: null,
  };
}

function measureLabel(t: Translate, table: Table, r: Pick<Report, "measure" | "flow">) {
  if (r.flow) return r.flow === "income" ? t("report.incomeOf") : t("report.expenseOf");
  const col = table.columns.find((c) => c.id === r.measure.columnId);
  if (r.measure.agg === "count" || !col) return t("report.count");
  // A sum is named after its column ("Сумма", "Выручка"); only averages need a word.
  return r.measure.agg === "avg" ? t("report.avg", { col: col.name }) : col.name;
}

function kindWord(t: Translate, kind: GroupKind) {
  return kind === "week" ? t("report.byWeek") : kind === "month" ? t("report.byMonthKind") : kind === "quarter" ? t("report.byQuarter") : t("report.byYear");
}

function groupLabel(t: Translate, table: Table, g: Report["groupBy"]) {
  const col = table.columns.find((c) => c.id === g.columnId);
  if (!col) return "?";
  if (g.kind === "column") return t("report.byCol", { col: col.name });
  const dates = table.columns.filter((c) => c.type === "date");
  // One date column: "by month". Several: say which one.
  return dates.length > 1 ? t("report.dateOption", { col: col.name, kind: kindWord(t, g.kind) }) : kindWord(t, g.kind);
}

export function generatedName(t: Translate, table: Table, r: Draft | Report): string {
  return t("report.title", { measure: measureLabel(t, table, r), group: groupLabel(t, table, r.groupBy) });
}

/** The name to show: the person's own, or one generated in the current language. */
export function reportName(t: Translate, ws: Workspace, r: Report): string {
  const table = ws.tables.find((x) => x.id === r.tableId);
  if (!table) return r.name;
  if (r.customName) return r.name;
  if (r.customName === undefined && r.name) {
    // Reports saved before names followed the language: keep a name the person typed.
    const old = LOCALES.map((l) => {
      const tl = translator(l);
      const col = table.columns.find((c) => c.id === r.measure.columnId);
      const measure = r.measure.agg === "count" || !col ? tl("report.count") : r.measure.agg === "avg" ? tl("report.avg", { col: col.name }) : col.name;
      const gcol = table.columns.find((c) => c.id === r.groupBy.columnId);
      const group = !gcol ? "?" : r.groupBy.kind === "month" ? tl("report.byMonth", { col: gcol.name }) : gcol.name;
      return tl("report.defaultName", { measure, group });
    });
    if (!old.includes(r.name)) return r.name;
  }
  return generatedName(t, table, r);
}

function groupOptions(t: Translate, table: Table) {
  const out: { value: string; label: string }[] = [];
  for (const c of groupColumns(table)) {
    if (c.type === "date") for (const k of DATE_KINDS) out.push({ value: `${k}:${c.id}`, label: t("report.dateOption", { col: c.name, kind: kindWord(t, k) }) });
    else out.push({ value: `column:${c.id}`, label: c.name });
  }
  return out;
}

export function ReportDialog({ open, onClose, reportId }: { open: boolean; onClose: () => void; reportId: string | null }) {
  const t = useT();
  const ws = useStore((s) => s.ws);
  const dispatch = useStore((s) => s.dispatch);
  const openReport = useStore((s) => s.openReport);
  const activeTableId = useStore((s) => s.activeTableId);
  const existing = ws.reports?.find((r) => r.id === reportId) ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [customName, setCustomName] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      const name = reportName(t, ws, existing);
      const tb = ws.tables.find((x) => x.id === existing.tableId);
      const custom = !!tb && name !== generatedName(t, tb, existing);
      setCustomName(custom);
      return setDraft({ ...existing, name: custom ? name : "" });
    }
    setCustomName(false);
    const table = ws.tables.find((tb) => tb.id === activeTableId) ?? ws.tables[0];
    setDraft(table ? suggestReport(ws, table) : null);
    // Reset only when the dialog opens.
  }, [open, reportId]);

  const table = draft ? ws.tables.find((tb) => tb.id === draft.tableId) : undefined;
  if (!open) return null;

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const measures = table ? measureColumns(ws, table) : [];
  const ledger = table ? ledgerOf(table) : null;
  const options = table ? groupOptions(t, table) : [];

  const save = () => {
    if (!draft || !table) return;
    const name = (customName && draft.name.trim()) || generatedName(t, table, draft);
    const full: Draft = { ...draft, name, customName: customName && !!draft.name.trim() };
    if (existing) {
      dispatch({ type: "report.update", reportId: existing.id, patch: full }, t("report.edit"));
    } else {
      const report: Report = { ...full, id: newId.report() };
      if (dispatch({ type: "report.create", report }, t("report.new"))) openReport(report.id);
    }
    onClose();
  };

  const measureValue = draft ? (draft.measure.agg === "count" ? "count" : `${draft.measure.agg}:${draft.measure.columnId}`) : "";
  const groupValue = draft ? `${draft.groupBy.kind}:${draft.groupBy.columnId}` : "";
  const splitValue = draft?.split ? `${draft.split.kind}:${draft.split.columnId}` : "";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={existing ? t("report.editTitle") : t("report.new")}
      footer={
        <>
          <div className="flex-1" />
          <Button variant="primary" onClick={save} disabled={!draft || !table}>
            {t("report.save")}
          </Button>
        </>
      }
    >
      {draft && table && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Label text={t("report.table")}>
              <select
                className={inputClass}
                value={draft.tableId}
                onChange={(e) => {
                  const tb = ws.tables.find((x) => x.id === e.target.value)!;
                  setDraft({ ...suggestReport(ws, tb), name: draft.name });
                }}
              >
                {ws.tables.map((tb) => (
                  <option key={tb.id} value={tb.id}>
                    {tb.name}
                  </option>
                ))}
              </select>
            </Label>
            <Label text={t("report.measure")}>
              <select
                className={inputClass}
                value={measureValue}
                onChange={(e) => {
                  const [agg, columnId] = e.target.value.split(":");
                  set({ measure: agg === "count" ? { agg: "count", columnId: null } : { agg: agg as "sum" | "avg", columnId } });
                }}
              >
                <option value="count">{t("report.count")}</option>
                {measures.map((c) => (
                  <option key={`sum:${c.id}`} value={`sum:${c.id}`}>
                    {t("report.sum", { col: c.name })}
                  </option>
                ))}
                {measures.map((c) => (
                  <option key={`avg:${c.id}`} value={`avg:${c.id}`}>
                    {t("report.avg", { col: c.name })}
                  </option>
                ))}
              </select>
            </Label>
            {ledger && ledger.kind === "both" && (
              <Label text={t("report.flow")}>
                <select className={inputClass} value={draft.flow ?? ""} onChange={(e) => set({ flow: (e.target.value || null) as Draft["flow"] })}>
                  <option value="">{t("report.flowAll")}</option>
                  <option value="income">{t("report.flowIncome")}</option>
                  <option value="expense">{t("report.flowExpense")}</option>
                </select>
              </Label>
            )}
            <Label text={t("report.groupBy")}>
              <select
                className={inputClass}
                value={groupValue}
                onChange={(e) => {
                  const [kind, columnId] = e.target.value.split(":") as [GroupKind, string];
                  const dated = kind !== "column";
                  set({ groupBy: { kind, columnId }, chart: dated ? (draft.chart === "bars" ? "columns" : draft.chart) : "bars", limit: dated ? 0 : draft.limit || 10 });
                }}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Label>
            <Label text={t("report.split")}>
              <select
                className={inputClass}
                value={splitValue}
                onChange={(e) => {
                  if (!e.target.value) return set({ split: null });
                  const [kind, columnId] = e.target.value.split(":") as [GroupKind, string];
                  set({ split: { kind, columnId } });
                }}
              >
                <option value="">{t("report.splitNone")}</option>
                {options
                  .filter((o) => o.value !== groupValue)
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </select>
            </Label>
          </div>

          {table.columns.some((c) => c.type === "date") && (
            <div>
              <span className="mb-1.5 block text-sm font-semibold text-ink-2">{t("report.period")}</span>
              <PeriodPicker value={draft.period ?? { kind: "all" }} onChange={(period) => set({ period: period.kind === "all" ? null : period })} />
            </div>
          )}
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-ink-2">{t("report.filters")}</span>
            <FilterBar table={table} filters={draft.filters ?? []} onChange={(filters) => set({ filters })} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="mb-1.5 block text-sm font-semibold text-ink-2">{t("report.chart")}</span>
              <div className="grid grid-cols-3 gap-1.5">
                {(["bars", "columns", "line"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={draft.chart === c}
                    onClick={() => set({ chart: c })}
                    className={`min-w-0 rounded-xl border-2 px-2 py-2 text-sm font-semibold ${draft.chart === c ? "border-ink bg-ink text-paper" : "border-line hover:border-ink"}`}
                  >
                    {t(`chart.${c}`)}
                  </button>
                ))}
              </div>
            </div>
            <Label text={t("report.limit")}>
              <select className={inputClass} value={draft.limit} onChange={(e) => set({ limit: Number(e.target.value) })}>
                <option value={0}>{t("report.limitAll")}</option>
                {[5, 10, 20].map((n) => (
                  <option key={n} value={n}>
                    {t("report.limitTop", { n })}
                  </option>
                ))}
              </select>
            </Label>
          </div>
          <Label text={t("report.name")}>
            <input
              className={inputClass}
              value={customName ? draft.name : ""}
              placeholder={generatedName(t, table, draft)}
              onChange={(e) => {
                setCustomName(e.target.value.trim() !== "");
                set({ name: e.target.value });
              }}
            />
          </Label>
        </div>
      )}
    </Dialog>
  );
}

export function ReportView({ report }: { report: Report }) {
  const t = useT();
  const today = useToday();
  const ws = useStore((s) => s.ws);
  const settings = useStore((s) => s.settings);
  const dispatch = useStore((s) => s.dispatch);
  const openReport = useStore((s) => s.openReport);
  const setActiveTable = useStore((s) => s.setActiveTable);
  const [editing, setEditing] = useState(false);
  const table = ws.tables.find((tb) => tb.id === report.tableId);

  const groups = useMemo(() => (table ? aggregate(table, report, today, ws) : []), [table, report, today, ws]);
  const matrix = useMemo(() => (table && report.split ? pivot(table, { ...report, split: report.split }, today, ws) : null), [table, report, today, ws]);
  if (!table) {
    return <p className="px-4 py-10 font-semibold text-late md:px-10">{t("report.missingTable")}</p>;
  }

  const ledger = ledgerOf(table);
  const measureCol = report.flow && ledger ? table.columns.find((c) => c.id === ledger.amountId) : table.columns.find((c) => c.id === report.measure.columnId);
  const countOnly = report.measure.agg === "count" && !report.flow;
  const fmt = (n: number) => {
    if (countOnly || !measureCol) return formatNumber(n, settings.locale);
    const shown = displayColumn(table, measureCol, ws);
    return formatValue(shown.type === "money" ? shown : { ...shown, type: "formula" }, Math.round(n * 100) / 100, settings);
  };
  const groupCol = table.columns.find((c) => c.id === report.groupBy.columnId);
  const total = groups.reduce((a, g) => a + (countOnly ? g.count : g.sum), 0);
  const count = groups.reduce((a, g) => a + g.count, 0);
  const totalValue = report.measure.agg === "avg" && !report.flow ? (count ? groups.reduce((a, g) => a + g.sum, 0) / count : 0) : total;
  const shown = report.limit > 0 && report.groupBy.kind === "column" ? groups.slice(0, report.limit) : groups;
  const keyLabel = (kind: GroupKind, col: Column | undefined) => (key: string) => {
    if (!key) return t("report.empty");
    if (kind !== "column") return dateKeyLabel(kind, key, settings.locale);
    if (col?.type === "checkbox") return key === "true" ? "✓" : "—";
    return key;
  };
  const label = keyLabel(report.groupBy.kind, groupCol);
  const share = (g: (typeof groups)[number]) => (countOnly ? g.count : g.sum) / (total || 1);
  const data: Datum[] = shown.map((g) => ({
    key: g.key,
    label: label(g.key),
    value: g.value,
    detail: `${formatNumber(g.count, settings.locale)} ${t("figures.entries")} · ${Math.round(share(g) * 100)}%`,
    color: groupCol?.type === "select" ? optionColor(groupCol, g.key) : null,
  }));
  const name = reportName(t, ws, report);
  const scopeLine = [report.period && report.period.kind !== "all" ? periodLabel(t, report.period, settings.locale) : null, ...(report.filters ?? []).map((f) => filterText(t, table, f, ws))]
    .filter(Boolean)
    .join(" · ");
  const splitCol = report.split ? table.columns.find((c) => c.id === report.split!.columnId) : undefined;
  const splitLabel = report.split ? keyLabel(report.split.kind, splitCol) : label;

  const remove = () => {
    if (!confirm(t("report.deleteConfirm", { name }))) return;
    dispatch({ type: "report.delete", reportId: report.id }, t("report.delete"));
    openReport(null);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-16 md:px-10 md:pt-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <h1 className="min-w-0 flex-1 text-[34px] leading-[0.98] font-extrabold tracking-[-0.045em] text-balance md:text-[56px]">{name}</h1>
        <div className="flex shrink-0 gap-2 md:pt-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            {t("report.edit")}
          </Button>
          <Button variant="ghost" onClick={remove}>
            {t("report.delete")}
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
        <button type="button" onClick={() => setActiveTable(table.id)} className="font-semibold hover:text-ink">
          {t("report.from", { table: table.name })}
        </button>
        {scopeLine && <span>· {scopeLine}</span>}
      </div>

      <section className="mt-6 border-b-[3px] border-rule pb-5">
        <div className="font-display text-[32px] leading-none font-bold tracking-[-0.04em] tabular md:text-[42px]">{fmt(totalValue)}</div>
        <div className="mt-2 text-ink-2">
          {t("report.total")}: {measureLabel(t, table, report)}
        </div>
      </section>

      {groups.length === 0 ? (
        <p className="py-10 text-ink-2">{t("report.noData")}</p>
      ) : (
        <>
          <div className="pt-6">{report.chart === "bars" ? <BarList data={data} fmt={fmt} /> : <TimeChart data={data} fmt={fmt} kind={report.chart} />}</div>
          {matrix ? (
            <div className="mt-8 overflow-x-auto border-t-2 border-rule">
              <table className="w-max min-w-full text-[15px]">
                <thead>
                  <tr className="text-left text-sm text-ink-2">
                    <th className="sticky left-0 bg-paper py-2.5 pr-4 font-semibold">{groupCol?.name}</th>
                    {matrix.columns.map((c) => (
                      <th key={c} className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                        {splitLabel(c)}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right font-semibold">{t("report.totalRow")}</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((r) => (
                    <tr key={r} className="border-t border-line">
                      <td className="sticky left-0 bg-paper py-2.5 pr-4 font-semibold whitespace-nowrap">{label(r)}</td>
                      {matrix.columns.map((c) => (
                        <td key={c} className="px-3 py-2.5 text-right tabular whitespace-nowrap">
                          {matrix.cells[r]?.[c] ? fmt(matrix.cells[r][c]) : <span className="text-ink-2">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right font-extrabold tabular whitespace-nowrap">{fmt(matrix.rowTotals[r] ?? 0)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-rule">
                    <td className="sticky left-0 bg-paper py-2.5 pr-4 font-extrabold">{t("report.totalRow")}</td>
                    {matrix.columns.map((c) => (
                      <td key={c} className="px-3 py-2.5 text-right font-extrabold tabular whitespace-nowrap">
                        {fmt(matrix.columnTotals[c] ?? 0)}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right font-extrabold tabular whitespace-nowrap">{fmt(matrix.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <table className="mt-8 w-full border-t-2 border-rule text-[15px]">
              <thead>
                <tr className="text-left text-sm text-ink-2">
                  <th className="py-2.5 font-semibold">{groupCol?.name}</th>
                  <th className="py-2.5 text-right font-semibold">{measureLabel(t, table, report)}</th>
                  <th className="py-2.5 text-right font-semibold">{t("report.share")}</th>
                </tr>
              </thead>
              <tbody>
                {(report.groupBy.kind !== "column" ? [...shown].reverse() : shown).map((g) => (
                  <tr key={g.key} className="border-t border-line">
                    <td className="py-2.5 font-semibold">{label(g.key)}</td>
                    <td className="py-2.5 text-right font-extrabold tabular">{fmt(g.value)}</td>
                    <td className="py-2.5 text-right text-ink-2">{Math.round(share(g) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <ReportDialog open={editing} onClose={() => setEditing(false)} reportId={report.id} />
    </div>
  );
}
