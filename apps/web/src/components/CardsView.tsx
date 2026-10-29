import { computeRow, displayColumn, formatValue, type Row, type Table } from "@higtclass/core";
import { useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { StatusMark } from "./GridView.tsx";

// Phones get one line per entry: what it is on the left, the amount and its
// status on the right, everything else small underneath.

export function CardsView({ table, rows, onOpenRow }: { table: Table; rows: Row[]; onOpenRow: (id: string) => void }) {
  const settings = useStore((s) => s.settings);
  const today = useToday();
  const titleCol = table.columns.find((c) => c.type === "text") ?? table.columns.find((c) => c.type === "select");
  const amountCol =
    table.columns.find((c) => c.type === "money") ??
    table.columns.find((c) => c.type === "formula") ??
    table.columns.find((c) => c.type === "number");
  const statusCol = table.columns.find((c) => c.type === "select" && c !== titleCol);
  const rest = table.columns.filter((c) => c !== titleCol && c !== amountCol && c !== statusCol);

  return (
    <ul>
      {rows.map((row) => {
        const computed = computeRow(table, row, today);
        const value = (id: string) => {
          const c = computed[id];
          if (c) return "value" in c ? c.value : null;
          return row.values[id] ?? null;
        };
        const status = statusCol ? value(statusCol.id) : null;
        const details = rest
          .map((c) => {
            const text = formatValue(displayColumn(table, c), value(c.id), settings);
            if (!text) return null;
            return c.type === "checkbox" ? c.name : c.type === "date" ? text : `${c.name}: ${text}`;
          })
          .filter(Boolean);
        return (
          <li key={row.id}>
            <button type="button" onClick={() => onOpenRow(row.id)} className="grid w-full grid-cols-[1fr_auto] gap-x-4 border-b border-line py-4 text-left active:bg-soft">
              <span className="min-w-0 truncate text-[17px] font-bold">
                {titleCol ? formatValue(titleCol, value(titleCol.id), settings) || "—" : "—"}
              </span>
              <span className="text-right text-[17px] font-extrabold">
                {amountCol ? formatValue(displayColumn(table, amountCol), value(amountCol.id), settings) : ""}
              </span>
              <span className="min-w-0 truncate text-ink-2">{details.join(" · ")}</span>
              <span className="text-right text-sm">{typeof status === "string" && <StatusMark value={status} />}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
