import { describe, expect, it } from "vitest";
import { aggregate, computedRows, FLOW_FILTER, pivot, scopeRows } from "./aggregate.ts";
import { addRecords, optionsFor, renameOption } from "./commands.ts";
import { computeRow, rowValues } from "./formula.ts";
import { goalProgress, ledgerOf, ledgerTotals } from "./ledger.ts";
import { incomeBetween } from "./knowledge.ts";
import { dateOrder, setRegion } from "./locale.ts";
import { applyOp, type Op } from "./ops.ts";
import { dateKey, dateKeyLabel, periodRange } from "./periods.ts";
import { parseQuickEntries } from "./quick.ts";
import { findTemplate, instantiateTemplate } from "./templates.ts";
import type { Table, Workspace } from "./types.ts";
import { parseDate, parseNumber, parseValue } from "./values.ts";

const now = new Date(2026, 9, 30);

function fromTemplate(id: string, locale: "ru" | "uk" | "en" | "de" | "es" = "uk") {
  const res = instantiateTemplate(findTemplate(id)!, locale, { locale, now });
  return { ws: applyOp({ tables: [] }, res.op), mainId: res.mainId };
}

function add(ws: Workspace, tableId: string, records: Record<string, unknown>[], locale: "ru" | "uk" | "en" | "de" | "es" = "uk") {
  const table = ws.tables.find((t) => t.id === tableId)!;
  return applyOp(ws, addRecords(table, records, { locale, now, ws }).op);
}

const tableOf = (ws: Workspace, id: string) => ws.tables.find((t) => t.id === id)!;

describe("money parsing", () => {
  it("reads 1.500 and 1,500 as thousands in money columns, decimals elsewhere", () => {
    expect(parseNumber("1.500", "en", { money: true })).toBe(1500);
    expect(parseNumber("1.500", "en")).toBe(1.5);
    expect(parseNumber("1,500", "de", { money: true })).toBe(1500);
    expect(parseNumber("12.50", "en", { money: true })).toBe(12.5);
    expect(parseNumber("0,500", "de", { money: true })).toBe(0.5);
    expect(parseValue({ id: "a", name: "Fee", type: "money" }, "1.500", "en")).toBe(1500);
  });

  it("follows the browser region for English dates", () => {
    setRegion("en-GB");
    expect(dateOrder("en")).toBe("DMY");
    expect(parseDate("03/10", "en", now)).toBe("2026-10-03");
    setRegion("en-US");
    expect(parseDate("03/10", "en", now)).toBe("2026-03-10");
    setRegion(null);
  });
});

describe("ledger", () => {
  it("separates income, spending and what's left", () => {
    let { ws, mainId } = fromTemplate("budget");
    ws = add(ws, mainId, [
      { Тип: "Дохід", Категорія: "Зарплата", Сума: "18 500" },
      { Категорія: "Їжа", Сума: "85" },
      { Категорія: "Транспорт", Сума: "240" },
    ]);
    const table = tableOf(ws, mainId);
    const ledger = ledgerOf(table)!;
    expect(ledger.kind).toBe("both");
    // The default type is "expense", so untyped entries are spending.
    const totals = ledgerTotals(ledger, computedRows(table, "2026-10-30", ws));
    expect(totals).toMatchObject({ income: 18500, expense: 325, balance: 18175 });
  });

  it("counts only paid invoices as income", () => {
    let { ws, mainId } = fromTemplate("clients_payments");
    const clients = ws.tables.find((t) => t.id !== mainId)!;
    ws = add(ws, clients.id, [{ "Ім'я": "Олег Петренко" }]);
    ws = add(ws, mainId, [
      { Клієнт: "Олег Петренко", Сума: "12000", Оплачено: "так" },
      { Клієнт: "Олег", Сума: "6000" },
    ]);
    const table = tableOf(ws, mainId);
    const totals = ledgerTotals(ledgerOf(table)!, computedRows(table, "2026-10-30", ws));
    expect(totals).toMatchObject({ income: 12000, pending: 6000, pendingCount: 1 });
    // The client shows the total of their payments.
    const c = tableOf(ws, clients.id);
    const [received, owes] = c.columns.filter((x) => x.type === "rollup");
    const v = rowValues(c, c.rows[0], "2026-10-30", ws);
    expect([v[received.id], v[owes.id]]).toEqual([12000, 6000]);
  });
});

