import { describe, expect, it } from "vitest";
import { summarizeTable, groupBy } from "./aggregate.ts";
import { addRecords, changeColumnType, createTable, updateCells } from "./commands.ts";
import { applyOp, applyWithInverse, type Op } from "./ops.ts";
import { TEMPLATES } from "./templates.ts";
import type { Workspace } from "./types.ts";

const ctx = { locale: "ru" as const, now: new Date(2026, 9, 29) };
const empty: Workspace = { tables: [] };

function setup() {
  const created = createTable(
    {
      name: "Расходы",
      columns: [
        { name: "Дата", type: "date" },
        { name: "Категория", type: "select", options: ["Еда"] },
        { name: "Сумма", type: "money" },
      ],
      rows: [{ Дата: "вчера", Категория: "еда", Сумма: "1 500" }],
    },
    ctx,
  );
  expect(created.problems).toEqual([]);
  return { ws: applyOp(empty, created.op), table: created.table };
}

/** Applying an op and then its inverse must give back the original workspace. */
function expectUndoable(ws: Workspace, op: Op) {
  const { ws: after, inverse } = applyWithInverse(ws, op);
  expect(after).not.toEqual(ws);
  expect(applyOp(after, inverse)).toEqual(ws);
  return after;
}

describe("commands + ops", () => {
  it("creates a table and parses the initial rows", () => {
    const { ws, table } = setup();
    const [date, cat, sum] = table.columns;
    expect(ws.tables[0].rows[0].values).toEqual({ [date.id]: "2026-10-28", [cat.id]: "Еда", [sum.id]: 1500 });
  });

  it("adds records, extends select options, reports bad input", () => {
    const { ws, table } = setup();
    const res = addRecords(table, [{ Сумма: "5к", Категория: "Такси" }, { Сумма: "много" }, { Цвет: "red" }], ctx);
    expect(res.problems.map((p) => p.reason)).toEqual(["invalid_value", "unknown_column"]);
    const after = expectUndoable(ws, res.op);
    const t = after.tables[0];
    expect(t.rows).toHaveLength(4);
    expect(t.columns[1].options).toEqual(["Еда", "Такси"]);
  });

  it("updates and clears cells", () => {
    const { ws, table } = setup();
    const rowId = table.rows[0].id;
    const res = updateCells(table, [{ rowId, column: "Сумма", value: "2000" }, { rowId, column: "Категория", value: "" }], ctx);
    const after = expectUndoable(ws, res.op);
    expect(after.tables[0].rows[0].values).toEqual({ [table.columns[0].id]: "2026-10-28", [table.columns[2].id]: 2000 });
  });

  it("changes column type with value conversion, undoably", () => {
    const { ws, table } = setup();
    const res = changeColumnType(table, table.columns[2].id, "text", ctx);
    const after = expectUndoable(ws, res.op);
    expect(after.tables[0].rows[0].values[table.columns[2].id]).toBe("1500");
  });

  it("renaming a column rewrites formulas that use it", () => {
    const { ws, table } = setup();
    const withFormula = applyOp(ws, {
      type: "column.add",
      tableId: table.id,
      column: { id: "f", name: "x2", type: "formula", formula: "[Сумма] * 2" },
    });
    const after = expectUndoable(withFormula, {
      type: "column.update",
      tableId: table.id,
      columnId: table.columns[2].id,
      patch: { name: "Деньги" },
    });
    expect(after.tables[0].columns.at(-1)!.formula).toBe("[Деньги] * 2");
  });

  it("deletes rows, columns and tables undoably", () => {
    const { ws, table } = setup();
    expectUndoable(ws, { type: "rows.delete", tableId: table.id, rowIds: [table.rows[0].id] });
    expectUndoable(ws, { type: "column.delete", tableId: table.id, columnId: table.columns[2].id });
    expectUndoable(ws, { type: "table.delete", tableId: table.id });
  });

  it("summarizes and groups", () => {
    const { ws, table } = setup();
    const more = addRecords(table, [{ Категория: "Еда", Сумма: 500 }, { Категория: "Такси", Сумма: 300 }], ctx);
    const t = applyOp(ws, more.op).tables[0];
    const sum = table.columns[2].id;
    expect(summarizeTable(t, "2026-10-29")[sum]).toMatchObject({ count: 3, sum: 2300, max: 1500 });
    expect(groupBy(t, table.columns[1].id, sum, "2026-10-29")).toEqual([
      { key: "Еда", count: 2, sum: 2000 },
      { key: "Такси", count: 1, sum: 300 },
    ]);
  });
});

describe("templates", () => {
  it.each(["ru", "uk", "en", "de", "es"] as const)("build cleanly in %s", (locale) => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(8);
    for (const tpl of TEMPLATES) {
      const res = createTable({ name: tpl.name[locale], icon: tpl.icon, columns: tpl.columns(locale) }, { locale });
      expect(res.problems).toEqual([]);
    }
  });
});
