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
  link: "↗",
  lookup: "⇢",
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
  const ws = useStore((s) => s.ws);
  const dispatch = useStore((s) => s.dispatch);
  const column = columnId ? table.columns.find((c) => c.id === columnId) : undefined;

  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [options, setOptions] = useState("");
  const [formula, setFormula] = useState("");
  const [currency, setCurrency] = useState("");
  const [linkTableId, setLinkTableId] = useState("");
  const [viaColumnId, setViaColumnId] = useState("");
  const [lookupColumnId, setLookupColumnId] = useState("");

  const otherTables = ws.tables.filter((tb) => tb.id !== table.id);
  const linkColumns = table.columns.filter((c) => c.type === "link" && c.id !== column?.id);
  const viaTable = ws.tables.find((tb) => tb.id === linkColumns.find((c) => c.id === viaColumnId)?.linkTableId);

  useEffect(() => {
    if (!open) return;
    setName(column?.name ?? "");
    setType(column?.type ?? "text");
    setOptions((column?.options ?? []).join(", "));
    setFormula(column?.formula ?? "");
    setCurrency(column?.currency ?? "");
    setLinkTableId(column?.linkTableId ?? otherTables[0]?.id ?? "");
    setViaColumnId(column?.lookup?.viaColumnId ?? linkColumns[0]?.id ?? "");
    setLookupColumnId(column?.lookup?.columnId ?? "");
  }, [open, columnId]);

  // Pick the first column of the linked table once the link is chosen.
  useEffect(() => {
    if (viaTable && !viaTable.columns.some((c) => c.id === lookupColumnId)) setLookupColumnId(viaTable.columns[0]?.id ?? "");
  }, [viaTable, lookupColumnId]);

  let formulaError: string | null = null;
  let preview: string | null = null;
  if (type === "formula" && formula.trim()) {
    try {
      validateFormula(formula);
      const draft: Column = { id: column?.id ?? "__draft", name: name || "?", type: "formula", formula };
      const tmp = { ...table, columns: [...table.columns.filter((c) => c.id !== draft.id), draft] };
      const first = table.rows[0];
      if (first) {
        const cell = computeRow(tmp, first, today, ws)[draft.id];
        if ("error" in cell) formulaError = t(`formula.${cell.error}`);
        else preview = formatValue(displayColumn(tmp, draft, ws), cell.value, settings);
      }
    } catch {
      formulaError = t("formula.syntax");
    }
  }

  const canSave =
    name.trim() !== "" &&
    !(type === "formula" && (!formula.trim() || formulaError)) &&
    !(type === "link" && !linkTableId) &&
    !(type === "lookup" && (!viaColumnId || !lookupColumnId));
  const lookup = { viaColumnId, columnId: lookupColumnId };

  const save = () => {
    if (!canSave) return;
    const ctx = { locale: settings.locale, ws };
    if (!column) {
      const res = addColumn(table, {
        name,
        type,
        options: splitOptions(options),
        formula,
        currency: currency || undefined,
        linkTableId: type === "link" ? linkTableId : undefined,
        lookup: type === "lookup" ? lookup : undefined,
      });
      if (!res.problems.length) dispatch(res.op, t("column.new"));
      onClose();
      return;
    }
    const ops: Op[] = [];
    const patch: ColumnPatch = {};
    if (name.trim() !== column.name) patch.name = name.trim();
    if (type !== column.type) {
      ops.push(changeColumnType(table, column.id, type, ctx, { options: splitOptions(options), formula, linkTableId, lookup }).op);
    } else {
      if (type === "select" && options !== (column.options ?? []).join(", ")) patch.options = splitOptions(options);
      if (type === "formula" && formula !== column.formula) patch.formula = formula;
      if (type === "link" && linkTableId !== column.linkTableId) {
        ops.push(changeColumnType(table, column.id, "link", ctx, { linkTableId }).op);
      }
      if (type === "lookup" && (viaColumnId !== column.lookup?.viaColumnId || lookupColumnId !== column.lookup?.columnId)) patch.lookup = lookup;
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
          <span className="mb-1.5 block text-sm font-semibold text-ink-2">{t("column.type")}</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COLUMN_TYPES.filter((ct) => (ct !== "link" || otherTables.length > 0) && (ct !== "lookup" || linkColumns.length > 0 || column?.type === "lookup")).map((ct) => (
              <button
                key={ct}
                type="button"
                onClick={() => setType(ct)}
                className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition ${
                  type === ct
                    ? "border-ink bg-ink text-paper"
                    : "border-line text-ink hover:border-ink"
                }`}
              >
                <span className="w-5 text-center text-xs opacity-70">{TYPE_ICONS[ct]}</span>
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
        {type === "link" && (
          <Label text={t("column.linkTable")} hint={t("column.linkHint")}>
            <select className={inputClass} value={linkTableId} onChange={(e) => setLinkTableId(e.target.value)}>
              {otherTables.map((tb) => (
                <option key={tb.id} value={tb.id}>
                  {tb.name}
                </option>
              ))}
            </select>
          </Label>
        )}
        {type === "lookup" &&
          (linkColumns.length === 0 ? (
            <p className="font-semibold text-late">{t("column.noLinks")}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Label text={t("column.via")}>
                <select className={inputClass} value={viaColumnId} onChange={(e) => setViaColumnId(e.target.value)}>
                  {linkColumns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Label>
              <Label text={t("column.lookupColumn")}>
                <select className={inputClass} value={lookupColumnId} onChange={(e) => setLookupColumnId(e.target.value)}>
                  {(viaTable?.columns ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Label>
            </div>
          ))}
        {type === "formula" && (
          <Label
            text={t("column.formula")}
            hint={
              formulaError ? (
                <span className="font-semibold text-late">{formulaError}</span>
              ) : preview !== null ? (
                `${t("column.preview")}: ${preview}`
              ) : (
                t("column.formulaHint")
              )
            }
          >
            <input
              className={inputClass}
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
                    className="rounded-lg border-2 border-line px-2 py-0.5 text-sm font-semibold hover:border-ink"
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
