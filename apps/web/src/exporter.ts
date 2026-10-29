import {
  cellText,
  computedRows,
  displayColumn,
  LOCALE_RULES,
  todayISO,
  toCsv,
  type CellValue,
  type Column,
  type Settings,
  type Table,
  type Workspace,
} from "@higtclass/core";

// Downloads for the accountant: a real .xlsx with numbers as numbers and dates
// as dates, or a CSV that Excel opens correctly in the person's language.

function fileName(table: Table, ext: string) {
  const safe = table.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "zifra";
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

function shownType(ws: Workspace, table: Table, col: Column) {
  return displayColumn(table, col, ws).type;
}

export async function exportXlsx(ws: Workspace, table: Table, settings: Settings) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const rows = computedRows(table, todayISO(), ws);
  const dateFormat = LOCALE_RULES[settings.locale].dateOrder === "MDY" ? "mm/dd/yyyy" : "dd.mm.yyyy";
  const header = table.columns.map((c) => ({ value: c.name, fontWeight: "bold" as const }));
  const body = rows.map((values) =>
    table.columns.map((c) => {
      const v: CellValue | undefined = values[c.id];
      if (v === null || v === undefined || v === "") return null;
      const type = shownType(ws, table, c);
      if (typeof v === "number" && (type === "money" || type === "number" || type === "formula")) {
        return { value: v, type: Number, format: type === "money" ? "#,##0.00" : "#,##0.####" };
      }
      if (type === "date" && typeof v === "string") {
        const [y, m, d] = v.split("-").map(Number);
        return { value: new Date(Date.UTC(y, m - 1, d)), type: Date, format: dateFormat };
      }
      if (typeof v === "boolean") return { value: v, type: Boolean };
      return { value: cellText(ws, table, c, v, settings), type: String };
    }),
  );
  const blob = await writeXlsxFile([header, ...body] as never, {
    sheet: table.name.slice(0, 31) || "Zifra",
    stickyRowsCount: 1,
    columns: table.columns.map((c) => ({ width: Math.min(40, Math.max(10, c.name.length + 4)) })),
  } as never).toBlob();
  download(blob, fileName(table, "xlsx"));
}

export function exportCsv(ws: Workspace, table: Table, settings: Settings) {
  const rows = computedRows(table, todayISO(), ws);
  const decimal = LOCALE_RULES[settings.locale].decimal;
  const body = rows.map((values) =>
    table.columns.map((c) => {
      const v = values[c.id];
      if (v === null || v === undefined) return null;
      if (typeof v === "number") return decimal === "," ? String(v).replace(".", ",") : v;
      if (typeof v === "boolean") return v ? LOCALE_RULES[settings.locale].trueWords[0] : "";
      return cellText(ws, table, c, v, settings);
    }),
  );
  const csv = toCsv([table.columns.map((c) => c.name), ...body], settings.locale);
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), fileName(table, "csv"));
}
