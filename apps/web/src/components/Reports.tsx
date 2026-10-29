import {
  aggregate,
  displayColumn,
  formatNumber,
  formatValue,
  localeTag,
  newId,
  type Column,
  type Report,
  type Table,
  type Workspace,
} from "@higtclass/core";
import { useEffect, useMemo, useState } from "react";
import { useT, type Translate } from "../i18n/index.ts";
import { useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { BarList, TimeChart, type Datum } from "./Charts.tsx";
import { Button, Dialog, inputClass, Label, statusColor } from "./ui.tsx";

// Reports: a saved question about one table — "revenue by client", "expenses
// by month" — answered as a chart plus the numbers, without a pivot table.

function measureColumns(ws: Workspace, table: Table): Column[] {
  return table.columns.filter((c) => {
    const shown = displayColumn(table, c, ws).type;
    return shown === "money" || shown === "number" || c.type === "formula";
  });
}

function groupColumns(table: Table): Column[] {
  return table.columns.filter((c) => ["select", "link", "text", "checkbox", "date"].includes(c.type));
}

/** Sensible first report for a table: money by the first category, else by month. */
export function suggestReport(ws: Workspace, table: Table): Omit<Report, "id" | "name"> {
  const money = measureColumns(ws, table)[0];
  const group = table.columns.find((c) => c.type === "select" || c.type === "link");
  const date = table.columns.find((c) => c.type === "date");
  const byMonth = !group && !!date;
  return {
    tableId: table.id,
    measure: money ? { agg: "sum", columnId: money.id } : { agg: "count", columnId: null },
    groupBy: byMonth ? { kind: "month", columnId: date!.id } : { kind: "column", columnId: (group ?? date ?? table.columns[0]).id },
    chart: byMonth ? "columns" : "bars",
    limit: byMonth ? 0 : 10,
  };
}

function measureLabel(t: Translate, table: Table, r: Pick<Report, "measure">) {
  const col = table.columns.find((c) => c.id === r.measure.columnId);
  if (r.measure.agg === "count" || !col) return t("report.count");
  // A sum is named after its column ("Сумма", "Выручка"); only averages need a word.
  return r.measure.agg === "avg" ? t("report.avg", { col: col.name }) : col.name;
}

function groupLabel(t: Translate, table: Table, r: Pick<Report, "groupBy">) {
  const col = table.columns.find((c) => c.id === r.groupBy.columnId);
  if (!col) return "?";
  return r.groupBy.kind === "month" ? t("report.byMonth", { col: col.name }) : col.name;
}

export function ReportDialog({ open, onClose, reportId }: { open: boolean; onClose: () => void; reportId: string | null }) {
  const t = useT();
  const ws = useStore((s) => s.ws);
  const dispatch = useStore((s) => s.dispatch);
  const openReport = useStore((s) => s.openReport);
  const activeTableId = useStore((s) => s.activeTableId);
  const existing = ws.reports?.find((r) => r.id === reportId) ?? null;
  const [draft, setDraft] = useState<Omit<Report, "id"> | null>(null);
  // While the name is the generated one, it follows the settings.
  const [customName, setCustomName] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      const tb = ws.tables.find((x) => x.id === existing.tableId);
      setCustomName(!tb || existing.name !== t("report.defaultName", { measure: measureLabel(t, tb, existing), group: groupLabel(t, tb, existing) }));
      return setDraft({ ...existing });
    }
    setCustomName(false);
    const table = ws.tables.find((tb) => tb.id === activeTableId) ?? ws.tables[0];
    setDraft(table ? { name: "", ...suggestReport(ws, table) } : null);
    // Reset only when the dialog opens.
  }, [open, reportId]);

  const table = draft ? ws.tables.find((tb) => tb.id === draft.tableId) : undefined;
  if (!open) return null;

  const set = (patch: Partial<Omit<Report, "id">>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const measures = table ? measureColumns(ws, table) : [];
  const groups = table ? groupColumns(table) : [];

  const save = () => {
    if (!draft || !table) return;
    const name = (customName && draft.name.trim()) || t("report.defaultName", { measure: measureLabel(t, table, draft), group: groupLabel(t, table, draft) });
    if (existing) {
      dispatch({ type: "report.update", reportId: existing.id, patch: { ...draft, name } }, t("report.edit"));
    } else {
      const report: Report = { ...draft, name, id: newId.report() };
      if (dispatch({ type: "report.create", report }, t("report.new"))) openReport(report.id);
    }
    onClose();
  };

  const measureValue = draft ? (draft.measure.agg === "count" ? "count" : `${draft.measure.agg}:${draft.measure.columnId}`) : "";
  const groupValue = draft ? `${draft.groupBy.kind}:${draft.groupBy.columnId}` : "";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? t("report.edit") : t("report.new")}
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
        <div className="space-y-4">
          <Label text={t("report.table")}>
            <select
              className={inputClass}
              value={draft.tableId}
              onChange={(e) => {
                const tb = ws.tables.find((x) => x.id === e.target.value)!;
                setDraft({ name: draft.name, ...suggestReport(ws, tb) });
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
          <Label text={t("report.groupBy")}>
            <select
              className={inputClass}
              value={groupValue}
              onChange={(e) => {
                const [kind, columnId] = e.target.value.split(":") as ["column" | "month", string];
                set({ groupBy: { kind, columnId }, chart: kind === "month" ? (draft.chart === "bars" ? "columns" : draft.chart) : "bars", limit: kind === "month" ? 0 : draft.limit || 10 });
              }}
            >
              {groups.map((c) =>
                c.type === "date" ? (
                  <option key={c.id} value={`month:${c.id}`}>
                    {t("report.byMonth", { col: c.name })}
                  </option>
                ) : (
                  <option key={c.id} value={`column:${c.id}`}>
                    {c.name}
                  </option>
                ),
              )}
            </select>
          </Label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="mb-1.5 block text-sm font-semibold text-ink-2">{t("report.chart")}</span>
              <div className="flex gap-1.5">
                {(["bars", "columns", "line"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={draft.chart === c}
                    onClick={() => set({ chart: c })}
                    className={`flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold ${draft.chart === c ? "border-ink bg-ink text-paper" : "border-line hover:border-ink"}`}
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
              placeholder={t("report.defaultName", { measure: measureLabel(t, table, draft), group: groupLabel(t, table, draft) })}
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
  if (!table) {
    return <p className="px-4 py-10 font-semibold text-late md:px-10">{t("report.missingTable")}</p>;
  }

  const measureCol = table.columns.find((c) => c.id === report.measure.columnId);
  const groupCol = table.columns.find((c) => c.id === report.groupBy.columnId);
  const fmt = (n: number) =>
    report.measure.agg === "count" || !measureCol ? formatNumber(n, settings.locale) : formatValue(displayColumn(table, measureCol, ws), Math.round(n * 100) / 100, settings);
  const total = groups.reduce((a, g) => a + (report.measure.agg === "count" ? g.count : g.sum), 0);
  const totalValue = report.measure.agg === "avg" ? (groups.reduce((a, g) => a + g.count, 0) ? groups.reduce((a, g) => a + g.sum, 0) / groups.reduce((a, g) => a + g.count, 0) : 0) : total;
  const shown = report.limit > 0 ? groups.slice(0, report.limit) : groups;
  const monthFmt = new Intl.DateTimeFormat(localeTag(settings.locale), { month: "short", year: "2-digit" });
  const label = (key: string) => {
    if (!key) return t("report.empty");
    if (report.groupBy.kind === "month") return monthFmt.format(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1));
    if (groupCol?.type === "checkbox") return key === "true" ? "✓" : "—";
    return key;
  };
  const share = (g: (typeof groups)[number]) => (report.measure.agg === "count" ? g.count : g.sum) / (total || 1);
  const data: Datum[] = shown.map((g) => ({
    key: g.key,
    label: label(g.key),
    value: g.value,
    detail: `${formatNumber(g.count, settings.locale)} ${t("figures.entries")} · ${Math.round(share(g) * 100)}%`,
    color: groupCol?.type === "select" ? statusColor(g.key) : null,
  }));

  const remove = () => {
    if (!confirm(t("report.deleteConfirm", { name: report.name }))) return;
    dispatch({ type: "report.delete", reportId: report.id }, t("report.delete"));
    openReport(null);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-16 md:px-10 md:pt-8">
      <div className="flex flex-wrap items-start gap-3">
        <h1 className="min-w-0 flex-1 text-[38px] leading-[0.95] font-extrabold tracking-[-0.045em] break-words md:text-[56px]">{report.name}</h1>
        <div className="flex gap-2 pt-1 md:pt-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            {t("report.edit")}
          </Button>
          <Button variant="ghost" onClick={remove}>
            {t("report.delete")}
          </Button>
        </div>
      </div>
      <button type="button" onClick={() => setActiveTable(table.id)} className="mt-3 font-semibold text-ink-2 hover:text-ink">
        {t("report.from", { table: table.name })}
      </button>

      <section className="mt-6 border-b-[3px] border-rule pb-5">
        <div className="font-display text-[34px] leading-none font-bold tracking-[-0.04em] md:text-[42px]">{fmt(totalValue)}</div>
        <div className="mt-2 text-ink-2">
          {t("report.total")}: {measureLabel(t, table, report).toLowerCase()}
        </div>
      </section>

      {groups.length === 0 ? (
        <p className="py-10 text-ink-2">{t("report.noData")}</p>
      ) : (
        <>
          <div className="pt-6">{report.chart === "bars" ? <BarList data={data} fmt={fmt} /> : <TimeChart data={data} fmt={fmt} kind={report.chart} />}</div>
          <table className="mt-8 w-full border-t-2 border-rule text-[15px]">
            <thead>
              <tr className="text-left text-sm text-ink-2">
                <th className="py-2.5 font-semibold">{groupLabel(t, table, report)}</th>
                <th className="py-2.5 text-right font-semibold">{report.measure.agg === "count" ? t("report.count") : measureLabel(t, table, report)}</th>
                <th className="py-2.5 text-right font-semibold">{t("report.share")}</th>
              </tr>
            </thead>
            <tbody>
              {(report.groupBy.kind === "month" ? [...shown].reverse() : shown).map((g) => (
                <tr key={g.key} className="border-t border-line">
                  <td className="py-2.5 font-semibold">{label(g.key)}</td>
                  <td className="py-2.5 text-right font-extrabold">{fmt(g.value)}</td>
                  <td className="py-2.5 text-right text-ink-2">{Math.round(share(g) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <ReportDialog open={editing} onClose={() => setEditing(false)} reportId={report.id} />
    </div>
  );
}
