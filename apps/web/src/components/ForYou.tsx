import {
  addColumn,
  createTable,
  DEFAULT_RULES,
  formatDate,
  formatNumber,
  localeTag,
  incomeThisYear,
  isRulePack,
  REGIMES,
  suggestionsFor,
  TEMPLATES,
  upcomingDeadlines,
  upcomingHolidays,
  type Country,
  type Occupation,
  type Profile,
  type Suggestion,
  type TaxRegime,
} from "@higtclass/core";
import { useEffect, useMemo, useState } from "react";
import { useT, type Translate } from "../i18n/index.ts";
import { useToday } from "../lib.ts";
import { useActiveTable, useStore } from "../store.ts";
import { Button } from "./ui.tsx";

// "Для вас": deadlines, bank holidays and tips picked for the person's country
// and tax situation. The rules come from the server so they can be updated
// without a new release; the bundled pack works offline.

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

/** Load the latest rule pack once per app start. */
export function useRulesSync() {
  const setRules = useStore((s) => s.setRules);
  useEffect(() => {
    setRules(DEFAULT_RULES);
    fetch(`${API}/api/rules`)
      .then((r) => (r.ok ? r.json() : null))
      .then((pack: unknown) => isRulePack(pack) && setRules(pack))
      .catch(() => {
        /* offline: keep what we have */
      });
  }, [setRules]);
}

export interface DueItem {
  key: string;
  date: string;
  daysLeft: number;
  title: string;
  body: string;
  source?: string;
  holiday?: boolean;
}

export function useDueItems(days = 45): DueItem[] {
  const today = useToday();
  const rules = useStore((s) => s.rules);
  const settings = useStore((s) => s.settings);
  const t = useT();
  return useMemo(() => {
    const profile = settings.profile;
    if (!profile) return [];
    const l = settings.locale;
    const deadlines: DueItem[] = upcomingDeadlines(rules, profile, today, days).map((u) => ({
      key: `${u.deadline.id}@${u.date}`,
      date: u.date,
      daysLeft: u.daysLeft,
      title: u.deadline.title[l],
      body: u.deadline.body[l],
      source: u.deadline.source,
    }));
    const holidays: DueItem[] = upcomingHolidays(profile, today, days).map((h) => ({
      key: `holiday@${h.date}`,
      date: h.date,
      daysLeft: h.daysLeft,
      title: h.name,
      body: t("forYou.holiday"),
      holiday: true,
    }));
    return [...deadlines, ...holidays].sort((a, b) => a.date.localeCompare(b.date));
  }, [rules, settings.profile, settings.locale, today, days, t]);
}

export function whenText(t: Translate, daysLeft: number) {
  if (daysLeft === 0) return t("forYou.today");
  if (daysLeft === 1) return t("forYou.tomorrow");
  return t("forYou.inDays", { n: daysLeft });
}

