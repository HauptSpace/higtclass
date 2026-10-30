import type { CommandContext, RawRecord } from "./commands.ts";
import { INCOME_WORDS, ledgerOf } from "./ledger.ts";
import { rowLabel } from "./links.ts";
import type { Workspace } from "./types.ts";
import { LOCALE_RULES } from "./locale.ts";
import { ALL_CATEGORIES } from "./templates.ts";
import { isComputed, type Column, type Table } from "./types.ts";
import { parseDate, parseNumber } from "./values.ts";

// Understanding short entries without the assistant: "кава 85",
// "вчора таксі 240", "продукти 1,2к і кава 60", "Taxi 12,50 gestern".
// Free, instant and offline — the assistant is only needed for the rest.

const SPLIT = /\s*;\s*|,\s+(?=[^\d\s])|\s+(?:и|і|та|and|und|y|e|plus)\s+/iu;
const CURRENCY_WORD = /^(₽|₴|\$|€|£|руб\.?|р\.?|грн\.?|гривен\p{L}*|uah|rub|usd|eur|euro?s?|евро|євро|доллар\p{L}*|долар\p{L}*|dollars?|zł|pln)$/iu;
const STOP = /^(на|за|в|во|у|з|с|по|для|от|від|for|on|at|in|to|für|am|im|um|zu|para|por|en|de|del|el|la)$/iu;
const DATE_TOKEN = /^(\d{1,2}[./]\d{1,2}[./](\d{2}|\d{4})|\d{1,2}\/\d{1,2}|\d{2}\.\d{2}|\d{1,2}\.\d{1,2}\.)$/;
const NOTE_NAME = /(коммент|комент|примеч|приміт|опис|note|notiz|nota|descr|beschreib|zweck|job|работ|робот|auftrag|trabajo|задач|завдан|task|aufgabe|услуг|послуг|service|leistung)/i;

/** "5.9" is a date only when another number in the entry is the amount. */
const SHORT_DATE = /^\d{1,2}\.\d{1,2}$/;

// Month names as people write them in a date: "5 вересня", "5. Oktober", "Sep 5", "5 de mayo".
const MONTHS: [RegExp, number][] = [
  [/^(янв|січ|jan|ene)/i, 1],
  [/^(фев|лют|feb)/i, 2],
  [/^(мар|берез|mär|mar)/i, 3],
  [/^(апр|квіт|apr|abr)/i, 4],
  [/^(мая|май|трав|may|mai|mayo)/i, 5],
  [/^(июн|черв|jun)/i, 6],
  [/^(июл|лип|jul)/i, 7],
  [/^(авг|серп|aug|ago)/i, 8],
  [/^(сен|верес|sep|set)/i, 9],
  [/^(окт|жовт|oct|okt)/i, 10],
  [/^(ноя|листоп|nov)/i, 11],
  [/^(дек|груд|dec|dez|dic)/i, 12],
];
const monthOf = (w: string) => (w.length >= 3 ? MONTHS.find(([re]) => re.test(w))?.[1] : undefined);

export interface QuickEntry {
  record: RawRecord;
  /** Column ids that were filled, so the preview can show them. */
  filled: string[];
}

function isAmountToken(token: string, locale: CommandContext["locale"]): number | null {
  if (!/\d/.test(token)) return null;
  return parseNumber(token, locale, { money: true });
}

