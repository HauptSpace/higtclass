import {
  addRecords,
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
  const editable = table.columns.filter((c) => c.type !== "formula");

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

  const ctx = { locale: settings.locale };

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

  const computed = row ? computeRow(table, row, today) : {};
  const bad = new Set(problems.map((p) => p.columnId));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span>
          {table.icon} {row ? t("record.edit") : t("record.new")}
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
          if (col.type === "formula") {
            if (!row) return null;
            const c = computed[col.id];
            return (
              <Label key={col.id} text={col.name}>
                <div className="tabular rounded-xl bg-zinc-100 px-3 py-2.5 text-sm dark:bg-zinc-800">
                  {c && "value" in c ? formatValue(displayColumn(table, col), c.value, settings) : c ? t(`formula.${c.error}`) : ""}
                </div>
              </Label>
            );
          }
          return (
            <div key={col.id} className={bad.has(col.id) ? "rounded-xl ring-2 ring-red-400 ring-offset-4 dark:ring-offset-zinc-900" : ""}>
              <Label text={col.name}>
                <FieldInput
                  column={col}
                  value={drafts[col.id] ?? ""}
                  onChange={(v) => setDrafts((d) => ({ ...d, [col.id]: v }))}
                  autoFocus={i === table.columns.findIndex((c) => c.type !== "date" && c.type !== "formula")}
                  onEnter={() => save(false)}
                />
              </Label>
            </div>
          );
        })}
        {problems.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
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
