import {
  addColumn,
  BUNDESLAENDER,
  computedRows,
  currencyChoices,
  deadlinePeriod,
  DEFAULT_RULES,
  findTemplate,
  formatDate,
  formatNumber,
  goalProgress,
  incomeBetween,
  instantiateTemplate,
  isRulePack,
  ledgerOf,
  localeTag,
  REGIMES,
  suggestionsFor,
  upcomingDeadlines,
  upcomingHolidays,
  type Bundesland,
  type Country,
  type DueAmount,
  type Occupation,
  type Op,
  type Profile,
  type SuggestedColumn,
  type Suggestion,
  type Table,
  type TaxRegime,
} from "@higtclass/core";
import { useEffect, useMemo, useState } from "react";
import { useT, type Translate } from "../i18n/index.ts";
import { useToday } from "../lib.ts";
import { useActiveTable, useStore } from "../store.ts";
import { Button, Chips, inputClass } from "./ui.tsx";

// "Для вас": deadlines with the amounts due, bank holidays and tips picked for
// the person's country and tax situation. The rules come from the server so
// they can be updated without a new release; the bundled pack works offline.

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

/** Load the latest rule pack once per app start, after saved data is loaded. */
export function useRulesSync() {
  const setRules = useStore((s) => s.setRules);
  const hydrated = useStore((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated) return;
    setRules(DEFAULT_RULES);
    fetch(`${API}/api/rules`)
      .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : null))
      .then((pack: unknown) => isRulePack(pack) && setRules(pack))
      .catch(() => {
        /* offline: keep what we have */
      });
  }, [hydrated, setRules]);
}

export interface DueItem {
  key: string;
  date: string;
  daysLeft: number;
  title: string;
  body: string;
  source?: string;
  holiday?: boolean;
  /** "Єдиний податок 5%: 11 562 грн", worked out from last quarter's income. */
  amounts: string[];
}

export function useDueItems(days = 45): DueItem[] {
  const today = useToday();
  const rules = useStore((s) => s.rules);
  const settings = useStore((s) => s.settings);
  const ws = useStore((s) => s.ws);
  const t = useT();
  return useMemo(() => {
    const profile = settings.profile;
    if (!profile) return [];
    const l = settings.locale;
    const money = (n: number) => formatNumber(Math.round(n * 100) / 100, l, settings.currency);
    // Missed deadlines stay until marked done (up to six weeks back).
    const deadlines: DueItem[] = upcomingDeadlines(rules, profile, today, days, 45)
      .filter((u) => u.daysLeft >= 0 || !settings.dismissed.includes(`${u.deadline.id}@${u.date}`))
      .map((u) => {
        const amounts: string[] = [];
        if (u.deadline.amounts?.length) {
          const range = deadlinePeriod(u.deadline, u.date);
          const income = incomeBetween(ws, range.from, range.to, today);
          if (income.tables.length) {
            for (const a of u.deadline.amounts as DueAmount[]) {
              amounts.push(`${a.label[l]}: ${money(a.rate ? (income.total * a.rate) / 100 : income.total)}`);
            }
          }
        }
        return {
          key: `${u.deadline.id}@${u.date}`,
          date: u.date,
          daysLeft: u.daysLeft,
          title: u.deadline.title[l],
          body: u.deadline.body[l],
          source: u.deadline.source,
          amounts,
        };
      });
    const holidays: DueItem[] = upcomingHolidays(profile, today, days).map((h) => ({
      key: `holiday@${h.date}`,
      date: h.date,
      daysLeft: h.daysLeft,
      title: h.name,
      body: t("forYou.holiday"),
      holiday: true,
      amounts: [],
    }));
    return [...deadlines, ...holidays].sort((a, b) => a.date.localeCompare(b.date));
  }, [rules, settings.profile, settings.locale, settings.currency, settings.dismissed, today, days, t, ws]);
}

export function whenText(t: Translate, daysLeft: number) {
  if (daysLeft < 0) return t("forYou.overdue", { n: -daysLeft });
  if (daysLeft === 0) return t("forYou.today");
  if (daysLeft === 1) return t("forYou.tomorrow");
  return t("forYou.inDays", { n: daysLeft });
}

