import {
  addColumn,
  addRecords,
  applyOp,
  COLUMN_TYPES,
  createTable,
  updateCells,
  type CommandContext,
  type Op,
  type Problem,
  type Workspace,
} from "@higtclass/core";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// The assistant never touches data directly. Each tool call is turned into
// core operations against a scratch copy of the workspace; the operations go
// back to the app, which shows them and applies them only when the person
// presses "Записать".

const columnDraft = z.object({
  name: z.string().min(1),
  type: z.enum(COLUMN_TYPES as [string, ...string[]]),
  options: z.array(z.string()).optional(),
  formula: z.string().optional(),
  currency: z.string().optional(),
  link_table_id: z.string().optional(),
});

const cell = z.object({ column: z.string().min(1), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) });
const rowInput = z.object({ values: z.array(cell) });

const schemas = {
  create_table: z.object({
    name: z.string().min(1),
    columns: z.array(columnDraft).min(1),
    rows: z.array(rowInput).optional(),
  }),
  add_rows: z.object({ table_id: z.string(), rows: z.array(rowInput).min(1) }),
  update_cells: z.object({
    table_id: z.string(),
    updates: z.array(z.object({ row_id: z.string(), column: z.string(), value: cell.shape.value })).min(1),
  }),
  delete_rows: z.object({ table_id: z.string(), row_ids: z.array(z.string()).min(1) }),
  add_columns: z.object({ table_id: z.string(), columns: z.array(columnDraft).min(1) }),
};

export type ToolName = keyof typeof schemas;

const columnSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    type: {
      type: "string",
      enum: COLUMN_TYPES.filter((t) => t !== "lookup" && t !== "rollup"),
      description: "money for amounts, date for dates, select for a fixed set of choices, checkbox for yes/no, formula for values computed from other columns, link to point at rows of another table",
    },
    options: { type: "array", items: { type: "string" }, description: "Choices for select columns" },
    formula: { type: "string", description: "For formula columns, e.g. [Price] * [Quantity] — column names in square brackets" },
    currency: { type: "string", description: "ISO code for money columns if different from the workspace currency" },
    link_table_id: { type: "string", description: "For link columns: id of the table whose rows this column points to (e.g. Orders.Client → Clients)" },
  },
  required: ["name", "type"],
} as const;

const rowSchema = {
  type: "object",
  properties: {
    values: {
      type: "array",
      items: {
        type: "object",
        properties: {
          column: { type: "string", description: "Exact column name" },
          value: { type: ["string", "number", "boolean", "null"], description: "Dates as YYYY-MM-DD, amounts as plain numbers, links as the linked row's name" },
        },
        required: ["column", "value"],
      },
    },
  },
  required: ["values"],
} as const;

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "add_rows",
    description:
      "Add one or more entries to an existing table. Use this for anything the person reports that happened (a sale, an expense, a new client, a task). Fill only columns you are confident about; leave formula columns out.",
    input_schema: {
      type: "object",
      properties: { table_id: { type: "string" }, rows: { type: "array", items: rowSchema } },
      required: ["table_id", "rows"],
    },
  },
  {
    name: "update_cells",
    description:
      "Change values in existing rows, e.g. mark an order as paid. Find the row id in recent_rows of the workspace context.",
    input_schema: {
      type: "object",
      properties: {
        table_id: { type: "string" },
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: { row_id: { type: "string" }, column: { type: "string" }, value: rowSchema.properties.values.items.properties.value },
            required: ["row_id", "column", "value"],
          },
        },
      },
      required: ["table_id", "updates"],
    },
  },
  {
    name: "create_table",
    description:
      "Create a new table with typed columns (usually 3–7), optionally with first rows. Name it and its columns in the person's language. Use only when no existing table fits or the person asks for a new one.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, columns: { type: "array", items: columnSchema }, rows: { type: "array", items: rowSchema } },
      required: ["name", "columns"],
    },
  },
  {
    name: "add_columns",
    description: "Add columns to an existing table when the person asks for it or new data clearly needs a place.",
    input_schema: {
      type: "object",
      properties: { table_id: { type: "string" }, columns: { type: "array", items: columnSchema } },
      required: ["table_id", "columns"],
    },
  },
  {
    name: "delete_rows",
    description: "Delete rows. Only when the person explicitly asks to remove entries.",
    input_schema: {
      type: "object",
      properties: { table_id: { type: "string" }, row_ids: { type: "array", items: { type: "string" } } },
      required: ["table_id", "row_ids"],
    },
  },
];

