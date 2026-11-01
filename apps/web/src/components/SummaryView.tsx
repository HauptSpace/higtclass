import {
  cellText,
  dateKey,
  dateKeyLabel,
  displayColumn,
  formatNumber,
  formatValue,
  ledgerOf,
  rowFlow,
  rowSide,
  type CellValue,
  type Column,
  type ColumnSummary,
  type Table,
} from "@sumira/core";
import { useT } from "../i18n/index.ts";
import { leadColumn } from "../lib.ts";
import { useStore } from "../store.ts";
import { optionColor } from "./ui.tsx";

// The answers people actually want — "how much came in and went out, on what,
// per month and quarter" — for exactly the rows on screen, without a pivot table.

interface Group {
  key: string;
  label: string;
  value: number;
  count: number;
}

function group(values: Record<string, CellValue>[], key: (v: Record<string, CellValue>) => string, amount: (v: Record<string, CellValue>) => number | null, label: (k: string) => string) {
  const map = new Map<string, Group>();
  for (const v of values) {
    const a = amount(v);
    if (a === null) continue;
    const k = key(v);
    const g = map.get(k) ?? { key: k, label: label(k), value: 0, count: 0 };
    g.value += a;
    g.count++;
    map.set(k, g);
  }
  return [...map.values()];
}

