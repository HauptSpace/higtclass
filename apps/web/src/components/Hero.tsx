import {
  addRecords,
  applyOp,
  cellText,
  computedRows,
  findTemplate,
  formatNumber,
  instantiateTemplate,
  ledgerOf,
  ledgerTotals,
  parseQuickEntries,
  rowSide,
  type Table,
} from "@higtclass/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { useIsMobile, useToday } from "../lib.ts";
import { useDictation } from "../speech.ts";
import { useStore } from "../store.ts";
import { MicIcon } from "./AssistantBar.tsx";

// The first screen: no questions, no setup. Type (or say) what happened and
// watch your own table appear with the sums done. One tap keeps it.

const EXAMPLES: Record<string, string[]> = {
  uk: ["зарплата 22 000", "кава 85", "вчора таксі 240", "продукти 1,2к"],
  ru: ["зарплата 22 000", "кофе 85", "вчера такси 240", "продукты 1,2к"],
  en: ["salary 2 400", "coffee 3.50", "yesterday taxi 12", "groceries 64"],
  de: ["Gehalt 2.400", "Kaffee 3,50", "gestern Taxi 12", "Lebensmittel 64"],
  es: ["sueldo 1.800", "café 2,50", "ayer taxi 12", "supermercado 64"],
};

/** A number that rolls to its new value instead of jumping. */
function Rolling({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 450);
      const eased = 1 - (1 - k) ** 3;
      setShown(a + (value - a) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(Math.round(shown))}</>;
}

