import { describe, expect, it } from "vitest";
import type { Column } from "./types.ts";
import { formatValue, parseDate, parseNumber, parseValue } from "./values.ts";

const now = new Date(2026, 9, 29); // 29 Oct 2026

describe("parseNumber", () => {
  it.each([
    ["1500", "ru", 1500],
    ["1 500,50", "ru", 1500.5],
    ["1.500,50", "de", 1500.5],
    ["1,500.50", "en", 1500.5],
    ["1,500", "en", 1500],
    ["1,5", "ru", 1.5],
    ["1.5", "ru", 1.5],
    ["1.000.000", "de", 1_000_000],
    ["5к", "ru", 5000],
    ["5 тыс", "ru", 5000],
    ["2,5к", "ru", 2500],
    ["1.2 млн", "ru", 1_200_000],
    ["5 тис", "uk", 5000],
    ["5k", "en", 5000],
    ["5 mil", "es", 5000],
    ["3 Mio", "de", 3_000_000],
    ["500 ₽", "ru", 500],
    ["500 руб", "ru", 500],
    ["300 грн", "uk", 300],
    ["$20", "en", 20],
    ["20 €", "de", 20],
    ["-300", "ru", -300],
    ["−300", "ru", -300],
  ] as const)("%s (%s) → %d", (raw, locale, expected) => {
    expect(parseNumber(raw, locale)).toBe(expected);
  });

  it.each(["abc", "5 яблок", "1.2.3,4,5", "", "--5"])("rejects %s", (raw) => {
    expect(parseNumber(raw, "ru")).toBeNull();
  });
});

describe("parseDate", () => {
  it.each([
    ["сегодня", "ru", "2026-10-29"],
    ["вчера", "ru", "2026-10-28"],
    ["вчора", "uk", "2026-10-28"],
    ["yesterday", "en", "2026-10-28"],
    ["gestern", "de", "2026-10-28"],
    ["ayer", "es", "2026-10-28"],
    ["mañana", "es", "2026-10-30"],
    ["2026-03-04", "ru", "2026-03-04"],
    ["04.03.2026", "ru", "2026-03-04"],
    ["4.3", "de", "2026-03-04"],
    ["03/04/2026", "en", "2026-04-03"],
    ["04/03/26", "es", "2026-03-04"],
  ] as const)("%s (%s) → %s", (raw, locale, expected) => {
    expect(parseDate(raw, locale, now)).toBe(expected);
  });

  it("rejects impossible dates", () => {
    expect(parseDate("31.02.2026", "ru", now)).toBeNull();
    expect(parseDate("завтра-послезавтра", "ru", now)).toBeNull();
  });
});

describe("parseValue", () => {
  const col = (type: Column["type"]): Column => ({ id: "c", name: "x", type });

  it("treats empty input as an empty cell", () => {
    expect(parseValue(col("money"), "  ", "ru")).toBeNull();
  });

  it("returns undefined for input it cannot understand", () => {
    expect(parseValue(col("money"), "много", "ru")).toBeUndefined();
    expect(parseValue(col("date"), "когда-нибудь", "ru")).toBeUndefined();
  });

  it("understands yes/no in every language", () => {
    expect(parseValue(col("checkbox"), "да", "ru")).toBe(true);
    expect(parseValue(col("checkbox"), "так", "uk")).toBe(true);
    expect(parseValue(col("checkbox"), "ja", "de")).toBe(true);
    expect(parseValue(col("checkbox"), "sí", "es")).toBe(true);
    expect(parseValue(col("checkbox"), "нет", "ru")).toBe(false);
  });
});

describe("formatValue", () => {
  it("formats money with the column or workspace currency", () => {
    const money: Column = { id: "c", name: "x", type: "money" };
    expect(formatValue(money, 1500.5, { locale: "ru", currency: "RUB" }).replace(/\s/g, " ")).toBe("1 500,50 ₽");
    expect(formatValue(money, 1500, { locale: "ru", currency: "RUB" }).replace(/\s/g, " ")).toBe("1 500 ₽");
    expect(formatValue({ ...money, currency: "EUR" }, 1500.5, { locale: "de", currency: "RUB" }).replace(/\s/g, " ")).toBe("1.500,50 €");
  });
});
