import {
  addColumn,
  changeColumnType,
  COLUMN_TYPES,
  computeRow,
  CURRENCIES,
  displayColumn,
  formatValue,
  validateFormula,
  type Column,
  type ColumnPatch,
  type ColumnType,
  type Op,
  type Table,
} from "@higtclass/core";
import { useEffect, useState } from "react";
import { useT } from "../i18n/index.ts";
import { useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { Button, Dialog, inputClass, Label } from "./ui.tsx";

export const TYPE_ICONS: Record<ColumnType, string> = {
  text: "Aa",
  number: "#",
  money: "¤",
  date: "📅",
  select: "◉",
  checkbox: "☑",
  formula: "ƒ",
};

const splitOptions = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function ColumnDialog({
  table,
  columnId,
  open,
  onClose,
}: {
  table: Table;
  /** null → new column */
  columnId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const today = useToday();
  const settings = useStore((s) => s.settings);
  const dispatch = useStore((s) => s.dispatch);
  const column = columnId ? table.columns.find((c) => c.id === columnId) : undefined;

  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [options, setOptions] = useState("");
  const [formula, setFormula] = useState("");
  const [currency, setCurrency] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(column?.name ?? "");
    setType(column?.type ?? "text");
    setOptions((column?.options ?? []).join(", "));
    setFormula(column?.formula ?? "");
    setCurrency(column?.currency ?? "");
  }, [open, columnId]);

  let formulaError: string | null = null;
  let preview: string | null = null;
  if (type === "formula" && formula.trim()) {
    try {
      validateFormula(formula);
      const draft: Column = { id: column?.id ?? "__draft", name: name || "?", type: "formula", formula };
      const tmp = { ...table, columns: [...table.columns.filter((c) => c.id !== draft.id), draft] };
      const first = table.rows[0];
      if (first) {
        const cell = computeRow(tmp, first, today)[draft.id];
        if ("error" in cell) formulaError = t(`formula.${cell.error}`);
        else preview = formatValue(displayColumn(tmp, draft), cell.value, settings);
      }
    } catch {
      formulaError = t("formula.syntax");
    }
  }

  const canSave = name.trim() !== "" && !(type === "formula" && (!formula.trim() || formulaError));

  const save = () => {
    if (!canSave) return;
    const ctx = { locale: settings.locale };
    if (!column) {
      const res = addColumn(table, {
        name,
        type,
        options: splitOptions(options),
        formula,
        currency: currency || undefined,
      });
      if (!res.problems.length) dispatch(res.op, t("column.new"));
      onClose();
      return;
    }
    const ops: Op[] = [];
    const patch: ColumnPatch = {};
    if (name.trim() !== column.name) patch.name = name.trim();
    if (type !== column.type) {
      ops.push(changeColumnType(table, column.id, type, ctx, { options: splitOptions(options), formula }).op);
    } else {
      if (type === "select" && options !== (column.options ?? []).join(", ")) patch.options = splitOptions(options);
      if (type === "formula" && formula !== column.formula) patch.formula = formula;
    }
    if (type === "money" && (currency || undefined) !== column.currency) patch.currency = currency || undefined;
    if (Object.keys(patch).length) ops.push({ type: "column.update", tableId: table.id, columnId: column.id, patch });
    if (ops.length) dispatch({ type: "batch", ops }, t("column.edit"));
    onClose();
  };

  const remove = () => {
    if (!column || !confirm(t("column.deleteConfirm", { name: column.name }))) return;
    dispatch({ type: "column.delete", tableId: table.id, columnId: column.id }, t("column.delete"));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={column ? t("column.edit") : t("column.new")}
      footer={
        <>
          {column && (
            <Button variant="danger" onClick={remove}>
              {t("column.delete")}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="primary" onClick={save} disabled={!canSave}>
            {t("column.save")}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Label text={t("column.name")}>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Label>
        <div>
          <span className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-300">{t("column.type")}</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COLUMN_TYPES.map((ct) => (
              <button
                key={ct}
                type="button"
                onClick={() => setType(ct)}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
                  type === ct
                    ? "bg-brand-600 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                <span className="w-5 text-center font-mono text-xs opacity-80">{TYPE_ICONS[ct]}</span>
                {t(`type.${ct}`)}
              </button>
            ))}
          </div>
        </div>
        {type === "select" && (
          <Label text={t("column.options")} hint={t("column.optionsHint")}>
            <textarea className={inputClass} rows={2} value={options} onChange={(e) => setOptions(e.target.value)} />
          </Label>
        )}
        {type === "money" && (
          <Label text={t("column.currency")}>
            <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="">{t("column.currencyDefault", { code: settings.currency })}</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Label>
        )}
        {type === "formula" && (
          <Label
            text={t("column.formula")}
            hint={
              formulaError ? (
                <span className="text-red-600 dark:text-red-400">{formulaError}</span>
              ) : preview !== null ? (
                `${t("column.preview")}: ${preview}`
              ) : (
                t("column.formulaHint")
              )
            }
          >
            <input
              className={`${inputClass} font-mono`}
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="[A] * [B]"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {table.columns
                .filter((c) => c.id !== column?.id)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setFormula((f) => `${f}${f && !f.endsWith(" ") ? " " : ""}[${c.name}]`)}
                    className="rounded-lg bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    [{c.name}]
                  </button>
                ))}
            </div>
          </Label>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
