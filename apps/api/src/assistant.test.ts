import { applyOp, createTable, type Op, type Workspace } from "@sumira/core";
import { describe, expect, it } from "vitest";
import { AssistantError, runAssistant, type MessagesClient } from "./assistant.ts";
import { runTool } from "./tools.ts";

const now = new Date(2026, 9, 29);
const settings = { locale: "ru" as const, currency: "RUB" };

function workspace() {
  const res = createTable(
    {
      name: "Заказы",
      columns: [
        { name: "Дата", type: "date" },
        { name: "Клиент", type: "text" },
        { name: "Сумма", type: "money" },
        { name: "Статус", type: "select", options: ["Новый", "Оплачен"] },
      ],
      rows: [{ Дата: "2026-10-28", Клиент: "ООО «Альфа»", Сумма: 120000, Статус: "Новый" }],
    },
    { locale: "ru", now },
  );
  return { ws: applyOp({ tables: [] }, res.op) as Workspace, table: res.table };
}

type Script = (params: Parameters<MessagesClient["beta"]["messages"]["create"]>[0]) => unknown;

function fakeClient(...script: Script[]) {
  const calls: Parameters<MessagesClient["beta"]["messages"]["create"]>[0][] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(structuredClone(params));
          const step = script[calls.length - 1];
          if (!step) throw new Error("unexpected call");
          return step(params) as never;
        },
      },
    },
  };
  return { client, calls };
}

const toolUse = (id: string, name: string, input: unknown) => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});
const text = (t: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });

describe("runTool", () => {
  it("adds rows with loose values and reports what it could not use", () => {
    const { ws, table } = workspace();
    const out = runTool(
      ws,
      "add_rows",
      { table_id: table.id, rows: [{ values: [{ column: "Клиент", value: "Кофейня" }, { column: "Сумма", value: "24 600" }, { column: "Цвет", value: "red" }] }] },
      { locale: "ru", now },
    );
    expect(out.ok).toBe(true);
    expect((out.result as { problems: unknown[] }).problems).toEqual([{ reason: "unknown_column", column: "Цвет", input: "red" }]);
    const after = applyOp(ws, out.op!);
    expect(after.tables[0].rows).toHaveLength(2);
  });

  it("rejects malformed input and unknown tables without throwing", () => {
    const { ws } = workspace();
    expect(runTool(ws, "add_rows", { table_id: 5 }, { locale: "ru" }).ok).toBe(false);
    expect(runTool(ws, "add_rows", { table_id: "nope", rows: [{ values: [] }] }, { locale: "ru" }).ok).toBe(false);
    expect(runTool(ws, "drop_everything", {}, { locale: "ru" }).ok).toBe(false);
  });
});

describe("runAssistant", () => {
  it("runs the tool loop and returns ops without changing the input workspace", async () => {
    const { ws, table } = workspace();
    const rowId = table.rows[0].id;
    const { client, calls } = fakeClient(
      () => toolUse("t1", "update_cells", { table_id: table.id, updates: [{ row_id: rowId, column: "Статус", value: "Оплачен" }] }),
      () => text("Отметил заказ Альфы как оплаченный."),
    );
    const res = await runAssistant(client, { message: "Альфа оплатила", workspace: ws, settings, activeTableId: table.id }, now);

    expect(res.reply).toBe("Отметил заказ Альфы как оплаченный.");
    expect(res.ops).toHaveLength(1);
    const after = res.ops.reduce((w: Workspace, op: Op) => applyOp(w, op), ws);
    expect(after.tables[0].rows[0].values[table.columns[3].id]).toBe("Оплачен");
    expect(ws.tables[0].rows[0].values[table.columns[3].id]).toBe("Новый");

    // The context carries today's date and row ids; tool results go back to the model.
    const firstUser = calls[0].messages[0].content as { type: string; text?: string }[];
    expect(firstUser.at(-1)!.text).toContain('"today":"2026-10-29"');
    expect(firstUser.at(-1)!.text).toContain(rowId);
    expect(calls[1].messages.at(-1)!.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "t1", is_error: false }),
    ]);
  });

  it("chains a created table into later calls in the same request", async () => {
    const { ws } = workspace();
    let createdId = "";
    const { client } = fakeClient(
      () => toolUse("t1", "create_table", { name: "Расходы", columns: [{ name: "Сумма", type: "money" }] }),
      (params) => {
        const result = (params.messages.at(-1)!.content as { content: string }[])[0].content;
        createdId = JSON.parse(result).table_id;
        return toolUse("t2", "add_rows", { table_id: createdId, rows: [{ values: [{ column: "Сумма", value: 450 }] }] });
      },
      () => text("Создал таблицу и записал такси."),
    );
    const res = await runAssistant(client, { message: "такси 450, заведи расходы", workspace: ws, settings, mode: "build" }, now);
    const after = res.ops.reduce((w: Workspace, op: Op) => applyOp(w, op), ws);
    expect(after.tables.find((t) => t.id === createdId)!.rows).toHaveLength(1);
  });

  it("surfaces refusals as errors", async () => {
    const { ws } = workspace();
    const { client } = fakeClient(() => ({ stop_reason: "refusal", content: [] }));
    await expect(runAssistant(client, { message: "x", workspace: ws, settings }, now)).rejects.toBeInstanceOf(AssistantError);
  });
});
