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
  | "formula";

export const COLUMN_TYPES: ColumnType[] = [
  "text",
  "number",
  "money",
  "date",
  "select",
  "checkbox",
  "formula",
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

export interface Workspace {
  tables: Table[];
}

export interface Settings {
  locale: Locale;
  currency: string;
}

export const NUMERIC_TYPES: ColumnType[] = ["number", "money", "formula"];
