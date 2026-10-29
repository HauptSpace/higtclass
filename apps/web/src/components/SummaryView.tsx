import {
  displayColumn,
  formatValue,
  groupBy,
  groupByMonth,
  localeTag,
  type ColumnSummary,
  type Group,
  type Table,
} from "@higtclass/core";
import { useT } from "../i18n/index.ts";
import { useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { statusColor } from "./ui.tsx";

// The answers people actually want — "how much in total, on what, per month" —
// without building a pivot table.

export function SummaryView({ table, summary }: { table: Table; summary: Record<string, ColumnSummary> }) {
  const t = useT();
  const today = useToday();
  const settings = useStore((s) => s.settings);
  const numeric = table.columns.filter((c) => summary[c.id]?.sum !== undefined);
  const valueCol = numeric[0] ?? null;
  const groupCols = table.columns.filter((c) => c.type === "select");
  const dateCol = table.columns.find((c) => c.type === "date");
  const fmt = (n: number) => (valueCol ? formatValue(displayColumn(table, valueCol), n, settings) : String(n));

  if (!numeric.length && !groupCols.length) {
    return <p className="border-t-2 border-rule py-8 text-ink-2">{t("summary.none")}</p>;
  }

  const monthLabel = (key: string) => {
    if (!key) return t("summary.empty");
    const label = new Intl.DateTimeFormat(localeTag(settings.locale), { month: "long", year: "numeric" }).format(
      new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1),
    );
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  return (
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
      {numeric.length > 0 && (
        <section className="border-t-2 border-rule pt-4 lg:col-span-2">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left text-sm text-ink-2">
                <th className="pb-2 font-semibold" />
                <th className="pb-2 text-right font-semibold">{t("summary.avg")}</th>
                <th className="pb-2 text-right font-semibold">{t("summary.max")}</th>
              </tr>
            </thead>
            <tbody>
              {numeric.map((c) => {
                const s = summary[c.id];
                const col = displayColumn(table, c);
                return (
                  <tr key={c.id} className="border-t border-line">
                    <td className="py-2.5 font-bold">{c.name}</td>
                    <td className="py-2.5 text-right">{formatValue(col, s.avg!, settings)}</td>
                    <td className="py-2.5 text-right">{formatValue(col, s.max!, settings)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {groupCols.map((g) => (
        <Bars
          key={g.id}
          title={t("summary.by", { column: g.name })}
          groups={groupBy(table, g.id, valueCol?.id ?? null, today)}
          useSum={!!valueCol}
          fmt={fmt}
          label={(k) => k || t("summary.empty")}
          colorOf={(k) => statusColor(k)}
        />
      ))}
      {dateCol && (
        <Bars title={t("summary.byMonth")} groups={groupByMonth(table, dateCol.id, valueCol?.id ?? null, today)} useSum={!!valueCol} fmt={fmt} label={monthLabel} />
      )}
    </div>
  );
}

function Bars({
  title,
  groups,
  useSum,
  fmt,
  label,
  colorOf,
}: {
  title: string;
  groups: Group[];
  useSum: boolean;
  fmt: (n: number) => string;
  label: (key: string) => string;
  colorOf?: (key: string) => string | null;
}) {
  const metric = (g: Group) => (useSum ? g.sum : g.count);
  const max = Math.max(1, ...groups.map((g) => Math.abs(metric(g))));
  return (
    <section className="border-t-2 border-rule pt-4">
      <h3 className="mb-4 text-xl font-extrabold tracking-tight">{title}</h3>
      <ul className="space-y-3.5">
        {groups.map((g) => (
          <li key={g.key}>
            <div className="mb-1.5 flex justify-between gap-3">
              <span className="truncate font-semibold">{label(g.key)}</span>
              <span className="shrink-0 font-extrabold">{useSum ? fmt(g.sum) : g.count}</span>
            </div>
            <div className="h-2.5 bg-line">
              <div className="h-full" style={{ width: `${(Math.abs(metric(g)) / max) * 100}%`, background: colorOf?.(g.key) ?? "var(--ink)" }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
