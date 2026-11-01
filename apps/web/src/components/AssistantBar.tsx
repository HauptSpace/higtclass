import { addRecords, ledgerOf, parseQuickEntries, type CellValue, type Op, type RawRecord } from "@sumira/core";
import { useRef, useState } from "react";
import { askAssistant, describeOps, readPhoto, type AssistantFailure, type PhotoInput } from "../assistant.ts";
import { useT } from "../i18n/index.ts";
import { draftOf, useStockWarnings } from "../lib.ts";
import { useDictation } from "../speech.ts";
import { useStore } from "../store.ts";
import { Button } from "./ui.tsx";

// The line at the top of every table: say, type or photograph what happened,
// see how Sumira understood it, then save it with one press.

type Phase =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "preview"; reply: string; ops: Op[]; local?: boolean; record?: RawRecord }
  | { kind: "failed"; failure: AssistantFailure }
  | { kind: "reply"; reply: string };

export function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5" y="1" width="6" height="9" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h2l1.2-2h4.6L12.5 5h2A1.5 1.5 0 0 1 16 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 13.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="9" cy="10" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function ChangeList({ ops }: { ops: Op[] }) {
  const t = useT();
  const ws = useStore((s) => s.ws);
  const settings = useStore((s) => s.settings);
  const items = describeOps(ws, ops, settings, t);
  if (!items.length) return <p className="text-ink-2">{t("ai.nothing")}</p>;
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i}>
          <div className="text-sm font-bold">{item.title}</div>
          {item.fields.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {item.fields.map(([name, value], j) => (
                <span key={j} className="rounded-full border-2 border-ink bg-paper px-3 py-1 text-sm">
                  <span className="text-ink-2">{name}</span> <b className="font-bold">{value}</b>
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Income or expense, one tap to correct a guess ("Fam. Schneider 1250" is income). */
function FlowToggle({ tableId, record, onChange }: { tableId: string; record: RawRecord; onChange: (record: RawRecord, ops: Op[]) => void }) {
  const ws = useStore((s) => s.ws);
  const settings = useStore((s) => s.settings);
  const table = ws.tables.find((tb) => tb.id === tableId);
  const ledger = table ? ledgerOf(table) : null;
  const typeCol = ledger?.kind === "both" && ledger.typeColumnId ? table!.columns.find((c) => c.id === ledger.typeColumnId) : undefined;
  if (!table || !typeCol) return null;
  const income = ledger!.incomeValues?.[0];
  const expense = (typeCol.options ?? []).find((o) => !ledger!.incomeValues?.includes(o));
  const current = String(record[typeCol.id] ?? typeCol.default ?? expense ?? "");
  const pick = (value: string) => {
    const next: RawRecord = { ...record, [typeCol.id]: value };
    // A category that belongs to the other side no longer fits.
    for (const c of table.columns) {
      const v = next[c.id];
      if (c.scope?.columnId === typeCol.id && typeof v === "string" && c.scope.map[v] && c.scope.map[v] !== value) delete next[c.id];
    }
    const res = addRecords(table, [next], { locale: settings.locale, ws, currency: settings.currency, rates: useStore.getState().exchange ?? undefined });
    if (!res.problems.length) onChange(next, [res.op]);
  };
  return (
    <div className="mb-3 inline-flex gap-1 rounded-full bg-paper p-0.5" role="group">
      {[income, expense].filter((x): x is string => !!x).map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={current === o}
          onClick={() => pick(o)}
          className={`rounded-full px-3.5 py-1 text-sm font-bold ${current === o ? (o === income ? "bg-paid text-white" : "bg-ink text-paper") : "text-ink-2"}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function AssistantBar({ tableId, onEdit }: { tableId: string; onEdit?: (preset: Record<string, string>) => void }) {
  const t = useT();
  const ws = useStore((s) => s.ws);
  const settings = useStore((s) => s.settings);
  const dispatch = useStore((s) => s.dispatch);
  const showToast = useStore((s) => s.showToast);
  const warnStock = useStockWarnings();
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<PhotoInput | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);
  const dictation = useDictation(settings.locale, (spoken, final) => {
    setText(spoken);
    if (final && spoken) void submit(spoken);
  });

  // Short entries ("кава 85", "вчора таксі 240") are understood right here:
  // instant, free and offline. The assistant gets the rest.
  const quick = (msg: string): { ops: Op[]; record?: RawRecord } | null => {
    const table = ws.tables.find((tb) => tb.id === tableId);
    if (!table || !msg) return null;
    const ctx = { locale: settings.locale, ws, currency: settings.currency, rates: useStore.getState().exchange ?? undefined };
    const entries = parseQuickEntries(table, msg, ctx);
    if (!entries) return null;
    const res = addRecords(table, entries.map((e) => e.record), ctx);
    if (res.problems.length) return null;
    return { ops: [res.op], record: entries.length === 1 ? entries[0].record : undefined };
  };

  async function submit(message = text) {
    const msg = message.trim();
    if (!msg && !photo) return;
    const local = photo ? null : quick(msg);
    if (local) return setPhase({ kind: "preview", reply: "", ops: local.ops, local: true, record: local.record });
    setPhase({ kind: "thinking" });
    const res = await askAssistant({ message: msg, image: photo, activeTableId: tableId, workspace: ws, settings });
    if (!res.ok) return setPhase({ kind: "failed", failure: res.failure });
    if (!res.ops.length) return setPhase({ kind: "reply", reply: res.reply || t("ai.nothing") });
    setPhase({ kind: "preview", reply: res.reply, ops: res.ops });
  }

  const reset = () => {
    setText("");
    setPhoto(null);
    setPhase({ kind: "idle" });
  };

  const save = () => {
    if (phase.kind !== "preview") return;
    const before = useStore.getState().ws;
    if (dispatch({ type: "batch", ops: phase.ops }, t("ai.saved"))) {
      showToast(t("ai.saved"));
      const inserted: string[] = [];
      const visit = (op: Op) => {
        if (op.type === "batch") op.ops.forEach(visit);
        else if (op.type === "rows.insert" && op.tableId === tableId) inserted.push(...op.rows.map((r) => r.id));
      };
      phase.ops.forEach(visit);
      warnStock(before, tableId, inserted);
      reset();
    } else {
      // The table changed while Sumira was thinking: ask again on fresh data.
      setPhase({ kind: "failed", failure: "error" });
    }
  };

  const busy = phase.kind === "thinking";

  return (
    <div className="border-b-2 border-rule bg-soft">
      <form
        className="flex items-center gap-2 px-3 py-3 md:gap-3 md:px-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Enter again on a preview saves it.
          if (phase.kind === "preview") save();
          else void submit();
        }}
      >
        {dictation.supported && (
          <button
            type="button"
            onClick={dictation.listening ? dictation.stop : dictation.start}
            disabled={busy}
            aria-label={dictation.listening ? t("ai.stopMic") : t("ai.mic")}
            title={dictation.listening ? t("ai.stopMic") : t("ai.mic")}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition ${dictation.listening ? "listening bg-late text-white" : "bg-accent text-on-accent"}`}
          >
            <MicIcon />
          </button>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label={t("ai.photo")}
          title={t("ai.photo")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-ink text-ink hover:bg-paper"
        >
          <CameraIcon />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              setPhoto(await readPhoto(file));
            } catch {
              // Not a picture (a PDF or CSV picked by mistake).
              setPhase({ kind: "failed", failure: "notImage" });
            }
          }}
        />
        {photo && (
          <button type="button" onClick={() => setPhoto(null)} className="relative shrink-0" aria-label={t("ai.removePhoto")} title={t("ai.removePhoto")}>
            <img src={photo.previewUrl} alt="" className="h-11 w-11 rounded-lg object-cover" />
            <span className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-[11px] text-paper">✕</span>
          </button>
        )}
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (phase.kind === "failed" || phase.kind === "reply") setPhase({ kind: "idle" });
          }}
          disabled={busy}
          placeholder={photo ? t("ai.placeholderPhoto") : dictation.listening ? "…" : t("ai.placeholder")}
          className="min-w-0 flex-1 bg-transparent py-2 text-[17px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-2"
          aria-label={t("ai.placeholder")}
        />
        {(text.trim() || photo) && phase.kind !== "preview" && (
          <Button type="submit" variant="primary" disabled={busy} className="shrink-0">
            {busy ? t("ai.thinking") : t("ai.send")}
          </Button>
        )}
      </form>

      {phase.kind === "preview" && (
        <div className="px-4 pb-4 md:pl-[7.5rem]">
          {phase.reply && <p className="mb-3 text-ink-2">{phase.reply}</p>}
          {phase.local && <p className="mb-2 text-xs font-bold tracking-wide text-ink-2 uppercase">{t("ai.local")}</p>}
          {phase.record && <FlowToggle tableId={tableId} record={phase.record} onChange={(record, ops) => setPhase({ ...phase, record, ops })} />}
          <ChangeList ops={phase.ops} />
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={save}>
              {t("ai.save")}
            </Button>
            {phase.record && onEdit && (
              <Button
                variant="outline"
                onClick={() => {
                  // Fix a guess in the full form: the parsed values become its starting point.
                  const table = ws.tables.find((tb) => tb.id === tableId);
                  const record = phase.record!;
                  if (!table) return;
                  const preset = Object.fromEntries(
                    table.columns.filter((c) => record[c.id] !== undefined).map((c) => [c.id, draftOf(c, record[c.id] as CellValue, settings.locale)]),
                  );
                  reset();
                  onEdit(preset);
                }}
              >
                {t("ai.edit")}
              </Button>
            )}
            <Button variant="ghost" onClick={reset}>
              {t("ai.discard")}
            </Button>
          </div>
        </div>
      )}
      {phase.kind === "reply" && <p className="px-4 pb-4 text-ink-2 md:pl-[7.5rem]">{phase.reply}</p>}
      {phase.kind === "failed" && (
        <p role="alert" className="px-4 pb-4 font-medium text-late md:pl-[7.5rem]">
          {t(`ai.${phase.failure}`)}
        </p>
      )}
    </div>
  );
}