export interface ToolOutcome {
  ok: boolean;
  /** JSON-able result for the model. */
  result: unknown;
  op?: Op;
}

type DraftInput = z.infer<typeof columnDraft>;
const toDraft = ({ link_table_id, ...d }: DraftInput) => ({ ...d, linkTableId: link_table_id }) as never;

const rowsToRecords = (rows: z.infer<typeof rowInput>[]) =>
  rows.map((r) => Object.fromEntries(r.values.map((v) => [v.column, v.value])));

function problemsText(problems: Problem[]) {
  return problems.map((p) => ({ reason: p.reason, column: p.column, input: p.input }));
}

/** Validate and run one tool call against the scratch workspace. */
export function runTool(ws: Workspace, name: string, input: unknown, baseCtx: CommandContext): ToolOutcome {
  const ctx = { ...baseCtx, ws };
  if (!(name in schemas)) return { ok: false, result: { error: `Unknown tool ${name}` } };
  const parsed = schemas[name as ToolName].safeParse(input);
  if (!parsed.success) return { ok: false, result: { error: "Invalid input", details: parsed.error.issues.slice(0, 5) } };
  const data = parsed.data as never;

  const table = (id: string) => ws.tables.find((t) => t.id === id);
  const missingTable = (id: string): ToolOutcome => ({
    ok: false,
    result: { error: `No table with id ${id}`, tables: ws.tables.map((t) => ({ id: t.id, name: t.name })) },
  });

  switch (name as ToolName) {
    case "create_table": {
      const d = data as z.infer<typeof schemas.create_table>;
      const res = createTable(
        { name: d.name, columns: d.columns.map(toDraft), rows: d.rows ? rowsToRecords(d.rows) : [] },
        ctx,
      );
      return {
        ok: true,
        op: res.op,
        result: { table_id: res.table.id, columns: res.table.columns.map((c) => c.name), rows_added: res.table.rows.length, problems: problemsText(res.problems) },
      };
    }
    case "add_rows": {
      const d = data as z.infer<typeof schemas.add_rows>;
      const t = table(d.table_id);
      if (!t) return missingTable(d.table_id);
      const res = addRecords(t, rowsToRecords(d.rows), ctx);
      return { ok: true, op: res.op, result: { row_ids: res.rows.map((r) => r.id), problems: problemsText(res.problems) } };
    }
    case "update_cells": {
      const d = data as z.infer<typeof schemas.update_cells>;
      const t = table(d.table_id);
      if (!t) return missingTable(d.table_id);
      const res = updateCells(t, d.updates.map((u) => ({ rowId: u.row_id, column: u.column, value: u.value })), ctx);
      return { ok: true, op: res.op, result: { updated: d.updates.length, problems: problemsText(res.problems) } };
    }
    case "delete_rows": {
      const d = data as z.infer<typeof schemas.delete_rows>;
      const t = table(d.table_id);
      if (!t) return missingTable(d.table_id);
      const known = new Set(t.rows.map((r) => r.id));
      const rowIds = d.row_ids.filter((id) => known.has(id));
      if (!rowIds.length) return { ok: false, result: { error: "None of these rows exist" } };
      return { ok: true, op: { type: "rows.delete", tableId: t.id, rowIds }, result: { deleted: rowIds.length } };
    }
    case "add_columns": {
      const d = data as z.infer<typeof schemas.add_columns>;
      let t = table(d.table_id);
      if (!t) return missingTable(d.table_id);
      const ops: Op[] = [];
      const problems: Problem[] = [];
      for (const draft of d.columns) {
        const res = addColumn(t, toDraft(draft));
        ops.push(res.op);
        problems.push(...res.problems);
        t = { ...t, columns: [...t.columns, res.column] };
      }
      return { ok: true, op: { type: "batch", ops }, result: { added: d.columns.map((c) => c.name), problems: problemsText(problems) } };
    }
  }
}

/** Apply an outcome's op to the scratch workspace; returns the new workspace. */
export function applyOutcome(ws: Workspace, outcome: ToolOutcome): Workspace {
  return outcome.op ? applyOp(ws, outcome.op) : ws;
}
