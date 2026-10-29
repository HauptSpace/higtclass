import { cellText, editableValue, todayISO, type CellValue, type Column, type Problem, type Table } from "@higtclass/core";
import { useEffect, useState } from "react";
import type { Translate } from "./i18n/index.ts";
import { useStore } from "./store.ts";

export function problemText(t: Translate, p: Problem): string {
  return t(`problem.${p.reason}`, { column: p.column ?? "", input: String(p.input ?? "") });
}

/** Text to put in an editor for a stored value. */
export function draftOf(column: Column, value: CellValue | undefined, locale: Parameters<typeof editableValue>[2]): string {
  if (column.type === "checkbox") return value ? "1" : "";
  if (column.type === "link") return typeof value === "string" ? value : "";
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
