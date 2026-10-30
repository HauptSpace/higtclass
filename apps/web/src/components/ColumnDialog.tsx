import {
  addColumn,
  applyOp,
  changeColumnType,
  COLUMN_TYPES,
  computeRow,
  currencyChoices,
  displayColumn,
  formatValue,
  renameOption,
  validateFormula,
  type CellValue,
  type Column,
  type ColumnPatch,
  type ColumnType,
  type Op,
  type RollupAgg,
  type Table,
} from "@higtclass/core";
import { useEffect, useState } from "react";
import { useT } from "../i18n/index.ts";
import { useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { Button, Dialog, inputClass, Label, OPTION_COLORS, optionColor } from "./ui.tsx";

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
  rollup: "Σ",
};

const AGGS: RollupAgg[] = ["sum", "count", "avg", "min", "max"];

interface OptionDraft {
  /** Name the choice had when the dialog opened (null for a new one). */
  from: string | null;
  name: string;
  color?: string;
}

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
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [newOption, setNewOption] = useState("");
  const [formula, setFormula] = useState("");
  const [format, setFormat] = useState<NonNullable<Column["format"]>>("auto");
  const [currency, setCurrency] = useState("");
  const [linkTableId, setLinkTableId] = useState("");
  const [viaColumnId, setViaColumnId] = useState("");
  const [lookupColumnId, setLookupColumnId] = useState("");
  const [rollup, setRollup] = useState<{ source: string; agg: RollupAgg; columnId: string }>({ source: "", agg: "sum", columnId: "" });
  const [defaultValue, setDefaultValue] = useState("");

  const otherTables = ws.tables.filter((tb) => tb.id !== table.id);
  const linkColumns = table.columns.filter((c) => c.type === "link" && c.id !== column?.id);
  const viaTable = ws.tables.find((tb) => tb.id === linkColumns.find((c) => c.id === viaColumnId)?.linkTableId);
  // Tables with a link pointing here: "Sales.Product → Products".
  const sources = ws.tables.flatMap((tb) => tb.columns.filter((c) => c.type === "link" && c.linkTableId === table.id).map((c) => ({ table: tb, link: c })));
  const source = sources.find((s) => `${s.table.id}:${s.link.id}` === rollup.source);

  useEffect(() => {
    if (!open) return;
    setName(column?.name ?? "");
    setType(column?.type ?? "text");
    setOptions((column?.options ?? []).map((o) => ({ from: o, name: o, color: column?.optionColors?.[o] })));
    setNewOption("");
    setFormula(column?.formula ?? "");
    setFormat(column?.format ?? "auto");
    setCurrency(column?.currency ?? "");
    setLinkTableId(column?.linkTableId ?? otherTables[0]?.id ?? "");
    setViaColumnId(column?.lookup?.viaColumnId ?? linkColumns[0]?.id ?? "");
    setLookupColumnId(column?.lookup?.columnId ?? "");
    const r = column?.rollup;
    const first = sources[0];
    setRollup({
      source: r ? `${r.tableId}:${r.linkColumnId}` : first ? `${first.table.id}:${first.link.id}` : "",
      agg: r?.agg ?? "sum",
      columnId: r?.columnId ?? "",
    });
    setDefaultValue(column?.default === undefined || column.default === null ? "" : String(column.default));
  }, [open, columnId]);

  // Pick the first column of the linked table once the link is chosen.
  useEffect(() => {
    if (viaTable && !viaTable.columns.some((c) => c.id === lookupColumnId)) setLookupColumnId(viaTable.columns[0]?.id ?? "");
  }, [viaTable, lookupColumnId]);
  useEffect(() => {
    if (source && rollup.agg !== "count" && !source.table.columns.some((c) => c.id === rollup.columnId)) {
      const numeric = source.table.columns.find((c) => ["number", "money", "formula", "lookup", "rollup"].includes(c.type) && c.id !== source.link.id);
      setRollup((r) => ({ ...r, columnId: numeric?.id ?? "" }));
    }
  }, [source, rollup.agg, rollup.columnId]);

  let formulaError: string | null = null;
  let preview: string | null = null;
  if (type === "formula" && formula.trim()) {
    try {
      validateFormula(formula);
      const draft: Column = { id: column?.id ?? "__draft", name: name || "?", type: "formula", formula, ...(format !== "auto" ? { format } : {}), ...(currency ? { currency } : {}) };
      const tmp = { ...table, columns: [...table.columns.filter((c) => c.id !== draft.id), draft] };
      const first = table.rows.at(-1);
      if (first) {
        const cell = computeRow(tmp, first, today, ws)[draft.id];
        if ("error" in cell) formulaError = t(`formula.${cell.error}` as "formula.syntax");
        else preview = formatValue(displayColumn(tmp, draft, ws), cell.value, settings);
      }
    } catch {
      formulaError = t("formula.syntax");
    }
  }

  const optionNames = options.map((o) => o.name.trim()).filter(Boolean);
  const canSave =
    name.trim() !== "" &&
    !(type === "formula" && (!formula.trim() || formulaError)) &&
    !(type === "link" && !linkTableId) &&
    !(type === "lookup" && (!viaColumnId || !lookupColumnId)) &&
    !(type === "rollup" && (!source || (rollup.agg !== "count" && !rollup.columnId)));
  const lookup = { viaColumnId, columnId: lookupColumnId };
  const rollupSpec = source ? { tableId: source.table.id, linkColumnId: source.link.id, columnId: rollup.agg === "count" ? null : rollup.columnId, agg: rollup.agg } : undefined;
  const colors = Object.fromEntries(options.filter((o) => o.color && o.name.trim()).map((o) => [o.name.trim(), o.color!]));
  const defaultCell: CellValue | undefined = defaultValue === "" ? undefined : type === "checkbox" ? defaultValue === "true" : defaultValue;

  const save = () => {
    if (!canSave) return;
    const ctx = { locale: settings.locale, ws };
    if (!column) {
      const res = addColumn(table, {
        name,
        type,
        options: optionNames,
        optionColors: colors,
        formula,
        format,
        currency: currency || undefined,
        linkTableId: type === "link" ? linkTableId : undefined,
        lookup: type === "lookup" ? lookup : undefined,
        rollup: type === "rollup" ? rollupSpec : undefined,
        default: defaultCell,
      });
      if (!res.problems.length) dispatch(res.op, t("column.new"));
      onClose();
      return;
    }
    const ops: Op[] = [];
    const patch: ColumnPatch = {};
    if (name.trim() !== column.name) patch.name = name.trim();
    if (type !== column.type) {
      ops.push(changeColumnType(table, column.id, type, ctx, { options: optionNames, formula, linkTableId, lookup, rollup: rollupSpec }).op);
      if (type === "select" && Object.keys(colors).length) patch.optionColors = colors;
    } else {
      if (type === "select") {
        // Renames first (they rewrite entries and merge duplicates), then the list itself.
        let working = table;
        for (const o of options) {
          if (o.from && o.name.trim() && o.name.trim() !== o.from) {
            const op = renameOption(working, column.id, o.from, o.name.trim());
            if (!op) continue;
            ops.push(op);
            working = applyOp({ tables: [working] }, op).tables[0];
          }
        }
        const removed = options.filter((o) => o.from && !o.name.trim()).map((o) => o.from!);
        const next = [...new Set(optionNames)];
        if (JSON.stringify(next) !== JSON.stringify(column.options ?? [])) patch.options = next;
        if (JSON.stringify(colors) !== JSON.stringify(column.optionColors ?? {})) patch.optionColors = Object.keys(colors).length ? colors : undefined;
        const scope = working.columns.find((c) => c.id === column.id)?.scope;
        if (removed.length && scope) {
          patch.scope = { ...scope, map: Object.fromEntries(Object.entries(scope.map).filter(([k]) => !removed.includes(k))) };
        }
      }
      if (type === "formula" && formula !== column.formula) patch.formula = formula;
      if (type === "formula" && format !== (column.format ?? "auto")) patch.format = format === "auto" ? undefined : format;
      if (type === "link" && linkTableId !== column.linkTableId) ops.push(changeColumnType(table, column.id, "link", ctx, { linkTableId }).op);
      if (type === "lookup" && (viaColumnId !== column.lookup?.viaColumnId || lookupColumnId !== column.lookup?.columnId)) patch.lookup = lookup;
      if (type === "rollup" && JSON.stringify(rollupSpec) !== JSON.stringify(column.rollup)) patch.rollup = rollupSpec;
    }
    if ((type === "money" || (type === "formula" && format === "money")) && (currency || undefined) !== column.currency) patch.currency = currency || undefined;
    if (JSON.stringify(defaultCell) !== JSON.stringify(column.default)) patch.default = defaultCell;
    if (Object.keys(patch).length) ops.push({ type: "column.update", tableId: table.id, columnId: column.id, patch });
    if (ops.length) dispatch({ type: "batch", ops }, t("column.edit"));
    onClose();
  };

  const move = (dir: -1 | 1) => {
    if (!column) return;
    const index = table.columns.indexOf(column) + dir;
    if (index < 0 || index >= table.columns.length) return;
    dispatch({ type: "column.move", tableId: table.id, columnId: column.id, index }, t("column.position"));
  };

  const remove = () => {
    if (!column || !confirm(t("column.deleteConfirm", { name: column.name }))) return;
    dispatch({ type: "column.delete", tableId: table.id, columnId: column.id }, t("column.delete"));
    onClose();
  };

  const allowed = COLUMN_TYPES.filter(
    (ct) =>
      (ct !== "link" || otherTables.length > 0 || column?.type === "link") &&
      (ct !== "lookup" || linkColumns.length > 0 || column?.type === "lookup") &&
      (ct !== "rollup" || sources.length > 0 || column?.type === "rollup"),
  );
  const index = column ? table.columns.indexOf(column) : -1;
  const valueColumns = source?.table.columns.filter((c) => c.id !== source.link.id && ["number", "money", "formula", "lookup", "rollup"].includes(c.type)) ?? [];

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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {allowed.map((ct) => (
              <button
                key={ct}
                type="button"
                onClick={() => setType(ct)}
                className={`flex min-w-0 items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-sm leading-tight font-semibold transition ${
                  type === ct ? "border-ink bg-ink text-paper" : "border-line text-ink hover:border-ink"
                }`}
              >
                <span className="w-5 shrink-0 text-center text-xs opacity-70">{TYPE_ICONS[ct]}</span>
                <span className="min-w-0 break-words">{t(`type.${ct}`)}</span>
              </button>
            ))}
          </div>
        </div>

        {type === "select" && (
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-ink-2">{t("column.options")}</span>
            <ul className="space-y-1.5">
              {options.map((o, i) => (
                <li key={i} className="flex items-center gap-2">
                  <ColorPick
                    value={o.color ?? optionColor(undefined, o.name) ?? undefined}
                    onPick={(color) => setOptions((list) => list.map((x, j) => (j === i ? { ...x, color } : x)))}
                    label={t("column.optionColor")}
                  />
                  <input
                    className={`${inputClass} !py-1.5`}
                    value={o.name}
                    aria-label={t("column.options")}
                    onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    aria-label={t("column.optionRemove")}
                    title={t("column.optionRemove")}
                    onClick={() => setOptions((list) => list.map((x, j) => (j === i ? { ...x, name: "" } : x)).filter((x, j) => j !== i || x.from))}
                    className="rounded-lg px-2 py-1 text-ink-2 hover:bg-soft hover:text-late"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <input
                className={`${inputClass} !py-1.5`}
                value={newOption}
                placeholder={t("column.optionAdd")}
                onChange={(e) => setNewOption(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (newOption.trim()) setOptions((list) => [...list, { from: null, name: newOption.trim() }]);
                    setNewOption("");
                  }
                }}
              />
              <Button
                variant="outline"
                onClick={() => {
                  if (newOption.trim()) setOptions((list) => [...list, { from: null, name: newOption.trim() }]);
                  setNewOption("");
                }}
              >
                ＋
              </Button>
            </div>
            {column?.type === "select" && <p className="mt-1.5 text-sm text-ink-2">{t("column.optionMerge")}</p>}
          </div>
        )}

        {type === "money" && <CurrencySelect value={currency} onChange={setCurrency} />}

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

        {type === "rollup" &&
          (sources.length === 0 ? (
            <p className="font-semibold text-late">{t("column.noBacklinks")}</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-2">{t("column.rollupHint")}</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Label text={t("column.rollupFrom")}>
                  <select className={inputClass} value={rollup.source} onChange={(e) => setRollup((r) => ({ ...r, source: e.target.value, columnId: "" }))}>
                    {sources.map((s) => (
                      <option key={`${s.table.id}:${s.link.id}`} value={`${s.table.id}:${s.link.id}`}>
                        {s.table.name} · {s.link.name}
                      </option>
                    ))}
                  </select>
                </Label>
                <Label text={t("column.rollupAgg")}>
                  <select className={inputClass} value={rollup.agg} onChange={(e) => setRollup((r) => ({ ...r, agg: e.target.value as RollupAgg }))}>
                    {AGGS.map((a) => (
                      <option key={a} value={a}>
                        {t(`agg.${a}`)}
                      </option>
                    ))}
                  </select>
                </Label>
                {rollup.agg !== "count" && (
                  <Label text={t("column.rollupColumn")}>
                    <select className={inputClass} value={rollup.columnId} onChange={(e) => setRollup((r) => ({ ...r, columnId: e.target.value }))}>
                      {valueColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Label>
                )}
              </div>
            </div>
          ))}

        {type === "formula" && (
          <>
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
              <input className={inputClass} value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="[A] * [B]" />
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Label text={t("column.format")}>
                <select className={inputClass} value={format} onChange={(e) => setFormat(e.target.value as NonNullable<Column["format"]>)}>
                  {(["auto", "number", "money"] as const).map((f) => (
                    <option key={f} value={f}>
                      {t(`format.${f}`)}
                    </option>
                  ))}
                </select>
              </Label>
              {format === "money" && <CurrencySelect value={currency} onChange={setCurrency} />}
            </div>
          </>
        )}

        {(type === "select" || type === "checkbox" || type === "text") && (
          <Label text={t("column.default")}>
            {type === "select" ? (
              <select className={inputClass} value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)}>
                <option value="">{t("column.defaultNone")}</option>
                {optionNames.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : type === "checkbox" ? (
              <select className={inputClass} value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)}>
                <option value="">{t("filter.no")}</option>
                <option value="true">✓ {t("filter.yes")}</option>
              </select>
            ) : (
              <input className={inputClass} value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} />
            )}
          </Label>
        )}

        {column && table.columns.length > 1 && (
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-ink-2">{t("column.position")}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => move(-1)} disabled={index <= 0}>
                {t("column.moveLeft")}
              </Button>
              <Button variant="outline" onClick={() => move(1)} disabled={index >= table.columns.length - 1}>
                {t("column.moveRight")}
              </Button>
            </div>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  return (
    <Label text={t("column.currency")}>
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("column.currencyDefault", { code: settings.currency })}</option>
        {currencyChoices(settings.locale).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </Label>
  );
}

function ColorPick({ value, onPick, label }: { value?: string; onPick: (c: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="h-7 w-7 shrink-0 rounded-md border-2 border-line"
        style={{ background: value ?? "var(--ink-2)" }}
      />
      {open && (
        <div className="absolute left-0 z-40 mt-1 flex w-max gap-1 rounded-lg border-2 border-ink bg-paper p-1.5 shadow-xl">
          {OPTION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
              className="h-6 w-6 rounded"
              style={{ background: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
