import { useEffect } from "react";
import { useT } from "../i18n/index.ts";
import { useStore } from "../store.ts";

export function Toast() {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const hide = useStore((s) => s.hideToast);
  const undo = useStore((s) => s.undo);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(hide, 5000);
    return () => clearTimeout(id);
  }, [toast, hide]);

  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 md:bottom-6">
      <div
        key={toast.id}
        className="pointer-events-auto flex max-w-md items-center gap-4 rounded-2xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-xl dark:bg-zinc-100 dark:text-zinc-900"
      >
        <span>{toast.text}</span>
        {toast.undoable && (
          <button
            type="button"
            className="font-semibold text-brand-100 dark:text-brand-700"
            onClick={() => {
              undo();
              hide();
            }}
          >
            {t("undo.undo")}
          </button>
        )}
      </div>
    </div>
  );
}
