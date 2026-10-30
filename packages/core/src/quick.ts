import type { CommandContext, RawRecord } from "./commands.ts";
import { INCOME_WORDS, ledgerOf } from "./ledger.ts";
import { matchLinkTarget } from "./links.ts";
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
  const rules = LOCALE_RULES[locale];
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
        set(dateCol, parseDate(two, locale, ctx.now));
        used.add(i).add(i + 1);
        break;
      }
      const w = words[i].toLowerCase().replace(/,$/, "");
      if (w in rules.relativeDays || (DATE_TOKEN.test(words[i]) && parseDate(words[i], locale, ctx.now))) {
        set(dateCol, parseDate(w in rules.relativeDays ? w : words[i], locale, ctx.now));
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
  const numberCols = editable.filter((c) => c.type === "number");
  if (numbers.length) {
    // The amount is the number with a currency or "к", else the last one; others fill quantities.
    const amountAt = numbers.findIndex((n) => n.strong);
    const amount = numbers.splice(amountAt >= 0 ? amountAt : numbers.length - 1, 1)[0];
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
        const id = matchLinkTarget(ctx.ws, col, span.map((x) => words[x]).join(" "));
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
  const restText = rest.join(" ").replace(new RegExp(`(^|\\s)(${STOP.source.slice(2, -2)})$`, "iu"), "").trim();
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

  // Whatever is left is the description.
  const textCol = editable.find((c) => c.type === "text");
  if (textCol && restText) set(textCol, restText.charAt(0).toUpperCase() + restText.slice(1));

  const understood = moneyCol ? filled.includes(moneyCol.id) : filled.length > 0;
  if (!understood) return null;
  // No date said: it happened today.
  if (dateCol && !(dateCol.id in record)) record[dateCol.id] = parseDate(Object.keys(rules.relativeDays).find((w) => rules.relativeDays[w] === 0) ?? "", locale, ctx.now);
  return { record, filled };
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
