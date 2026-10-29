import { describe, expect, it } from "vitest";
import { applyOp } from "./ops.ts";
import { createTable } from "./commands.ts";
import { DEFAULT_RULES, germanHolidays, incomeThisYear, isRulePack, suggestionsFor, upcomingDeadlines, upcomingHolidays } from "./knowledge.ts";

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
    expect(ids).toEqual(["de_klein_limit", "de_euer"]);
    expect(suggestionsFor(DEFAULT_RULES, { country: "other", occupation: "personal", regime: "none" }).map((s) => s.id)).toEqual([
      "personal_savings",
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

  it("validates fetched rule packs", () => {
    expect(isRulePack(DEFAULT_RULES)).toBe(true);
    expect(isRulePack({ version: "x" })).toBe(false);
  });
});
