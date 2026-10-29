import { createTable, TEMPLATES, type Template } from "@higtclass/core";
import { useT } from "../i18n/index.ts";
import { useStore } from "../store.ts";
import { Dialog } from "./ui.tsx";

export function TemplateGrid({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const locale = useStore((s) => s.settings.locale);
  const dispatch = useStore((s) => s.dispatch);
  const setActiveTable = useStore((s) => s.setActiveTable);

  const create = (tpl: Template | null) => {
    const res = createTable(
      tpl
        ? { name: tpl.name[locale], icon: tpl.icon, columns: tpl.columns(locale) }
        : { name: t("newTable.untitled"), icon: "📋", columns: [{ name: t("type.text"), type: "text" }] },
      { locale },
    );
    if (dispatch(res.op, t("newTable.title"))) setActiveTable(res.table.id);
    onDone?.();
  };

  const card =
    "flex items-start gap-3 rounded-2xl bg-white p-4 text-left ring-1 ring-zinc-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-500 dark:bg-zinc-900 dark:ring-zinc-800";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {TEMPLATES.map((tpl) => (
        <button key={tpl.id} type="button" className={card} onClick={() => create(tpl)}>
          <span className="text-3xl leading-none">{tpl.icon}</span>
          <span>
            <span className="block font-semibold">{tpl.name[locale]}</span>
            <span className="block text-sm text-zinc-500">{tpl.description[locale]}</span>
          </span>
        </button>
      ))}
      <button type="button" className={`${card} border-2 border-dashed border-zinc-200 ring-0 dark:border-zinc-700`} onClick={() => create(null)}>
        <span className="text-3xl leading-none">＋</span>
        <span>
          <span className="block font-semibold">{t("newTable.blank")}</span>
          <span className="block text-sm text-zinc-500">{t("newTable.blankDesc")}</span>
        </span>
      </button>
    </div>
  );
}

export function NewTableDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t("newTable.title")}>
      <TemplateGrid onDone={onClose} />
    </Dialog>
  );
}
