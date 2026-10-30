import { displayColumn } from "./formula.ts";
import type { CellValue, Column, Goal, Ledger, Table } from "./types.ts";

// What the money in a table means. Without this, a table with salary and
// coffee adds them together and the big number on top means nothing. With it
// Zifra says: came in, went out, what's left — and counts only paid invoices.

export const INCOME_WORDS =
  /(доход|дохід|приход|надходж|поступлен|зарплат|аванс|income|salary|revenue|einnahm|umsatz|gehalt|erlös|ingreso|sueldo|nómina|cobro)/i;
export const EXPENSE_WORDS = /(расход|витрат|трат|expense|spending|cost|ausgab|kosten|gasto|egreso)/i;
const PAID_WORDS = /(оплач|получен|отриман|paid|received|bezahlt|erhalten|pagad|cobrad)/i;
const SALES_NAME = /(заказ|замовл|продаж|оплат|выручк|виручк|order|sale|payment|invoice|auftr|rechnung|zahlung|verkauf|pedido|venta|cobro|factur|доход|дохід|income|einnahm|ingreso)/i;
const EXPENSE_NAME = /(расход|витрат|expense|ausgab|gasto|покупк|закупк|purchase|einkauf|compra)/i;
const INCOME_TEMPLATES = ["orders", "clients_payments", "stock_sales", "team_jobs"];
const EXPENSE_TEMPLATES = ["expenses"];

function amountColumn(table: Table): Column | undefined {
  const money = table.columns.filter((c) => c.type === "money");
  if (money.length) return money[0];
  // A computed total shown as money ("Сумма = [Кол-во] * [Цена]").
  return table.columns.find((c) => (c.type === "formula" || c.type === "lookup") && displayColumn(table, c).type === "money");
}

/**
 * The table's ledger: set explicitly by the person, or recognised from the
 * template, a "Type: income/expense" choice column, or the table's name.
 */
export function ledgerOf(table: Table): Ledger | null {
  if (table.ledger) return table.columns.some((c) => c.id === table.ledger!.amountId) ? table.ledger : null;
  const amount = amountColumn(table);
  if (!amount) return null;
  const paid = table.columns.find((c) => c.type === "checkbox" && PAID_WORDS.test(c.name));
  const kindCol = table.columns.find(
    (c) => c.type === "select" && (c.options ?? []).some((o) => INCOME_WORDS.test(o)) && (c.options ?? []).some((o) => EXPENSE_WORDS.test(o)),
  );
  if (kindCol) {
    return { amountId: amount.id, kind: "both", typeColumnId: kindCol.id, incomeValues: (kindCol.options ?? []).filter((o) => INCOME_WORDS.test(o)) };
  }
  if ((table.template && INCOME_TEMPLATES.includes(table.template)) || (!table.template && SALES_NAME.test(table.name))) {
    return { amountId: amount.id, kind: "income", ...(paid ? { paidColumnId: paid.id } : {}) };
  }
  if ((table.template && EXPENSE_TEMPLATES.includes(table.template)) || (!table.template && EXPENSE_NAME.test(table.name))) {
    return { amountId: amount.id, kind: "expense" };
  }
  return null;
}

export interface Flow {
  income: number;
  expense: number;
}

/**
 * How one row moves money, as positive amounts. Rows not yet paid count as
 * `pending` instead (unpaid invoices are not income yet).
 */
export function rowFlow(ledger: Ledger, values: Record<string, CellValue>): Flow & { pending: number } {
  const out = { income: 0, expense: 0, pending: 0 };
  const v = values[ledger.amountId];
  if (typeof v !== "number" || v === 0) return out;
  if (ledger.paidColumnId && values[ledger.paidColumnId] !== true) {
    out.pending = Math.abs(v);
    return out;
  }
  let income: boolean;
  if (ledger.kind === "income") income = v > 0;
  else if (ledger.kind === "expense") income = v < 0;
  else if (ledger.typeColumnId) {
    const type = String(values[ledger.typeColumnId] ?? "").toLowerCase();
    // Untyped rows are spending: that's what people jot down most.
    income = (ledger.incomeValues ?? []).some((o) => o.toLowerCase() === type);
    if (v < 0) income = !income;
  } else income = v > 0;
  if (income) out.income = Math.abs(v);
  else out.expense = Math.abs(v);
  return out;
}

export interface LedgerTotals extends Flow {
  /** income − expense */
  balance: number;
  /** Not yet paid. */
  pending: number;
  pendingCount: number;
}

export function ledgerTotals(ledger: Ledger, rows: Record<string, CellValue>[]): LedgerTotals {
  const t: LedgerTotals = { income: 0, expense: 0, balance: 0, pending: 0, pendingCount: 0 };
  for (const r of rows) {
    const f = rowFlow(ledger, r);
    t.income += f.income;
    t.expense += f.expense;
    if (f.pending) {
      t.pending += f.pending;
      t.pendingCount++;
    }
  }
  t.balance = t.income - t.expense;
  return t;
}

/** Signed amount of a row for one side of the ledger (for reports "income only"). */
export function flowAmount(ledger: Ledger, values: Record<string, CellValue>, side: "income" | "expense"): number {
  return rowFlow(ledger, values)[side];
}

/** True when a row belongs to the given side (for filtering, regardless of paid). */
export function rowSide(ledger: Ledger, values: Record<string, CellValue>): "income" | "expense" | null {
  const f = rowFlow({ ...ledger, paidColumnId: undefined }, values);
  return f.income ? "income" : f.expense ? "expense" : null;
}

export interface GoalProgress {
  saved: number;
  amount: number;
  left: number;
  share: number;
  /** How much to put aside per month to make it by the target date. */
  perMonth?: number;
  monthsLeft?: number;
}

/** Progress towards a table's savings goal; `values` are all rows, computed. */
export function goalProgress(goal: Goal, values: Record<string, CellValue>[], today: string): GoalProgress {
  const saved = values.reduce((a, v) => a + (typeof v[goal.columnId] === "number" ? (v[goal.columnId] as number) : 0), 0);
  const left = Math.max(0, goal.amount - saved);
  const out: GoalProgress = { saved, amount: goal.amount, left, share: goal.amount > 0 ? Math.min(1, saved / goal.amount) : 0 };
  if (goal.date && goal.date > today) {
    const [ty, tm] = today.split("-").map(Number);
    const [gy, gm] = goal.date.split("-").map(Number);
    const months = Math.max(1, (gy - ty) * 12 + (gm - tm));
    out.monthsLeft = months;
    out.perMonth = left / months;
  }
  return out;
}