describe("stock and sales", () => {
  it("takes sold quantities off the stock and works out margin", () => {
    let { ws, mainId } = fromTemplate("stock_sales", "ru");
    const products = ws.tables.find((t) => t.id !== mainId)!;
    ws = add(ws, products.id, [{ Товар: "Чехол iPhone", Закупка: "200", Цена: "550", Поступило: "10" }], "ru");
    ws = add(ws, mainId, [{ Товар: "Чехол", Количество: "3" }, { Товар: "Чехол iPhone" }], "ru");
    const p = tableOf(ws, products.id);
    const stock = p.columns.find((c) => c.name === "Остаток")!;
    expect(rowValues(p, p.rows[0], "2026-10-30", ws)[stock.id]).toBe(6);
    const sales = tableOf(ws, mainId);
    const v = rowValues(sales, sales.rows[0], "2026-10-30", ws);
    const named = Object.fromEntries(sales.columns.map((c) => [c.name, v[c.id]]));
    expect(named).toMatchObject({ Цена: 550, Сумма: 1650, Маржа: 1050 });
  });
});

describe("formulas over a whole column", () => {
  it("SUM([Amount]) totals the column", () => {
    let { ws, mainId } = fromTemplate("savings", "uk");
    ws = add(ws, mainId, [{ Сума: "5000" }, { Сума: "4500" }]);
    const t = tableOf(ws, mainId);
    const op: Op = { type: "column.add", tableId: t.id, column: { id: "c_left", name: "Лишилось", type: "formula", formula: "30000 - СУМ([Сума])" } };
    ws = applyOp(ws, op);
    const t2 = tableOf(ws, mainId);
    expect(computeRow(t2, t2.rows[0], "2026-10-30", ws).c_left).toEqual({ value: 20500 });
  });

  it("reports a column that sums itself as a cycle, not a hang", () => {
    let { ws, mainId } = fromTemplate("savings", "en");
    ws = add(ws, mainId, [{ Amount: "5" }], "en");
    ws = applyOp(ws, { type: "column.add", tableId: mainId, column: { id: "c_x", name: "X", type: "formula", formula: "SUM([X])" } });
    const t = tableOf(ws, mainId);
    expect(computeRow(t, t.rows[0], "2026-10-30", ws).c_x).toEqual({ error: "cycle" });
  });
});

describe("goal", () => {
  it("shows what's left and how much per month", () => {
    const p = goalProgress({ amount: 30000, columnId: "a", date: "2027-06-01" }, [{ a: 5000 }, { a: 4500 }], "2026-10-30");
    expect(p).toMatchObject({ saved: 9500, left: 20500, monthsLeft: 8 });
    expect(Math.round(p.perMonth!)).toBe(2563);
  });
});

