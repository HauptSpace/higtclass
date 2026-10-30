import {
  addRecords,
  COLUMN_TYPES,
  createTable,
  decodeText,
  matchImportColumns,
  parseCsv,
  planImport,
  type ColumnType,
  type ImportPlan,
  type RawCell,
} from "@higtclass/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { useStore } from "../store.ts";
import { Button, Dialog, inputClass, Label } from "./ui.tsx";

// Moving off Excel or a bank export in a minute: pick a file, check what Zifra
// understood (header row, column types, skipped "Total" rows), then import as
// a new table or add the rows to an existing one.

type Sheet = { name: string; grid: RawCell[][] };

async function readFile(file: File): Promise<Sheet[]> {
  if (/\.(csv|txt|tsv)$/i.test(file.name) || file.type === "text/csv") {
    // Bank exports are often Windows-1252/1251, not UTF-8.
    const text = decodeText(new Uint8Array(await file.arrayBuffer()));
    return [{ name: file.name.replace(/\.[^.]+$/, ""), grid: parseCsv(text) }];
  }
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => ({ name: s.sheet, grid: s.data as unknown as RawCell[][] }));
}

const IMPORTABLE: ColumnType[] = COLUMN_TYPES.filter((c) => c !== "formula" && c !== "link" && c !== "lookup" && c !== "rollup");

