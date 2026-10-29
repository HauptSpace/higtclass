import { CURRENCIES, LOCALE_RULES, LOCALES, type Locale } from "@higtclass/core";
import { LANGUAGE_NAMES, useT } from "../i18n/index.ts";
import { useActiveTable, useStore } from "../store.ts";
import { inputClass } from "./ui.tsx";

export function Sidebar({ onNewTable, onNavigate }: { onNewTable: () => void; onNavigate?: () => void }) {
  const t = useT();
  const tables = useStore((s) => s.ws.tables);
  const active = useActiveTable();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setActiveTable = useStore((s) => s.setActiveTable);

  const changeLocale = (locale: Locale) => {
    // Switching language also switches the default currency only if the user
    // never picked one different from the old language's default.
    const keepCurrency = settings.currency !== LOCALE_RULES[settings.locale].defaultCurrency;
    setSettings({ locale, currency: keepCurrency ? settings.currency : LOCALE_RULES[locale].defaultCurrency });
    document.documentElement.lang = locale;
  };

  return (
    <nav className="flex h-full flex-col gap-4 p-4">
      <div className="px-2">
        <div className="text-xl font-extrabold tracking-tight">
          higt<span className="text-brand-600">class</span>
        </div>
        <div className="text-xs text-zinc-500">{t("app.tagline")}</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mb-1 px-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">{t("sidebar.tables")}</div>
        <ul className="space-y-0.5">
          {tables.map((tbl) => (
            <li key={tbl.id}>
              <button
                type="button"
                onClick={() => {
                  setActiveTable(tbl.id);
                  onNavigate?.();
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition ${
                  active?.id === tbl.id
                    ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-100"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <span className="text-lg leading-none">{tbl.icon}</span>
                <span className="min-w-0 flex-1 truncate">{tbl.name}</span>
                <span className="text-xs text-zinc-400">{tbl.rows.length || ""}</span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onNewTable}
          className="mt-2 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10"
        >
          <span className="text-lg leading-none">＋</span>
          {t("sidebar.newTable")}
        </button>
      </div>

      <div className="space-y-2 rounded-2xl bg-zinc-100 p-3 dark:bg-zinc-900">
        <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">{t("sidebar.settings")}</div>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>{t("settings.language")}</span>
          <select className={`${inputClass} !w-36 !py-1.5`} value={settings.locale} onChange={(e) => changeLocale(e.target.value as Locale)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>{t("settings.currency")}</span>
          <select className={`${inputClass} !w-36 !py-1.5`} value={settings.currency} onChange={(e) => setSettings({ currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="px-2 text-xs text-zinc-400">🤖 {t("assistant.soon")}</p>
    </nav>
  );
}
