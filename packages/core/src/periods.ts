import { localeTag } from "./locale.ts";
import type { GroupKind, Locale, Period, PeriodKind } from "./types.ts";

// Time windows people think in — this week, last month, Q3, this year — and
// the keys and labels for grouping dates by week, month, quarter or year.

const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

function monday(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

export interface DateRange {
  from: string;
  to: string;
}

/** Inclusive date range of a period relative to today; null means "no limit". */
export function periodRange(period: Pick<Period, "kind" | "from" | "to"> | null | undefined, today: string): DateRange | null {
  if (!period || period.kind === "all") return null;
  const t = parse(today);
  const y = t.getFullYear();
  const m = t.getMonth();
  const q = Math.floor(m / 3);
  const range = (a: Date, b: Date) => ({ from: iso(a), to: iso(b) });
  switch (period.kind) {
    case "week": {
      const a = monday(t);
      const b = new Date(a);
      b.setDate(b.getDate() + 6);
      return range(a, b);
    }
    case "nextWeek": {
      const a = monday(t);
      a.setDate(a.getDate() + 7);
      const b = new Date(a);
      b.setDate(b.getDate() + 6);
      return range(a, b);
    }
    case "month":
      return range(new Date(y, m, 1), new Date(y, m + 1, 0));
    case "prevMonth":
      return range(new Date(y, m - 1, 1), new Date(y, m, 0));
    case "nextMonth":
      return range(new Date(y, m + 1, 1), new Date(y, m + 2, 0));
    case "quarter":
      return range(new Date(y, q * 3, 1), new Date(y, q * 3 + 3, 0));
    case "prevQuarter":
      return range(new Date(y, q * 3 - 3, 1), new Date(y, q * 3, 0));
    case "year":
      return range(new Date(y, 0, 1), new Date(y, 11, 31));
    case "prevYear":
      return range(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31));
    case "custom":
      return { from: period.from || "0000-01-01", to: period.to || "9999-12-31" };
  }
}

/** The same-length period just before (for "vs last month"). */
export function previousPeriod(kind: PeriodKind): PeriodKind | null {
  switch (kind) {
    case "month":
      return "prevMonth";
    case "quarter":
      return "prevQuarter";
    case "year":
      return "prevYear";
    default:
      return null;
  }
}

export function inRange(date: unknown, range: DateRange | null): boolean {
  if (!range) return true;
  return typeof date === "string" && date.slice(0, 10) >= range.from && date.slice(0, 10) <= range.to;
}

export const PERIOD_KINDS: PeriodKind[] = ["all", "week", "nextWeek", "month", "prevMonth", "nextMonth", "quarter", "prevQuarter", "year", "prevYear", "custom"];

/** Group key of a date: week → its Monday, month → YYYY-MM, quarter → YYYY-Qn, year → YYYY. */
export function dateKey(kind: Exclude<GroupKind, "column">, date: string): string {
  if (kind === "year") return date.slice(0, 4);
  if (kind === "month") return date.slice(0, 7);
  if (kind === "quarter") return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  return iso(monday(parse(date)));
}

const QUARTER_WORD: Record<Locale, (q: number, y: string) => string> = {
  ru: (q, y) => `${["I", "II", "III", "IV"][q - 1]} кв. ${y}`,
  uk: (q, y) => `${["I", "II", "III", "IV"][q - 1]} кв. ${y}`,
  en: (q, y) => `Q${q} ${y}`,
  de: (q, y) => `Q${q} ${y}`,
  es: (q, y) => `T${q} ${y}`,
};

/** Human label for a group key: "окт. 2026", "Q3 2026", "26 Oct – 1 Nov". */
export function dateKeyLabel(kind: Exclude<GroupKind, "column">, key: string, locale: Locale): string {
  const tag = localeTag(locale);
  if (kind === "year") return key;
  if (kind === "quarter") return QUARTER_WORD[locale](Number(key.slice(-1)), key.slice(0, 4));
  if (kind === "month") {
    const s = new Intl.DateTimeFormat(tag, { month: "short", year: "numeric" }).format(parse(`${key}-01`));
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const a = parse(key);
  const b = new Date(a);
  b.setDate(b.getDate() + 6);
  const f = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" });
  return `${f.format(a)} – ${f.format(b)}`;
}

/** Every key between two keys, so empty months still show as zero in a chart. */
export function keysBetween(kind: Exclude<GroupKind, "column">, first: string, last: string): string[] {
  const out: string[] = [];
  if (first > last) return out;
  if (kind === "year") {
    for (let y = Number(first); y <= Number(last) && out.length < 200; y++) out.push(String(y));
    return out;
  }
  if (kind === "quarter") {
    let y = Number(first.slice(0, 4));
    let q = Number(first.slice(-1));
    while (out.length < 400) {
      const k = `${y}-Q${q}`;
      out.push(k);
      if (k === last) break;
      q++;
      if (q > 4) {
        q = 1;
        y++;
      }
    }
    return out;
  }
  if (kind === "month") {
    const d = parse(`${first}-01`);
    while (out.length < 600) {
      const k = iso(d).slice(0, 7);
      out.push(k);
      if (k >= last) break;
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }
  const d = parse(first);
  while (out.length < 600) {
    const k = iso(d);
    out.push(k);
    if (k >= last) break;
    d.setDate(d.getDate() + 7);
  }
  return out;
}