function parseSegment(table: Table, segment: string, ctx: CommandContext): QuickEntry | null {
  const locale = ctx.locale;
  // Relative days in any language: someone using English in Spain says "mañana".
  const rules = {
    ...LOCALE_RULES[locale],
    relativeDays: Object.assign({}, ...Object.values(LOCALE_RULES).map((r) => r.relativeDays), LOCALE_RULES[locale].relativeDays) as Record<string, number>,
  };
  const dayWord = (w: string) => {
    const iso = new Date(ctx.now ?? new Date());
    iso.setDate(iso.getDate() + rules.relativeDays[w]);
    return `${iso.getFullYear()}-${String(iso.getMonth() + 1).padStart(2, "0")}-${String(iso.getDate()).padStart(2, "0")}`;
  };
  const words = segment.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const used = new Set<number>();
  const record: RawRecord = {};
  const filled: string[] = [];
  const set = (col: Column, value: unknown) => {
    record[col.id] = value;
    filled.push(col.id);
  };
  const editable = table.columns.filter((c) => !isComputed(c));

  // Date: "вчора", "pasado mañana", "03.10", "3/10".
  const dateCol = editable.find((c) => c.type === "date");
  if (dateCol) {
    for (let i = 0; i < words.length; i++) {
      const two = i + 1 < words.length ? `${words[i]} ${words[i + 1]}`.toLowerCase() : "";
      if (two && two in rules.relativeDays) {
        set(dateCol, dayWord(two));
        used.add(i).add(i + 1);
        break;
      }
      const w = words[i].toLowerCase().replace(/,$/, "");
      if (w in rules.relativeDays || (DATE_TOKEN.test(words[i]) && parseDate(words[i], locale, ctx.now))) {
        set(dateCol, w in rules.relativeDays ? dayWord(w) : parseDate(words[i], locale, ctx.now));
        used.add(i);
        break;
      }
      // "5 вересня" / "5. Oktober" / "Sep 5" / "5 de mayo"
      const day = Number(w.replace(/\.$/, ""));
      const nextWord = (words[i + 1] ?? "").toLowerCase();
      const afterDe = nextWord === "de" ? (words[i + 2] ?? "").toLowerCase() : nextWord;
      const month = /^\d{1,2}\.?$/.test(w) && day >= 1 && day <= 31 ? monthOf(afterDe) : undefined;
      if (month) {
        const year = (ctx.now ?? new Date()).getFullYear();
        set(dateCol, parseDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, locale, ctx.now));
        used.add(i).add(i + 1);
        if (nextWord === "de") used.add(i + 2);
        break;
      }
      const m2 = monthOf(w);
      const d2 = Number((words[i + 1] ?? "").replace(/[.,]$/, ""));
      if (m2 && /^\d{1,2}[.,]?$/.test(words[i + 1] ?? "") && d2 >= 1 && d2 <= 31 && /^[a-z]/i.test(w)) {
        const year = (ctx.now ?? new Date()).getFullYear();
        set(dateCol, parseDate(`${year}-${String(m2).padStart(2, "0")}-${String(d2).padStart(2, "0")}`, locale, ctx.now));
        used.add(i).add(i + 1);
        break;
      }
    }
    // "5.9 кава 60": a short d.m counts as the date when another number is the amount.
    if (!(dateCol.id in record)) {
      const numeric = words.filter((x, k) => !used.has(k) && /\d/.test(x));
      const at = words.findIndex((x, k) => !used.has(k) && SHORT_DATE.test(x));
      if (at >= 0 && numeric.length >= 2) {
        const d = parseDate(words[at], locale, ctx.now);
        if (d) {
          set(dateCol, d);
          used.add(at);
        }
      }
    }
  }

  // "4h", "12 км", "3шт": a number with a unit goes into the column named after that unit.
  const numberColsAll = editable.filter((c) => c.type === "number");
  const UNITS: [RegExp, RegExp][] = [
    [/^(h|hrs?|ч|час|год|std|stunden?|horas?)$/i, /(час|годин|hour|stund|hora)/i],
    [/^(km|км)$/i, /(км|km|кілом|kilom)/i],
    [/^(шт|pcs|stk|uds?)$/i, /(кол|кільк|qty|quant|menge|cant)/i],
  ];
  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;
    let m = words[i].match(/^(\d+(?:[.,]\d+)?)\s*(\p{L}+)\.?$/u);
    let span = 1;
    if (!m && /^\d+(?:[.,]\d+)?$/.test(words[i]) && words[i + 1]) {
      const unit = words[i + 1].replace(/\.$/, "");
      if (UNITS.some(([u]) => u.test(unit))) {
        m = [words[i], words[i], unit] as unknown as RegExpMatchArray;
        span = 2;
      }
    }
    if (!m) continue;
    const unit = UNITS.find(([u]) => u.test(m![2]));
    if (!unit) continue;
    const col = numberColsAll.find((c) => unit[1].test(c.name) && !(c.id in record));
    const value = parseNumber(m[1], locale);
    if (!col || value === null) continue;
    set(col, value);
    for (let k = 0; k < span; k++) used.add(i + k);
  }

  // Numbers: join "1 500" back together; currency words around them are noise.
  const numbers: { index: number[]; value: number; strong: boolean }[] = [];
  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;
    if (CURRENCY_WORD.test(words[i])) {
      used.add(i);
      if (numbers.length && numbers.at(-1)!.index.at(-1) === i - 1) numbers.at(-1)!.strong = true;
      continue;
    }
    let token = words[i];
    const index = [i];
    while (/^\d{1,3}$/.test(token) && i + 1 < words.length && /^\d{3}([.,]\d+)?$/.test(words[i + 1])) {
      token += words[++i];
      index.push(i);
    }
    const value = isAmountToken(token, locale);
    if (value === null) continue;
    const strong = /[^\d.,\s-]/.test(token); // "1,2к", "85грн", "€12"
    numbers.push({ index, value, strong });
    index.forEach((x) => used.add(x));
  }

  const moneyCol = editable.find((c) => c.type === "money");
  const numberCols = editable.filter((c) => c.type === "number" && !(c.id in record));
  if (numbers.length) {
    // The amount is the number with a currency or "к", else the last one; others fill quantities.
    // Without a money column the first number is the quantity ("продала 2 чехла").
    const amountAt = numbers.findIndex((n) => n.strong);
    const amount = numbers.splice(amountAt >= 0 ? amountAt : moneyCol ? numbers.length - 1 : 0, 1)[0];
    const target = moneyCol ?? numberCols.shift();
    if (target) set(target, amount.value);
    for (const n of numbers) {
      const col = numberCols.shift();
      if (col) set(col, n.value);
    }
  }

  // Linked rows by name: "Олег Петренко 12000" → the client Oleh Petrenko.
  for (const col of editable.filter((c) => c.type === "link")) {
    let best: { from: number; len: number; id: string } | null = null;
    for (let len = 3; len >= 1 && !best; len--) {
      for (let i = 0; i + len <= words.length; i++) {
        const span = Array.from({ length: len }, (_, k) => i + k);
        if (span.some((x) => used.has(x))) continue;
        const id = linkByName(ctx.ws, col, span.map((x) => words[x]).join(" "));
        if (id) {
          best = { from: i, len, id };
          break;
        }
      }
    }
    if (best) {
      set(col, best.id);
      for (let k = 0; k < best.len; k++) used.add(best.from + k);
    }
  }

  const rest = words.filter((_, i) => !used.has(i));
  // The description keeps the person's words ("відклав на відпустку"), minus a dangling preposition.
  let restText = rest.join(" ").replace(new RegExp(`(^|\\s)(${STOP.source.slice(2, -2)})$`, "iu"), "").trim();
  const lower = rest.filter((w) => !STOP.test(w)).join(" ").toLowerCase();

  // Choices: an option named in the text, else a category recognised by its words.
  const ledger = ledgerOf(table);
  const typeCol = ledger?.typeColumnId ? editable.find((c) => c.id === ledger.typeColumnId) : undefined;
  let income = false;
  for (const col of editable.filter((c) => c.type === "select" && c !== typeCol)) {
    const options = col.options ?? [];
    const defOf = (o: string) => ALL_CATEGORIES.find((d) => Object.values(d.name).some((n) => n.toLowerCase() === o.toLowerCase()));
    // A category named in the text counts, unless its own words say otherwise ("подарунок мамі" is not a gift received).
    let hit = options.find((o) => {
      if (o.length < 3 || !new RegExp(`(^|\\s)${escape(o.toLowerCase())}`, "u").test(lower)) return false;
      const def = defOf(o);
      return !def || def.words.source === "^$" || def.words.test(lower) || !col.scope?.map[o] || !ledger?.incomeValues?.includes(col.scope.map[o]);
    });
    if (!hit && lower) {
      const def = ALL_CATEGORIES.find((d) => d.words.test(lower) && options.some((o) => Object.values(d.name).some((n) => n.toLowerCase() === o.toLowerCase())));
      if (def) hit = options.find((o) => Object.values(def.name).some((n) => n.toLowerCase() === o.toLowerCase()));
    }
    if (hit) {
      set(col, hit);
      const parent = col.scope && typeCol && col.scope.columnId === typeCol.id ? col.scope.map[hit] : undefined;
      if (parent && ledger?.incomeValues?.some((v) => v.toLowerCase() === parent.toLowerCase())) income = true;
    }
  }
  if (typeCol && (income || INCOME_WORDS.test(lower))) {
    const value = ledger?.incomeValues?.[0];
    if (value) set(typeCol, value);
  }

  // "оплачено", "paid", "bezahlt": tick the paid box (and record today as the payment day).
  const paidCol = ledger?.paidColumnId ? editable.find((c) => c.id === ledger.paidColumnId) : undefined;
  const PAID = /(^|\s)(оплачен\p{L}*|оплатил\p{L}*|оплатив\p{L}*|сплачен\p{L}*|paid|bezahlt|pagad\p{L}*|cobrad\p{L}*)(?=\s|$)/iu;
  if (paidCol && PAID.test(lower)) {
    set(paidCol, true);
    restText = restText.replace(PAID, "").trim();
    const paidDate = ledger?.dateColumnId ? editable.find((c) => c.id === ledger.dateColumnId) : undefined;
    if (paidDate) set(paidDate, dayWord(Object.keys(LOCALE_RULES[locale].relativeDays).find((w) => LOCALE_RULES[locale].relativeDays[w] === 0)!));
  }

  // Whatever is left is the description: a note/job/item column, else the first text column.
  const textCol =
    editable.find((c) => c.type === "text" && NOTE_NAME.test(c.name)) ?? editable.find((c) => c.type === "text");
  if (textCol && restText) set(textCol, restText.charAt(0).toUpperCase() + restText.slice(1));

  const understood = moneyCol ? filled.includes(moneyCol.id) : filled.length > 0;
  if (!understood) return null;
  // No date said: it happened today.
  if (dateCol && !(dateCol.id in record)) record[dateCol.id] = dayWord(Object.keys(LOCALE_RULES[locale].relativeDays).find((w) => LOCALE_RULES[locale].relativeDays[w] === 0)!);
  return { record, filled };
}