function Chips<T extends string>({ value, options, label, onPick }: { value: T | null; options: T[]; label: (o: T) => string; onPick: (o: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onPick(o)}
          className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold transition ${value === o ? "border-ink bg-ink text-paper" : "border-line hover:border-ink"}`}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

export function ProfileForm({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const profile = useStore((s) => s.settings.profile);
  const setSettings = useStore((s) => s.setSettings);
  const [draft, setDraft] = useState<Partial<Profile>>(profile ?? {});

  const update = (patch: Partial<Profile>) => {
    const next = { ...draft, ...patch };
    if (patch.country && next.regime && !REGIMES[patch.country].includes(next.regime)) next.regime = undefined;
    if (next.occupation === "personal") next.regime = "none";
    setDraft(next);
    if (next.country && next.occupation && next.regime) setSettings({ profile: next as Profile });
  };

  const regimes = draft.country ? REGIMES[draft.country] : [];
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-sm font-semibold text-ink-2">{t("profile.country")}</div>
        <Chips<Country> value={draft.country ?? null} options={["DE", "UA", "other"]} label={(o) => t(`country.${o}`)} onPick={(country) => update({ country })} />
      </div>
      {draft.country && (
        <div>
          <div className="mb-2 text-sm font-semibold text-ink-2">{t("profile.occupation")}</div>
          <Chips<Occupation> value={draft.occupation ?? null} options={["personal", "self", "company"]} label={(o) => t(`occ.${o}`)} onPick={(occupation) => update({ occupation })} />
        </div>
      )}
      {draft.country && draft.occupation && draft.occupation !== "personal" && regimes.length > 1 && (
        <div>
          <div className="mb-2 text-sm font-semibold text-ink-2">{t("profile.regime")}</div>
          <Chips<TaxRegime> value={draft.regime ?? null} options={regimes} label={(o) => t(`regime.${o}`)} onPick={(regime) => update({ regime })} />
        </div>
      )}
      {onDone && draft.country && draft.occupation && draft.regime && (
        <Button variant="primary" onClick={onDone}>
          {t("forYou.done")}
        </Button>
      )}
    </div>
  );
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

  const moneyTable = active?.columns.some((c) => c.type === "money") ? active : ws.tables.find((tb) => tb.columns.some((c) => c.type === "money"));
  const moneyCol = moneyTable?.columns.find((c) => c.type === "money");

  let control: React.ReactNode = null;
  if (action?.type === "template") {
    const tpl = TEMPLATES.find((x) => x.id === action.templateId);
    if (tpl)
      control = (
        <Button
          variant="outline"
          onClick={() => {
            const res = createTable({ name: tpl.name[l], icon: tpl.icon, columns: tpl.columns(l) }, { locale: l });
            if (dispatch(res.op, s.title[l])) {
              setActiveTable(res.table.id);
              showToast(t("forYou.added"));
            }
          }}
        >
          {t("forYou.useTemplate")}
        </Button>
      );
  } else if (action?.type === "column") {
    const name = action.column.name[l];
    const exists = moneyTable?.columns.some((c) => c.name.toLowerCase() === name.toLowerCase());
    control =
      !moneyTable || !moneyCol ? (
        <p className="text-sm text-ink-2">{t("forYou.needMoney")}</p>
      ) : exists ? (
        <p className="text-sm font-semibold">✓ {t("forYou.added")}</p>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            const res = addColumn(moneyTable, { name, type: action.column.type, formula: action.column.formula?.replaceAll("{money}", moneyCol.name) });
            if (dispatch(res.op, name)) showToast(t("forYou.added"));
          }}
        >
          {t("forYou.addColumn", { table: moneyTable.name })}
        </Button>
      );
  } else if (action?.type === "limit") {
    const income = incomeThisYear(ws, today);
    const money = (n: number) => formatNumber(n, l, action.currency);
    const share = Math.min(1, income.total / action.amount);
    control = income.tables.length ? (
      <div>
        <div className="font-display text-2xl font-bold tracking-tight">{t("forYou.limitLeft", { left: money(Math.max(0, action.amount - income.total)) })}</div>
        <div className="mt-2 h-2.5 bg-line" aria-hidden="true">
          <div className="h-full" style={{ width: `${share * 100}%`, background: share > 0.9 ? "var(--late)" : share > 0.75 ? "var(--wait)" : "var(--ink)" }} />
        </div>
        <div className="mt-1.5 text-sm text-ink-2">
          {t("forYou.limitOf", { used: money(income.total), limit: money(action.amount) })} · {t("forYou.limitFrom", { tables: income.tables.join(", ") })}
        </div>
      </div>
    ) : (
      <p className="text-sm text-ink-2">{t("forYou.limitNone")}</p>
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
  const [editing, setEditing] = useState(false);
  const due = useDueItems();
  const profile = settings.profile;
  const tips = profile ? suggestionsFor(rules, profile) : [];

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
            {t(`country.${profile.country}`)}, {t(`occ.${profile.occupation}`)}
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
                {due.map((d) => (
                  <li key={d.key} className="grid grid-cols-[5.5rem_1fr] gap-4 border-b border-line py-4 md:grid-cols-[8rem_1fr]">
                    <div>
                      <div className="font-display text-xl leading-none font-bold tracking-tight md:text-2xl">{new Intl.DateTimeFormat(localeTag(settings.locale), { day: "numeric", month: "short" }).format(new Date(`${d.date}T12:00:00`))}</div>
                      <div className={`mt-1 text-sm font-semibold ${d.daysLeft <= 3 ? "text-late" : "text-ink-2"}`}>{whenText(t, d.daysLeft)}</div>
                    </div>
                    <div>
                      <div className="font-bold">{d.title}</div>
                      <div className="text-ink-2">{d.body}</div>
                      {d.source && (
                        <a href={d.source} target="_blank" rel="noreferrer" className="text-sm font-semibold underline underline-offset-4">
                          {t("forYou.source")}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
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
            {t("forYou.check")} {t("forYou.updated", { date: formatDate(rules.updated, settings.locale) })}
          </p>
        </>
      )}
    </div>
  );
}

/** One line above a table when something is due within a week. */
export function DeadlineBanner() {
  const t = useT();
  const due = useDueItems(7);
  const dismissed = useStore((s) => s.settings.dismissed);
  const dismiss = useStore((s) => s.dismiss);
  const openPage = useStore((s) => s.openPage);
  const next = due.find((d) => !dismissed.includes(d.key));
  if (!next) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm md:px-10 ${next.daysLeft <= 2 ? "bg-late text-white" : "bg-ink text-paper"}`} role="status">
      <span className="font-extrabold">{whenText(t, next.daysLeft)}</span>
      <span className="min-w-0 flex-1 font-semibold">{next.title}</span>
      <button type="button" className="font-bold underline underline-offset-4" onClick={() => openPage("foryou")}>
        {t("banner.open")}
      </button>
      <button type="button" className="opacity-80 hover:opacity-100" onClick={() => dismiss(next.key)}>
        {t("banner.hide")}
      </button>
    </div>
  );
}
