import {
  cellText,
  computedRows,
  dateOrder,
  displayColumn,
  formatDateNumeric,
  ledgerOf,
  LOCALE_RULES,
  rowFlow,
  todayISO,
  toCsv,
  type CellValue,
  type Column,
  type Row,
  type Settings,
  type Table,
  type Workspace,
} from "@higtclass/core";
import type { Translate } from "./i18n/index.ts";

// Downloads for the accountant: a real .xlsx with numbers as numbers, dates as
// dates, a totals row and — for income/expense tables — a sheet with totals by
// category; or a CSV that Excel opens correctly in the person's language.
// Exactly what is on screen: the period and filters apply.

export interface ExportOptions {
  rows?: Row[];
  values?: Record<string, CellValue>[];
  /** Shown in the file name, e.g. "Оплаты — Прошлый квартал". */
  title?: string;
  t?: Translate;
}

function fileName(name: string, ext: string) {
  const safe = name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "zifra";
  return `${safe} ${todayISO()}.${ext}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", UAH: "₴", GBP: "£", PLN: "zł", CHF: "CHF", RUB: "₽", TRY: "₺", CZK: "Kč", KZT: "₸", BYN: "Br" };

/** Rows to export: what's on screen, oldest first by date — the order an accountant reads. */
function exportRows(ws: Workspace, table: Table, opts: ExportOptions) {
  const values = opts.values ?? computedRows(table, todayISO(), ws);
  const date = table.columns.find((c) => c.type === "date");
  const order = values.map((_, i) => i);
  if (date) order.sort((a, b) => String(values[a][date.id] ?? "9999").localeCompare(String(values[b][date.id] ?? "9999")));
  return order.map((i) => values[i]);
}

export async function exportXlsx(ws: Workspace, table: Table, settings: Settings, opts: ExportOptions = {}) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const values = exportRows(ws, table, opts);
  const dateFormat = dateOrder(settings.locale) === "MDY" ? "mm/dd/yyyy" : "dd.mm.yyyy";
  const kinds = table.columns.map((c) => displayColumn(table, c, ws));
  const numberFormat = (col: Column, shown: Column, list: CellValue[]) => {
    if (shown.type === "money") {
      const code = shown.currency ?? settings.currency;
      return `#,##0.00 "${SYMBOL[code] ?? code}"`;
    }
    const whole = list.every((v) => typeof v !== "number" || Number.isInteger(v));
    return whole && col.type !== "formula" ? "#,##0" : "#,##0.00";
  };
  const formats = table.columns.map((c, i) => numberFormat(c, kinds[i], values.map((v) => v[c.id])));
  const header = table.columns.map((c) => ({ value: c.name, fontWeight: "bold" as const }));
  const body = values.map((v) =>
    table.columns.map((c, i) => {
      const value: CellValue | undefined = v[c.id];
      const shown = kinds[i];
      if (c.type === "checkbox") return { value: value === true, type: Boolean };
      if (value === null || value === undefined || value === "") return null;
      if (typeof value === "number") return { value, type: Number, format: formats[i] };
      if (shown.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split("-").map(Number);
        return { value: new Date(Date.UTC(y, m - 1, d)), type: Date, format: dateFormat };
      }
      return { value: cellText(ws, table, c, value, settings), type: String };
    }),
  );
  // Totals under the numbers, so nobody has to add a SUM.
  const totals = table.columns.map((c, i) => {
    if (i === 0) return { value: opts.t?.("report.totalRow") ?? "Σ", fontWeight: "bold" as const, type: String };
    if (c.type === "lookup") return null;
    const nums = values.map((v) => v[c.id]).filter((x): x is number => typeof x === "number");
    if (!nums.length) return null;
    return { value: nums.reduce((a, b) => a + b, 0), type: Number, format: formats[i], fontWeight: "bold" as const };
  });
  const widths = table.columns.map((c) => {
    const longest = Math.max(c.name.length, ...values.slice(0, 500).map((v) => cellText(ws, table, c, v[c.id], settings).length));
    return { width: Math.min(50, Math.max(10, longest + 2)) };
  });
  const sheets: unknown[] = [[header, ...body, [null], totals]];
  const sheetNames = [table.name.slice(0, 31) || "Zifra"];
  const columns: unknown[] = [widths];

  // Income and expenses: a second sheet with totals by category and the profit.
  const ledger = ledgerOf(table);
  const category = table.columns.find((c) => c.type === "select" && c.id !== ledger?.typeColumnId);
  if (ledger && opts.t) {
    const t = opts.t;
    const sums = new Map<string, { income: number; expense: number }>();
    for (const v of values) {
      const f = rowFlow(ledger, v);
      const key = category ? cellText(ws, table, category, v[category.id], settings) || "—" : "—";
      const g = sums.get(key) ?? { income: 0, expense: 0 };
      g.income += f.income;
      g.expense += f.expense;
      sums.set(key, g);
    }
    const money = `#,##0.00 "${SYMBOL[settings.currency] ?? settings.currency}"`;
    const head = [category?.name ?? "", t("figures.income"), t("figures.expense")].map((v) => ({ value: v, fontWeight: "bold" as const }));
    const lines = [...sums.entries()].sort((a, b) => b[1].income + b[1].expense - (a[1].income + a[1].expense)).map(([k, g]) => [
      { value: k, type: String },
      g.income ? { value: g.income, type: Number, format: money } : null,
      g.expense ? { value: g.expense, type: Number, format: money } : null,
    ]);
    const income = [...sums.values()].reduce((a, g) => a + g.income, 0);
    const expense = [...sums.values()].reduce((a, g) => a + g.expense, 0);
    sheets.push([
      head,
      ...lines,
      [null],
      [{ value: t("report.totalRow"), fontWeight: "bold", type: String }, { value: income, type: Number, format: money, fontWeight: "bold" }, { value: expense, type: Number, format: money, fontWeight: "bold" }],
      [{ value: t("figures.profit"), fontWeight: "bold", type: String }, { value: income - expense, type: Number, format: money, fontWeight: "bold" }, null],
    ]);
    sheetNames.push(t("view.summary").slice(0, 31));
    columns.push([{ width: 30 }, { width: 16 }, { width: 16 }]);
  }

  const blob = await writeXlsxFile(sheets.map((data, i) => ({ data, sheet: sheetNames[i], columns: columns[i], stickyRowsCount: 1 })) as never).toBlob();
  download(blob, fileName(opts.title ?? table.name, "xlsx"));
}

export function exportCsv(ws: Workspace, table: Table, settings: Settings, opts: ExportOptions = {}) {
  const values = exportRows(ws, table, opts);
  const decimal = LOCALE_RULES[settings.locale].decimal;
  const kinds = table.columns.map((c) => displayColumn(table, c, ws));
  const body = values.map((v) =>
    table.columns.map((c, i) => {
      const value = v[c.id];
      if (c.type === "checkbox") return value === true ? LOCALE_RULES[settings.locale].trueWords[0] : LOCALE_RULES[settings.locale].falseWords[0];
      if (value === null || value === undefined) return null;
      if (typeof value === "number") return decimal === "," ? String(value).replace(".", ",") : value;
      // Numeric dates, so Excel reads them as dates.
      if (kinds[i].type === "date" && typeof value === "string") return formatDateNumeric(value, settings.locale);
      return cellText(ws, table, c, value, settings);
    }),
  );
  const csv = toCsv([table.columns.map((c) => c.name), ...body], settings.locale);
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), fileName(opts.title ?? table.name, "csv"));
}
