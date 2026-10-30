import { cellText, computeRow, displayColumn, type Column, type Row, type Table } from "@higtclass/core";
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
  const statusCol = table.columns.find((c) => c.type === "select" && c !== titleCol);
  const dateCol = table.columns.find((c) => c.type === "date");
  const rest = table.columns.filter((c) => c !== titleCol && c !== amountCol && c !== statusCol && c !== dateCol);
  return { titleCol, amountCol, statusCol, dateCol, rest };
}

export function Card({ table, row, onOpen, compact, hide }: { table: Table; row: Row; onOpen: () => void; compact?: boolean; hide?: Column }) {
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
  const details = [
    ...(dateCol ? [show(dateCol)] : []),
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
      <span className="min-w-0 truncate text-[17px] font-bold">{titleCol ? show(titleCol) || "—" : "—"}</span>
      <span className="text-right text-[17px] font-extrabold tabular">{amountCol ? show(amountCol) : ""}</span>
      <span className="min-w-0 truncate text-ink-2">{details.join(" · ")}</span>
      <span className="text-right text-sm">{typeof status === "string" && <StatusMark value={status} column={statusCol} />}</span>
    </button>
  );
}

export function CardsView({ table, rows, onOpenRow, grid }: { table: Table; rows: Row[]; onOpenRow: (id: string) => void; grid?: boolean }) {
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
