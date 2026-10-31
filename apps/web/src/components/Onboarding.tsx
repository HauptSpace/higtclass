import { createTable, instantiateTemplate, templateColumns, templatesFor, USE_CASES, type Op, type Template, type UseCase } from "@higtclass/core";
import { useState } from "react";
import { askAssistant, type AssistantFailure } from "../assistant.ts";
import { useT } from "../i18n/index.ts";
import { useStore } from "../store.ts";
import { ChangeList } from "./AssistantBar.tsx";
import { Hero } from "./Hero.tsx";
import { Button, inputClass } from "./ui.tsx";

// First run (and "New table"): what is Zifra for → tables that fit, each with
// why it beats a spreadsheet and when to pick it → or describe it in words.

const ICON_PATHS: Record<UseCase, string> = {
  // wallet
  personal: "M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h13V8H6.5A2.5 2.5 0 0 1 4 7.5ZM15.5 13.5h.01",
  // box
  trade: "M4 8l8-4 8 4v8l-8 4-8-4V8Zm0 0 8 4 8-4M12 12v8",
  // two people facing
  services: "M8.5 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm7 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM4 19c0-2.8 2-5 4.5-5s4.5 2.2 4.5 5M11 19c0-2.8 2-5 4.5-5S20 16.2 20 19",
  // checklist
  team: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  // bar chart
  finance: "M4 20h16M6 16v-4M10.5 16V8M15 16v-6M19.5 16V5",
  // plus
  other: "M12 5v14M5 12h14",
};

