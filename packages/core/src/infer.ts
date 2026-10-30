import type { ColumnDraft } from "./commands.ts";
import type { Locale } from "./types.ts";
import { parseBoolean, parseDate, parseNumber } from "./values.ts";

// Importing someone's old Excel or CSV: look at each column's values and guess
// the type a person would have picked — dates, money, choices, checkboxes —
// so the imported table works like a Zifra table from the first minute.

/** One raw cell from a file: what a spreadsheet reader hands back. */
export type RawCell = string | number | boolean | Date | null | undefined;

const MONEY_HEADER = /(сумм|сума|цен|ціна|стоим|вартість|оплат|выручк|виручк|доход|дохід|расход|витрат|итог|разом|баланс|долг|борг|закуп|себестоим|собівар|price|amount|cost|total|revenue|income|expense|paid|balance|salary|purchase|betrag|preis|kosten|summe|umsatz|gehalt|einkauf|importe|precio|coste|total|ingreso|gasto|saldo|salario|compra|зарплат)/i;
const CURRENCY_MARK = /[₽₴$€£¥₸]|руб|грн|uah|rub|usd|eur/i;
const HEADER_CURRENCY: [RegExp, string][] = [
  [/€|\beur\b|евро|євро|euro/i, "EUR"],
  [/\$|\busd\b|доллар|долар/i, "USD"],
  [/₴|грн|\buah\b/i, "UAH"],
  [/₽|руб|\brub\b/i, "RUB"],
  [/£|\bgbp\b/i, "GBP"],
  [/zł|\bpln\b/i, "PLN"],
  [/\bchf\b/i, "CHF"],
];
/** A row that totals the ones above it: skip it on import, Zifra totals by itself. */
const TOTAL_ROW = /^(итого|итог|всего|разом|всього|підсумок|total|totals|sum|summe|gesamt|insgesamt|suma|totales?)\b[:.]?/i;

function isEmpty(v: RawCell): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** Turn whatever the file had into a string or number the core parsers understand. */
export function normalizeCell(v: RawCell): string | number | boolean | null {
  if (isEmpty(v)) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === "string") return v.trim();
  return v as number | boolean;
}

export function inferColumn(header: string, values: RawCell[], locale: Locale): ColumnDraft {
  const name = header.trim() || "?";
  const present = values.filter((v) => !isEmpty(v));
  if (!present.length) return { name, type: "text" };
  const share = (test: (v: RawCell) => boolean) => present.filter(test).length / present.length;

  // Only full dates count: "12.5" in a file is far more often a number than 12 May.
  const fullDate = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})$/;
  if (share((v) => v instanceof Date || (typeof v === "string" && fullDate.test(v.trim()) && parseDate(v, locale) !== null)) >= 0.9) {
    return { name, type: "date" };
  }
  if (share((v) => typeof v === "boolean" || (typeof v === "string" && parseBoolean(v, locale) !== null)) >= 0.95) {
    return { name, type: "checkbox" };
  }
  if (share((v) => typeof v === "number" || (typeof v === "string" && parseNumber(v, locale, { money: true }) !== null)) >= 0.9) {
    const money = MONEY_HEADER.test(name) || CURRENCY_MARK.test(name) || present.some((v) => typeof v === "string" && CURRENCY_MARK.test(v));
    const currency = HEADER_CURRENCY.find(([re]) => re.test(name))?.[1];
    return money ? { name, type: "money", ...(currency ? { currency } : {}) } : { name, type: "number" };
  }
  // Few distinct short values that repeat → a choice (status, category, city).
  const texts = present.map((v) => String(normalizeCell(v)));
  const distinct = [...new Set(texts.map((t) => t.toLowerCase()))];
  if (present.length >= 4 && distinct.length <= 12 && distinct.length / present.length <= 0.5 && texts.every((t) => t.length <= 40)) {
    const options: string[] = [];
    for (const t of texts) if (!options.some((o) => o.toLowerCase() === t.toLowerCase())) options.push(t);
    return { name, type: "select", options };
  }
  return { name, type: "text" };
}

export interface ImportPlan {
  columns: ColumnDraft[];
  /** Rows as raw records keyed by column name, ready for createTable. */
  rows: Record<string, string | number | boolean | null>[];
  /** Index (among non-empty rows) of the row used as the header. */
  headerRow: number;
  /** "Итого" rows left out. */
  skippedTotals: number;
}

