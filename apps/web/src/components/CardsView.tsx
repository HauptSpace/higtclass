import { computeRow, displayColumn, formatValue, type Row, type Table } from "@higtclass/core";
import { useToday } from "../lib.ts";
import { useStore } from "../store.ts";

// Phones get cards instead of a tiny grid: the main amount big on the right,
// the title on the left, everything else as small chips underneath.

export function CardsView({ table, rows, onOpenRow }: { table: Table; rows: Row[]; onOpenRow: (id: string) => void }) {
  const settings = useStore((s) => s.settings);
  const today = useToday();
  const titleCol = table.columns.find((c) => c.type === "text") ?? table.columns.find((c) => c.type === "select");
  const amountCol =
    table.columns.find((c) => c.type === "money") ??
    table.columns.find((c) => c.type === "formula") ??
    table.columns.find((c) => c.type === "number");
  const dateCol = table.columns.find((c) => c.type === "date");
  const rest = table.columns.filter((c) => c !== titleCol && c !== amountCol && c !== dateCol);

  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const computed = computeRow(table, row, today);
        const value = (id: string) => {
          const c = computed[id];
          if (c) return "value" in c ? c.value : null;
          return row.values[id] ?? null;
        };
        return (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onOpenRow(row.id)}
              className="w-full rounded-2xl bg-white p-4 text-left ring-1 ring-zinc-200 active:scale-[0.99] dark:bg-zinc-900 dark:ring-zinc-800"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {titleCol ? formatValue(titleCol, value(titleCol.id), settings) || "—" : "—"}
                  </div>
                  {dateCol && <div className="text-xs text-zinc-500">{formatValue(dateCol, value(dateCol.id), settings)}</div>}
                </div>
                {amountCol && (
                  <div className="tabular shrink-0 text-lg font-semibold">
                    {formatValue(displayColumn(table, amountCol), value(amountCol.id), settings)}
                  </div>
                )}
              </div>
              {rest.some((c) => value(c.id) !== null) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {rest.map((c) => {
                    const text = formatValue(displayColumn(table, c), value(c.id), settings);
                    if (!text) return null;
                    return (
                      <span key={c.id} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {c.type === "checkbox" ? `${c.name} ✓` : `${c.name}: ${text}`}
                      </span>
                    );
                  })}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
