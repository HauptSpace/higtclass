import { useEffect, useState } from "react";
import { NewTableDialog, TemplateGrid } from "./components/NewTableDialog.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { TableView } from "./components/TableView.tsx";
import { Toast } from "./components/Toast.tsx";
import { useT } from "./i18n/index.ts";
import { useActiveTable, useStore } from "./store.ts";

export function App() {
  const t = useT();
  const table = useActiveTable();
  const locale = useStore((s) => s.settings.locale);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const [newTable, setNewTable] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Ctrl/Cmd+Z everywhere except while typing in a field (the browser's own
  // text undo wins there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <div className="flex h-dvh">
      <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white md:block dark:border-zinc-800 dark:bg-zinc-950">
        <Sidebar onNewTable={() => setNewTable(true)} />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-zinc-950/40" />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-2xl dark:bg-zinc-950" onClick={(e) => e.stopPropagation()}>
            <Sidebar
              onNewTable={() => {
                setDrawer(false);
                setNewTable(true);
              }}
              onNavigate={() => setDrawer(false)}
            />
          </aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 md:hidden dark:border-zinc-800">
          <button type="button" className="rounded-lg p-2 text-xl" onClick={() => setDrawer(true)} aria-label={t("sidebar.tables")}>
            ☰
          </button>
          <span className="font-extrabold tracking-tight">
            higt<span className="text-brand-600">class</span>
          </span>
        </div>
        {table ? (
          <TableView key={table.id} table={table} />
        ) : (
          <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-10">
            <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">{t("empty.title")}</h1>
            <p className="mt-3 mb-8 text-zinc-500">{t("empty.subtitle")}</p>
            <TemplateGrid />
          </div>
        )}
      </main>

      <NewTableDialog open={newTable} onClose={() => setNewTable(false)} />
      <Toast />
    </div>
  );
}
