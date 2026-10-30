import { dateOrder, LOCALE_RULES, localeTag } from "./locale.ts";
import type { CellValue, Column, Locale, Settings } from "./types.ts";

// Turning loose human input ("1 500,50", "5к", "вчера", "так") into typed
// cell values, and typed values back into display strings.

const CURRENCY_NOISE =
  /[₽₴$€£¥₸]|(?<!\p{L})(руб\p{L}*|р|грн|гривен\p{L}*|uah|rub|usd|eur|euros?|евро|доллар\p{L}*|dollars?|zł|pln)(?!\p{L})\.?/giu;

/**
 * `money`: amounts never have three decimals, so "1.500" or "1,500" with a
 * single separator before exactly three digits is read as one thousand five
 * hundred in every language instead of 1.5.
 */
export function parseNumber(raw: unknown, locale: Locale, opts: { money?: boolean } = {}): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const rules = LOCALE_RULES[locale];
  let s = raw.trim().toLowerCase().replace(/−/g, "-").replace(CURRENCY_NOISE, "");
  s = s.replace(/[\s  ']/g, "");
  if (!s) return null;

  let mult = 1;
  const suffix = s.match(/^([-+]?[\d.,]+)([\p{L}.]+)$/u);
  if (suffix) {
    const word = suffix[2].replace(/\.$/, "");
    if (!(word in rules.multipliers)) return null;
    mult = rules.multipliers[word];
    s = suffix[1];
  }
  if (!/^[-+]?[\d.,]*\d[\d.,]*$/.test(s)) return null;

  const normalized = normalizeSeparators(s, rules.decimal, opts.money ?? false);
  if (normalized === null) return null;
  const n = Number(normalized) * mult;
  return Number.isFinite(n) ? n : null;
}

/** Resolve which of `,` / `.` is the decimal mark and return a JS number string. */
function normalizeSeparators(s: string, decimal: "," | ".", money: boolean): string | null {
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  if (commas && dots) {
    // Whichever comes last is the decimal mark: 1.500,50 / 1,500.50
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const thousands = dec === "," ? "." : ",";
    if ((dec === "," ? commas : dots) > 1) return null;
    return s.split(thousands).join("").replace(dec, ".");
  }
  const sep = commas ? "," : dots ? "." : null;
  if (!sep) return s;
  const sign = s.startsWith("-") ? "-" : "";
  const groups = s.replace(/^[-+]/, "").split(sep);
  const looksGrouped =
    groups[0].length >= 1 && groups[0].length <= 3 && groups.slice(1).every((g) => g.length === 3);
  // Repeated separator can only be thousands grouping: 1.000.000
  if (commas + dots > 1) return looksGrouped ? sign + groups.join("") : null;
  // A single separator: the locale's decimal mark is a decimal; the other one
  // is a thousands separator only when followed by exactly three digits.
  if (!looksGrouped || (sep === decimal && !(money && groups[0] !== "0"))) return sign + groups.join(".");
  return sign + groups.join("");
}

function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayISO(now = new Date()): string {
  return iso(now);
}

function validDate(y: number, m: number, d: number): string | null {
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return iso(date);
}

export function parseDate(raw: unknown, locale: Locale, now = new Date()): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const rules = LOCALE_RULES[locale];
  if (s in rules.relativeDays) {
    const d = new Date(now);
    d.setDate(d.getDate() + rules.relativeDays[s]);
    return iso(d);
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?\.?$/);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    const [day, month] = dateOrder(locale) === "DMY" ? [a, b] : [b, a];
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
    return validDate(year, month, day);
  }
  return null;
}

export function parseBoolean(raw: unknown, locale: Locale): boolean | null {
  if (typeof raw === "boolean") return raw;
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  const rules = LOCALE_RULES[locale];
  if (rules.trueWords.includes(s)) return true;
  if (rules.falseWords.includes(s)) return false;
  return null;
}

/**
 * Convert raw input for a column. Returns `undefined` when the input is not
 * understood (so callers can reject it), `null` for an intentionally empty cell.
 */
