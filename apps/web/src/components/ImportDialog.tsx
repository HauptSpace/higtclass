import { COLUMN_TYPES, createTable, parseCsv, planImport, type ColumnType, type ImportPlan, type RawCell } from "@higtclass/core";
import { useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { useStore } from "../store.ts";
import { Button, Dialog, inputClass, Label } from "./ui.tsx";

// Moving off Excel in a minute: pick a file, check what Zifra understood,
// import. Column types can be corrected before anything is saved.

type Sheet = { name: string; grid: RawCell[][] };

async function readFile(file: File): Promise<Sheet[]> {
  if (/\.(csv|txt|tsv)$/i.test(file.name) || file.type === "text/csv") {
    return [{ name: file.name.replace(/\.[^.]+$/, ""), grid: parseCsv(await file.text()) }];
  }
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => ({ name: s.sheet, grid: s.data as unknown as RawCell[][] }));
}

const IMPORTABLE: ColumnType[] = COLUMN_TYPES.filter((c) => c !== "formula" && c !== "link" && c !== "lookup");

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const locale = useStore((s) => s.settings.locale);
  const dispatch = useStore((s) => s.dispatch);
  const setActiveTable = useStore((s) => s.setActiveTable);
  const showToast = useStore((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);

  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<"error" | "empty" | null>(null);

  const reset = () => {
    setSheets([]);
    setPlan(null);
    setError(null);
    setName("");
  };

  const choose = (list: Sheet[], index: number, fallbackName: string) => {
    setSheetIndex(index);
    const p = planImport(list[index].grid, locale);
    setPlan(p.columns.length ? p : null);
    setError(p.columns.length ? null : "empty");
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

  const untitled = t("newTable.untitled");
  const result = useMemo(
    () => (plan ? createTable({ name: name || untitled, icon: "□", columns: plan.columns, rows: plan.rows }, { locale }) : null),
    [plan, name, untitled, locale],
  );
  const skipped = result?.problems.filter((p) => p.reason === "invalid_value").length ?? 0;

  const doImport = () => {
    if (!result) return;
    if (dispatch(result.op, t("import.title"))) {
      setActiveTable(result.table.id);
      showToast(t("import.done"));
    }
    reset();
    onClose();
  };

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
              {t("import.go", { n: result.table.rows.length })}
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Label text={t("import.name")}>
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
              </Label>
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
            </div>
            <div className="overflow-x-auto border-t-2 border-rule">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {plan.columns.map((c, i) => (
                      <th key={c.name} className="min-w-36 border-b-2 border-rule px-2 py-2 text-left align-bottom">
                        <div className="mb-1.5 font-extrabold">{c.name}</div>
                        <select
                          aria-label={`${c.name}: ${t("column.type")}`}
                          className="w-full rounded-lg border-2 border-line bg-paper px-2 py-1 text-sm font-semibold focus:border-ink"
                          value={c.type}
                          onChange={(e) => setType(i, e.target.value as ColumnType)}
                        >
                          {IMPORTABLE.map((ty) => (
                            <option key={ty} value={ty}>
                              {t(`type.${ty}`)}
                            </option>
                          ))}
                        </select>
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