function UseCaseIcon({ id }: { id: UseCase }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON_PATHS[id]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function firstCreatedTable(ops: Op[]): string | null {
  for (const op of ops) {
    if (op.type === "table.create") return op.table.id;
    if (op.type === "batch") {
      const inner = firstCreatedTable(op.ops);
      if (inner) return inner;
    }
  }
  return null;
}

export function Onboarding({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const t = useT();
  const locale = useStore((s) => s.settings.locale);
  const settings = useStore((s) => s.settings);
  const ws = useStore((s) => s.ws);
  const dispatch = useStore((s) => s.dispatch);
  const setActiveTable = useStore((s) => s.setActiveTable);
  const [use, setUse] = useState<UseCase | null>(null);
  const [description, setDescription] = useState("");
  const [build, setBuild] = useState<
    { kind: "idle" } | { kind: "thinking" } | { kind: "preview"; ops: Op[] } | { kind: "failed"; failure: AssistantFailure }
  >({ kind: "idle" });

  const finish = (op: Op, tableId: string | null) => {
    if (dispatch(op, t("newTable.title")) && tableId) setActiveTable(tableId);
    onDone?.();
  };

  const pickTemplate = (tpl: Template | null) => {
    if (tpl) {
      const res = instantiateTemplate(tpl, locale, { locale });
      return finish(res.op, res.mainId);
    }
    const res = createTable({ name: t("newTable.untitled"), icon: "□", columns: [{ name: t("newTable.firstColumn"), type: "text" }] }, { locale });
    finish(res.op, res.table.id);
  };

  const describe = async () => {
    if (!description.trim()) return;
    setBuild({ kind: "thinking" });
    const res = await askAssistant({ message: description, mode: "build", workspace: ws, settings });
    if (!res.ok) return setBuild({ kind: "failed", failure: res.failure });
    setBuild({ kind: "preview", ops: res.ops });
  };

  const heading = compact ? "text-3xl md:text-4xl" : "text-4xl md:text-6xl";

  if (!use) {
    return (
      <div>
        {compact ? (
          <>
            <h1 className={`${heading} leading-[0.95] font-extrabold tracking-[-0.04em]`}>{t("onb.title")}</h1>
            <p className="mt-4 max-w-xl text-lg text-ink-2">{t("onb.subtitle")}</p>
          </>
        ) : (
          <>
            <Hero />
            <h2 className="mt-14 text-2xl font-extrabold tracking-tight md:text-3xl">{t("hero.or")}</h2>
          </>
        )}
        <div className="mt-6 grid border-t-2 border-rule sm:grid-cols-2">
          {USE_CASES.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setUse(u.id)}
              className={`group flex items-start gap-4 border-b border-line py-5 text-left transition hover:bg-soft sm:px-4 ${i % 2 === 0 ? "sm:border-r" : ""}`}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-ink transition group-hover:border-accent group-hover:bg-accent group-hover:text-on-accent">
                <UseCaseIcon id={u.id} />
              </span>
              <span>
                <span className="block text-xl font-bold">{u.name[locale]}</span>
                <span className="mt-0.5 block text-ink-2">{u.hint[locale]}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const templates = templatesFor(use);
  return (
    <div>
      <button type="button" onClick={() => setUse(null)} className="mb-4 font-semibold text-ink-2 hover:text-ink">
        ← {t("onb.back")}
      </button>
      <h1 className={`${heading} leading-[0.95] font-extrabold tracking-[-0.04em]`}>{t("onb.pickTitle")}</h1>
      <p className="mt-4 max-w-xl text-lg text-ink-2">{t("onb.pickSubtitle")}</p>

      <ul className="mt-8 border-t-2 border-rule">
        {templates.map((tpl) => (
          <li key={tpl.id} className="grid gap-4 border-b border-line py-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start md:gap-6">
            <div>
              <div className="text-2xl font-extrabold tracking-tight">{tpl.name[locale]}</div>
              <div className="mt-1 text-ink-2">{tpl.description[locale]}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {templateColumns(tpl, locale).map((c) => (
                  <span key={c.name} className="rounded-full bg-soft px-2.5 py-0.5 text-sm text-ink-2">
                    {c.name}
                  </span>
                ))}
              </div>
              {tpl.tables.length > 1 && (
                <div className="mt-2 text-sm font-semibold text-ink-2">
                  {t("onb.alsoCreates", { tables: tpl.tables.map((x) => x.name[locale]).join(" · ") })}
                </div>
              )}
            </div>
            <div>
              <div className="text-sm font-bold">{t("onb.why")}</div>
              <p className="mt-1 text-ink-2">{tpl.why[locale]}</p>
            </div>
            <div>
              <div className="text-sm font-bold">{t("onb.when")}</div>
              <p className="mt-1 text-ink-2">{tpl.when[locale]}</p>
            </div>
            <Button variant="primary" onClick={() => pickTemplate(tpl)} className="justify-self-start">
              {t("onb.use")}
            </Button>
          </li>
        ))}
      </ul>

      <section className="mt-10 max-w-3xl">
        <h2 className="text-2xl font-extrabold tracking-tight">{t("onb.describeTitle")}</h2>
        <p className="mt-1 text-ink-2">{t("onb.describeHint")}</p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={t("onb.describePlaceholder")}
          className={`${inputClass} mt-4 resize-y text-lg`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={describe} disabled={!description.trim() || build.kind === "thinking"}>
            {build.kind === "thinking" ? t("ai.thinking") : t("onb.describeButton")}
          </Button>
          <Button variant="ghost" onClick={() => pickTemplate(null)}>
            {t("onb.blank")}
          </Button>
        </div>
        {build.kind === "failed" && (
          <p role="alert" className="mt-3 font-medium text-late">
            {t(`ai.${build.failure}`)}
          </p>
        )}
        {build.kind === "preview" && (
          <div className="mt-6 border-t-2 border-rule pt-5">
            <ChangeList ops={build.ops} />
            {build.ops.length > 0 && (
              <div className="mt-5 flex gap-2">
                <Button variant="primary" onClick={() => finish({ type: "batch", ops: build.ops }, firstCreatedTable(build.ops))}>
                  {t("ai.save")}
                </Button>
                <Button variant="ghost" onClick={() => setBuild({ kind: "idle" })}>
                  {t("ai.discard")}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