const COUNTRY_CURRENCY: Partial<Record<Country, string>> = { DE: "EUR", UA: "UAH" };

export function ProfileForm({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const profile = useStore((s) => s.settings.profile);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [draft, setDraft] = useState<Partial<Profile>>(profile ?? {});

  const update = (patch: Partial<Profile>) => {
    const next = { ...draft, ...patch };
    if (patch.country && next.regime && !REGIMES[patch.country].includes(next.regime)) next.regime = undefined;
    if (next.occupation === "personal") next.regime = "none";
    // Only one choice (another country): nothing to ask.
    if (next.country && next.occupation && !next.regime && REGIMES[next.country].length === 1) next.regime = REGIMES[next.country][0];
    if (next.country !== "DE") delete next.region;
    setDraft(next);
    const extra: Partial<typeof settings> = {};
    if (patch.country && COUNTRY_CURRENCY[patch.country]) extra.currency = COUNTRY_CURRENCY[patch.country]!;
    if (next.country && next.occupation && next.regime) setSettings({ profile: next as Profile, ...extra });
    else if (extra.currency) setSettings(extra);
  };

  const regimes = draft.country ? REGIMES[draft.country] : [];
  const done = draft.country && draft.occupation && draft.regime;
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-sm font-semibold text-ink-2">{t("profile.occupation")}</div>
        <Chips<Occupation> value={draft.occupation ?? null} options={["personal", "self", "company"]} label={(o) => t(`occ.${o}`)} onPick={(occupation) => update({ occupation })} />
      </div>
      {draft.occupation && (
        <div>
          <div className="mb-2 text-sm font-semibold text-ink-2">{t("profile.country")}</div>
          <Chips<Country> value={draft.country ?? null} options={["UA", "DE", "other"]} label={(o) => t(`country.${o}`)} onPick={(country) => update({ country })} />
        </div>
      )}
      {draft.country && draft.occupation && draft.occupation !== "personal" && regimes.length > 1 && (
        <div>
          <div className="mb-2 text-sm font-semibold text-ink-2">{t("profile.regime")}</div>
          <Chips<TaxRegime> value={draft.regime ?? null} options={regimes} label={(o) => t(`regime.${o}`)} onPick={(regime) => update({ regime })} />
        </div>
      )}
      {draft.country === "DE" && draft.occupation && (
        <label className="block max-w-xs">
          <span className="mb-1.5 block text-sm font-semibold text-ink-2">{t("profile.region")}</span>
          <select className={inputClass} value={draft.region ?? ""} onChange={(e) => update({ region: (e.target.value || undefined) as Bundesland | undefined })}>
            <option value="">{t("profile.regionNone")}</option>
            {(Object.keys(BUNDESLAENDER) as Bundesland[]).map((b) => (
              <option key={b} value={b}>
                {BUNDESLAENDER[b]}
              </option>
            ))}
          </select>
        </label>
      )}
      {draft.country && (
        <div>
          <div className="mb-2 text-sm font-semibold text-ink-2">{t("profile.currency")}</div>
          <Chips value={settings.currency} options={currencyChoices(settings.locale, settings.currency).slice(0, 5)} label={(c) => c} onPick={(currency) => setSettings({ currency })} />
        </div>
      )}
      {onDone && done && (
        <Button variant="primary" onClick={onDone}>
          {t("forYou.done")}
        </Button>
      )}
    </div>
  );
}

/** The table tax and limit columns belong to: the one with income, preferring the open one. */
function incomeTable(tables: Table[], active: Table | null): Table | undefined {
  const isIncome = (tb: Table) => {
    const l = ledgerOf(tb);
    return !!l && l.kind !== "expense";
  };
  return active && isIncome(active) ? active : tables.find(isIncome);
}

