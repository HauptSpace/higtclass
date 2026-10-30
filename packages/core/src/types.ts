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
  | "lookup"
  | "rollup"
  | "photo";

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
  "rollup",
  "photo",
];

export type RollupAgg = "sum" | "count" | "avg" | "min" | "max";

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  /** Choices for `select` columns. */
  options?: string[];
  /** Custom colours for choices, keyed by the choice. */
  optionColors?: Record<string, string>;
  /**
   * Choices that only make sense for some value of another choice column:
   * "Salary" only for income, "Food" only for expenses. Choices not listed
   * here always apply.
   */
  scope?: { columnId: string; map: Record<string, string> };
  /** Value a new entry starts with. */
  default?: CellValue;
  /** Expression for `formula` columns, e.g. `[Цена] * [Кол-во]`. */
  formula?: string;
  /** How a formula result is shown; "auto" follows the columns it uses. */
  format?: "auto" | "number" | "money";
  /** ISO 4217 code for `money` columns; falls back to the workspace currency. */
  currency?: string;
  /** For `link` columns: the table whose rows this column points to. Cells hold row ids. */
  linkTableId?: string;
  /** For `lookup` columns: show `columnId` of the row linked through `viaColumnId`. */
  lookup?: { viaColumnId: string; columnId: string };
  /**
   * For `rollup` columns: total over the rows of another table that link here,
   * e.g. Products.Sold = sum of Orders.Quantity where Orders.Product is this row.
   */
  rollup?: { tableId: string; linkColumnId: string; columnId: string | null; agg: RollupAgg; where?: { columnId: string; values: string[] } };
}

/** Stored cell value. Dates are `YYYY-MM-DD` strings, money is a plain number. */
export type CellValue = string | number | boolean | null;

export interface Row {
  id: string;
  createdAt: number;
  /** Keyed by column id. Formula columns are computed, never stored. */
  values: Record<string, CellValue>;
}

/**
 * What the money in a table means, so totals say "income / spent / left"
 * instead of adding salary and coffee together.
 */
export interface Ledger {
  /** The amount: a money column, or a formula/lookup shown as money. */
  amountId: string;
  /** income: every row is money in; expense: money out; both: decided per row. */
  kind: "income" | "expense" | "both";
  /** For "both": a choice column; rows with one of `incomeValues` are income, the rest expenses. Without it the sign decides. */
  typeColumnId?: string;
  incomeValues?: string[];
  /** Rows count as received/paid only when this checkbox is ticked. */
  paidColumnId?: string;
  /** Rows count only when this choice column has one of these values (e.g. Status = Done). */
  onlyWhen?: { columnId: string; values: string[] };
  /** When the money arrived (a FOP counts income on the day it's received); else the first date column. */
  dateColumnId?: string;
}

/** Saving towards a target: progress is the total of `columnId` (all time). */
export interface Goal {
  amount: number;
  columnId: string;
  /** Optional target date, YYYY-MM-DD. */
  date?: string;
}

export type PeriodKind =
  | "all"
  | "week"
  | "nextWeek"
  | "month"
  | "prevMonth"
  | "nextMonth"
  | "quarter"
  | "prevQuarter"
  | "year"
  | "prevYear"
  | "custom";

export interface Period {
  kind: PeriodKind;
  /** For "custom": inclusive YYYY-MM-DD bounds; either may be missing. */
  from?: string;
  to?: string;
  /** Date column the period applies to; the first date column when missing. */
  columnId?: string;
}

export interface Filter {
  columnId: string;
  /** in: one of `values` (choices, linked row ids, "true"/"false" for checkboxes); contains: text search. */
  op: "in" | "notIn" | "contains" | "empty" | "notEmpty" | "gte" | "lte";
  values?: string[];
  value?: string | number;
}

export type ViewMode = "grid" | "cards" | "board" | "calendar";

/** A named way of looking at a table: filters, period, sort and layout. */
export interface SavedView {
  id: string;
  name: string;
  filters: Filter[];
  period?: Period;
  sort?: { columnId: string; dir: 1 | -1 };
  mode?: ViewMode;
}

export interface Table {
  id: string;
  name: string;
  icon: string;
  createdAt: number;
  columns: Column[];
  rows: Row[];
  /** Template the table was made from, so tips don't suggest it twice. */
  template?: string;
  ledger?: Ledger;
  goal?: Goal;
  /** Column shown as the big number on top. */
  figure?: string;
  views?: SavedView[];
}

export type TablePatch = Partial<Pick<Table, "name" | "icon" | "template" | "ledger" | "goal" | "figure" | "views">>;

export type GroupKind = "column" | "week" | "month" | "quarter" | "year";

/** A saved chart over one table. */
export interface Report {
  id: string;
  name: string;
  tableId: string;
  /** What to count: a numeric column summed/averaged, or just the number of rows. */
  measure: { agg: "sum" | "avg" | "count"; columnId: string | null };
  /** How to split it: by a column's values, or by week/month/quarter/year of a date column. */
  groupBy: { kind: GroupKind; columnId: string };
  /** Optional second split, shown as a table: client × month. */
  split?: { kind: GroupKind; columnId: string } | null;
  /** Only rows matching these. */
  filters?: Filter[];
  period?: Period | null;
  /** For tables with income and expenses: count only one side. */
  flow?: "income" | "expense" | null;
  chart: "bars" | "columns" | "line";
  /** Show only the N largest groups (bars); 0 = all. */
  limit: number;
  /** True when the person typed the name; otherwise it's generated in their language. */
  customName?: boolean;
}

export interface Workspace {
  tables: Table[];
  reports?: Report[];
}

export interface Settings {
  locale: Locale;
  currency: string;
}

export const NUMERIC_TYPES: ColumnType[] = ["number", "money", "formula", "rollup"];

/** Columns whose values are computed, never typed in. */
export const COMPUTED_TYPES: ColumnType[] = ["formula", "lookup", "rollup"];

export const isComputed = (c: Pick<Column, "type">) => COMPUTED_TYPES.includes(c.type);