export function ImportDialog({ open, onClose, targetTableId }: { open: boolean; onClose: () => void; targetTableId?: string }) {
  const t = useT();
  const locale = useStore((s) => s.settings.locale);
  const ws = useStore((s) => s.ws);
  const dispatch = useStore((s) => s.dispatch);
  const setActiveTable = useStore((s) => s.setActiveTable);
  const showToast = useStore((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);

  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<"error" | "empty" | null>(null);
  const [target, setTarget] = useState<string>(targetTableId ?? "");

  useEffect(() => {
    if (open) setTarget(targetTableId ?? "");
  }, [open, targetTableId]);

  const reset = () => {
    setSheets([]);
    setPlan(null);
    setError(null);
    setName("");
    setHeaderRow(null);
  };

  const build = (list: Sheet[], index: number, header: number | null) => {
    const p = planImport(list[index].grid, locale, header === null ? {} : { headerRow: header });
    setPlan(p.columns.length ? p : null);
    setError(p.columns.length ? null : "empty");
    setHeaderRow(p.headerRow);
  };

  const choose = (list: Sheet[], index: number, fallbackName: string) => {
    setSheetIndex(index);
    build(list, index, null);
    setName(list.length > 1 ? list[index].name : fallbackName);
  };

  const onFile = async (file: File) => {
    reset();
    try {
      const list = await readFile(file);
      if (!list.length) return setError("empty");
      setSheets(list);
      choose(list, 0, file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      console.error(e);
      setError("error");
    }
  };

  const setType = (i: number, type: ColumnType) => {
    if (!plan) return;
    const columns = plan.columns.slice();
    const values = plan.rows.map((r) => r[columns[i].name]).filter((v) => v !== null && v !== "");
    const options = type === "select" ? [...new Set(values.map(String))].slice(0, 50) : undefined;
    columns[i] = { name: columns[i].name, type, options };
    setPlan({ ...plan, columns });
  };

  const targetTable = ws.tables.find((x) => x.id === target);
  const mapping = useMemo(() => (plan && targetTable ? matchImportColumns(plan, targetTable.columns) : null), [plan, targetTable]);

  const untitled = t("newTable.untitled");
  const result = useMemo(() => {
    if (!plan) return null;
    if (targetTable && mapping) {
      const records = plan.rows.map((r) => Object.fromEntries(Object.entries(r).flatMap(([k, v]) => (mapping[k] ? [[mapping[k]!, v]] : []))));
      const res = addRecords(targetTable, records, { locale, ws });
      return { op: res.op, count: res.rows.length, problems: res.problems, tableId: targetTable.id };
    }
    const res = createTable({ name: name || untitled, icon: "□", columns: plan.columns, rows: plan.rows }, { locale });
    return { op: res.op, count: res.table.rows.length, problems: res.problems, tableId: res.table.id };
  }, [plan, name, untitled, locale, targetTable, mapping, ws]);
  const skipped = result?.problems.filter((p) => p.reason === "invalid_value").length ?? 0;

  const doImport = () => {
    if (!result) return;
    if (dispatch(result.op, t("import.title"))) {
      setActiveTable(result.tableId);
      showToast(t("import.done"));
    }
    reset();
    onClose();
  };

  const nonEmpty = sheets[sheetIndex]?.grid.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== "")) ?? [];

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t("import.title")}
      wide
      footer={
        result ? (
          <>
            {skipped > 0 && <span className="text-sm text-ink-2">{t("import.skipped", { n: skipped })}</span>}
            <div className="flex-1" />
            <Button variant="primary" onClick={doImport}>
              {targetTable ? t("import.goExisting", { n: result.count }) : t("import.go", { n: result.count })}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => fileRef.current?.click()}>
            {t("import.pick")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void onFile(file);
            }}
          />
          <p className="max-w-xl text-ink-2">{t("import.hint")}</p>
        </div>
        {error && (
          <p role="alert" className="font-semibold text-late">
            {t(error === "empty" ? "import.empty" : "import.error")}
          </p>
        )}
        {plan && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Label text={t("import.target")}>
                <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">{t("import.targetNew")}</option>
                  {ws.tables.map((tb) => (
                    <option key={tb.id} value={tb.id}>
                      {tb.name}
                    </option>
                  ))}
                </select>
              </Label>
              {!targetTable && (
                <Label text={t("import.name")}>
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
                </Label>
              )}
              {sheets.length > 1 && (
                <Label text={t("import.sheet")}>
                  <select className={inputClass} value={sheetIndex} onChange={(e) => choose(sheets, Number(e.target.value), name)}>
                    {sheets.map((s, i) => (
                      <option key={s.name} value={i}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Label>
              )}
              <Label text={t("import.headerRow")}>
                <select
                  className={inputClass}
                  value={headerRow ?? 0}
                  onChange={(e) => {
                    const h = Number(e.target.value);
                    build(sheets, sheetIndex, h);
                  }}
                >
                  {nonEmpty.slice(0, 30).map((r, i) => (
                    <option key={i} value={i}>
                      {i + 1}: {r.filter((c) => c !== null && c !== undefined && String(c).trim() !== "").slice(0, 3).map(String).join(" · ").slice(0, 40)}
                    </option>
                  ))}
                </select>
              </Label>
            </div>
            {plan.skippedTotals > 0 && <p className="text-sm text-ink-2">{t("import.totalsSkipped", { n: plan.skippedTotals })}</p>}
            <div className="overflow-x-auto border-t-2 border-rule">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {plan.columns.map((c, i) => (
                      <th key={c.name} className="min-w-36 border-b-2 border-rule px-2 py-2 text-left align-bottom">
                        <div className="mb-1.5 font-extrabold">{c.name}</div>
                        {targetTable && mapping ? (
                          <div className={`text-xs font-semibold ${mapping[c.name] ? "text-ink-2" : "text-late"}`}>
                            {mapping[c.name] ? `${t("import.mapped")}: ${targetTable.columns.find((x) => x.id === mapping[c.name])?.name}` : t("import.unmapped")}
                          </div>
                        ) : (
                          <select
                            aria-label={`${c.name}: ${t("column.type")}`}
                            className="w-full rounded-lg border-2 border-line bg-paper px-2 py-1 text-sm font-semibold focus:border-ink"
                            value={c.type}
                            onChange={(e) => setType(i, e.target.value as ColumnType)}
                          >
                            {IMPORTABLE.map((ty) => (
                              <option key={ty} value={ty}>
                                {t(`type.${ty}`)}
                                {ty === "money" && c.type === "money" && c.currency ? ` (${c.currency})` : ""}
                              </option>
                            ))}
                          </select>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.slice(0, 6).map((r, i) => (
                    <tr key={i}>
                      {plan.columns.map((c) => (
                        <td key={c.name} className="border-b border-line px-2 py-2 whitespace-nowrap">
                          {r[c.name] === null ? "" : String(r[c.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-ink-2">{t("ai.rows", { n: plan.rows.length })}</p>
          </>
        )}
      </div>
    </Dialog>
  );
}