/** A linked row whose name is, or starts with, these words ("Hotel Miramar", "Олег"). */
function linkByName(ws: Workspace | undefined, col: Column, text: string): string | null {
  const target = ws?.tables.find((t) => t.id === col.linkTableId);
  if (!target) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[«»"'“”„]/g, "").replace(/\s+/g, " ").trim();
  const wanted = norm(text);
  if (wanted.length < 2) return null;
  const labels = target.rows.map((r) => ({ id: r.id, label: norm(rowLabel(target, r)) }));
  const exact = labels.filter((l) => l.label === wanted);
  if (exact.length === 1) return exact[0].id;
  // A code typed exactly ("CS-001") finds the row through any of its text columns.
  const codes = target.rows.filter((r) => target.columns.some((c) => c.type === "text" && typeof r.values[c.id] === "string" && norm(r.values[c.id] as string) === wanted));
  if (codes.length === 1) return codes[0].id;
  const starts = labels.filter((l) => l.label.startsWith(wanted) || l.label.split(" ").some((w) => w === wanted));
  return starts.length === 1 ? starts[0].id : null;
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Entries understood from a short phrase, or null if it needs the assistant
 * (no amount, or more than a handful of words per entry).
 */
export function parseQuickEntries(table: Table, text: string, ctx: CommandContext): QuickEntry[] | null {
  const segments = text.split(SPLIT).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return null;
  const out: QuickEntry[] = [];
  for (const s of segments) {
    if (s.split(/\s+/).length > 7) return null;
    const entry = parseSegment(table, s, ctx);
    if (!entry) return null;
    out.push(entry);
  }
  return out;
}