describe("periods and grouping", () => {
  it("knows quarters and weeks", () => {
    expect(periodRange({ kind: "prevQuarter" }, "2026-10-30")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(periodRange({ kind: "nextWeek" }, "2026-10-30")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(dateKey("quarter", "2026-08-15")).toBe("2026-Q3");
    expect(dateKeyLabel("quarter", "2026-Q3", "uk")).toBe("III кв. 2026");
    expect(dateKeyLabel("month", "2026-10", "en")).toMatch(/Oct 2026/);
  });

  it("reports income by quarter and filters by side", () => {
    let { ws, mainId } = fromTemplate("budget", "en");
    ws = add(
      ws,
      mainId,
      [
        { Date: "2026-07-03", Type: "Income", Amount: "1000" },
        { Date: "2026-08-03", Type: "Income", Amount: "500" },
        { Date: "2026-08-04", Amount: "70" },
        { Date: "2026-10-01", Type: "Income", Amount: "900" },
      ],
      "en",
    );
    const t = tableOf(ws, mainId);
    const date = t.columns.find((c) => c.type === "date")!;
    const groups = aggregate(t, { groupBy: { kind: "quarter", columnId: date.id }, measure: { agg: "sum", columnId: null }, flow: "income" }, "2026-10-30", ws);
    expect(groups.map((g) => [g.key, g.value])).toEqual([
      ["2026-Q3", 1500],
      ["2026-Q4", 900],
    ]);
    const values = computedRows(t, "2026-10-30", ws);
    expect(scopeRows(t, values, { filters: [{ columnId: FLOW_FILTER, op: "in", values: ["expense"] }] }, "2026-10-30", ws)).toHaveLength(1);
    expect(scopeRows(t, values, { period: { kind: "prevQuarter" } }, "2026-10-30", ws)).toHaveLength(3);
  });

  it("builds a client × month table", () => {
    let { ws, mainId } = fromTemplate("team_jobs", "en");
    const clients = ws.tables.find((t) => t.name === "Clients")!;
    ws = add(ws, clients.id, [{ Name: "Iberia" }, { Name: "Casa Sol" }], "en");
    ws = add(
      ws,
      mainId,
      [
        { Job: "Office", Client: "Iberia", Date: "2026-10-05", Price: "120" },
        { Job: "Office", Client: "Iberia", Date: "2026-11-02", Price: "120" },
        { Job: "Flat", Client: "Casa Sol", Date: "2026-10-09", Price: "60" },
      ],
      "en",
    );
    const t = tableOf(ws, mainId);
    const client = t.columns.find((c) => c.name === "Client")!;
    const date = t.columns.find((c) => c.name === "Date")!;
    const price = t.columns.find((c) => c.name === "Price")!;
    const p = pivot(t, { groupBy: { kind: "column", columnId: client.id }, split: { kind: "month", columnId: date.id }, measure: { agg: "sum", columnId: price.id } }, "2026-10-30", ws)!;
    expect(p.rows).toEqual(["Iberia", "Casa Sol"]);
    expect(p.columns).toEqual(["2026-10", "2026-11"]);
    expect(p.cells.Iberia).toEqual({ "2026-10": 120, "2026-11": 120 });
    expect(p.total).toBe(300);
  });
});

describe("quick entry without the assistant", () => {
  const budget = () => fromTemplate("budget", "uk");

  it("understands «кава 85» and «вчора таксі 240»", () => {
    const { ws, mainId } = budget();
    const t = tableOf(ws, mainId);
    const entries = parseQuickEntries(t, "кава 85 і вчора таксі 240", { locale: "uk", now, ws })!;
    expect(entries).toHaveLength(2);
    const named = (e: (typeof entries)[number]) => Object.fromEntries(Object.entries(e.record).map(([id, v]) => [t.columns.find((c) => c.id === id)!.name, v]));
    expect(named(entries[0])).toMatchObject({ Категорія: "Їжа", Сума: 85, Коментар: "Кава" });
    expect(named(entries[1])).toMatchObject({ Дата: "2026-10-29", Категорія: "Транспорт", Сума: 240 });
  });

  it("marks salary as income and reads «1,2к»", () => {
    const { ws, mainId } = budget();
    const t = tableOf(ws, mainId);
    const [salary] = parseQuickEntries(t, "зарплата 18 500", { locale: "uk", now, ws })!;
    const [food] = parseQuickEntries(t, "продукти 1,2к", { locale: "uk", now, ws })!;
    const type = t.columns.find((c) => c.name === "Тип")!;
    const amount = t.columns.find((c) => c.name === "Сума")!;
    expect(salary.record[type.id]).toBe("Дохід");
    expect(salary.record[amount.id]).toBe(18500);
    expect(food.record[amount.id]).toBe(1200);
  });

  it("finds a linked client by name", () => {
    let { ws, mainId } = fromTemplate("clients_payments", "uk");
    const clients = ws.tables.find((x) => x.id !== mainId)!;
    ws = add(ws, clients.id, [{ "Ім'я": "Олег Петренко" }]);
    const t = tableOf(ws, mainId);
    const [e] = parseQuickEntries(t, "Олег Петренко 12000 соцмережі", { locale: "uk", now, ws })!;
    const link = t.columns.find((c) => c.type === "link")!;
    expect(e.record[link.id]).toBe(tableOf(ws, clients.id).rows[0].id);
  });

  it("leaves long or number-less phrases to the assistant", () => {
    const { ws, mainId } = budget();
    const t = tableOf(ws, mainId);
    expect(parseQuickEntries(t, "скільки я витратив на їжу", { locale: "uk", now, ws })).toBeNull();
  });
});

describe("choices", () => {
  it("renames or merges a choice everywhere", () => {
    let { ws, mainId } = fromTemplate("budget", "ru");
    ws = add(ws, mainId, [{ Категория: "Еда", Сумма: "10" }], "ru");
    const t = tableOf(ws, mainId);
    const cat = t.columns.find((c) => c.name === "Категория")!;
    ws = applyOp(ws, renameOption(t, cat.id, "Еда", "Продукты")!);
    const t2 = tableOf(ws, mainId);
    const cat2 = t2.columns.find((c) => c.id === cat.id)!;
    expect(cat2.options).toContain("Продукты");
    expect(t2.rows[0].values[cat.id]).toBe("Продукты");
    expect(cat2.scope!.map["Продукты"]).toBe("Расход");
  });

  it("shows income categories only for income", () => {
    const { ws, mainId } = fromTemplate("budget", "en");
    const t: Table = tableOf(ws, mainId);
    const cat = t.columns.find((c) => c.name === "Category")!;
    expect(optionsFor(cat, "Income")).toContain("Salary");
    expect(optionsFor(cat, "Income")).not.toContain("Food");
    expect(optionsFor(cat, "Expense")).toContain("Food");
  });
});

describe("quick entry, round 2", () => {
  it("reads month names and short dates, keeps the words", () => {
    const { ws, mainId } = fromTemplate("budget", "uk");
    const t = tableOf(ws, mainId);
    const date = t.columns.find((c) => c.name === "Дата")!;
    const note = t.columns.find((c) => c.name === "Коментар")!;
    const type = t.columns.find((c) => c.name === "Тип")!;
    const [a] = parseQuickEntries(t, "5 вересня АТБ 640", { locale: "uk", now, ws })!;
    expect(a.record[date.id]).toBe("2026-09-05");
    expect(a.record[note.id]).toBe("АТБ");
    const [b] = parseQuickEntries(t, "5.9 кава 60", { locale: "uk", now, ws })!;
    expect(b.record[date.id]).toBe("2026-09-05");
    const [c] = parseQuickEntries(t, "відклав на відпустку 2000", { locale: "uk", now, ws })!;
    expect(c.record[note.id]).toBe("Відклав на відпустку");
    const [gift] = parseQuickEntries(t, "подарунок мамі 800", { locale: "uk", now, ws })!;
    expect(gift.record[type.id]).toBeUndefined();
    const [bonus] = parseQuickEntries(t, "премія 3000", { locale: "uk", now, ws })!;
    expect(bonus.record[type.id]).toBe("Дохід");
    const [coffee] = parseQuickEntries(t, "каву 85", { locale: "uk", now, ws })!;
    expect(Object.values(coffee.record)).toContain("Їжа");
  });

  it("a goal in an income & expenses table counts what's left", () => {
    const p = goalProgress({ amount: 1000, columnId: "a" }, [{ a: 800, t: "in" }, { a: 300 }], "2026-10-30", { amountId: "a", kind: "both", typeColumnId: "t", incomeValues: ["in"] });
    expect(p.saved).toBe(500);
  });
});

describe("jobs, round 2", () => {
  it("counts done jobs as income, keeps the job name and hours", () => {
    let { ws, mainId } = fromTemplate("team_jobs", "en");
    const clients = ws.tables.find((t) => t.name === "Clients")!;
    const staff = ws.tables.find((t) => t.name === "Staff")!;
    ws = add(ws, clients.id, [{ Name: "Hotel Miramar", "Monthly fee": "900" }], "en");
    ws = add(ws, staff.id, [{ Name: "Lucía", "Hourly rate": "14" }], "en");
    const jobs = tableOf(ws, mainId);
    const [e] = parseQuickEntries(jobs, "Hotel Miramar windows Lucía 4h 120 mañana", { locale: "en", now, ws })!;
    const named = Object.fromEntries(Object.entries(e.record).map(([id, v]) => [jobs.columns.find((c) => c.id === id)!.name, v]));
    expect(named).toMatchObject({ Job: "Windows", Hours: 4, Price: 120, Date: "2026-10-31" });
    ws = add(ws, mainId, [{ Job: "A", Client: "Hotel Miramar", Price: "120", Status: "Done" }, { Job: "B", Client: "Hotel Miramar", Price: "80", Status: "prob" }], "en");
    const t = tableOf(ws, mainId);
    expect(t.rows[1].values[t.columns.find((c) => c.name === "Status")!.id]).toBe("Problem");
    expect(ledgerTotals(ledgerOf(t)!, computedRows(t, "2026-10-30", ws))).toMatchObject({ income: 120, pending: 80 });
    expect(ledgerOf(tableOf(ws, staff.id))).toBeNull();
    const c = tableOf(ws, clients.id);
    const revenue = c.columns.find((x) => x.name === "Revenue")!;
    expect(rowValues(c, c.rows[0], "2026-10-30", ws)[revenue.id]).toBe(120);
  });
});

describe("money, round 2", () => {
  it("refuses dollars typed into a hryvnia column instead of saving them as hryvnias", () => {
    const { ws, mainId } = fromTemplate("clients_payments", "uk");
    const t = tableOf(ws, mainId);
    const res = addRecords(t, [{ Сума: "$800" }], { locale: "uk", now, ws, currency: "UAH" });
    expect(res.problems[0].reason).toBe("currency_mismatch");
    expect(addRecords(t, [{ Сума: "800 грн" }], { locale: "uk", now, ws, currency: "UAH" }).problems).toEqual([]);
  });

  it("counts income on the payment day", () => {
    let { ws, mainId } = fromTemplate("clients_payments", "uk");
    ws = add(ws, mainId, [{ Дата: "2026-09-25", Сума: "1000", Оплачено: "так", "Дата оплати": "2026-10-02" }]);
    expect(incomeBetween(ws, "2026-07-01", "2026-09-30", "2026-10-30").total).toBe(0);
    expect(incomeBetween(ws, "2026-10-01", "2026-12-31", "2026-10-30").total).toBe(1000);
  });
});

describe("excel formulas", () => {
  it("translates row formulas and column sums", async () => {
    const { excelFormula } = await import("./formula.ts");
    const cells: Record<string, string> = { Кількість: "C5", Ціна: "D5", Оплачено: "E5" };
    expect(excelFormula("[Кількість] * [Ціна]", (n) => cells[n] ?? null, () => null)).toBe("=(C5*D5)");
    expect(excelFormula("ЯКЩО([Оплачено]; ОКРУГЛИТИ([Ціна] * 5 / 100; 2); 0)", (n) => cells[n] ?? null, () => null)).toBe("=IF(E5,ROUND(((D5*5)/100),2),0)");
    expect(excelFormula("30000 - СУМ([Ціна])", () => null, (n) => (n === "Ціна" ? "D2:D40" : null))).toBe("=(30000-SUM(D2:D40))");
    expect(excelFormula("[Нема] * 2", () => null, () => null)).toBeNull();
  });
});

describe("currency conversion", () => {
  it("converts dollars at the official rate and keeps the original in the note", () => {
    const { ws, mainId } = fromTemplate("clients_payments", "uk");
    const t = tableOf(ws, mainId);
    const rates = { base: "UAH", date: "2026-10-31", source: "НБУ", rates: { USD: 41.25 } };
    const res = addRecords(t, [{ Сума: "$800" }], { locale: "uk", now, ws, currency: "UAH", rates });
    expect(res.problems).toEqual([]);
    const sum = t.columns.find((c) => c.name === "Сума")!;
    const note = t.columns.find((c) => c.name === "Коментар")!;
    expect(res.rows[0].values[sum.id]).toBe(33000);
    expect(res.rows[0].values[note.id]).toBe("800 USD × 41,25 (НБУ 2026-10-31)");
  });
});
