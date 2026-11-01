import { displayColumn, ledgerOf, parseDate, parseNumber, type Ledger, type Table } from "@sumira/core";
import { useEffect, useState } from "react";
import { useT } from "../i18n/index.ts";
import { dateExample } from "../lib.ts";
import { useStore } from "../store.ts";
import { Button, Chips, Dialog, inputClass, Label } from "./ui.tsx";

// What the money in a table means, and a savings goal. Both are optional:
// Sumira guesses the first from templates and names, the person can correct it.

export function moneyColumns(table: Table, ws: Parameters<typeof displayColumn>[2]) {
  return table.columns.filter((c) => displayColumn(table, c, ws).type === "money" || c.type === "number");
}

type Kind = "none" | Ledger["kind"];

export function LedgerDialog({ table, open, onClose }: { table: Table; open: boolean; onClose: () => void }) {
  const t = useT();
  const ws = useStore((s) => s.ws);
  const dispatch = useStore((s) => s.dispatch);
  const amounts = moneyColumns(table, ws);
  const types = table.columns.filter((c) => c.type === "select");
  const checks = table.columns.filter((c) => c.type === "checkbox");
  const [kind, setKind] = useState<Kind>("none");
  const [amountId, setAmountId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [incomeValues, setIncomeValues] = useState<string[]>([]);
  const [paidId, setPaidId] = useState("");

  useEffect(() => {
    if (!open) return;
    const l = ledgerOf(table);
    setKind(l?.kind ?? "none");
    setAmountId(l?.amountId ?? amounts[0]?.id ?? "");
    setTypeId(l?.typeColumnId ?? "");
    setIncomeValues(l?.incomeValues ?? []);
    setPaidId(l?.paidColumnId ?? "");
  }, [open, table.id]);

  const typeCol = types.find((c) => c.id === typeId);
  const save = () => {
    let ledger: Ledger | undefined;
    if (kind !== "none" && amountId) {
      ledger = { amountId, kind };
      if (kind === "both" && typeId) {
        ledger.typeColumnId = typeId;
        ledger.incomeValues = incomeValues;
      }
      if (kind !== "expense" && paidId) ledger.paidColumnId = paidId;
    }
    // "Not money" is stored as an explicit empty ledger only by removing the guess: use an unknown column.
    const value = kind === "none" ? { amountId: "", kind: "income" as const } : ledger;
    dispatch({ type: "table.update", tableId: table.id, patch: { ledger: value } }, t("table.money"));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("ledger.title")}
      footer={
        <>
          <div className="flex-1" />
          <Button variant="primary" onClick={save} disabled={kind !== "none" && !amountId}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-ink-2">{t("ledger.hint")}</p>
        <Chips<Kind> value={kind} options={["income", "expense", "both", "none"]} label={(k) => t(`ledger.${k}`)} onPick={setKind} />
        {kind !== "none" && (
          <>
            <Label text={t("ledger.amount")}>
              <select className={inputClass} value={amountId} onChange={(e) => setAmountId(e.target.value)}>
                {amounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Label>
            {kind === "both" && (
              <>
                <Label text={t("ledger.type")}>
                  <select className={inputClass} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                    <option value="">{t("ledger.bySign")}</option>
                    {types.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Label>
                {typeCol && (
                  <div>
                    <div className="mb-1.5 text-sm font-semibold text-ink-2">{t("ledger.incomeValues")}</div>
                    <Chips
                      multi
                      value={incomeValues}
                      options={typeCol.options ?? []}
                      label={(o) => o}
                      onPick={(o) => setIncomeValues((v) => (v.includes(o) ? v.filter((x) => x !== o) : [...v, o]))}
                    />
                  </div>
                )}
              </>
            )}
            {kind !== "expense" && checks.length > 0 && (
              <Label text={t("ledger.paid")}>
                <select className={inputClass} value={paidId} onChange={(e) => setPaidId(e.target.value)}>
                  <option value="">{t("ledger.paidNone")}</option>
                  {checks.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Label>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

export function GoalDialog({ table, open, onClose }: { table: Table; open: boolean; onClose: () => void }) {
  const t = useT();
  const ws = useStore((s) => s.ws);
  const locale = useStore((s) => s.settings.locale);
  const dispatch = useStore((s) => s.dispatch);
  const amounts = moneyColumns(table, ws);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [columnId, setColumnId] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount(table.goal ? String(table.goal.amount) : "");
    setDate(table.goal?.date ?? "");
    setColumnId(table.goal?.columnId ?? amounts[0]?.id ?? "");
  }, [open, table.id]);

  const n = parseNumber(amount, locale, { money: true });
  const d = date ? parseDate(date, locale) : null;
  const save = () => {
    if (!n || n <= 0 || !columnId) return;
    dispatch({ type: "table.update", tableId: table.id, patch: { goal: { amount: n, columnId, ...(d ? { date: d } : {}) } } }, t("goal.title"));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("goal.title")}
      footer={
        <>
          {table.goal && (
            <Button
              variant="danger"
              onClick={() => {
                dispatch({ type: "table.update", tableId: table.id, patch: { goal: undefined } }, t("goal.remove"));
                onClose();
              }}
            >
              {t("goal.remove")}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="primary" onClick={save} disabled={!n || n <= 0 || !columnId}>
            {t("goal.save")}
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
        <Label text={t("goal.amount")}>
          <input className={`${inputClass} text-lg`} inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="30 000" />
        </Label>
        <Label text={t("goal.date")}>
          <input className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} placeholder={dateExample(locale)} />
        </Label>
        {amounts.length > 1 && (
          <Label text={t("goal.column")}>
            <select className={inputClass} value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {amounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Label>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