export function parseValue(
  column: Column,
  raw: unknown,
  locale: Locale,
  now = new Date(),
): CellValue | undefined {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return null;
  let v: CellValue;
  switch (column.type) {
    case "number":
    case "money":
      v = parseNumber(raw, locale, { money: column.type === "money" });
      break;
    case "date":
      v = parseDate(raw, locale, now);
      break;
    case "checkbox":
      v = parseBoolean(raw, locale);
      break;
    case "formula":
    case "lookup":
    case "rollup":
      return undefined;
    case "photo":
      // A receipt photo, stored as a small JPEG data URL.
      return typeof raw === "string" && raw.startsWith("data:image/") ? raw : undefined;
    case "text":
    case "select":
    case "link":
      // Links are resolved to row ids by the commands, which can see the target table.
      return String(raw).trim();
  }
  return v === null ? undefined : v;
}

/** Re-interpret an already stored value after a column changes type. */
export function convertValue(value: CellValue, to: Column, locale: Locale): CellValue {
  if (value === null) return null;
  if (to.type === "formula" || to.type === "lookup" || to.type === "rollup") return null;
  if (to.type === "photo") return typeof value === "string" && value.startsWith("data:image/") ? value : null;
  if (typeof value === "boolean" && (to.type === "text" || to.type === "select")) {
    return value ? LOCALE_RULES[locale].trueWords[0] : LOCALE_RULES[locale].falseWords[0];
  }
  if (typeof value === "number" && (to.type === "text" || to.type === "select")) {
    return String(value);
  }
  const parsed = parseValue(to, typeof value === "string" ? value : String(value), locale);
  return parsed === undefined ? null : parsed;
}

const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: () => T): T {
  let f = formatters.get(key);
  if (!f) {
    f = make();
    formatters.set(key, f);
  }
  return f as T;
}

export function formatNumber(n: number, locale: Locale, currency?: string, digits = 4): string {
  const tag = localeTag(locale);
  if (currency) {
    // Whole amounts read better without ",00".
    const whole = Number.isInteger(n);
    return cached(`m:${tag}:${currency}:${whole}`, () =>
      new Intl.NumberFormat(tag, {
        style: "currency",
        currency,
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2,
      }),
    ).format(n);
  }
  return cached(`n:${tag}:${digits}`, () => new Intl.NumberFormat(tag, { maximumFractionDigits: digits })).format(n);
}

export function formatDate(isoDate: string, locale: Locale): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const tag = localeTag(locale);
  return cached(`d:${tag}`, () =>
    new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" }),
  ).format(new Date(y, m - 1, d));
}

export function formatValue(column: Column, value: CellValue, settings: Settings): string {
  if (value === null || value === undefined) return "";
  switch (column.type) {
    case "money":
      return typeof value === "number"
        ? formatNumber(value, settings.locale, column.currency ?? settings.currency)
        : String(value);
    case "number":
      return typeof value === "number" ? formatNumber(value, settings.locale) : String(value);
    case "formula":
    case "rollup":
      // Calculated numbers: two decimals are plenty (1 816,67, not 1 816,6667).
      return typeof value === "number" ? formatNumber(value, settings.locale, undefined, 2) : String(value);
    case "date":
      return typeof value === "string" ? formatDate(value, settings.locale) : String(value);
    case "checkbox":
      return value ? "✓" : "";
    case "photo":
      return value ? "📎" : "";
    default:
      return String(value);
  }
}

/** Value as the user would type it back into an editor field. */
export function editableValue(column: Column, value: CellValue, locale: Locale): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    const s = String(value);
    return LOCALE_RULES[locale].decimal === "," ? s.replace(".", ",") : s;
  }
  if (typeof value === "boolean") return value ? "1" : "";
  return String(value);
}

/** Numeric date for files: 30.10.2026 / 30/10/2026 / 10/30/2026, so Excel reads it as a date. */
export function formatDateNumeric(isoDate: string, locale: Locale): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const tag = localeTag(locale);
  return cached(`dn:${tag}`, () => new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric" })).format(
    new Date(y, m - 1, d),
  );
}

const CURRENCY_SIGNS: [RegExp, string][] = [
  [/\$|\busd\b|долл|долар|dollar/i, "USD"],
  [/€|\beur\b|евро|євро|euro/i, "EUR"],
  [/₴|грн|гривн|\buah\b/i, "UAH"],
  [/₽|руб|\brub\b/i, "RUB"],
  [/£|\bgbp\b/i, "GBP"],
  [/zł|\bpln\b/i, "PLN"],
];

/** The currency written next to an amount ("$800", "800 грн"), if any. */
export function currencyIn(raw: string): string | null {
  return CURRENCY_SIGNS.find(([re]) => re.test(raw))?.[1] ?? null;
}