const filled = (r: RawCell[]) => r.filter((c) => !isEmpty(c)).length;
const looksLikeLabel = (c: RawCell) => typeof c === "string" && !/^[-+]?[\d\s.,]+$/.test(c.trim());

/**
 * Where the real header is. Bank exports start with a few lines about the
 * account ("Kontonummer: …"); the header is the first row as wide as the data
 * below it, made of labels rather than numbers.
 */
export function detectHeaderRow(grid: RawCell[][]): number {
  const rows = grid.filter((r) => r.some((c) => !isEmpty(c)));
  if (rows.length < 3) return 0;
  const widths = rows.map(filled);
  const counts = new Map<number, number>();
  for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1);
  const typical = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  for (let i = 0; i < Math.min(rows.length - 1, 30); i++) {
    const cells = rows[i].filter((c) => !isEmpty(c));
    if (cells.length >= Math.max(2, Math.ceil(typical * 0.8)) && cells.every(looksLikeLabel) && widths[i + 1] >= Math.ceil(typical * 0.5)) return i;
  }
  return 0;
}

/**
 * Build a table plan from a grid of cells. The header is the first row that
 * looks like one (or `headerRow`); fully empty rows and columns are dropped,
 * and so are "Итого / Total" rows.
 */
export function planImport(grid: RawCell[][], locale: Locale, opts: { headerRow?: number } = {}): ImportPlan {
  const all = grid.filter((r) => r.some((c) => !isEmpty(c)));
  if (!all.length) return { columns: [], rows: [], headerRow: 0, skippedTotals: 0 };
  const headerRow = Math.min(all.length - 1, Math.max(0, opts.headerRow ?? detectHeaderRow(all)));
  const header = all[headerRow];
  let body = all.slice(headerRow + 1);
  const before = body.length;
  body = body.filter((r) => {
    const first = r.find((c) => !isEmpty(c));
    return !(typeof first === "string" && TOTAL_ROW.test(first.trim()));
  });
  const skippedTotals = before - body.length;
  const rows = [header, ...body];
  const width = Math.max(...rows.map((r) => r.length));
  const keep = Array.from({ length: width }, (_, i) => !isEmpty(header[i]) || body.some((r) => !isEmpty(r[i])));

  const names: string[] = [];
  const columns: ColumnDraft[] = [];
  const indexes: number[] = [];
  for (let i = 0; i < width; i++) {
    if (!keep[i]) continue;
    let name = isEmpty(header[i]) ? `${i + 1}` : String(normalizeCell(header[i]));
    // Duplicate headers would collide on name.
    for (let n = 2; names.some((x) => x.toLowerCase() === name.toLowerCase()); n++) name = `${name} ${n}`;
    names.push(name);
    indexes.push(i);
    columns.push(inferColumn(name, body.map((r) => r[i]), locale));
  }
  return {
    columns,
    rows: body.map((r) => Object.fromEntries(indexes.map((i, k) => [names[k], normalizeCell(r[i])]))),
    headerRow,
    skippedTotals,
  };
}

/**
 * Text of a CSV file whatever it was saved in: UTF-8, or the old Windows
 * encodings German (1252) and Ukrainian/Russian (1251) banks still use.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const cyr = new TextDecoder("windows-1251").decode(bytes);
    const lat = new TextDecoder("windows-1252").decode(bytes);
    const cyrLetters = (cyr.match(/[а-яёіїєґ]/giu) ?? []).length;
    const latLetters = (lat.match(/[äöüßéèàáíóúñç]/giu) ?? []).length;
    return cyrLetters > latLetters * 3 ? cyr : lat;
  }
}

/** Columns of a file matched to an existing table's columns by name. */
export function matchImportColumns(plan: ImportPlan, columns: { id: string; name: string }[]): Record<string, string | null> {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return Object.fromEntries(
    plan.columns.map((c) => [c.name, columns.find((x) => norm(x.name) === norm(c.name))?.id ?? null]),
  );
}

/** Minimal CSV reader: quotes, escaped quotes, newlines in quotes; `,` `;` or tab. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const nl = clean.indexOf("\n");
  const firstLine = nl === -1 ? clean : clean.slice(0, nl);
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length }));
  const delim = counts.sort((a, b) => b.n - a.n)[0].d;
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

/** CSV text for export; `;` for languages that use a decimal comma so Excel opens it right. */
export function toCsv(rows: (string | number | null)[][], locale: Locale): string {
  const delim = locale === "en" ? "," : ";";
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",;\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(delim)).join("\r\n");
}
