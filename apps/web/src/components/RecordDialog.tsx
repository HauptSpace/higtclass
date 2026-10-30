import {
  addRecords,
  backlinks,
  cellText,
  computeRow,
  draftValues,
  isComputed,
  ledgerOf,
  optionsFor,
  rowLabel,
  updateCells,
  type Column,
  type Problem,
  type Row,
  type Table,
} from "@higtclass/core";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n/index.ts";
import { draftOf, problemText, useStockWarnings, useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { FieldInput } from "./FieldInput.tsx";
import { StatusMark } from "./GridView.tsx";
import { Button, Dialog, Label } from "./ui.tsx";

// "Записать": the one-tap way to add an entry, also used to edit one. Shows
// what will be calculated before saving (price from the product, what's left
// in stock), and every entry in other tables that points here.

// What the person picked last time per table, so the next coffee is two taps.
const lastPicked = new Map<string, Record<string, string>>();

const REMEMBER: Column["type"][] = ["select", "link", "date"];

export function RecordDialog({
  table,
  rowId,
  open,
  onClose,
  preset,
  linked: openLinked,
}: {
  table: Table;
  /** null → new entry */
  rowId: string | null;
  open: boolean;
  onClose: () => void;
  /** Values to start a new entry with, e.g. the day clicked in the calendar. */
  preset?: Record<string, string>;
  /** Open an entry of another table straight away (a link clicked in the grid). */
  linked?: { tableId: string; rowId: string } | null;
}) {
  const t = useT();
  const today = useToday();
  const settings = useStore((s) => s.settings);
  const ws = useStore((s) => s.ws);
  const dispatch = useStore((s) => s.dispatch);
  const showToast = useStore((s) => s.showToast);
  const warnStock = useStockWarnings();
  // Following a link opens that entry here; "Back" returns.
  const [stack, setStack] = useState<{ tableId: string; rowId: string }[]>([]);
  const top = stack.at(-1);
  const current = top ? (ws.tables.find((x) => x.id === top.tableId) ?? table) : table;
  const currentRowId = top ? top.rowId : rowId;
  const row = currentRowId ? current.rows.find((r) => r.id === currentRowId) : undefined;
  const editable = current.columns.filter((c) => !isComputed(c));

  const blank = (): Record<string, string> => {
    const remembered = lastPicked.get(current.id) ?? {};
    return Object.fromEntries(
      editable.map((c) => {
        if (preset?.[c.id]) return [c.id, preset[c.id]];
        if (remembered[c.id] !== undefined) return [c.id, remembered[c.id]];
        if (c.type === "date") return [c.id, draftOf(c, today, settings.locale)];
        if (c.default !== undefined && c.default !== null) return [c.id, draftOf(c, c.default, settings.locale)];
        return [c.id, ""];
      }),
    );
  };
  const [drafts, setDrafts] = useState<Record<string, string>>(blank);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStack(openLinked ? [openLinked] : []);
  }, [open, rowId, openLinked?.rowId]);

  useEffect(() => {
    if (!open) return;
    setProblems([]);
    setEmpty(false);
    setDrafts(row ? Object.fromEntries(editable.map((c) => [c.id, draftOf(c, row.values[c.id], settings.locale)])) : blank());
    // Reset only when the dialog opens or switches row.
  }, [open, rowId, top?.rowId, top?.tableId]);

  const ctx = { locale: settings.locale, ws, currency: settings.currency };

  // Preview of calculated columns while typing: price from the product, totals.
  const preview = useMemo(() => {
    const values = draftValues(current, drafts, ctx);
    const temp: Row = { id: row?.id ?? "__new", createdAt: 0, values };
    return computeRow(current, temp, today, ws);
  }, [current, drafts, ws, today, row?.id]);

  const save = (again: boolean) => {
    const before = useStore.getState().ws;
    if (row) {
      const ledger = ledgerOf(current);
      const next = { ...drafts };
      // Ticking "Paid" fills the payment day with today, unless one is given.
      if (ledger?.paidColumnId && ledger.dateColumnId && next[ledger.paidColumnId] === "1" && row.values[ledger.paidColumnId] !== true && !next[ledger.dateColumnId]) {
        next[ledger.dateColumnId] = draftOf(current.columns.find((c) => c.id === ledger.dateColumnId)!, today, settings.locale);
      }
      const changed = editable.filter((c) => next[c.id] !== draftOf(c, row.values[c.id], settings.locale));
      const res = updateCells(current, changed.map((c) => ({ rowId: row.id, column: c.id, value: next[c.id] })), ctx);
      if (res.problems.length) return setProblems(res.problems);
      if (changed.length && dispatch(res.op, t("record.edit"))) warnStock(before, current.id, [row.id]);
      if (stack.length > (openLinked ? 1 : 0)) setStack((s) => s.slice(0, -1));
      else onClose();
      return;
    }
    // Only today's date, defaults and last time's category: nothing was actually entered.
    const start = blank();
    const entered = editable.some((c) => (drafts[c.id] ?? "").trim() !== "" && drafts[c.id] !== start[c.id]);
    if (!entered) {
      setEmpty(true);
      return;
    }
    // Empty fields are sent too: a switched-off "Paid" must stay off, not fall back to its default.
    const raw: Record<string, string> = { ...drafts };
    const ledger = ledgerOf(current);
    if (ledger?.paidColumnId && ledger.dateColumnId && raw[ledger.paidColumnId] === "1" && !raw[ledger.dateColumnId]) {
      raw[ledger.dateColumnId] = draftOf(current.columns.find((c) => c.id === ledger.dateColumnId)!, today, settings.locale);
    }
    const res = addRecords(current, [raw], ctx);
    if (res.problems.length) return setProblems(res.problems);
    if (!dispatch(res.op, t("record.new"))) return;
    showToast(t("record.saved"));
    warnStock(before, current.id, res.rows.map((r) => r.id));
    lastPicked.set(
      current.id,
      Object.fromEntries(editable.filter((c) => REMEMBER.includes(c.type) && c.type !== "link" && drafts[c.id]).map((c) => [c.id, drafts[c.id]])),
    );
    if (again) {
      setDrafts(blank());
      setProblems([]);
      setEmpty(false);
    } else {
      onClose();
    }
  };

  const remove = () => {
    if (!row) return;
    dispatch({ type: "rows.delete", tableId: current.id, rowIds: [row.id] }, t("record.delete"));
    showToast(t("record.deleted"));
    if (stack.length > (openLinked ? 1 : 0)) setStack((s) => s.slice(0, -1));
    else onClose();
  };

  const linked = row ? backlinks(ws, current.id, row.id) : [];
  const bad = new Set(problems.map((p) => p.columnId));
  const firstField = current.columns.findIndex((c) => c.type !== "date" && !isComputed(c));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          {stack.length > (openLinked ? 1 : 0) && (
            <button type="button" onClick={() => setStack((s) => s.slice(0, -1))} className="text-base font-semibold text-ink-2 hover:text-ink" aria-label={t("record.back")}>
              ←
            </button>
          )}
          <span className="min-w-0">
            {row ? rowLabel(current, row, settings) : t("record.new")}
            {current !== table && <span className="block text-sm font-semibold text-ink-2">{current.name}</span>}
          </span>
        </span>
      }
      footer={
        <>
          {row && (
            <Button variant="danger" onClick={remove}>
              {t("record.delete")}
            </Button>
          )}
          <div className="flex-1" />
          {!row && <Button onClick={() => save(true)}>{t("record.saveAndNew")}</Button>}
          <Button variant="primary" onClick={() => save(false)}>
            {t("record.save")}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        {current.columns.map((col, i) => {
          if (isComputed(col)) {
            const c = preview[col.id];
            const text = c && "value" in c ? cellText(ws, current, col, c.value, settings) : c ? t(`formula.${c.error}` as "formula.syntax") : "";
            if (!row && !text) return null;
            const negative = c && "value" in c && typeof c.value === "number" && c.value < 0;
            return (
              <Label key={col.id} text={col.name}>
                <div className={`rounded-xl bg-soft px-3.5 py-2.5 font-bold ${negative ? "text-late" : ""}`}>{text || "—"}</div>
              </Label>
            );
          }
          const parent = col.scope ? drafts[col.scope.columnId] : undefined;
          return (
            <div key={col.id} className={bad.has(col.id) ? "rounded-xl outline-2 outline-offset-4 outline-late" : ""}>
              <Label text={col.name}>
                <FieldInput
                  column={col}
                  value={drafts[col.id] ?? ""}
                  options={col.type === "select" ? optionsFor(col, parent) : undefined}
                  onChange={(v) => {
                    setEmpty(false);
                    setDrafts((d) => ({ ...d, [col.id]: v }));
                  }}
                  autoFocus={i === firstField}
                  onEnter={() => save(false)}
                />
              </Label>
            </div>
          );
        })}
        {linked.map((b) => {
          const money = b.table.columns.find((c) => c.type === "money");
          const sum = money ? b.rows.reduce((acc, r) => acc + (typeof r.values[money.id] === "number" ? (r.values[money.id] as number) : 0), 0) : null;
          const title =
            b.table.columns.find((c) => c.type === "text" && c.id !== b.column.id) ??
            b.table.columns.find((c) => (c.type === "number" || c.type === "select") && c.id !== b.column.id);
          const date = b.table.columns.find((c) => c.type === "date");
          const status = b.table.columns.find((c) => c.type === "select");
          const sorted = date ? [...b.rows].sort((x, y) => String(y.values[date.id] ?? "").localeCompare(String(x.values[date.id] ?? ""))) : [...b.rows].reverse();
          return (
            <section key={b.table.id + b.column.id} className="border-t-2 border-rule pt-3">
              <h3 className="font-extrabold">
                {t("record.linked", { table: b.table.name, n: b.rows.length })}
                {money && sum !== null && <span className="font-semibold text-ink-2"> · {t("record.linkedTotal", { sum: cellText(ws, b.table, money, sum, settings) })}</span>}
              </h3>
              <ul className="mt-2 max-h-72 overflow-y-auto">
                {sorted.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setStack((s) => [...s, { tableId: b.table.id, rowId: r.id }])}
                      className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line py-2 text-left text-sm hover:bg-soft"
                    >
                      <span className="w-24 shrink-0 text-ink-2">{date ? cellText(ws, b.table, date, r.values[date.id], settings) : ""}</span>
                      <span className="min-w-0 truncate">
                        {title ? `${title.type === "number" ? `${title.name}: ` : ""}${cellText(ws, b.table, title, r.values[title.id], settings)}` : ""}
                        {status && typeof r.values[status.id] === "string" && (
                          <span className="ml-2 text-xs">
                            <StatusMark value={r.values[status.id] as string} column={status} />
                          </span>
                        )}
                      </span>
                      <b className="tabular">{money ? cellText(ws, b.table, money, r.values[money.id], settings) : ""}</b>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {empty && <p className="border-l-4 border-late pl-3 font-semibold text-late">{t("record.empty")}</p>}
        {problems.length > 0 && (
          <ul className="space-y-1 border-l-4 border-late pl-3 font-semibold text-late">
            {problems.map((p, i) => (
              <li key={i}>{problemText(t, p)}</li>
            ))}
          </ul>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
