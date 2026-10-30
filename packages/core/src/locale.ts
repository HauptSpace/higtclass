import type { Locale } from "./types.ts";

// Per-language knowledge used to understand loose human input.

interface LocaleRules {
  /** BCP 47 tag for Intl formatting and speech recognition. */
  tag: string;
  decimal: "," | ".";
  /** Order of day/month in numeric dates like 03/04. */
  dateOrder: "DMY" | "MDY";
  /** Relative day words → offset from today. */
  relativeDays: Record<string, number>;
  /** Number suffixes like "5к" or "5 mil" → multiplier. */
  multipliers: Record<string, number>;
  trueWords: string[];
  falseWords: string[];
  defaultCurrency: string;
}

const COMMON_TRUE = ["true", "1", "+", "✓", "✔", "x", "yes"];
const COMMON_FALSE = ["false", "0", "-", "no"];

export const LOCALE_RULES: Record<Locale, LocaleRules> = {
  ru: {
    tag: "ru-RU",
    decimal: ",",
    dateOrder: "DMY",
    relativeDays: { сегодня: 0, вчера: -1, позавчера: -2, завтра: 1, послезавтра: 2 },
    multipliers: { к: 1e3, тыс: 1e3, т: 1e3, k: 1e3, м: 1e6, млн: 1e6, лям: 1e6, млрд: 1e9 },
    trueWords: ["да", "есть", "готово", "сделано", ...COMMON_TRUE],
    falseWords: ["нет", ...COMMON_FALSE],
    defaultCurrency: "RUB",
  },
  uk: {
    tag: "uk-UA",
    decimal: ",",
    dateOrder: "DMY",
    relativeDays: { сьогодні: 0, вчора: -1, учора: -1, позавчора: -2, завтра: 1, післязавтра: 2 },
    multipliers: { к: 1e3, тис: 1e3, т: 1e3, k: 1e3, м: 1e6, млн: 1e6, млрд: 1e9 },
    trueWords: ["так", "є", "готово", "зроблено", ...COMMON_TRUE],
    falseWords: ["ні", ...COMMON_FALSE],
    defaultCurrency: "UAH",
  },
  en: {
    tag: "en-US",
    decimal: ".",
    dateOrder: "MDY",
    relativeDays: { today: 0, yesterday: -1, tomorrow: 1 },
    multipliers: { k: 1e3, thousand: 1e3, m: 1e6, mln: 1e6, million: 1e6, bn: 1e9, b: 1e9 },
    trueWords: ["y", "done", ...COMMON_TRUE],
    falseWords: ["n", ...COMMON_FALSE],
    defaultCurrency: "EUR",
  },
  de: {
    tag: "de-DE",
    decimal: ",",
    dateOrder: "DMY",
    relativeDays: { heute: 0, gestern: -1, vorgestern: -2, morgen: 1, übermorgen: 2 },
    multipliers: { k: 1e3, tsd: 1e3, tausend: 1e3, mio: 1e6, million: 1e6, mrd: 1e9 },
    trueWords: ["ja", "erledigt", ...COMMON_TRUE],
    falseWords: ["nein", ...COMMON_FALSE],
    defaultCurrency: "EUR",
  },
  es: {
    tag: "es-ES",
    decimal: ",",
    dateOrder: "DMY",
    relativeDays: { hoy: 0, ayer: -1, anteayer: -2, antier: -2, mañana: 1, "pasado mañana": 2 },
    multipliers: { k: 1e3, mil: 1e3, m: 1e6, millón: 1e6, millones: 1e6, mill: 1e6 },
    trueWords: ["sí", "si", "hecho", "listo", ...COMMON_TRUE],
    falseWords: COMMON_FALSE,
    defaultCurrency: "EUR",
  },
};

export const CURRENCIES = ["EUR", "USD", "UAH", "GBP", "PLN", "CHF", "CZK", "TRY", "KZT", "BYN", "RUB"];

/** Currencies with the one in use first, then those that fit the language, then the rest. */
export function currencyChoices(locale: Locale, current?: string): string[] {
  const first: Record<Locale, string[]> = {
    uk: ["UAH", "EUR", "USD", "PLN"],
    ru: ["EUR", "USD", "UAH"],
    en: ["EUR", "USD", "GBP"],
    de: ["EUR", "CHF", "USD"],
    es: ["EUR", "USD"],
  };
  return [...new Set([...(current ? [current] : []), ...first[locale], ...CURRENCIES])];
}

// The browser's region refines formatting inside a language: en-GB writes
// 30/10/2026 and en-US 10/30/2026, de-AT and de-DE agree. Set once at startup.
let region: string | null = null;

export function setRegion(tag: string | null | undefined): void {
  region = tag && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(tag) ? tag : null;
}

export function localeTag(locale: Locale): string {
  if (region && region.split("-")[0].toLowerCase() === locale && region.includes("-")) return region;
  // English outside the US: day before month.
  return locale === "en" ? "en-GB" : LOCALE_RULES[locale].tag;
}

/** Day/month order for numeric dates in the current language and region. */
export function dateOrder(locale: Locale): "DMY" | "MDY" {
  if (locale !== "en") return LOCALE_RULES[locale].dateOrder;
  return /^en-(US|PH|CA)$/i.test(localeTag(locale)) ? "MDY" : "DMY";
}

const REGION_CURRENCY: Record<string, string> = {
  UA: "UAH", US: "USD", GB: "GBP", PL: "PLN", CH: "CHF", CZ: "CZK", TR: "TRY", KZ: "KZT", BY: "BYN", RU: "RUB",
  CA: "USD", AU: "USD",
};
const EURO = ["DE", "AT", "ES", "FR", "IT", "NL", "BE", "IE", "PT", "FI", "GR", "SK", "SI", "LT", "LV", "EE", "LU", "MT", "CY", "HR"];

/** A sensible default currency for a browser language like "en-GB" or "es-MX". */
export function currencyForLanguage(tag: string, locale: Locale): string {
  const country = tag.split("-")[1]?.toUpperCase();
  if (country && EURO.includes(country)) return "EUR";
  if (country && REGION_CURRENCY[country]) return REGION_CURRENCY[country];
  return LOCALE_RULES[locale].defaultCurrency;
}

/** Best-effort match of a browser language like "uk-UA" to a supported locale. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const lang of languages) {
    const base = lang.toLowerCase().split("-")[0];
    if (base === "ru" || base === "uk" || base === "en" || base === "de" || base === "es") return base;
    if (base === "be" || base === "kk") return "ru";
  }
  return "en";
}
