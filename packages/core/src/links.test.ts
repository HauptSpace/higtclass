import { describe, expect, it } from "vitest";
import { aggregate } from "./aggregate.ts";
import { addColumn, addRecords, changeColumnType, createTable, newId } from "./commands.ts";
import { computeRow, displayColumn } from "./formula.ts";
import { backlinks, cellText } from "./links.ts";
import { applyOp, applyWithInverse } from "./ops.ts";
import type { Report, Workspace } from "./types.ts";

const settings = { locale: "ru" as const, currency: "RUB" };
const today = "2026-10-29";

function setup() {
  let ws: Workspace = { tables: [] };
  const clients = createTable(
    {
      name: "Клиенты",
      columns: [
        { name: "Имя", type: "text" },
        { name: "Телефон", type: "text" },
        { name: "Скидка", type: "number" },
      ],
      rows: [
        { Имя: "ООО «Альфа»", Телефон: "+7 900 000-00-01", Скидка: 5 },
        { Имя: "ИП Беляев", Телефон: "+7 900 000-00-02", Скидка: 0 },
      ],
    },
    { locale: "ru" },
  );
  ws = applyOp(ws, clients.op);
  const orders = createTable(
    {
      name: "Заказы",
      columns: [
        { name: "Дата", type: "date" },
        { name: "Клиент", type: "link", linkTableId: clients.table.id },
        { name: "Сумма", type: "money" },
      ],
    },
    { locale: "ru" },
  );
  ws = applyOp(ws, orders.op);
  return { ws, clients: clients.table, orders: ws.tables[1] };
}

describe("linked tables", () => {
  it("resolves typed or dictated names to rows, and rejects unknown ones", () => {
    const { ws, clients, orders } = setup();
    const res = addRecords(
      orders,
      [
        { Дата: "2026-10-28", Клиент: "альфа", Сумма: "120к" },
        { Дата: "2026-10-29", Клиент: "ИП Беляев", Сумма: 45500 },
        { Дата: "2026-10-29", Клиент: "ООО «Альфа»", Сумма: 8500 },
        { Клиент: "Гамма" },
      ],
      { locale: "ru", ws },
    );
    expect(res.problems).toEqual([expect.objectContaining({ reason: "invalid_value", input: "Гамма" })]);
    const after = applyOp(ws, res.op);
    const link = orders.columns[1];
    expect(res.rows.map((r) => r.values[link.id])).toEqual([clients.rows[0].id, clients.rows[1].id, clients.rows[0].id, undefined]);
    expect(cellText(after, orders, link, res.rows[0].values[link.id], settings)).toBe("ООО «Альфа»");

    const alpha = backlinks(after, clients.id, clients.rows[0].id);
    expect(alpha).toHaveLength(1);
    expect(alpha[0].rows).toHaveLength(2);
  });

  it("looks up values through a link, including into formulas", () => {
    const { ws, clients, orders } = setup();
    const link = orders.columns[1];
    const phone = addColumn(orders, { name: "Телефон", type: "lookup", lookup: { viaColumnId: link.id, columnId: clients.columns[1].id } });
    let w = applyOp(ws, phone.op);
    const disc = addColumn(w.tables[1], { name: "Скидка", type: "lookup", lookup: { viaColumnId: link.id, columnId: clients.columns[2].id } });
    w = applyOp(w, disc.op);
    const net = addColumn(w.tables[1], { name: "К оплате", type: "formula", formula: "[Сумма] * (1 - [Скидка] / 100)" });
    w = applyOp(w, net.op);
    const rows = addRecords(w.tables[1], [{ Клиент: "Альфа", Сумма: 1000 }], { locale: "ru", ws: w });
    w = applyOp(w, rows.op);
    const t = w.tables[1];
    const out = computeRow(t, t.rows[0], today, w);
    expect(out[phone.column.id]).toEqual({ value: "+7 900 000-00-01" });
    expect(out[net.column.id]).toEqual({ value: 950 });
    expect(displayColumn(t, disc.column, w).type).toBe("number");
  });

  it("turns a text column into a link by matching names, undoably", () => {
    let ws: Workspace = { tables: [] };
    const clients = createTable({ name: "Клиенты", columns: [{ name: "Имя", type: "text" }], rows: [{ Имя: "Альфа" }] }, { locale: "ru" });
    ws = applyOp(ws, clients.op);
    const orders = createTable({ name: "Заказы", columns: [{ name: "Клиент", type: "text" }], rows: [{ Клиент: "альфа" }, { Клиент: "Неизвестный" }] }, { locale: "ru" });
    ws = applyOp(ws, orders.op);
    const col = orders.table.columns[0];
    const res = changeColumnType(ws.tables[1], col.id, "link", { locale: "ru", ws }, { linkTableId: clients.table.id });
    const { ws: after, inverse } = applyWithInverse(ws, res.op);
    expect(after.tables[1].rows.map((r) => r.values[col.id])).toEqual([clients.table.rows[0].id, undefined]);
    expect(applyOp(after, inverse)).toEqual(ws);
  });

  it("aggregates by linked row name for reports", () => {
    const { ws, orders } = setup();
    const res = addRecords(orders, [{ Клиент: "Альфа", Сумма: 100 }, { Клиент: "Беляев", Сумма: 300 }, { Клиент: "Альфа", Сумма: 50 }], { locale: "ru", ws });
    const w = applyOp(ws, res.op);
    const t = w.tables[1];
    const groups = aggregate(t, { groupBy: { kind: "column", columnId: t.columns[1].id }, measure: { agg: "sum", columnId: t.columns[2].id } }, today, w);
    expect(groups.map((g) => [g.key, g.value])).toEqual([
      ["ИП Беляев", 300],
      ["ООО «Альфа»", 150],
    ]);
  });
});

describe("reports", () => {
  it("create, update and delete undoably", () => {
    const { ws, orders } = setup();
    const report: Report = {
      id: newId.report(),
      name: "Выручка по клиентам",
      tableId: orders.id,
      measure: { agg: "sum", columnId: orders.columns[2].id },
      groupBy: { kind: "column", columnId: orders.columns[1].id },
      chart: "bars",
      limit: 10,
    };
    const created = applyWithInverse(ws, { type: "report.create", report });
    expect(applyOp(created.ws, created.inverse)).toEqual(ws);
    const updated = applyWithInverse(created.ws, { type: "report.update", reportId: report.id, patch: { chart: "columns" } });
    expect(updated.ws.reports![0].chart).toBe("columns");
    expect(applyOp(updated.ws, updated.inverse)).toEqual(created.ws);
    const deleted = applyWithInverse(created.ws, { type: "report.delete", reportId: report.id });
    expect(applyOp(deleted.ws, deleted.inverse)).toEqual(created.ws);
  });
});