export function Hero() {
  const t = useT();
  const today = useToday();
  const settings = useStore((s) => s.settings);
  const dispatch = useStore((s) => s.dispatch);
  const setActiveTable = useStore((s) => s.setActiveTable);
  const l = settings.locale;
  const examples = EXAMPLES[l] ?? EXAMPLES.en;
  const mobile = useIsMobile();

  // A private little workspace with an income & expenses table, kept only on screen until saved.
  const fresh = () => {
    const res = instantiateTemplate(findTemplate("budget")!, l, { locale: l });
    return { ws: applyOp({ tables: [] }, res.op), id: res.mainId };
  };
  const [demo, setDemo] = useState(fresh);
  useEffect(() => setDemo(fresh()), [l]);
  const table = demo.ws.tables.find((x) => x.id === demo.id) as Table;
  const [text, setText] = useState("");
  const [miss, setMiss] = useState(false);
  const [hint, setHint] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHint((h) => (h + 1) % examples.length), 2600);
    return () => clearInterval(id);
  }, [examples.length]);

  const add = (raw: string) => {
    const msg = raw.trim();
    if (!msg) return;
    const ctx = { locale: l, ws: demo.ws, currency: settings.currency };
    const entries = parseQuickEntries(table, msg, ctx);
    if (!entries) {
      setMiss(true);
      return;
    }
    const res = addRecords(
      table,
      entries.map((e) => e.record),
      ctx,
    );
    setDemo((d) => ({ ...d, ws: applyOp(d.ws, res.op) }));
    setText("");
    setMiss(false);
  };
  const dictation = useDictation(l, (spoken, final) => {
    setText(spoken);
    if (final && spoken) add(spoken);
  });

  const values = useMemo(() => computedRows(table, today, demo.ws), [table, today, demo.ws]);
  const ledger = ledgerOf(table)!;
  const totals = ledgerTotals(ledger, values);
  const money = (n: number) => formatNumber(n, l, settings.currency);
  const category = table.columns.find((c) => c.type === "select" && c.id !== ledger.typeColumnId);
  const note = table.columns.find((c) => c.type === "text");
  const amount = table.columns.find((c) => c.id === ledger.amountId)!;
  const rows = table.rows.slice().reverse();

  const keep = () => {
    const name = table.name;
    const copy = { ...table, name, createdAt: Date.now() };
    if (dispatch({ type: "table.create", table: copy }, name)) setActiveTable(copy.id);
  };

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
      <div className="min-w-0">
        <h1 className="text-[40px] leading-[0.95] font-extrabold tracking-[-0.045em] text-balance md:text-[64px]">{t("hero.title")}</h1>
        <p className="mt-4 max-w-xl text-lg text-ink-2">{t("hero.subtitle")}</p>

        <form
          className="mt-7 flex items-center gap-2 rounded-2xl border-2 border-ink bg-paper p-2 shadow-[0_8px_0_0_var(--ink)]"
          onSubmit={(e) => {
            e.preventDefault();
            add(text);
          }}
        >
          {dictation.supported && (
            <button
              type="button"
              onClick={dictation.listening ? dictation.stop : dictation.start}
              aria-label={dictation.listening ? t("ai.stopMic") : t("ai.mic")}
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl transition ${dictation.listening ? "listening bg-late text-white" : "bg-accent text-on-accent"}`}
            >
              <MicIcon />
            </button>
          )}
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMiss(false);
            }}
            placeholder={mobile ? examples[hint] : `${t("hero.try")} ${examples[hint]}`}
            aria-label={t("ai.placeholder")}
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-xl font-medium outline-none placeholder:text-ink-2"
          />
          <button type="submit" disabled={!text.trim()} className="shrink-0 rounded-xl bg-ink px-4 py-3 font-bold text-paper disabled:opacity-30">
            ↵
          </button>
        </form>
        {miss && <p className="mt-3 font-semibold text-late">{t("hero.miss")}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {examples.map((e) => (
            <button key={e} type="button" onClick={() => add(e)} className="rounded-full border-2 border-line px-3.5 py-1.5 font-semibold hover:border-ink">
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className={`min-w-0 rounded-3xl border-2 p-5 md:p-7 ${rows.length ? "border-ink bg-paper" : "border-dashed border-line"}`} aria-live="polite">
        <div className="text-sm font-bold tracking-wide text-ink-2 uppercase">{table.name}</div>
        {rows.length === 0 ? (
          <div className="py-6">
            <div className="h-10 w-2/3 rounded-lg bg-soft" />
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div className="h-6 rounded bg-soft" />
              <div className="h-6 rounded bg-soft" />
            </div>
            <p className="mt-6 text-ink-2">{t("hero.empty")}</p>
          </div>
        ) : (
          <>
            <div className="mt-3 font-display text-[44px] leading-none font-bold tracking-[-0.04em] whitespace-nowrap tabular md:text-[56px]">
              <Rolling value={totals.balance} format={money} />
            </div>
            <div className="mt-1 text-ink-2">{t("figures.balance")}</div>
            <div className="mt-4 grid grid-cols-2 gap-4 border-b-2 border-rule pb-4">
              <div>
                <div className="font-display text-2xl font-bold tracking-tight whitespace-nowrap tabular">
                  <Rolling value={totals.income} format={money} />
                </div>
                <div className="text-sm text-ink-2">{t("figures.income")}</div>
              </div>
              <div>
                <div className="font-display text-2xl font-bold tracking-tight whitespace-nowrap tabular">
                  <Rolling value={totals.expense} format={money} />
                </div>
                <div className="text-sm text-ink-2">{t("figures.expense")}</div>
              </div>
            </div>
            <ul className="max-h-64 overflow-y-auto">
              {rows.map((r) => {
                const side = rowSide(ledger, r.values);
                return (
                  <li key={r.id} className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 animate-[rise_.35s_ease-out]">
                    <span className="min-w-0 truncate">
                      <b>{note ? cellText(demo.ws, table, note, r.values[note.id], settings) : ""}</b>
                      {category && r.values[category.id] ? <span className="ml-2 text-sm text-ink-2">{String(r.values[category.id])}</span> : null}
                    </span>
                    <b className={`shrink-0 tabular ${side === "income" ? "text-paid" : ""}`}>
                      {side === "income" ? "+" : "−"}
                      {cellText(demo.ws, table, amount, r.values[amount.id], settings).replace(/^[-−]/, "")}
                    </b>
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={keep} className="mt-5 w-full rounded-xl bg-accent px-4 py-3.5 text-lg font-bold text-on-accent hover:opacity-90">
              {t("hero.keep")}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
