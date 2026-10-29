import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "outline" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:opacity-90",
  outline: "border-2 border-ink text-ink hover:bg-soft",
  ghost: "text-ink-2 hover:bg-soft hover:text-ink",
  danger: "text-late hover:bg-soft",
};

export function Button({
  variant = "outline",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[15px] font-bold transition disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    />
  );
}

/** Modal: centered on desktop, bottom sheet on phones. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-paper text-ink shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"}`}
      >
        <div className="flex items-start justify-between gap-4 border-b-2 border-rule px-6 pt-6 pb-4">
          <h2 className="text-2xl leading-tight font-extrabold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 rounded-lg px-2 py-1 text-xl leading-none text-ink-2 hover:bg-soft hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Label({ text, hint, children }: { text: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink-2">{text}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-ink-2">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border-2 border-line bg-paper px-3.5 py-2.5 text-base text-ink outline-none transition placeholder:text-ink-2/70 focus:border-ink";

/** Status colour for a select value, used for squares in the grid and cards. */
export function statusColor(value: string): string | null {
  const v = value.toLowerCase();
  if (/(оплач|paid|bezahlt|pagad|готов|done|fertig|listo|hecho|erledigt|верну|повер|settled|beglichen|devuel|постоян|regular|stamm|habitual)/.test(v)) return "var(--paid)";
  if (/(ждёт|ждет|чека|wait|offen|pendient|надо|треба|to do|review|провер|перевір|prüf|revisi)/.test(v)) return "var(--wait)";
  if (/(просроч|overdue|late|überfällig|vencid|отмен|скасов|cancel|storn|ушёл|пішов|lost|verloren|perdid)/.test(v)) return "var(--late)";
  if (/(работ|робот|progress|arbeit|curso)/.test(v)) return "var(--work)";
  return null;
}
