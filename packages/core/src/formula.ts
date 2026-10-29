import type { CellValue, Column, Row, Table } from "./types.ts";

// Row-level formulas that reference columns by name: `[Цена] * [Кол-во]`.
// A formula is written once per column and applies to every row, so there is
// no copy-drag step and no `B7` reference to get wrong.
//
// Syntax: numbers use `.` for decimals; function arguments are separated by
// `;` or `,`. Strings are double-quoted. Function names are accepted in all
// supported languages (ROUND / ОКРУГЛ / RUNDEN / REDONDEAR ...).

export type FormulaErrorCode = "syntax" | "ref" | "cycle" | "div0" | "type";

export class FormulaError extends Error {
  code: FormulaErrorCode;
  constructor(code: FormulaErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

type Value = number | string | boolean | null;

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; name: string }
  | { k: "neg"; e: Node }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "call"; fn: string; args: Node[] };

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  // "1,02" is a decimal when `,` cannot be an argument separator: either the
  // formula separates arguments with `;` (Excel in ru/uk/de/es), or it has no
  // function calls at all.
  const decimalComma = src.includes(";") || !/[\p{L}_]\s*\(/u.test(src);
  const numberRe = decimalComma ? /^\d*[.,]?\d+/ : /^\d*\.?\d+/;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      const m = src.slice(i).match(numberRe)!;
      out.push({ t: "num", v: Number(m[0].replace(",", ".")) });
      i += m[0].length;
    } else if (c === "[") {
      const end = src.indexOf("]", i);
      if (end < 0) throw new FormulaError("syntax", "Unclosed [");
      out.push({ t: "ref", v: src.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (c === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError("syntax", 'Unclosed "');
      out.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
    } else if (/\p{L}|_/u.test(c)) {
      const m = src.slice(i).match(/^[\p{L}_][\p{L}\d_]*/u)!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (["<=", ">=", "<>", "!=", "=="].includes(two)) {
        out.push({ t: "op", v: two === "!=" ? "<>" : two === "==" ? "=" : two });
        i += 2;
      } else if ("+-*/^()<>=;,%".includes(c)) {
        out.push({ t: "op", v: c === ";" ? "," : c });
        i++;
      } else {
        throw new FormulaError("syntax", `Unexpected "${c}"`);
      }
    }
  }
  return out;
}

// Function names in every supported language → canonical name.
const FUNCTION_ALIASES: Record<string, string> = {};
const FUNCTIONS: Record<string, string[]> = {
  ROUND: ["ОКРУГЛ", "ОКРУГЛИТИ", "RUNDEN", "REDONDEAR"],
  ABS: [],
  MIN: ["МИН", "МІН", "MÍN"],
  MAX: ["МАКС", "MÁX"],
  IF: ["ЕСЛИ", "ЯКЩО", "WENN", "SI"],
  TODAY: ["СЕГОДНЯ", "СЬОГОДНІ", "HEUTE", "HOY"],
  DAYS: ["ДНИ", "ДНІ", "TAGE", "DIAS", "DÍAS"],
};
for (const [name, aliases] of Object.entries(FUNCTIONS)) {
  FUNCTION_ALIASES[name] = name;
  for (const a of aliases) FUNCTION_ALIASES[a] = name;
}
const TRUE_IDS = ["TRUE", "ИСТИНА", "ІСТИНА", "WAHR", "VERDADERO"];
const FALSE_IDS = ["FALSE", "ЛОЖЬ", "ХИБНІСТЬ", "FALSCH", "FALSO"];

class Parser {
  private i = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Node {
    const n = this.comparison();
    if (this.i < this.tokens.length) throw new FormulaError("syntax", "Unexpected token");
    return n;
  }

  private peekOp(...ops: string[]): string | null {
    const t = this.tokens[this.i];
    return t?.t === "op" && ops.includes(t.v) ? t.v : null;
  }

  private expect(op: string) {
    if (!this.peekOp(op)) throw new FormulaError("syntax", `Expected "${op}"`);
    this.i++;
  }

  private comparison(): Node {
    let l = this.additive();
    let op: string | null;
    while ((op = this.peekOp("=", "<>", "<", ">", "<=", ">="))) {
      this.i++;
      l = { k: "bin", op, l, r: this.additive() };
    }
    return l;
  }

  private additive(): Node {
    let l = this.term();
    let op: string | null;
    while ((op = this.peekOp("+", "-"))) {
      this.i++;
      l = { k: "bin", op, l, r: this.term() };
    }
    return l;
  }

  private term(): Node {
    let l = this.power();
    let op: string | null;
    while ((op = this.peekOp("*", "/"))) {
      this.i++;
      l = { k: "bin", op, l, r: this.power() };
    }
    return l;
  }

  private power(): Node {
    const base = this.unary();
    if (this.peekOp("^")) {
      this.i++;
      return { k: "bin", op: "^", l: base, r: this.power() };
    }
    return base;
  }

  private unary(): Node {
    if (this.peekOp("-")) {
      this.i++;
      return { k: "neg", e: this.unary() };
    }
    if (this.peekOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.postfix();
  }

  private postfix(): Node {
    let n = this.primary();
    while (this.peekOp("%")) {
      this.i++;
      n = { k: "bin", op: "/", l: n, r: { k: "num", v: 100 } };
    }
    return n;
  }

  private primary(): Node {
    const t = this.tokens[this.i++];
    if (!t) throw new FormulaError("syntax", "Unexpected end");
    switch (t.t) {
      case "num":
        return { k: "num", v: t.v };
      case "str":
        return { k: "str", v: t.v };
      case "ref":
        return { k: "ref", name: t.v };
      case "id": {
        const upper = t.v.toUpperCase();
        if (TRUE_IDS.includes(upper)) return { k: "bool", v: true };
        if (FALSE_IDS.includes(upper)) return { k: "bool", v: false };
        const fn = FUNCTION_ALIASES[upper];
        if (!fn) throw new FormulaError("syntax", `Unknown function ${t.v}`);
        this.expect("(");
        const args: Node[] = [];
        if (!this.peekOp(")")) {
          args.push(this.comparison());
          while (this.peekOp(",")) {
            this.i++;
            args.push(this.comparison());
          }
        }
        this.expect(")");
        return { k: "call", fn, args };
      }
      case "op":
        if (t.v === "(") {
          const n = this.comparison();
          this.expect(")");
          return n;
        }
        throw new FormulaError("syntax", `Unexpected "${t.v}"`);
    }
  }
}

const compiled = new Map<string, Node | FormulaError>();

export function compile(src: string): Node {
  let n = compiled.get(src);
  if (!n) {
    try {
      const body = src.trim().replace(/^=/, "");
      if (!body) throw new FormulaError("syntax", "Empty formula");
      n = new Parser(tokenize(body)).parse();
    } catch (e) {
      n = e instanceof FormulaError ? e : new FormulaError("syntax", String(e));
    }
    compiled.set(src, n);
  }
  if (n instanceof FormulaError) throw n;
  return n;
}

/** Throws FormulaError when the formula does not parse. */
export function validateFormula(src: string): void {
  compile(src);
}

/** Column names a formula references (as written). */
export function formulaRefs(src: string): string[] {
  return [...src.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Rewrite references after a column rename. */
export function renameFormulaRefs(src: string, from: string, to: string): string {
  return src.replace(/\[([^\]]+)\]/g, (whole, name: string) => (sameName(name, from) ? `[${to}]` : whole));
}

export function findColumnByName(columns: Column[], name: string): Column | undefined {
  return columns.find((c) => sameName(c.name, name));
}

/**
 * How a formula column should be displayed: a formula built on a money column
 * is shown as money in that column's currency.
 */
export function displayColumn(table: Table, column: Column): Column {
  if (column.type !== "formula" || !column.formula) return column;
  const money = formulaRefs(column.formula)
    .map((name) => findColumnByName(table.columns, name))
    .find((c) => c?.type === "money");
  return money ? { ...column, type: "money", currency: money.currency } : column;
}

function toNumber(v: Value): number {
  if (v === null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v.replace(",", "."));
  if (Number.isNaN(n)) throw new FormulaError("type", `"${v}" is not a number`);
  return n;
}

function dayNumber(v: Value): number {
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000;
  }
  throw new FormulaError("type", "Expected a date");
}

function compare(op: string, a: Value, b: Value): boolean {
  const bothNumeric =
    (typeof a === "number" || a === null) && (typeof b === "number" || b === null);
  const x = bothNumeric ? toNumber(a) : String(a ?? "").toLowerCase();
  const y = bothNumeric ? toNumber(b) : String(b ?? "").toLowerCase();
  switch (op) {
    case "=":
      return x === y;
    case "<>":
      return x !== y;
    case "<":
      return x < y;
    case ">":
      return x > y;
    case "<=":
      return x <= y;
    default:
      return x >= y;
  }
}

interface EvalContext {
  resolve(name: string): Value;
  today: string;
}

function evaluate(n: Node, ctx: EvalContext): Value {
  switch (n.k) {
    case "num":
    case "str":
    case "bool":
      return n.v;
    case "ref":
      return ctx.resolve(n.name);
    case "neg":
      return -toNumber(evaluate(n.e, ctx));
    case "bin": {
      const a = evaluate(n.l, ctx);
      const b = evaluate(n.r, ctx);
      switch (n.op) {
        case "+":
          return toNumber(a) + toNumber(b);
        case "-":
          return toNumber(a) - toNumber(b);
        case "*":
          return toNumber(a) * toNumber(b);
        case "/": {
          const d = toNumber(b);
          if (d === 0) throw new FormulaError("div0", "Division by zero");
          return toNumber(a) / d;
        }
        case "^":
          return toNumber(a) ** toNumber(b);
        default:
          return compare(n.op, a, b);
      }
    }
    case "call": {
      const args = n.args;
      const need = (min: number, max = min) => {
        if (args.length < min || args.length > max) {
          throw new FormulaError("syntax", `${n.fn}: wrong number of arguments`);
        }
      };
      switch (n.fn) {
        case "ROUND": {
          need(1, 2);
          const digits = args[1] ? toNumber(evaluate(args[1], ctx)) : 0;
          const f = 10 ** digits;
          return Math.round(toNumber(evaluate(args[0], ctx)) * f) / f;
        }
        case "ABS":
          need(1);
          return Math.abs(toNumber(evaluate(args[0], ctx)));
        case "MIN":
        case "MAX": {
          if (!args.length) throw new FormulaError("syntax", `${n.fn}: no arguments`);
          const nums = args.map((a) => toNumber(evaluate(a, ctx)));
          return n.fn === "MIN" ? Math.min(...nums) : Math.max(...nums);
        }
        case "IF": {
          need(2, 3);
          const c = evaluate(args[0], ctx);
          const truthy = typeof c === "boolean" ? c : toNumber(c) !== 0;
          if (truthy) return evaluate(args[1], ctx);
          return args[2] ? evaluate(args[2], ctx) : null;
        }
        case "TODAY":
          need(0);
          return ctx.today;
        case "DAYS":
          need(2);
          return dayNumber(evaluate(args[0], ctx)) - dayNumber(evaluate(args[1], ctx));
      }
      throw new FormulaError("syntax", `Unknown function ${n.fn}`);
    }
  }
}

export type ComputedCell = { value: CellValue } | { error: FormulaErrorCode };

/**
 * Computes every formula column of one row. Formulas may reference other
 * formula columns; cycles are reported as errors instead of hanging.
 */
export function computeRow(table: Table, row: Row, today: string): Record<string, ComputedCell> {
  const out: Record<string, ComputedCell> = {};
  const visiting = new Set<string>();

  const computeColumn = (col: Column): ComputedCell => {
    const done = out[col.id];
    if (done) return done;
    if (visiting.has(col.id)) return { error: "cycle" };
    visiting.add(col.id);
    let result: ComputedCell;
    try {
      const ast = compile(col.formula ?? "");
      const value = evaluate(ast, {
        today,
        resolve(name) {
          const ref = findColumnByName(table.columns, name);
          if (!ref) throw new FormulaError("ref", `No column "${name}"`);
          if (ref.type !== "formula") return row.values[ref.id] ?? null;
          const inner = computeColumn(ref);
          if ("error" in inner) throw new FormulaError(inner.error, "Upstream error");
          return inner.value;
        },
      });
      result = { value: typeof value === "number" && !Number.isFinite(value) ? null : value };
    } catch (e) {
      result = { error: e instanceof FormulaError ? e.code : "syntax" };
    }
    visiting.delete(col.id);
    out[col.id] = result;
    return result;
  };

  for (const col of table.columns) if (col.type === "formula") computeColumn(col);
  return out;
}

/** Stored values plus computed formula values for one row (errors become null). */
export function rowValues(table: Table, row: Row, today: string): Record<string, CellValue> {
  const computed = computeRow(table, row, today);
  const values = { ...row.values };
  for (const [id, cell] of Object.entries(computed)) values[id] = "value" in cell ? cell.value : null;
  return values;
}
