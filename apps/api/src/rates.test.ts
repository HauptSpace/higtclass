import { describe, expect, it } from "vitest";
import { ecbRates, nbuRates } from "./rates.ts";

const ok = (body: unknown) => async () => ({ ok: true, text: async () => String(body), json: async () => body });

describe("exchange rates", () => {
  it("reads the National Bank of Ukraine list", async () => {
    const r = await nbuRates(ok([{ cc: "USD", rate: 41.25, exchangedate: "31.10.2026" }, { cc: "EUR", rate: 47.9, exchangedate: "31.10.2026" }]));
    expect(r).toMatchObject({ base: "UAH", date: "2026-10-31", source: "NBU" });
    expect(r.rates.USD).toBe(41.25);
  });

  it("turns ECB's per-euro rates into any base", async () => {
    const xml = "<Cube time='2026-10-30'><Cube currency='USD' rate='1.10'/><Cube currency='PLN' rate='4.40'/></Cube>";
    const eur = await ecbRates(ok(xml), "EUR");
    expect(eur.rates.USD).toBeCloseTo(1 / 1.1);
    const pln = await ecbRates(ok(xml), "PLN");
    expect(pln.rates.EUR).toBeCloseTo(4.4);
    expect(pln.rates.USD).toBeCloseTo(4);
  });
});
