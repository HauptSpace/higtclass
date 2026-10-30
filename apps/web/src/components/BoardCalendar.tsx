import { cellText, localeTag, type Column, type Row, type Table } from "@higtclass/core";
import { useMemo, useState } from "react";
import { useT } from "../i18n/index.ts";
import { useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { Card } from "./CardsView.tsx";
import { optionColor } from "./ui.tsx";

// Two more ways to look at the same rows: a board with one column per status
// (drag a card to change it) and a calendar by date (week or month).

export function boardColumnsOf(table: Table): Column[] {
  return table.columns.filter((c) => c.type === "select");
}

export function BoardView({
  table,
  rows,
  columnId,
  onColumn,
  onOpenRow,
}: {
  table: Table;
  rows: Row[];
  columnId: string | null | undefined;
  onColumn: (id: string) => void;
  onOpenRow: (id: string) => void;
}) {
  const t = useT();
  const dispatch = useStore((s) => s.dispatch);
  const choices = boardColumnsOf(table);
  // Status-like columns first: that is what a board is for.
  const preferred = choices.find((c) => /(статус|status|estado|этап|етап|stage)/i.test(c.name)) ?? choices[0];
  const col = choices.find((c) => c.id === columnId) ?? preferred;
  const [over, setOver] = useState<string | null>(null);
  if (!col) return <p className="py-10 text-center text-ink-2">{t("board.needSelect")}</p>;

  const lanes = [...(col.options ?? []), ""];
  const byLane = new Map<string, Row[]>(lanes.map((l) => [l, []]));
  for (const r of rows) {
    const v = r.values[col.id];
    const key = typeof v === "string" && byLane.has(v) ? v : "";
    byLane.get(key)!.push(r);
  }
  const move = (rowId: string, lane: string) =>
    dispatch({ type: "cells.set", tableId: table.id, cells: [{ rowId, columnId: col.id, value: lane || null }] }, t("record.edit"));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {choices.length > 1 && (
        <label className="flex items-center gap-2 py-2 text-sm font-semibold text-ink-2">
          {t("board.by")}
          <select className="rounded-lg border-2 border-line bg-paper px-2 py-1 text-ink" value={col.id} onChange={(e) => onColumn(e.target.value)}>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3">
        {lanes.map((lane) => {
          const items = byLane.get(lane)!;
          if (lane === "" && !items.length) return null;
          const color = lane ? optionColor(col, lane) : null;
          return (
            <section
              key={lane || "_"}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(lane);
              }}
              onDragLeave={() => setOver((o) => (o === lane ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/zifra-row");
                if (id) move(id, lane);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-2xl bg-soft p-2 ${over === lane ? "ring-2 ring-ink" : ""}`}
            >
              <h3 className="flex items-center gap-2 px-2 pt-1 pb-2 font-extrabold">
                {color && <i className="h-2.5 w-2.5" style={{ background: color }} />}
                <span className="truncate">{lane || t("board.none")}</span>
                <span className="ml-auto text-sm font-semibold text-ink-2">{items.length}</span>
              </h3>
              <ul className="min-h-12 space-y-2 overflow-y-auto">
                {items.map((r) => (
                  <li
                    key={r.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/zifra-row", r.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className="cursor-grab rounded-xl border-2 border-transparent bg-paper p-3 shadow-sm hover:border-ink active:cursor-grabbing"
                  >
                    <Card table={table} row={r} onOpen={() => onOpenRow(r.id)} compact hide={col} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

export function CalendarView({
  table,
  rows,
  onOpenRow,
  onNewAt,
}: {
  table: Table;
  rows: Row[];
  onOpenRow: (id: string) => void;
  onNewAt: (date: string) => void;
}) {
  const t = useT();
  const today = useToday();
  const settings = useStore((s) => s.settings);
  const ws = useStore((s) => s.ws);
  const dateCol = table.columns.find((c) => c.type === "date");
  const [mode, setMode] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(() => today);
  const tag = localeTag(settings.locale);

  const days = useMemo(() => {
    const [y, m, d] = cursor.split("-").map(Number);
    const base = new Date(y, m - 1, d);
    let start: Date;
    let count: number;
    if (mode === "week") {
      start = new Date(base);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      count = 7;
    } else {
      const firstOfMonth = new Date(y, m - 1, 1);
      start = new Date(firstOfMonth);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      const lastOfMonth = new Date(y, m, 0);
      const end = new Date(lastOfMonth);
      end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7)));
      count = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    }
    return Array.from({ length: count }, (_, i) => {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      return iso(day);
    });
  }, [cursor, mode]);

  const byDay = useMemo(() => {
    const map = new Map<string, Row[]>();
    if (!dateCol) return map;
    for (const r of rows) {
      const v = r.values[dateCol.id];
      if (typeof v !== "string") continue;
      const list = map.get(v.slice(0, 10));
      if (list) list.push(r);
      else map.set(v.slice(0, 10), [r]);
    }
    return map;
  }, [rows, dateCol]);

  if (!dateCol) return <p className="py-10 text-center text-ink-2">{t("calendar.needDate")}</p>;

  const shift = (dir: number) => {
    const [y, m, d] = cursor.split("-").map(Number);
    const next = mode === "week" ? new Date(y, m - 1, d + dir * 7) : new Date(y, m - 1 + dir, 1);
    setCursor(iso(next));
  };
  const month = cursor.slice(0, 7);
  const weekday = new Intl.DateTimeFormat(tag, { weekday: "short" });
  const title =
    mode === "month"
      ? new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" }).format(new Date(`${month}-01T12:00:00`))
      : `${new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" }).format(new Date(`${days[0]}T12:00:00`))} – ${new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${days[6]}T12:00:00`))}`;
  const titleCol = table.columns.find((c) => c.type === "text") ?? table.columns.find((c) => c.type === "link");
  const statusCol = table.columns.find((c) => c.type === "select");
  const limit = mode === "week" ? 12 : 3;

  return (
    <div className="pb-6">
      <div className="flex flex-wrap items-center gap-2 py-2">
        <button type="button" onClick={() => shift(-1)} aria-label={t("calendar.prev")} className="rounded-lg border-2 border-line px-2.5 py-1 font-bold hover:border-ink">
          ‹
        </button>
        <button type="button" onClick={() => shift(1)} aria-label={t("calendar.next")} className="rounded-lg border-2 border-line px-2.5 py-1 font-bold hover:border-ink">
          ›
        </button>
        <button type="button" onClick={() => setCursor(today)} className="rounded-lg px-2.5 py-1 text-sm font-semibold text-ink-2 hover:text-ink">
          {t("calendar.today")}
        </button>
        <h3 className="text-xl font-extrabold tracking-tight first-letter:uppercase">{title}</h3>
        <div className="ml-auto flex gap-1 rounded-full bg-soft p-0.5">
          {(["week", "month"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded-full px-3 py-1 text-sm font-bold ${mode === m ? "bg-ink text-paper" : "text-ink-2"}`}>
              {t(`calendar.${m}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-7 border-t-2 border-l border-rule">
        {days.slice(0, 7).map((d) => (
          <div key={`h${d}`} className="border-r border-b border-line px-2 py-1 text-xs font-semibold text-ink-2 uppercase">
            {weekday.format(new Date(`${d}T12:00:00`))}
          </div>
        ))}
        {days.map((d) => {
          const items = byDay.get(d) ?? [];
          const outside = mode === "month" && d.slice(0, 7) !== month;
          return (
            <div
              key={d}
              className={`group relative border-r border-b border-line p-1.5 ${mode === "week" ? "min-h-64" : "min-h-24"} ${outside ? "bg-soft/60 text-ink-2" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-bold ${d === today ? "bg-accent text-on-accent" : ""}`}>{Number(d.slice(8))}</span>
                <button
                  type="button"
                  onClick={() => onNewAt(d)}
                  aria-label={`${t("table.record")} ${d}`}
                  className="rounded px-1 text-sm text-ink-2 opacity-0 group-hover:opacity-100 hover:text-ink focus:opacity-100"
                >
                  ＋
                </button>
              </div>
              <ul className="mt-1 space-y-1">
                {items.slice(0, limit).map((r) => {
                  const status = statusCol ? r.values[statusCol.id] : null;
                  const color = typeof status === "string" ? optionColor(statusCol, status) : null;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onOpenRow(r.id)}
                        className="flex w-full items-center gap-1.5 truncate rounded-md bg-paper px-1.5 py-0.5 text-left text-xs font-semibold shadow-sm ring-1 ring-line hover:ring-ink"
                      >
                        {color && <i className="h-2 w-2 shrink-0" style={{ background: color }} />}
                        <span className="truncate">{titleCol ? cellText(ws, table, titleCol, r.values[titleCol.id], settings) || "—" : "—"}</span>
                      </button>
                    </li>
                  );
                })}
                {items.length > limit && <li className="px-1 text-xs font-semibold text-ink-2">{t("calendar.more", { n: items.length - limit })}</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