export function SummaryView({ table, values, summary }: { table: Table; values: Record<string, CellValue>[]; summary: Record<string, ColumnSummary> }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const ws = useStore((s) => s.ws);
  const ledger = ledgerOf(table);
  const business = !!table.template && table.template !== "budget";
  const lead = leadColumn(table, ws, (c) => summary[c.id]?.sum !== undefined);
  const numeric = table.columns.filter((c) => summary[c.id]?.sum !== undefined);
  const groupCols = table.columns.filter((c) => (c.type === "select" || c.type === "link") && c.id !== ledger?.typeColumnId);
  const dateCol = table.columns.find((c) => c.type === "date");
  const leadShown = lead ? displayColumn(table, lead, ws) : null;
  const fmt = (n: number) => (leadShown ? formatValue(leadShown.type === "money" ? leadShown : { ...leadShown, type: "formula" }, Math.round(n * 100) / 100, settings) : formatNumber(n, settings.locale));
  const empty = t("summary.empty");
  const keyText = (c: Column) => (v: Record<string, CellValue>) => cellText(ws, table, c, v[c.id], settings) || "";
  const label = (k: string) => k || empty;

  if (!numeric.length && !groupCols.length) {
    return <p className="border-t-2 border-rule py-8 text-ink-2">{t("summary.none")}</p>;
  }

  const sections: React.ReactNode[] = [];

  if (ledger && dateCol) {
    const flowRows = (kind: "month" | "quarter") => {
      const map = new Map<string, { income: number; expense: number }>();
      for (const v of values) {
        const d = v[dateCol.id];
        if (typeof d !== "string") continue;
        const k = dateKey(kind, d);
        const f = rowFlow(ledger, v);
        const g = map.get(k) ?? { income: 0, expense: 0 };
        g.income += f.income;
        g.expense += f.expense;
        map.set(k, g);
      }
      return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    };
    for (const kind of ["month", "quarter"] as const) {
      const list = flowRows(kind);
      if (!list.length) continue;
      sections.push(
        <section key={`flow-${kind}`} className="border-t-2 border-rule pt-4 lg:col-span-2">
          <h3 className="mb-3 text-xl font-extrabold tracking-tight">{kind === "month" ? t("summary.flowByMonth") : t("summary.flowByQuarter")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm sm:text-[15px]">
              <thead>
                <tr className="text-left text-sm text-ink-2">
                  <th className="pb-2 font-semibold">{t("summary.period")}</th>
                  {ledger.kind !== "expense" && <th className="pb-2 text-right font-semibold">{t("figures.income")}</th>}
                  {ledger.kind !== "income" && <th className="pb-2 text-right font-semibold">{t("figures.expense")}</th>}
                  {ledger.kind === "both" && <th className="pb-2 text-right font-semibold">{business ? t("figures.profit") : t("figures.balance")}</th>}
                </tr>
              </thead>
              <tbody>
                {list.map(([k, g]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-2.5 pr-2 font-bold">{dateKeyLabel(kind, k, settings.locale)}</td>
                    {ledger.kind !== "expense" && <td className="py-2.5 text-right tabular">{fmt(g.income)}</td>}
                    {ledger.kind !== "income" && <td className="py-2.5 text-right tabular">{fmt(g.expense)}</td>}
                    {ledger.kind === "both" && <td className={`py-2.5 text-right font-extrabold tabular ${g.income - g.expense < 0 ? "text-late" : ""}`}>{fmt(g.income - g.expense)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>,
      );
    }
  } else if (numeric.length) {
    sections.push(
      <section key="stats" className="border-t-2 border-rule pt-4 lg:col-span-2">
        <div className="overflow-x-auto">
        <table className="w-full text-sm sm:text-[15px]">
          <thead>
            <tr className="text-left text-sm text-ink-2">
              <th className="pb-2 font-semibold" />
              <th className="pb-2 text-right font-semibold">{t("report.totalRow")}</th>
              <th className="pb-2 text-right font-semibold">{t("summary.avg")}</th>
              <th className="pb-2 text-right font-semibold">{t("summary.max")}</th>
            </tr>
          </thead>
          <tbody>
            {numeric.map((c) => {
              const s = summary[c.id];
              const shown = displayColumn(table, c, ws);
              const col = shown.type === "money" ? shown : { ...c, type: "formula" as const };
              return (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-2.5 font-bold">{c.name}</td>
                  <td className="py-2.5 text-right tabular">{c.type === "lookup" ? "—" : formatValue(col, s.sum!, settings)}</td>
                  <td className="py-2.5 text-right tabular">{formatValue(col, s.avg!, settings)}</td>
                  <td className="py-2.5 text-right tabular">{formatValue(col, s.max!, settings)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>,
    );
  }

  for (const g of groupCols) {
    if (ledger?.kind === "both") {
      for (const side of ["expense", "income"] as const) {
        const groups = group(values, keyText(g), (v) => (rowSide(ledger, v) === side ? rowFlow(ledger, v)[side] || null : null), label);
        if (!groups.length) continue;
        sections.push(
          <Bars
            key={`${g.id}-${side}`}
            title={t("summary.sumBy", { measure: side === "income" ? t("report.incomeOf") : t("report.expenseOf"), column: g.name })}
            groups={groups.sort((a, b) => b.value - a.value)}
            fmt={fmt}
            colorOf={(k) => (g.type === "select" ? optionColor(g, k) : null)}
          />,
        );
      }
      continue;
    }
    const amount = (v: Record<string, CellValue>) => {
      // The same rule as the number on top: only money actually received (or spent).
      if (ledger) return rowFlow(ledger, v)[ledger.kind === "expense" ? "expense" : "income"];
      if (!lead) return 1;
      const n = v[lead.id];
      return typeof n === "number" ? n : 0;
    };
    const groups = group(values, keyText(g), amount, label).sort((a, b) => b.value - a.value);
    if (!groups.length) continue;
    sections.push(
      <Bars
        key={g.id}
        title={lead ? t("summary.sumBy", { measure: lead.name, column: g.name }) : t("summary.by", { column: g.name })}
        groups={groups}
        fmt={lead ? fmt : (n) => formatNumber(n, settings.locale)}
        colorOf={(k) => (g.type === "select" ? optionColor(g, k) : null)}
      />,
    );
  }

  if (dateCol && !ledger && lead) {
    for (const kind of ["month", "quarter"] as const) {
      const groups = group(
        values,
        (v) => (typeof v[dateCol.id] === "string" ? dateKey(kind, v[dateCol.id] as string) : ""),
        (v) => (typeof v[lead.id] === "number" ? (v[lead.id] as number) : 0),
        (k) => (k ? dateKeyLabel(kind, k, settings.locale) : empty),
      ).sort((a, b) => b.key.localeCompare(a.key));
      if (groups.length) sections.push(<Bars key={kind} title={kind === "month" ? `${t("summary.byMonth")} · ${lead.name}` : `${t("summary.byQuarter")} · ${lead.name}`} groups={groups} fmt={fmt} />);
    }
  }

  return <div className="grid min-w-0 grid-cols-1 gap-x-10 gap-y-8 pb-10 lg:grid-cols-2 [&>section]:min-w-0">{sections}</div>;
}

function Bars({ title, groups, fmt, colorOf }: { title: string; groups: Group[]; fmt: (n: number) => string; colorOf?: (key: string) => string | null }) {
  const max = Math.max(1, ...groups.map((g) => Math.abs(g.value)));
  return (
    <section className="border-t-2 border-rule pt-4">
      <h3 className="mb-4 text-xl font-extrabold tracking-tight">{title}</h3>
      <ul className="space-y-3.5">
        {groups.map((g) => (
          <li key={g.key}>
            <div className="mb-1.5 flex justify-between gap-3">
              <span className="truncate font-semibold">{g.label}</span>
              <span className="shrink-0 font-extrabold tabular">{fmt(g.value)}</span>
            </div>
            <div className="h-2.5 bg-line">
              <div className="h-full" style={{ width: `${(Math.abs(g.value) / max) * 100}%`, background: colorOf?.(g.key) ?? "var(--ink)" }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
