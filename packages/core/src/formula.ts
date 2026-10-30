import type { CellValue, Column, Row, Table, Workspace } from "./types.ts";

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
  SUM: ["СУММ", "СУММА", "СУМ", "СУМА", "SUMME", "SUMA"],
  AVERAGE: ["СРЗНАЧ", "СЕРЗНАЧ", "СРЕДНЕЕ", "СЕРЕДНЄ", "MITTELWERT", "PROMEDIO", "AVG"],
  COUNT: ["СЧЁТ", "СЧЕТ", "РАХУНОК", "КІЛЬКІСТЬ", "КОЛИЧЕСТВО", "ANZAHL", "CONTAR"],
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
export function displayColumn(table: Table, column: Column, ws?: Workspace, depth = 0): Column {
  if (column.type === "rollup") {
    const source = ws?.tables.find((t) => t.id === column.rollup?.tableId);
    const target = source?.columns.find((c) => c.id === column.rollup?.columnId);
    if (!source || !target || column.rollup?.agg === "count" || depth >= MAX_LOOKUP_DEPTH) return column;
    const shown = displayColumn(source, target, ws, depth + 1);
    return shown.type === "money" ? { ...shown, id: column.id, name: column.name } : column;
  }
  if (column.type === "lookup") {
    // Shown like the column it looks up, under its own name.
    const via = table.columns.find((c) => c.id === column.lookup?.viaColumnId);
    const target = ws?.tables.find((t) => t.id === via?.linkTableId);
    const targetCol = target?.columns.find((c) => c.id === column.lookup?.columnId);
    if (!target || !targetCol || depth >= MAX_LOOKUP_DEPTH) return column;
    const shown = displayColumn(target, targetCol, ws, depth + 1);
    return { ...shown, id: column.id, name: column.name };
  }
  if (column.type !== "formula" || !column.formula) return column;
  if (column.format === "money") return { ...column, type: "money" };
  if (column.format === "number") return column;
  // A formula over money (also money pulled in from a link, or another money formula) is money.
  for (const name of formulaRefs(column.formula)) {
    const ref = findColumnByName(table.columns, name);
    if (!ref || ref.id === column.id) continue;
    const shown = ref.type === "money" ? ref : depth < MAX_LOOKUP_DEPTH && ref.type !== "text" ? displayColumn(table, ref, ws, depth + 1) : null;
    if (shown?.type === "money") return { ...column, type: "money", currency: shown.currency };
  }
  return column;
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
  /** Every value of a column, for SUM([Amount]) over the whole table. */
  column(name: string): Value[];
  today: string;
}

function numbersOf(args: Node[], ctx: EvalContext): number[] {
  // SUM([Amount]) with a bare column means the whole column; anything else is a list of values.
  if (args.length === 1 && args[0].k === "ref") {
    return ctx.column(args[0].name).filter((v): v is number => typeof v === "number");
  }
  return args.map((a) => toNumber(evaluate(a, ctx)));
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
        case "SUM": {
          if (!args.length) throw new FormulaError("syntax", "SUM: no arguments");
          return numbersOf(args, ctx).reduce((a, b) => a + b, 0);
        }
        case "AVERAGE": {
          if (!args.length) throw new FormulaError("syntax", "AVERAGE: no arguments");
          const nums = numbersOf(args, ctx);
          return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        }
        case "COUNT": {
          need(1);
          if (args[0].k !== "ref") throw new FormulaError("syntax", "COUNT: expects a column");
          return ctx.column(args[0].name).filter((v) => v !== null && v !== "").length;
        }
      }
      throw new FormulaError("syntax", `Unknown function ${n.fn}`);
    }
  }
}

export type ComputedCell = { value: CellValue } | { error: FormulaErrorCode };

/** The table a link column points to and the row a cell links to, if both still exist. */
export function resolveLink(ws: Workspace | undefined, column: Column, value: CellValue | undefined) {
  if (!ws || column.type !== "link" || typeof value !== "string") return null;
  const table = ws.tables.find((t) => t.id === column.linkTableId);
  const row = table?.rows.find((r) => r.id === value);
  return table && row ? { table, row } : null;
}

const MAX_LOOKUP_DEPTH = 4;

// Rows of a table grouped by the row they link to, rebuilt whenever that table changes.
const linkIndex = new WeakMap<Row[], Map<string, Map<string, Row[]>>>();

export function linkedRowsIndex(source: Table, linkColumnId: string): Map<string, Row[]> {
  let byColumn = linkIndex.get(source.rows);
  if (!byColumn) {
    byColumn = new Map();
    linkIndex.set(source.rows, byColumn);
  }
  let index = byColumn.get(linkColumnId);
  if (!index) {
    index = new Map();
    for (const r of source.rows) {
      const target = r.values[linkColumnId];
      if (typeof target !== "string") continue;
      const list = index.get(target);
      if (list) list.push(r);
      else index.set(target, [r]);
    }
    byColumn.set(linkColumnId, index);
  }
  return index;
}

// Whole-column values for SUM([X]) — computed once per workspace version.
const columnCache = new WeakMap<object, Map<string, Value[] | "busy">>();

