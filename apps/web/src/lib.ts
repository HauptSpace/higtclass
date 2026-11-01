import {
  cellText,
  displayColumn,
  editableValue,
  formatDate,
  formatDateNumeric,
  ledgerOf,
  rowLabel,
  rowValues,
  todayISO,
  type CellValue,
  type Column,
  type Locale,
  type Period,
  type Problem,
  type Table,
  type Workspace,
} from "@sumira/core";
import { useCallback, useEffect, useState } from "react";
import { useT, type Translate } from "./i18n/index.ts";
import { useStore } from "./store.ts";

export function problemText(t: Translate, p: Problem): string {
  return t(`problem.${p.reason}`, { column: p.column ?? "", input: String(p.input ?? "") });
}

/** Text to put in an editor for a stored value. */
export function draftOf(column: Column, value: CellValue | undefined, locale: Parameters<typeof editableValue>[2]): string {
  if (column.type === "checkbox") return value ? "1" : "";
  if (column.type === "link") return typeof value === "string" ? value : "";
  // Dates are edited the way people write them: 03.10.2026, not 2026-10-03.
  if (column.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDateNumeric(value, locale);
  return editableValue(column, value ?? null, locale);
}

/** Today's date, refreshed when the day changes while the app is open. */
export function useToday(): string {
  const [today, setToday] = useState(() => todayISO());
  useEffect(() => {
    const id = setInterval(() => setToday(todayISO()), 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}

export function useIsMobile(): boolean {
  const query = "(max-width: 767px)";
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}

/** Cell text with the current workspace and settings: links show names, lookups follow their target. */
export function useCellText() {
  const ws = useStore((s) => s.ws);
  const settings = useStore((s) => s.settings);
  return (table: Table, column: Column, value: CellValue | undefined) => cellText(ws, table, column, value, settings);
}

const TOTAL_NAME = /(сумм|сума|итог|разом|всего|усього|total|amount|summe|betrag|importe|revenue|выручк|виручк|umsatz)/i;

/** The column whose total is the big number on top of a table. */
export function leadColumn(table: Table, ws: Workspace, summable: (c: Column) => boolean): Column | null {
  const chosen = table.columns.find((c) => c.id === table.figure);
  if (chosen) return chosen;
  const ledger = ledgerOf(table);
  const fromLedger = ledger && table.columns.find((c) => c.id === ledger.amountId);
  if (fromLedger) return fromLedger;
  const numeric = table.columns.filter(summable);
  const money = numeric.filter((c) => displayColumn(table, c, ws).type === "money");
  // A computed total ("Сумма = Кол-во × Цена") says more than a unit price.
  return (
    money.find((c) => c.type !== "lookup" && c.type !== "money" && TOTAL_NAME.test(c.name)) ??
    money.find((c) => c.type === "money" && TOTAL_NAME.test(c.name)) ??
    money.find((c) => c.type === "formula" || c.type === "rollup") ??
    money.find((c) => c.type === "money") ??
    numeric.find((c) => c.type !== "lookup") ??
    null
  );
}

export function periodLabel(t: Translate, period: Period | null | undefined, locale: Locale): string {
  if (!period || period.kind === "all") return t("period.all");
  if (period.kind !== "custom") return t(`period.${period.kind}`);
  const f = (d?: string) => (d ? formatDate(d, locale) : "…");
  return `${f(period.from)} – ${f(period.to)}`;
}

/** Example of a date the way this person writes it, for placeholders. */
export function dateExample(locale: Locale): string {
  return formatDateNumeric("2026-10-03", locale);
}

/** Text inputs where Ctrl+Z belongs to the field, not to the app. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "range", "color"].includes(type);
}

/**
 * After an entry is saved, warn when a linked row's calculated number drops
 * below zero — "Чехол iPhone: Остаток теперь −2" — instead of failing silently.
 */
export function useStockWarnings() {
  const t = useT();
  const showToast = useStore((s) => s.showToast);
  return useCallback(
    (before: Workspace, tableId: string, rowIds: string[]) => {
      const { ws: after, settings } = useStore.getState();
      const table = after.tables.find((x) => x.id === tableId);
      if (!table) return;
      const today = todayISO();
      for (const link of table.columns.filter((c) => c.type === "link")) {
        const target = after.tables.find((x) => x.id === link.linkTableId);
        const targetBefore = before.tables.find((x) => x.id === link.linkTableId);
        if (!target) continue;
        const ids = new Set(rowIds.map((id) => table.rows.find((r) => r.id === id)?.values[link.id]).filter((v): v is string => typeof v === "string"));
        for (const id of ids) {
          const row = target.rows.find((r) => r.id === id);
          if (!row) continue;
          const now = rowValues(target, row, today, after);
          const prevRow = targetBefore?.rows.find((r) => r.id === id);
          const prev = prevRow && targetBefore ? rowValues(targetBefore, prevRow, today, before) : {};
          for (const col of target.columns) {
            if (col.type !== "formula" && col.type !== "rollup") continue;
            const v = now[col.id];
            const p = prev[col.id];
            if (typeof v === "number" && v < 0 && !(typeof p === "number" && p < 0)) {
              showToast(t("record.stockLow", { name: rowLabel(target, row), column: col.name, value: cellText(after, target, col, v, settings) }), false);
              return;
            }
          }
        }
      }
    },
    [t, showToast],
  );
}
