import { cellText, type CellValue, type Op, type Table, type Workspace } from "@higtclass/core";
import type { Translate } from "./i18n/index.ts";
import type { AppSettings } from "./store.ts";

// Talking to the Zifra API, and turning the operations it proposes into
// something a person can read before pressing "Записать".

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export interface PhotoInput {
  mediaType: "image/jpeg";
  data: string;
  previewUrl: string;
}

export type AssistantFailure = "off" | "busy" | "refused" | "offline" | "error";

export type AssistantResult = { ok: true; reply: string; ops: Op[] } | { ok: false; failure: AssistantFailure };

export async function askAssistant(input: {
  message: string;
  image?: PhotoInput | null;
  mode?: "entry" | "build";
  activeTableId?: string | null;
  workspace: Workspace;
  settings: AppSettings;
}): Promise<AssistantResult> {
  let res: Response;
  try {
    res = await fetch(`${API}/api/assistant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        image: input.image ? { mediaType: input.image.mediaType, data: input.image.data } : undefined,
        mode: input.mode ?? "entry",
        activeTableId: input.activeTableId ?? null,
        workspace: input.workspace,
        settings: { locale: input.settings.locale, currency: input.settings.currency },
      }),
    });
  } catch {
    return { ok: false, failure: "offline" };
  }
  if (res.ok) {
    const body = (await res.json()) as { reply: string; ops: Op[] };
    return { ok: true, reply: body.reply ?? "", ops: body.ops ?? [] };
  }
  const error = await res
    .json()
    .then((b: { error?: string }) => b.error)
    .catch(() => undefined);
  // 502/504/404: no API behind the site at all (the proxy has nothing to talk to).
  if (res.status === 503 || error === "assistant_not_configured" || res.status === 502 || res.status === 504 || res.status === 404) return { ok: false, failure: "off" };
  if (res.status === 429) return { ok: false, failure: "busy" };
  if (error === "refused") return { ok: false, failure: "refused" };
  return { ok: false, failure: "error" };
}

/** Downscale a photo in the browser so uploads stay small and fast. */
export async function readPhoto(file: File, maxSide = 1600): Promise<PhotoInput> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: url.slice(url.indexOf(",") + 1), previewUrl: url };
}

export interface ChangeItem {
  title: string;
  /** Column name → display value. */
  fields: [string, string][];
  kind: "table" | "row" | "update" | "delete" | "column";
}

/** Human-readable list of what a set of operations will do. */
export function describeOps(ws: Workspace, ops: Op[], settings: AppSettings, t: Translate): ChangeItem[] {
  const items: ChangeItem[] = [];
  const tables = new Map(ws.tables.map((tb) => [tb.id, tb]));
  const show = (tb: Table | undefined, columnId: string, value: CellValue) => {
    const col = tb?.columns.find((c) => c.id === columnId);
    return col && tb ? ([col.name, cellText({ tables: [...tables.values()] }, tb, col, value, settings) || "—"] as [string, string]) : null;
  };

  const visit = (op: Op) => {
    switch (op.type) {
      case "batch":
        op.ops.forEach(visit);
        return;
      case "table.create":
        tables.set(op.table.id, op.table);
        items.push({
          kind: "table",
          title: t("ai.newTable", { name: op.table.name }),
          fields: [
            [t("ai.columns"), op.table.columns.map((c) => `${c.name} · ${t(`type.${c.type}`)}`).join(", ")],
            ...(op.table.rows.length ? [[t("ai.rows", { n: op.table.rows.length }), ""] as [string, string]] : []),
          ],
        });
        return;
      case "column.add": {
        const tb = tables.get(op.tableId);
        if (tb) tables.set(tb.id, { ...tb, columns: [...tb.columns, op.column] });
        items.push({ kind: "column", title: t("ai.newColumn", { name: op.column.name, table: tb?.name ?? "" }), fields: [] });
        return;
      }
      case "rows.insert": {
        const tb = tables.get(op.tableId);
        for (const row of op.rows) {
          items.push({
            kind: "row",
            title: t("ai.newRow", { table: tb?.name ?? "" }),
            fields: (tb?.columns ?? [])
              .filter((c) => row.values[c.id] !== undefined)
              .map((c) => show(tb, c.id, row.values[c.id])!)
              .filter(Boolean),
          });
        }
        return;
      }
      case "cells.set": {
        const tb = tables.get(op.tableId);
        const fields = op.cells.map((c) => show(tb, c.columnId, c.value)).filter((x): x is [string, string] => x !== null);
        items.push({ kind: "update", title: t("ai.update", { table: tb?.name ?? "" }), fields });
        return;
      }
      case "rows.delete": {
        const tb = tables.get(op.tableId);
        items.push({ kind: "delete", title: t("ai.deleteRows", { table: tb?.name ?? "", n: op.rowIds.length }), fields: [] });
        return;
      }
      default:
        // Option lists growing, renames: too small to show separately.
        return;
    }
  };
  ops.forEach(visit);
  return items;
}
