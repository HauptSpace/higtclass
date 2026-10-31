import { cellText, computeRow, displayColumn, ledgerOf, localeTag, rowFlow, rowSide, todayISO, type Column, type Row, type Table } from "@higtclass/core";
import { useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { StatusMark } from "./GridView.tsx";

// One card per entry: what it is on the left, the amount and its status on the
// right, the date and everything else small underneath. Phones get a list,
// wide screens a grid.

/** The columns a card is built from. */
export function cardColumns(table: Table, ws: Parameters<typeof displayColumn>[2]) {
  const titleCol =
    table.columns.find((c) => c.type === "text") ?? table.columns.find((c) => c.type === "link") ?? table.columns.find((c) => c.type === "select");
  const amountCol =
    table.columns.find((c) => c.type === "money") ??
    table.columns.find((c) => (c.type === "formula" || c.type === "rollup") && displayColumn(table, c, ws).type === "money") ??
    table.columns.find((c) => c.type === "number");
  // The income/expense type is already said by the sign and colour of the amount.
  const typeId = ledgerOf(table)?.typeColumnId;
  const statusCol = table.columns.find((c) => c.type === "select" && c !== titleCol && c.id !== typeId);
  const dateCol = table.columns.find((c) => c.type === "date");
  const rest = table.columns.filter((c) => c !== titleCol && c !== amountCol && c !== statusCol && c !== dateCol && c.id !== typeId);
  return { titleCol, amountCol, statusCol, dateCol, rest };
}

export function Card({ table, row, onOpen, compact, hide, noDate }: { table: Table; row: Row; onOpen: () => void; compact?: boolean; hide?: Column; noDate?: boolean }) {
  const settings = useStore((s) => s.settings);
  const ws = useStore((s) => s.ws);
  const today = useToday();
  const { titleCol, amountCol, statusCol, dateCol, rest } = cardColumns(table, ws);
  const computed = computeRow(table, row, today, ws);
  const value = (id: string) => {
    const c = computed[id];
    if (c) return "value" in c ? c.value : null;
    return row.values[id] ?? null;
  };
  const show = (c: Column) => cellText(ws, table, c, value(c.id), settings);
  const status = statusCol && statusCol !== hide ? value(statusCol.id) : null;
  // Income and spending look different here too: +18 500 in green, −85.
  const ledger = ledgerOf(table);
  const side = ledger?.kind === "both" && amountCol?.id === ledger.amountId ? rowSide(ledger, row.values) : null;
  let amount = amountCol ? show(amountCol) : "";
  if (side && amount) amount = `${side === "income" ? "+" : "−"}${amount.replace(/^[-−]/, "")}`;
  // No description: name the entry by its category or status instead of "—".
  const fallback = table.columns.find((c) => c.type === "select" && c.id !== ledger?.typeColumnId && value(c.id));
  const details = [
    ...(dateCol && !noDate ? [show(dateCol)] : []),
    ...rest
      .filter((c) => c !== hide)
      .slice(0, compact ? 2 : 6)
      .map((c) => {
        const text = show(c);
        if (!text) return null;
        return c.type === "checkbox" ? c.name : `${c.name}: ${text}`;
      }),
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-left"
    >
      <span className="min-w-0 truncate text-[17px] font-bold">{(titleCol && show(titleCol)) || (fallback && show(fallback)) || "—"}</span>
      <span className={`text-right text-[17px] font-extrabold whitespace-nowrap tabular ${side === "income" ? "text-paid" : ""}`}>{amount}</span>
      <span className="min-w-0 truncate text-ink-2">{details.join(" · ")}</span>
      <span className="text-right text-sm">{typeof status === "string" && <StatusMark value={status} column={statusCol} />}</span>
    </button>
  );
}

export function CardsView({ table, rows, onOpenRow, grid, byDay }: { table: Table; rows: Row[]; onOpenRow: (id: string) => void; grid?: boolean; byDay?: boolean }) {
  const dateCol = table.columns.find((c) => c.type === "date");
  if (byDay && dateCol) return <DayList table={table} rows={rows} dateId={dateCol.id} onOpenRow={onOpenRow} />;
  return (
    <ul className={grid ? "grid gap-3 py-3 sm:grid-cols-2 xl:grid-cols-3" : ""}>
      {rows.map((row) => (
        <li key={row.id} className={grid ? "rounded-2xl border-2 border-line p-4 hover:border-ink" : "border-b border-line py-4 active:bg-soft"}>
          <Card table={table} row={row} onOpen={() => onOpenRow(row.id)} />
        </li>
      ))}
    </ul>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Entries under day headings — "Сьогодні", "Вчора", "чт, 29 жовтня" — with each day's total, like a bank app. */
function DayList({ table, rows, dateId, onOpenRow }: { table: Table; rows: Row[]; dateId: string; onOpenRow: (id: string) => void }) {
  const settings = useStore((s) => s.settings);
  const tag = localeTag(settings.locale);
  const ledger = ledgerOf(table);
  const today = todayISO();
  const before = new Date();
  before.setDate(before.getDate() - 1);
  const yesterday = todayISO(before);
  const groups: { day: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const d = typeof r.values[dateId] === "string" ? (r.values[dateId] as string) : "";
    const last = groups.at(-1);
    if (last && last.day === d) last.rows.push(r);
    else groups.push({ day: d, rows: [r] });
  }
  const rel = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  const title = (d: string) => {
    if (!d) return "—";
    if (d === today) return capital(rel.format(0, "day"));
    if (d === yesterday) return capital(rel.format(-1, "day"));
    return capital(new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "long" }).format(new Date(`${d}T12:00:00`)));
  };
  const money = (n: number) => new Intl.NumberFormat(tag, { style: "currency", currency: settings.currency, maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
  return (
    <div>
      {groups.map((g) => {
        let net = 0;
        if (ledger) {
          for (const r of g.rows) {
            const f = rowFlow(ledger, r.values);
            net += f.income - f.expense;
          }
        }
        return (
          <section key={g.day || "none"}>
            <h3 className="sticky top-0 z-10 flex justify-between bg-paper pt-4 pb-1 text-sm font-bold text-ink-2">
              <span>{title(g.day)}</span>
              {ledger && net !== 0 && (
                <span className="tabular">
                  {net > 0 ? "+" : "−"}
                  {money(Math.abs(net))}
                </span>
              )}
            </h3>
            <ul>
              {g.rows.map((row) => (
                <li key={row.id} className="border-b border-line py-3 active:bg-soft">
                  <Card table={table} row={row} onOpen={() => onOpenRow(row.id)} noDate />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
