// Domain model. Everything is plain JSON so a workspace can live in the
// browser, in the desktop app, on the server, and travel between them.

export type Locale = "ru" | "uk" | "en" | "de" | "es";

export const LOCALES: Locale[] = ["ru", "uk", "en", "de", "es"];

export type ColumnType =
  | "text"
  | "number"
  | "money"
  | "date"
  | "select"
  | "checkbox"
  | "formula"
  | "link"
  | "lookup";

export const COLUMN_TYPES: ColumnType[] = [
  "text",
  "number",
  "money",
  "date",
  "select",
  "checkbox",
  "formula",
  "link",
  "lookup",
];

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  /** Choices for `select` columns. */
  options?: string[];
  /** Expression for `formula` columns, e.g. `[Цена] * [Кол-во]`. */
  formula?: string;
  /** ISO 4217 code for `money` columns; falls back to the workspace currency. */
  currency?: string;
  /** For `link` columns: the table whose rows this column points to. Cells hold row ids. */
  linkTableId?: string;
  /** For `lookup` columns: show `columnId` of the row linked through `viaColumnId`. */
  lookup?: { viaColumnId: string; columnId: string };
}

/** Stored cell value. Dates are `YYYY-MM-DD` strings, money is a plain number. */
export type CellValue = string | number | boolean | null;

export interface Row {
  id: string;
  createdAt: number;
  /** Keyed by column id. Formula columns are computed, never stored. */
  values: Record<string, CellValue>;
}

export interface Table {
  id: string;
  name: string;
  icon: string;
  createdAt: number;
  columns: Column[];
  rows: Row[];
}

/** A saved chart over one table. */
export interface Report {
  id: string;
  name: string;
  tableId: string;
  /** What to count: a numeric column summed/averaged, or just the number of rows. */
  measure: { agg: "sum" | "avg" | "count"; columnId: string | null };
  /** How to split it: by a column's values, or by month of a date column. */
  groupBy: { kind: "column" | "month"; columnId: string };
  chart: "bars" | "columns" | "line";
  /** Show only the N largest groups (bars); 0 = all. */
  limit: number;
}

export interface Workspace {
  tables: Table[];
  reports?: Report[];
}

export interface Settings {
  locale: Locale;
  currency: string;
}

export const NUMERIC_TYPES: ColumnType[] = ["number", "money", "formula"];

/** Columns whose values are computed, never typed in. */
export const COMPUTED_TYPES: ColumnType[] = ["formula", "lookup"];
