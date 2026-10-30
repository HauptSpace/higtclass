import { FLOW_FILTER, formatDateNumeric, ledgerOf, parseDate, rowLabel, type Column, type Filter, type Period, type PeriodKind, type Table } from "@higtclass/core";
import { useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { dateExample, periodLabel } from "../lib.ts";
import { useStore } from "../store.ts";
import { Button, inputClass, optionColor, useDismiss } from "./ui.tsx";

// Period, filters and the income/expense switch: the same controls above a
// table and inside a report, so "Q3, only paid, only this client" is two taps.

const MAIN: PeriodKind[] = ["all", "week", "month", "prevMonth", "quarter", "year"];
const MORE: PeriodKind[] = ["nextWeek", "nextMonth", "prevQuarter", "prevYear", "custom"];

const pill = (on: boolean) =>
  `shrink-0 rounded-full border-2 px-3 py-1 text-sm font-semibold whitespace-nowrap transition ${on ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"}`;

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const t = useT();
  const locale = useStore((s) => s.settings.locale);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, open, () => setOpen(false));
  const inMore = MORE.includes(value.kind);
  return (
    <div className="flex items-center gap-1 max-sm:flex-nowrap sm:flex-wrap" role="group" aria-label={t("report.period")}>
      {MAIN.map((k) => (
        <button key={k} type="button" aria-pressed={value.kind === k} onClick={() => onChange({ kind: k, columnId: value.columnId })} className={pill(value.kind === k)}>
          {t(`period.${k}`)}
        </button>
      ))}
      <div ref={box} className="relative">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={pill(inMore)}>
          {inMore ? periodLabel(t, value, locale) : t("period.more")} ▾
        </button>
        {open && (
          <div className="z-40 rounded-xl border-2 border-ink bg-paper p-2 shadow-xl max-sm:fixed max-sm:inset-x-4 max-sm:top-24 sm:absolute sm:left-0 sm:mt-2 sm:w-64">
            {MORE.filter((k) => k !== "custom").map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  onChange({ kind: k, columnId: value.columnId });
                  setOpen(false);
                }}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-soft ${value.kind === k ? "font-bold" : ""}`}
              >
                {t(`period.${k}`)}
              </button>
            ))}
            <div className="mt-1 border-t border-line px-1 pt-2">
              <div className="mb-1 text-xs font-semibold text-ink-2">{t("period.custom")}</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-ink-2">
                  {t("period.from")}
                  <TypedDate
                    value={value.kind === "custom" ? value.from : undefined}
                    onChange={(from) => onChange({ kind: "custom", from, to: value.kind === "custom" ? value.to : undefined, columnId: value.columnId })}
                  />
                </label>
                <label className="text-xs text-ink-2">
                  {t("period.to")}
                  <TypedDate
                    value={value.kind === "custom" ? value.to : undefined}
                    onChange={(to) => onChange({ kind: "custom", to, from: value.kind === "custom" ? value.from : undefined, columnId: value.columnId })}
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A date typed as 01.08.2026 / "вчора" (not the browser's picker, whose format follows the browser). */
function TypedDate({ value, onChange }: { value?: string; onChange: (iso: string | undefined) => void }) {
  const locale = useStore((s) => s.settings.locale);
  const [text, setText] = useState(value ? formatDateNumeric(value, locale) : "");
  const bad = text.trim() !== "" && !parseDate(text, locale);
  return (
    <input
      className={`${inputClass} !px-2 !py-1 text-sm ${bad ? "!border-late" : ""}`}
      value={text}
      placeholder={dateExample(locale)}
      aria-invalid={bad}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text.trim() ? (parseDate(text, locale) ?? undefined) : undefined)}
      onKeyDown={(e) => e.key === "Enter" && onChange(text.trim() ? (parseDate(text, locale) ?? undefined) : undefined)}
    />
  );
}

/** Columns worth filtering by. */
export function filterableColumns(table: Table): Column[] {
  return table.columns.filter((c) => ["select", "checkbox", "link", "text", "number", "money", "date", "lookup"].includes(c.type));
}

function choicesOf(table: Table, column: Column, ws: ReturnType<typeof useStore.getState>["ws"]): { value: string; label: string }[] {
  if (column.type === "checkbox") return [];
  if (column.type === "select") return (column.options ?? []).map((o) => ({ value: o, label: o }));
  if (column.type === "link") {
    const target = ws.tables.find((t) => t.id === column.linkTableId);
    return (target?.rows ?? []).map((r) => ({ value: r.id, label: rowLabel(target!, r) })).sort((a, b) => a.label.localeCompare(b.label));
  }
  return [];
}

export function filterText(t: ReturnType<typeof useT>, table: Table, f: Filter, ws: ReturnType<typeof useStore.getState>["ws"]): string {
  if (f.columnId === FLOW_FILTER) return f.values?.includes("income") ? t("flow.income") : t("flow.expense");
  const col = table.columns.find((c) => c.id === f.columnId);
  if (!col) return "?";
  const neg = f.op === "notIn" ? `${t("filter.not")} ` : "";
  switch (f.op) {
    case "empty":
      return `${col.name}: ${col.type === "checkbox" ? t("filter.no") : t("filter.empty")}`;
    case "notEmpty":
      return `${col.name}: ${col.type === "checkbox" ? t("filter.yes") : t("filter.notEmpty")}`;
    case "contains":
      return `${col.name} ${t("filter.contains")} “${f.value}”`;
    case "gte":
    case "lte": {
      const shown = col.type === "date" && typeof f.value === "string" ? formatDateNumeric(f.value, useStore.getState().settings.locale) : f.value;
      return `${col.name} ${f.op === "gte" ? "≥" : "≤"} ${shown}`;
    }
    default: {
      const labels = choicesOf(table, col, ws);
      const names = (f.values ?? []).map((v) => labels.find((l) => l.value === v)?.label ?? v);
      return `${col.name}: ${neg}${names.join(", ")}`;
    }
  }
}

/** Active filters as removable chips, plus "+ Filter". */
export function FilterBar({ table, filters, onChange }: { table: Table; filters: Filter[]; onChange: (f: Filter[]) => void }) {
  const t = useT();
  const ws = useStore((s) => s.ws);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, open, () => setOpen(false));
  const shown = filters.filter((f) => f.columnId !== FLOW_FILTER);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-ink py-1 pr-1.5 pl-3 text-sm font-semibold text-paper">
          {filterText(t, table, f, ws)}
          <button type="button" aria-label={t("filter.clear")} onClick={() => onChange(filters.filter((x) => x !== f))} className="grid h-5 w-5 place-items-center rounded-full hover:bg-white/20">
            ✕
          </button>
        </span>
      ))}
      <div ref={box} className="relative">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-full border-2 border-dashed border-line px-3 py-1 text-sm font-semibold text-ink-2 hover:border-ink hover:text-ink">
          ＋ {t("filter.add")}
        </button>
        {open && (
          <FilterEditor
            table={table}
            onAdd={(added) => {
              const list = Array.isArray(added) ? added : [added];
              const replaced = (x: Filter) => list.some((f) => f.columnId === x.columnId && (f.op === x.op || !["gte", "lte"].includes(f.op)));
              onChange([...filters.filter((x) => !replaced(x)), ...list]);
              setOpen(false);
            }}
          />
        )}
      </div>
      {shown.length > 1 && (
        <button type="button" onClick={() => onChange(filters.filter((f) => f.columnId === FLOW_FILTER))} className="text-sm font-semibold text-ink-2 underline underline-offset-4 hover:text-ink">
          {t("filter.clear")}
        </button>
      )}
    </div>
  );
}

function FilterEditor({ table, onAdd }: { table: Table; onAdd: (f: Filter | Filter[]) => void }) {
  const t = useT();
  const ws = useStore((s) => s.ws);
  const locale = useStore((s) => s.settings.locale);
  const columns = filterableColumns(table);
  const [columnId, setColumnId] = useState(columns.find((c) => c.type === "select")?.id ?? columns[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const col = columns.find((c) => c.id === columnId);
  const choices = col ? choicesOf(table, col, ws) : [];
  const numeric = col && ["number", "money", "date"].includes(col.type);

  return (
    <div className="z-40 rounded-xl border-2 border-ink bg-paper p-3 shadow-xl max-sm:fixed max-sm:inset-x-4 max-sm:top-24 sm:absolute sm:left-0 sm:mt-2 sm:w-80">
      <label className="block text-xs font-semibold text-ink-2">
        {t("filter.pickColumn")}
        <select
          className={`${inputClass} mt-1 !py-1.5`}
          value={columnId}
          onChange={(e) => {
            setColumnId(e.target.value);
            setPicked([]);
          }}
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {col && (
        <div className="mt-3">
          {col.type === "checkbox" ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onAdd({ columnId, op: "notEmpty" })}>
                ✓ {t("filter.yes")}
              </Button>
              <Button variant="outline" onClick={() => onAdd({ columnId, op: "empty" })}>
                {t("filter.no")}
              </Button>
            </div>
          ) : choices.length > 0 ? (
            <>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {choices.map((c) => {
                  const on = picked.includes(c.value);
                  const color = col.type === "select" ? optionColor(col, c.value) : null;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c.value) : [...p, c.value]))}
                      className={`inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-semibold ${on ? "border-ink bg-ink text-paper" : "border-line hover:border-ink"}`}
                    >
                      {color && <i className="h-2 w-2" style={{ background: color }} />}
                      {c.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="primary" disabled={!picked.length} onClick={() => onAdd({ columnId, op: "in", values: picked })}>
                  {t("filter.apply")}
                </Button>
                <Button variant="ghost" onClick={() => onAdd({ columnId, op: "empty" })}>
                  {t("filter.empty")}
                </Button>
              </div>
            </>
          ) : numeric ? (
            <div className="grid grid-cols-2 gap-2">
              <input className={`${inputClass} !py-1.5`} inputMode={col.type === "date" ? "text" : "decimal"} placeholder={col.type === "date" ? `${t("period.from")} ${dateExample(locale)}` : t("period.from")} value={min} onChange={(e) => setMin(e.target.value)} />
              <input className={`${inputClass} !py-1.5`} inputMode={col.type === "date" ? "text" : "decimal"} placeholder={col.type === "date" ? `${t("period.to")} ${dateExample(locale)}` : t("period.to")} value={max} onChange={(e) => setMax(e.target.value)} />
              <Button
                variant="primary"
                className="col-span-2"
                disabled={!min && !max}
                onClick={() => {
                  const conv = (v: string) => (col.type === "date" ? (parseDate(v, locale) ?? v) : Number(v.replace(/\s/g, "").replace(",", ".")));
                  const list: Filter[] = [];
                  if (min) list.push({ columnId, op: "gte", value: conv(min) });
                  if (max) list.push({ columnId, op: "lte", value: conv(max) });
                  onAdd(list);
                }}
              >
                {t("filter.apply")}
              </Button>
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) onAdd({ columnId, op: "contains", value: text.trim() });
              }}
            >
              <input className={`${inputClass} !py-1.5`} autoFocus placeholder={t("filter.contains")} value={text} onChange={(e) => setText(e.target.value)} />
              <Button type="submit" variant="primary" disabled={!text.trim()}>
                {t("filter.apply")}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** All / Income / Expenses for tables that have both. */
export function FlowSwitch({ table, filters, onChange }: { table: Table; filters: Filter[]; onChange: (f: Filter[]) => void }) {
  const t = useT();
  const ledger = ledgerOf(table);
  if (!ledger || ledger.kind !== "both") return null;
  const current = filters.find((f) => f.columnId === FLOW_FILTER)?.values?.[0] ?? "all";
  const set = (side: string) => {
    const rest = filters.filter((f) => f.columnId !== FLOW_FILTER);
    onChange(side === "all" ? rest : [...rest, { columnId: FLOW_FILTER, op: "in", values: [side] }]);
  };
  return (
    <div className="flex gap-1 rounded-full bg-soft p-0.5" role="group">
      {(["all", "income", "expense"] as const).map((side) => (
        <button
          key={side}
          type="button"
          aria-pressed={current === side}
          onClick={() => set(side)}
          className={`rounded-full px-3 py-1 text-sm font-bold transition ${current === side ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"}`}
        >
          {t(`flow.${side}`)}
        </button>
      ))}
    </div>
  );
}
