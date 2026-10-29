import { CURRENCIES, LOCALE_RULES, LOCALES, type Locale } from "@higtclass/core";
import { LANGUAGE_NAMES, useT } from "../i18n/index.ts";
import { useActiveTable, useStore, type Theme } from "../store.ts";

const NO_REPORTS: never[] = [];

export const ACCENTS = ["#E5352B", "#1F4FE0", "#FF7A1A", "#6D4AFF", "#7A4B2A", "#E2457A"];

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-display font-bold tracking-[-0.05em] ${className}`}>zifra</span>;
}

const railSelect =
  "w-full rounded-lg border border-white/15 bg-transparent px-2 py-1.5 text-sm text-rail-text outline-none focus:border-white/60 [&>option]:text-black";

export function Sidebar({
  onNewTable,
  onImport,
  onNewReport,
  onNavigate,
}: {
  onNewTable: () => void;
  onImport: () => void;
  onNewReport: () => void;
  onNavigate?: () => void;
}) {
  const t = useT();
  const tables = useStore((s) => s.ws.tables);
  const active = useActiveTable();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setActiveTable = useStore((s) => s.setActiveTable);
  const reports = useStore((s) => s.ws.reports) ?? NO_REPORTS;
  const activeReportId = useStore((s) => s.activeReportId);
  const openReport = useStore((s) => s.openReport);
  const sideButton = "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[15px] text-rail-text hover:bg-white/10";

  const changeLocale = (locale: Locale) => {
    // The currency follows the language only if the person never picked their own.
    const keepCurrency = settings.currency !== LOCALE_RULES[settings.locale].defaultCurrency;
    setSettings({ locale, currency: keepCurrency ? settings.currency : LOCALE_RULES[locale].defaultCurrency });
  };

  return (
    <nav className="flex h-full flex-col gap-7 bg-rail px-4 py-6 text-rail-text" aria-label={t("sidebar.tables")}>
      <Wordmark className="px-2 text-[28px] leading-none" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mb-2 px-2 text-sm font-semibold text-rail-dim">{t("sidebar.tables")}</div>
        <ul className="space-y-0.5">
          {tables.map((tbl) => {
            const on = !activeReportId && active?.id === tbl.id;
            return (
              <li key={tbl.id}>
                <button
                  type="button"
                  aria-current={on ? "page" : undefined}
                  onClick={() => {
                    setActiveTable(tbl.id);
                    onNavigate?.();
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[15px] transition ${
                    on
                      ? settings.accent
                        ? "font-bold text-white"
                        : "bg-white font-bold text-black"
                      : "text-rail-text hover:bg-white/10"
                  }`}
                  style={on && settings.accent ? { background: settings.accent } : undefined}
                >
                  <span className={`h-2 w-2 shrink-0 ${on ? "bg-current" : "bg-rail-dim"}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{tbl.name}</span>
                  <span className={`text-xs ${on ? "opacity-70" : "text-rail-dim"}`}>{tbl.rows.length || ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={onNewTable}
          className="mt-2 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[15px] font-semibold text-rail-text hover:bg-white/10"
        >
          <span className="w-4 text-center">＋</span>
          {t("sidebar.newTable")}
        </button>
        <button type="button" onClick={onImport} className={sideButton}>
          <span className="w-4 text-center">↥</span>
          {t("sidebar.import")}
        </button>

        {tables.length > 0 && (
          <>
            <div className="mt-6 mb-2 px-2 text-sm font-semibold text-rail-dim">{t("sidebar.reports")}</div>
            <ul className="space-y-0.5">
              {reports.map((r) => {
                const on = activeReportId === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-current={on ? "page" : undefined}
                      onClick={() => {
                        openReport(r.id);
                        onNavigate?.();
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[15px] transition ${
                        on ? (settings.accent ? "font-bold text-white" : "bg-white font-bold text-black") : "text-rail-text hover:bg-white/10"
                      }`}
                      style={on && settings.accent ? { background: settings.accent } : undefined}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 opacity-80">
                        <path d="M2 14h12M4 11V7M8 11V3M12 11V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={onNewReport} className={`${sideButton} mt-1 font-semibold`}>
              <span className="w-4 text-center">＋</span>
              {t("sidebar.newReport")}
            </button>
          </>
        )}
      </div>

      <details className="group rounded-xl border border-white/10">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-semibold text-rail-text">
          {t("sidebar.settings")}
          <span className="text-rail-dim transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="space-y-3 px-3 pb-3">
          <label className="block text-xs text-rail-dim">
            {t("settings.language")}
            <select className={`${railSelect} mt-1`} value={settings.locale} onChange={(e) => changeLocale(e.target.value as Locale)}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_NAMES[l]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-rail-dim">
            {t("settings.currency")}
            <select className={`${railSelect} mt-1`} value={settings.currency} onChange={(e) => setSettings({ currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-rail-dim">
            {t("settings.theme")}
            <div className="mt-1 grid grid-cols-3 gap-1 rounded-lg border border-white/15 p-0.5">
              {(["system", "light", "dark"] as Theme[]).map((th) => (
                <button
                  key={th}
                  type="button"
                  onClick={() => setSettings({ theme: th })}
                  className={`rounded-md py-1 text-xs font-semibold ${settings.theme === th ? "bg-white text-black" : "text-rail-text hover:bg-white/10"}`}
                >
                  {t(`theme.${th}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-rail-dim">
            {t("settings.accent")}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSettings({ accent: null })}
                title={t("accent.none")}
                aria-label={t("accent.none")}
                aria-pressed={settings.accent === null}
                className={`h-6 w-6 rounded-full border-2 bg-[linear-gradient(135deg,#fff_50%,#000_50%)] ${settings.accent === null ? "border-white ring-2 ring-white/40" : "border-white/30"}`}
              />
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSettings({ accent: c })}
                  aria-label={c}
                  aria-pressed={settings.accent === c}
                  className={`h-6 w-6 rounded-full border-2 ${settings.accent === c ? "border-white ring-2 ring-white/40" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
      </details>
      <p className="px-2 text-xs text-rail-dim">{t("sidebar.saved")}</p>
    </nav>
  );
}
