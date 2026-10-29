import { describe, expect, it } from "vitest";
import { computeRow, displayColumn, renameFormulaRefs, validateFormula } from "./formula.ts";
import type { Table } from "./types.ts";

const today = "2026-10-29";

function table(formulas: Record<string, string>, values: Record<string, unknown> = {}): Table {
  return {
    id: "t",
    name: "T",
    icon: "",
    createdAt: 0,
    columns: [
      { id: "qty", name: "Кол-во", type: "number" },
      { id: "price", name: "Цена", type: "money" },
      { id: "cat", name: "Категория", type: "select", options: ["Еда"] },
      { id: "due", name: "Срок", type: "date" },
      ...Object.entries(formulas).map(([id, formula]) => ({ id, name: id, type: "formula" as const, formula })),
    ],
    rows: [{ id: "r", createdAt: 0, values: { qty: 3, price: 250, cat: "Еда", due: "2026-11-08", ...values } as never }],
  };
}

const calc = (formula: string, values?: Record<string, unknown>) => {
  const t = table({ f: formula }, values);
  return computeRow(t, t.rows[0], today).f;
};

describe("formulas", () => {
  it("references columns by name, case-insensitively", () => {
    expect(calc("[Кол-во] * [цена]")).toEqual({ value: 750 });
  });

  it("follows operator precedence, percent and power", () => {
    expect(calc("1 + 2 * 3 ^ 2")).toEqual({ value: 19 });
    expect(calc("[Цена] * 10%")).toEqual({ value: 25 });
    expect(calc("-(2 + 3)")).toEqual({ value: -5 });
  });

  it("supports localized function names and both argument separators", () => {
    expect(calc("ОКРУГЛ([Цена] / 3; 2)")).toEqual({ value: 83.33 });
    expect(calc("RUNDEN([Цена] / 3, 1)")).toEqual({ value: 83.3 });
    expect(calc('ЕСЛИ([Категория] = "еда"; "да"; "нет")')).toEqual({ value: "да" });
    expect(calc('WENN([Кол-во] > 5, 1, 0)')).toEqual({ value: 0 });
    expect(calc("МАКС([Кол-во]; 10; 2)")).toEqual({ value: 10 });
  });

  it("accepts decimal commas where they cannot be argument separators", () => {
    expect(calc("[Цена] * 1,5")).toEqual({ value: 375 });
    expect(calc("ОКРУГЛ([Цена] * 1,02; 1)")).toEqual({ value: 255 });
    expect(calc("MAX(1,5)")).toEqual({ value: 5 });
  });

  it("does date math", () => {
    expect(calc("DAYS([Срок], TODAY())")).toEqual({ value: 10 });
  });

  it("treats empty cells as zero", () => {
    expect(calc("[Кол-во] + 1", { qty: undefined })).toEqual({ value: 1 });
  });

  it("chains formula columns and detects cycles", () => {
    const t = table({ a: "[Цена] * 2", b: "[a] + 1", x: "[y]", y: "[x]" });
    const out = computeRow(t, t.rows[0], today);
    expect(out.b).toEqual({ value: 501 });
    expect(out.x).toEqual({ error: "cycle" });
  });

  it("reports errors instead of throwing", () => {
    expect(calc("[Нет такой]")).toEqual({ error: "ref" });
    expect(calc("[Цена] / 0")).toEqual({ error: "div0" });
    expect(calc("[Цена] * ")).toEqual({ error: "syntax" });
    expect(calc('[Категория] * 2')).toEqual({ error: "type" });
  });

  it("displays formulas over money as money", () => {
    const t = table({ m: "[Цена] * 2", n: "[Кол-во] * 2" });
    expect(displayColumn(t, t.columns.find((c) => c.id === "m")!).type).toBe("money");
    expect(displayColumn(t, t.columns.find((c) => c.id === "n")!).type).toBe("formula");
  });

  it("validates and rewrites references", () => {
    expect(() => validateFormula("[a] +")).toThrow();
    expect(renameFormulaRefs("[Цена] * [ цена ] + [Кол-во]", "цена", "Price")).toBe("[Price] * [Price] + [Кол-во]");
  });
});