/** A tax formula that only counts money actually received (and only income rows). */
function taxFormula(table: Table, column: SuggestedColumn): string | null {
  const ledger = ledgerOf(table);
  const amount = table.columns.find((c) => c.id === ledger?.amountId) ?? table.columns.find((c) => c.type === "money");
  if (!amount || !column.formula) return null;
  let f = column.formula.replaceAll("{money}", amount.name);
  const paid = table.columns.find((c) => c.id === ledger?.paidColumnId);
  if (paid) f = `IF([${paid.name}]; ${f}; 0)`;
  const type = table.columns.find((c) => c.id === ledger?.typeColumnId);
  if (type && ledger?.incomeValues?.[0]) f = `IF([${type.name}] = "${ledger.incomeValues[0]}"; ${f}; 0)`;
  return f;
}

function SuggestionCard({ s }: { s: Suggestion }) {
  const t = useT();
  const today = useToday();
  const ws = useStore((s) => s.ws);
  const settings = useStore((s) => s.settings);
  const dispatch = useStore((s) => s.dispatch);
  const setActiveTable = useStore((s) => s.setActiveTable);
  const showToast = useStore((s) => s.showToast);
  const active = useActiveTable();
  const l = settings.locale;
  const action = s.action;

  let control: React.ReactNode = null;
  if (action?.type === "template") {
    const tpl = findTemplate(action.templateId);
    const covering = ws.tables.filter((tb) => tb.template && (action.coveredBy ?? [action.templateId]).includes(tb.template));
    // Point at the table that holds the money (Payments), not its sibling (Clients).
    const covered = covering.find((tb) => ledgerOf(tb)) ?? covering[0];
    if (covered) {
      control = (
        <p className="text-sm">
          ✓ {t("forYou.covered", { table: covered.name })}{" "}
          <button type="button" onClick={() => setActiveTable(covered.id)} className="font-semibold underline underline-offset-4">
            {t("forYou.open")}
          </button>
        </p>
      );
    } else if (tpl) {
      control = (
        <Button
          variant="outline"
          onClick={() => {
            const res = instantiateTemplate(tpl, l, { locale: l });
            if (dispatch(res.op, s.title[l])) {
              setActiveTable(res.mainId);
              showToast(t("forYou.added"));
            }
          }}
        >
          {t("forYou.useTemplate")}
        </Button>
      );
    }
  } else if (action?.type === "columns" || action?.type === "column") {
    const columns = action.type === "columns" ? action.columns : [action.column];
    const target = incomeTable(ws.tables, active) ?? (active?.columns.some((c) => c.type === "money") ? active : undefined);
    const missing = target ? columns.filter((c) => !target.columns.some((x) => x.name.toLowerCase() === c.name[l].toLowerCase())) : [];
    control = !target ? (
      <p className="text-sm text-ink-2">{t("forYou.needMoney")}</p>
    ) : !missing.length ? (
      <p className="text-sm font-semibold">✓ {t("forYou.added")}</p>
    ) : (
      <div>
        <Button
          variant="outline"
          onClick={() => {
            const ops: Op[] = [];
            let working = target;
            for (const c of missing) {
              const formula = taxFormula(working, c);
              if (!formula) continue;
              const res = addColumn(working, { name: c.name[l], type: c.type, formula, format: "money" });
              ops.push(res.op);
              working = { ...working, columns: [...working.columns, res.column] };
            }
            if (ops.length && dispatch({ type: "batch", ops }, s.title[l])) {
              setActiveTable(target.id);
              showToast(t("forYou.added"));
            }
          }}
        >
          {t("forYou.addColumn", { table: target.name })}
        </Button>
        {ledgerOf(target)?.paidColumnId && <p className="mt-1.5 text-sm text-ink-2">{t("forYou.taxOnPaid")}</p>}
      </div>
    );
  } else if (action?.type === "limit") {
    const year = today.slice(0, 4);
    const income = incomeBetween(ws, `${year}-01-01`, `${year}-12-31`, today);
    const money = (n: number) => formatNumber(Math.round(n * 100) / 100, l, action.currency);
    const share = Math.min(1, income.total / action.amount);
    const moneyTables = ws.tables.filter((tb) => tb.columns.some((c) => c.type === "money"));
    control = income.tables.length ? (
      <div>
        <div className={`font-display text-2xl font-bold tracking-tight ${income.total > action.amount ? "text-late" : ""}`}>
          {income.total > action.amount
            ? t("forYou.limitOver", { limit: money(action.amount), over: money(income.total - action.amount) })
            : t("forYou.limitLeft2", { left: money(action.amount - income.total), limit: money(action.amount) })}
        </div>
        <div className="mt-2 h-2.5 bg-line" aria-hidden="true">
          <div className="h-full" style={{ width: `${share * 100}%`, background: share > 0.9 ? "var(--late)" : share > 0.75 ? "var(--wait)" : "var(--ink)" }} />
        </div>
        <div className="mt-1.5 text-sm text-ink-2">
          {t("forYou.limitThisYear", { used: money(income.total) })} · {t("forYou.limitFrom", { tables: income.tables.join(", ") })}
        </div>
        {action.note && <p className="mt-1 text-sm text-ink-2">{action.note[l]}</p>}
      </div>
    ) : moneyTables.length ? (
      <div>
        <p className="text-sm font-semibold">{t("forYou.limitPick")}</p>
        <p className="mb-2 text-sm text-ink-2">{t("forYou.limitPickHint")}</p>
        <div className="flex flex-wrap gap-1.5">
          {moneyTables.map((tb) => (
            <Button
              key={tb.id}
              variant="outline"
              onClick={() => {
                const amount = tb.columns.find((c) => c.type === "money")!;
                const paid = tb.columns.find((c) => c.type === "checkbox" && /(оплач|paid|bezahlt|pagad|отрим|получ)/i.test(c.name));
                dispatch({ type: "table.update", tableId: tb.id, patch: { ledger: { amountId: amount.id, kind: "income", ...(paid ? { paidColumnId: paid.id } : {}) } } }, t("table.money"));
              }}
            >
              {tb.name}
            </Button>
          ))}
        </div>
      </div>
    ) : (
      <p className="text-sm text-ink-2">{t("forYou.limitNone")}</p>
    );
  } else if (action?.type === "goals") {
    const goals = ws.tables.filter((tb) => tb.goal);
    if (!goals.length) return null;
    control = (
      <ul className="space-y-3">
        {goals.map((tb) => {
          const p = goalProgress(tb.goal!, computedRows(tb, today, ws), today, ledgerOf(tb));
          const money = (n: number) => formatNumber(Math.round(n), l, settings.currency);
          return (
            <li key={tb.id}>
              <button type="button" onClick={() => setActiveTable(tb.id)} className="w-full text-left">
                <div className="flex justify-between gap-3 font-semibold">
                  <span>{tb.name}</span>
                  <span>{t("goal.of", { saved: money(p.saved), amount: money(p.amount) })}</span>
                </div>
                <div className="mt-1.5 h-2.5 bg-line">
                  <div className="h-full bg-accent" style={{ width: `${p.share * 100}%` }} />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <li className="border-t border-line py-5">
      <div className="text-xl font-extrabold tracking-tight">{s.title[l]}</div>
      <p className="mt-1 max-w-2xl text-ink-2">{s.body[l]}</p>
      {s.source && (
        <a href={s.source} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-semibold underline underline-offset-4">
          {t("forYou.source")}
        </a>
      )}
      {control && <div className="mt-3">{control}</div>}
    </li>
  );
}

export function ForYouView() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const rules = useStore((s) => s.rules);
  const dismiss = useStore((s) => s.dismiss);
  const [editing, setEditing] = useState(false);
  const due = useDueItems();
  const profile = settings.profile;
  const tips = profile ? suggestionsFor(rules, profile) : [];
  const check = profile?.country === "DE" ? t("forYou.checkDE") : profile?.country === "UA" ? t("forYou.checkUA") : t("forYou.check");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-16 md:px-10 md:pt-8">
      <h1 className="text-[44px] leading-[0.95] font-extrabold tracking-[-0.045em] md:text-[64px]">{t("forYou.title")}</h1>

      {!profile || editing ? (
        <section className="mt-6 max-w-2xl border-t-2 border-rule pt-5">
          <p className="mb-5 text-ink-2">{profile ? t("profile.hint") : t("forYou.setup")}</p>
          <ProfileForm onDone={() => setEditing(false)} />
        </section>
      ) : (
        <>
          <p className="mt-3 text-ink-2">
            {t(`occ.${profile.occupation}`)}, {t(`country.${profile.country}`)}
            {profile.regime !== "none" && <>, {t(`regime.${profile.regime}`)}</>}
            {" — "}
            <button type="button" onClick={() => setEditing(true)} className="font-semibold text-ink underline underline-offset-4">
              {t("forYou.change")}
            </button>
          </p>

          <section className="mt-8 border-t-2 border-rule pt-4">
            <h2 className="text-2xl font-extrabold tracking-tight">{t("forYou.deadlines")}</h2>
            {due.length === 0 ? (
              <p className="mt-3 text-ink-2">{t("forYou.noDeadlines")}</p>
            ) : (
              <ul className="mt-2">
                {due.map((d) => {
                  const urgent = !d.holiday && d.daysLeft <= 5;
                  return (
                    <li key={d.key} className={`grid grid-cols-[5.5rem_1fr] gap-4 border-b border-line py-4 md:grid-cols-[8rem_1fr] ${urgent ? "border-l-4 border-l-late pl-3" : ""}`}>
                      <div>
                        <div className="font-display text-xl leading-none font-bold tracking-tight md:text-2xl">
                          {new Intl.DateTimeFormat(localeTag(settings.locale), { day: "numeric", month: "short" }).format(new Date(`${d.date}T12:00:00`))}
                        </div>
                        <div className={`mt-1 text-sm font-semibold ${urgent ? "text-late" : "text-ink-2"}`}>{whenText(t, d.daysLeft)}</div>
                      </div>
                      <div>
                        <div className="font-bold">{d.title}</div>
                        <div className="text-ink-2">{d.body}</div>
                        {d.amounts.length > 0 && (
                          <ul className="mt-1.5 flex flex-wrap gap-1.5">
                            {d.amounts.map((a) => (
                              <li key={a} className="rounded-full bg-soft px-3 py-1 text-sm font-bold">
                                {a}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                          {d.source && (
                            <a href={d.source} target="_blank" rel="noreferrer" className="text-sm font-semibold underline underline-offset-4">
                              {t("forYou.source")}
                            </a>
                          )}
                          {d.daysLeft < 0 && (
                            <span className="text-sm">
                              <span className="font-semibold text-late">{t("forYou.doneQ")}</span>{" "}
                              <button type="button" onClick={() => dismiss(d.key)} className="font-bold underline underline-offset-4">
                                ✓ {t("forYou.didIt")}
                              </button>
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {tips.length > 0 && (
            <section className="mt-10 border-t-2 border-rule pt-4">
              <h2 className="text-2xl font-extrabold tracking-tight">{t("forYou.tips")}</h2>
              <ul className="mt-1">
                {tips.map((s) => (
                  <SuggestionCard key={s.id} s={s} />
                ))}
              </ul>
            </section>
          )}

          <p className="mt-8 text-sm text-ink-2">
            {check} {t("forYou.updated", { date: formatDate(rules.updated, settings.locale) })}
          </p>
        </>
      )}
    </div>
  );
}

/** One line above a table when something is due within a week (or was missed). */
export function DeadlineBanner() {
  const t = useT();
  const due = useDueItems(7);
  const dismissed = useStore((s) => s.settings.dismissed);
  const dismiss = useStore((s) => s.dismiss);
  const openPage = useStore((s) => s.openPage);
  const next = due.find((d) => !dismissed.includes(d.key));
  if (!next) return null;
  const urgent = next.daysLeft <= 2;
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm md:px-10 ${urgent ? "bg-late text-white" : "bg-ink text-paper"}`} role="status">
      <span className="font-extrabold">{whenText(t, next.daysLeft)}</span>
      <span className="min-w-0 flex-1 font-semibold">
        {next.title}
        {next.amounts.length > 0 && <span className="font-normal opacity-90"> · {next.amounts.join(" · ")}</span>}
      </span>
      <button type="button" className="font-bold underline underline-offset-4" onClick={() => openPage("foryou")}>
        {t("banner.open")}
      </button>
      <button type="button" className="opacity-80 hover:opacity-100" onClick={() => dismiss(next.key)}>
        {next.daysLeft < 0 ? `✓ ${t("forYou.didIt")}` : t("banner.hide")}
      </button>
    </div>
  );
}
