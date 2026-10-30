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
    // Top of the screen: at the bottom it covered the "Save and add another" button.
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] flex justify-center px-4" role="status">
      <div key={toast.id} className="pointer-events-auto flex max-w-md items-center gap-5 rounded-xl bg-ink px-5 py-3.5 font-semibold text-paper shadow-2xl">
        <span>{toast.text}</span>
        {toast.undoable && (
          <button
            type="button"
            className="font-extrabold underline underline-offset-4"
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
