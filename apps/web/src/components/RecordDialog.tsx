import {
  addRecords,
  backlinks,
  cellText,
  computeRow,
  displayColumn,
  formatValue,
  updateCells,
  type Problem,
  type Table,
} from "@higtclass/core";
import { useEffect, useState } from "react";
import { useT } from "../i18n/index.ts";
import { draftOf, problemText, useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { FieldInput } from "./FieldInput.tsx";
import { Button, Dialog, Label } from "./ui.tsx";

// "Записать": the one-tap way to add an entry, also used to edit one.

export function RecordDialog({
  table,
  rowId,
  open,
  onClose,
}: {
  table: Table;
  /** null → new entry */
  rowId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const today = useToday();
  const settings = useStore((s) => s.settings);
  const dispatch = useStore((s) => s.dispatch);
  const showToast = useStore((s) => s.showToast);
  const row = rowId ? table.rows.find((r) => r.id === rowId) : undefined;
  const ws = useStore((s) => s.ws);
  const editable = table.columns.filter((c) => c.type !== "formula" && c.type !== "lookup");

  const blank = () =>
    Object.fromEntries(editable.map((c) => [c.id, c.type === "date" ? today : ""])) as Record<string, string>;
  const [drafts, setDrafts] = useState<Record<string, string>>(blank);
  const [problems, setProblems] = useState<Problem[]>([]);

  useEffect(() => {
    if (!open) return;
    setProblems([]);
    setDrafts(row ? Object.fromEntries(editable.map((c) => [c.id, draftOf(c, row.values[c.id], settings.locale)])) : blank());
    // Reset only when the dialog opens or switches row.
  }, [open, rowId]);

  const ctx = { locale: settings.locale, ws };

  const save = (again: boolean) => {
    if (row) {
      const changed = editable.filter((c) => drafts[c.id] !== draftOf(c, row.values[c.id], settings.locale));
      const res = updateCells(table, changed.map((c) => ({ rowId: row.id, column: c.id, value: drafts[c.id] })), ctx);
      if (res.problems.length) return setProblems(res.problems);
      if (changed.length) dispatch(res.op, t("record.edit"));
      onClose();
      return;
    }
    const raw = Object.fromEntries(Object.entries(drafts).filter(([, v]) => v.trim() !== ""));
    if (!Object.keys(raw).length) return;
    const res = addRecords(table, [raw], ctx);
    if (res.problems.length) return setProblems(res.problems);
    dispatch(res.op, t("record.new"));
    showToast(t("record.saved"));
    if (again) {
      setDrafts(blank());
      setProblems([]);
    } else {
      onClose();
    }
  };

  const remove = () => {
    if (!row) return;
    dispatch({ type: "rows.delete", tableId: table.id, rowIds: [row.id] }, t("record.delete"));
    showToast(t("record.delete"));
    onClose();
  };

  const computed = row ? computeRow(table, row, today, ws) : {};
  const linked = row ? backlinks(ws, table.id, row.id) : [];
  const bad = new Set(problems.map((p) => p.columnId));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span>
          {row ? t("record.edit") : t("record.new")}
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
        {table.columns.map((col, i) => {
          if (col.type === "formula" || col.type === "lookup") {
            if (!row) return null;
            const c = computed[col.id];
            return (
              <Label key={col.id} text={col.name}>
                <div className="rounded-xl bg-soft px-3.5 py-2.5 font-bold">
                  {c && "value" in c ? formatValue(displayColumn(table, col, ws), c.value, settings) : c ? t(`formula.${c.error}`) : ""}
                </div>
              </Label>
            );
          }
          return (
            <div key={col.id} className={bad.has(col.id) ? "rounded-xl outline-2 outline-offset-4 outline-late" : ""}>
              <Label text={col.name}>
                <FieldInput
                  column={col}
                  value={drafts[col.id] ?? ""}
                  onChange={(v) => setDrafts((d) => ({ ...d, [col.id]: v }))}
                  autoFocus={i === table.columns.findIndex((c) => c.type !== "date" && c.type !== "formula" && c.type !== "lookup")}
                  onEnter={() => save(false)}
                />
              </Label>
            </div>
          );
        })}
        {linked.map((b) => {
          const money = b.table.columns.find((c) => c.type === "money");
          const sum = money ? b.rows.reduce((acc, r) => acc + (typeof r.values[money.id] === "number" ? (r.values[money.id] as number) : 0), 0) : null;
          const title = b.table.columns.find((c) => c.type === "text") ?? b.table.columns.find((c) => c.type === "date");
          return (
            <section key={b.table.id + b.column.id} className="border-t-2 border-rule pt-3">
              <h3 className="font-extrabold">
                {t("record.linked", { table: b.table.name, n: b.rows.length })}
                {money && sum !== null && <span className="font-semibold text-ink-2"> · {t("record.linkedTotal", { sum: formatValue(money, sum, settings) })}</span>}
              </h3>
              <ul className="mt-2">
                {b.rows
                  .slice(-6)
                  .reverse()
                  .map((r) => (
                    <li key={r.id} className="flex justify-between gap-3 border-b border-line py-1.5 text-sm">
                      <span className="truncate">{title ? cellText(ws, b.table, title, r.values[title.id], settings) : ""}</span>
                      <b>{money ? cellText(ws, b.table, money, r.values[money.id], settings) : ""}</b>
                    </li>
                  ))}
              </ul>
            </section>
          );
        })}
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
