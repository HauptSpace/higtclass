// Exchange rates for "$800 into a hryvnia column": the National Bank of
// Ukraine for UAH, the European Central Bank for everything else (via EUR).
// Fetched at most every six hours and kept in memory.

export interface Rates {
  base: string;
  date: string;
  source: "NBU" | "ECB";
  /** How much one unit of each currency is worth in `base`. */
  rates: Record<string, number>;
}

type Fetch = (url: string) => Promise<{ ok: boolean; text(): Promise<string>; json(): Promise<unknown> }>;

const NBU = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json";
const ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const TTL = 6 * 3600_000;

export async function nbuRates(fetcher: Fetch): Promise<Rates> {
  const res = await fetcher(NBU);
  if (!res.ok) throw new Error("NBU unavailable");
  const list = (await res.json()) as { cc: string; rate: number; exchangedate: string }[];
  const rates: Record<string, number> = { UAH: 1 };
  for (const r of list) if (typeof r.rate === "number" && r.cc) rates[r.cc] = r.rate;
  const [d, m, y] = (list[0]?.exchangedate ?? "").split(".");
  return { base: "UAH", date: y ? `${y}-${m}-${d}` : "", source: "NBU", rates };
}

/** ECB publishes how many units of each currency one euro buys. */
export async function ecbRates(fetcher: Fetch, base: string): Promise<Rates> {
  const res = await fetcher(ECB);
  if (!res.ok) throw new Error("ECB unavailable");
  const xml = await res.text();
  const perEuro: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/currency='([A-Z]{3})'\s+rate='([\d.]+)'/g)) perEuro[m[1]] = Number(m[2]);
  const date = xml.match(/time='(\d{4}-\d{2}-\d{2})'/)?.[1] ?? "";
  if (!perEuro[base]) throw new Error(`No ECB rate for ${base}`);
  const rates: Record<string, number> = {};
  for (const [cc, n] of Object.entries(perEuro)) rates[cc] = perEuro[base] / n;
  return { base, date, source: "ECB", rates };
}

const cache = new Map<string, { at: number; rates: Rates }>();

export async function ratesFor(base: string, fetcher: Fetch = fetch as unknown as Fetch): Promise<Rates> {
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < TTL) return hit.rates;
  const rates = base === "UAH" ? await nbuRates(fetcher) : await ecbRates(fetcher, base);
  cache.set(base, { at: Date.now(), rates });
  return rates;
}
