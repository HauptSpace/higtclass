import { describe, expect, it } from "vitest";
import { applyOp } from "./ops.ts";
import { createTable } from "./commands.ts";
import { deadlinePeriod, DEFAULT_RULES, germanHolidays, incomeThisYear, isRulePack, suggestionsFor, upcomingDeadlines, upcomingHolidays } from "./knowledge.ts";

describe("for-you rules", () => {
  it("picks deadlines for a Ukrainian FOP of group 3", () => {
    const up = upcomingDeadlines(DEFAULT_RULES, { country: "UA", occupation: "self", regime: "ua_fop3" }, "2026-10-29");
    expect(up.map((u) => [u.deadline.id, u.date, u.daysLeft])).toEqual([
      ["ua_fop3_declaration", "2026-11-09", 11],
      ["ua_fop3_payment", "2026-11-19", 21],
    ]);
  });

  it("moves German VAT deadlines off weekends", () => {
    const up = upcomingDeadlines(DEFAULT_RULES, { country: "DE", occupation: "self", regime: "de_ust_monthly" }, "2027-04-01", 40);
    // 10 April 2027 is a Saturday.
    expect(up.find((u) => u.deadline.id === "de_ust_monthly")!.date).toBe("2027-04-12");
  });

  it("filters suggestions by profile", () => {
    const ids = suggestionsFor(DEFAULT_RULES, { country: "DE", occupation: "self", regime: "de_klein" }).map((s) => s.id);
    expect(ids).toEqual(["de_klein_limit", "de_euer", "de_trips", "goals"]);
    expect(suggestionsFor(DEFAULT_RULES, { country: "other", occupation: "personal", regime: "none" }).map((s) => s.id)).toEqual([
      "personal_savings",
      "goals",
      "personal_expenses",
    ]);
  });

  it("knows German public holidays", () => {
    const h = germanHolidays(2026);
    expect(h.find((x) => x.name === "Karfreitag")!.date).toBe("2026-04-03");
    expect(h.find((x) => x.name === "Pfingstmontag")!.date).toBe("2026-05-25");
    expect(upcomingHolidays({ country: "DE", occupation: "self", regime: "de_klein" }, "2026-12-01", 30).map((x) => x.name)).toEqual([
      "1. Weihnachtstag",
      "2. Weihnachtstag",
    ]);
  });

  it("adds up this year's income for limit trackers", () => {
    const res = createTable(
      {
        name: "Доходы и расходы",
        columns: [
          { name: "Дата", type: "date" },
          { name: "Тип", type: "select", options: ["Доход", "Расход"] },
          { name: "Сумма", type: "money" },
        ],
        rows: [
          { Дата: "2026-03-01", Тип: "Доход", Сумма: 1000 },
          { Дата: "2026-03-02", Тип: "Расход", Сумма: 300 },
          { Дата: "2025-12-31", Тип: "Доход", Сумма: 5000 },
        ],
      },
      { locale: "ru" },
    );
    const ws = applyOp({ tables: [] }, res.op);
    expect(incomeThisYear(ws, "2026-10-29")).toEqual({ total: 1000, tables: ["Доходы и расходы"] });
  });

  it("adds state holidays when the Bundesland is known", () => {
    expect(germanHolidays(2026, "NW").some((h) => h.name === "Allerheiligen")).toBe(true);
    expect(germanHolidays(2026, "BE").some((h) => h.name === "Allerheiligen")).toBe(false);
    expect(germanHolidays(2026, "SN").find((h) => h.name === "Buß- und Bettag")!.date).toBe("2026-11-18");
  });

  it("keeps a passed deadline visible for a week and knows its quarter", () => {
    const up = upcomingDeadlines(DEFAULT_RULES, { country: "UA", occupation: "self", regime: "ua_fop3" }, "2026-11-12", 10, 7);
    const decl = up.find((u) => u.deadline.id === "ua_fop3_declaration")!;
    expect(decl.daysLeft).toBe(-3);
    expect(deadlinePeriod(decl.deadline, decl.date)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("validates fetched rule packs", () => {
    expect(isRulePack(DEFAULT_RULES)).toBe(true);
    expect(isRulePack({ version: "x" })).toBe(false);
  });
});

describe("more countries", () => {
  it("knows Polish and Spanish holidays and deadlines", async () => {
    const { polishHolidays, spanishHolidays } = await import("./knowledge.ts");
    expect(polishHolidays(2026).find((h) => h.name === "Boże Ciało")!.date).toBe("2026-06-04");
    expect(spanishHolidays(2026).find((h) => h.name === "Viernes Santo")!.date).toBe("2026-04-03");
    const pl = upcomingDeadlines(DEFAULT_RULES, { country: "PL", occupation: "self", regime: "pl_jdg_vat" }, "2026-10-30", 30).map((u) => [u.deadline.id, u.date]);
    expect(pl).toEqual([
      ["pl_zus", "2026-11-20"],
      ["pl_pit_advance", "2026-11-20"],
      ["pl_vat", "2026-11-25"],
    ]);
    const es = upcomingDeadlines(DEFAULT_RULES, { country: "ES", occupation: "self", regime: "es_autonomo" }, "2027-01-02", 40);
    expect(es.map((u) => [u.deadline.id, u.date])).toEqual([["es_quarterly", "2027-02-01"]]);
  });
});
