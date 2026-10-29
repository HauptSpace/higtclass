import {
  displayColumn,
  formatDate,
  formatValue,
  groupBy,
  groupByMonth,
  localeTag,
  type Column,
  type ColumnSummary,
  type Group,
  type Table,
} from "@higtclass/core";
import { useT } from "../i18n/index.ts";
import { useToday } from "../lib.ts";
import { useStore } from "../store.ts";

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
  const asNumber = (c: Column): Column => displayColumn(table, c);
  const fmt = (n: number) => (valueCol ? formatValue(asNumber(valueCol), n, settings) : String(n));

  if (!numeric.length && !groupCols.length) {
    return <p className="rounded-2xl bg-white p-6 text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">{t("summary.none")}</p>;
  }

  const monthLabel = (key: string) => {
    if (!key) return t("summary.empty");
    const label = new Intl.DateTimeFormat(localeTag(settings.locale), { month: "long", year: "numeric" }).format(
      new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1),
    );
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {numeric.map((c) => {
          const s = summary[c.id];
          const col = asNumber(c);
          return (
            <div key={c.id} className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-sm text-zinc-500">{c.name}</div>
              <div className="tabular mt-1 text-2xl font-semibold">{formatValue(col, s.sum!, settings)}</div>
              <div className="tabular mt-2 flex gap-4 text-xs text-zinc-500">
                <span>
                  {t("summary.avg")}: {formatValue(col, s.avg!, settings)}
                </span>
                <span>
                  {t("summary.max")}: {formatValue(col, s.max!, settings)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {groupCols.map((g) => (
        <Bars key={g.id} title={t("summary.by", { column: g.name })} groups={groupBy(table, g.id, valueCol?.id ?? null, today)} useSum={!!valueCol} fmt={fmt} label={(k) => k || t("summary.empty")} />
      ))}
      {dateCol && (
        <Bars title={t("summary.byMonth")} groups={groupByMonth(table, dateCol.id, valueCol?.id ?? null, today)} useSum={!!valueCol} fmt={fmt} label={monthLabel} />
      )}
      <p className="text-center text-xs text-zinc-400">{formatDate(today, settings.locale)}</p>
    </div>
  );
}

function Bars({
  title,
  groups,
  useSum,
  fmt,
  label,
}: {
  title: string;
  groups: Group[];
  useSum: boolean;
  fmt: (n: number) => string;
  label: (key: string) => string;
}) {
  const metric = (g: Group) => (useSum ? g.sum : g.count);
  const max = Math.max(1, ...groups.map((g) => Math.abs(metric(g))));
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <ul className="space-y-2.5">
        {groups.map((g) => (
          <li key={g.key}>
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span className="truncate">{label(g.key)}</span>
              <span className="tabular shrink-0 font-medium">{useSum ? fmt(g.sum) : g.count}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${(Math.abs(metric(g)) / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