export function aggregateValues(nums: number[], agg: "sum" | "avg" | "min" | "max"): number | null {
  if (!nums.length) return agg === "sum" ? 0 : null;
  if (agg === "sum") return nums.reduce((a, b) => a + b, 0);
  if (agg === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
  return agg === "min" ? Math.min(...nums) : Math.max(...nums);
}

/**
 * Computes every formula and lookup column of one row. Formulas may reference
 * other computed columns; cycles are reported as errors instead of hanging.
 * Lookups need the workspace to reach the linked table.
 */
export function computeRow(table: Table, row: Row, today: string, ws?: Workspace, depth = 0): Record<string, ComputedCell> {
  const out: Record<string, ComputedCell> = {};
  const visiting = new Set<string>();

  const lookupValue = (col: Column): ComputedCell => {
    const via = table.columns.find((c) => c.id === col.lookup?.viaColumnId);
    if (!via || via.type !== "link") return { error: "ref" };
    const target = ws?.tables.find((t) => t.id === via.linkTableId);
    const targetCol = target?.columns.find((c) => c.id === col.lookup?.columnId);
    if (!target || !targetCol) return { error: "ref" };
    const linked = target.rows.find((r) => r.id === row.values[via.id]);
    if (!linked) return { value: null };
    if (targetCol.type !== "formula" && targetCol.type !== "lookup" && targetCol.type !== "rollup") return { value: linked.values[targetCol.id] ?? null };
    if (depth >= MAX_LOOKUP_DEPTH) return { error: "cycle" };
    return computeRow(target, linked, today, ws, depth + 1)[targetCol.id] ?? { value: null };
  };

  const rollupValue = (col: Column): ComputedCell => {
    const spec = col.rollup;
    const source = ws?.tables.find((t) => t.id === spec?.tableId);
    if (!spec || !source || !source.columns.some((c) => c.id === spec.linkColumnId)) return { error: "ref" };
    const linked = linkedRowsIndex(source, spec.linkColumnId).get(row.id) ?? [];
    if (spec.agg === "count") return { value: linked.length };
    const valueCol = source.columns.find((c) => c.id === spec.columnId);
    if (!valueCol) return { error: "ref" };
    const nums: number[] = [];
    for (const r of linked) {
      let v: CellValue | undefined;
      if (valueCol.type === "formula" || valueCol.type === "lookup" || valueCol.type === "rollup") {
        if (depth >= MAX_LOOKUP_DEPTH) return { error: "cycle" };
        const c = computeRow(source, r, today, ws, depth + 1)[valueCol.id];
        if (c && "error" in c) return c;
        v = c?.value;
      } else v = r.values[valueCol.id];
      if (typeof v === "number") nums.push(v);
    }
    return { value: aggregateValues(nums, spec.agg) };
  };

  const wholeColumn = (name: string): Value[] => {
    const ref = findColumnByName(table.columns, name);
    if (!ref) throw new FormulaError("ref", `No column "${name}"`);
    if (ref.type !== "formula" && ref.type !== "lookup" && ref.type !== "rollup") {
      return table.rows.map((r) => (r.values[ref.id] ?? null) as Value);
    }
    const key = ws ?? table;
    let cache = columnCache.get(key);
    if (!cache) {
      cache = new Map();
      columnCache.set(key, cache);
    }
    const cacheKey = `${table.id}:${ref.id}`;
    const hit = cache.get(cacheKey);
    if (hit === "busy" || visiting.has(ref.id) || depth >= MAX_LOOKUP_DEPTH) throw new FormulaError("cycle", "Column refers to itself");
    if (hit) return hit;
    cache.set(cacheKey, "busy");
    try {
      const values = table.rows.map((r) => {
        const c = computeRow(table, r, today, ws, depth + 1)[ref.id];
        return c && "value" in c ? (c.value as Value) : null;
      });
      cache.set(cacheKey, values);
      return values;
    } catch (e) {
      cache.delete(cacheKey);
      throw e;
    }
  };

  const computeColumn = (col: Column): ComputedCell => {
    const done = out[col.id];
    if (done) return done;
    if (visiting.has(col.id)) return { error: "cycle" };
    visiting.add(col.id);
    let result: ComputedCell;
    if (col.type === "lookup") {
      result = lookupValue(col);
    } else if (col.type === "rollup") {
      result = rollupValue(col);
    } else {
      try {
        const ast = compile(col.formula ?? "");
        const value = evaluate(ast, {
          today,
          column: wholeColumn,
          resolve(name) {
            const ref = findColumnByName(table.columns, name);
            if (!ref) throw new FormulaError("ref", `No column "${name}"`);
            if (ref.type !== "formula" && ref.type !== "lookup" && ref.type !== "rollup") return row.values[ref.id] ?? null;
            const inner = computeColumn(ref);
            if ("error" in inner) throw new FormulaError(inner.error, "Upstream error");
            return inner.value;
          },
        });
        result = { value: typeof value === "number" && !Number.isFinite(value) ? null : value };
      } catch (e) {
        result = { error: e instanceof FormulaError ? e.code : "syntax" };
      }
    }
    visiting.delete(col.id);
    out[col.id] = result;
    return result;
  };

  for (const col of table.columns) if (col.type === "formula" || col.type === "lookup" || col.type === "rollup") computeColumn(col);
  return out;
}

/** Stored values plus computed formula values for one row (errors become null). */
export function rowValues(table: Table, row: Row, today: string, ws?: Workspace): Record<string, CellValue> {
  const computed = computeRow(table, row, today, ws);
  const values = { ...row.values };
  for (const [id, cell] of Object.entries(computed)) values[id] = "value" in cell ? cell.value : null;
  return values;
}
