import { describe, expect, it } from "vitest";
import { createTable } from "./commands.ts";
import { parseCsv, planImport, toCsv } from "./infer.ts";

describe("import", () => {
  it("guesses column types from an Excel-like grid", () => {
    const grid = [
      [null, null, null, null, null, null],
      ["Дата", "Клиент", "Сумма", "Статус", "Оплачено", "Кол-во"],
      [new Date(2026, 9, 1), "ООО Альфа", 120000, "Новый", "да", "12.5"],
      ["02.10.2026", "ИП Беляев", "45 500 ₽", "Готов", "нет", "3"],
      ["2026-10-03", "ТД Гамма", 98000, "Новый", "да", "7,25"],
      ["04.10.2026", "Hotel Nord", 67500, "Готов", "нет", "1"],
      [null, null, null, null, null, null],
    ];
    const plan = planImport(grid, "ru");
    expect(plan.columns.map((c) => c.type)).toEqual(["date", "text", "money", "select", "checkbox", "number"]);
    expect(plan.columns[3].options).toEqual(["Новый", "Готов"]);
    const res = createTable({ name: "Импорт", columns: plan.columns, rows: plan.rows }, { locale: "ru" });
    expect(res.problems).toEqual([]);
    expect(res.table.rows).toHaveLength(4);
    expect(res.table.rows[1].values[res.table.columns[2].id]).toBe(45500);
    expect(res.table.rows[0].values[res.table.columns[0].id]).toBe("2026-10-01");
  });

  it("names empty and duplicate headers and drops empty columns", () => {
    const plan = planImport(
      [
        ["Имя", "", "Имя", ""],
        ["А", "x", "B", ""],
      ],
      "en",
    );
    expect(plan.columns.map((c) => c.name)).toEqual(["Имя", "2", "Имя 2"]);
  });

  it("reads and writes CSV with quotes and either delimiter", () => {
    expect(parseCsv('a;b\r\n"x;1";"he said ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x;1", 'he said "hi"'],
    ]);
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    const csv = toCsv([["Имя", "Сумма"], ['ООО "Альфа"', 120000]], "ru");
    expect(parseCsv(csv)).toEqual([
      ["Имя", "Сумма"],
      ['ООО "Альфа"', "120000"],
    ]);
  });
});
