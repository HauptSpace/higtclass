import type { Column } from "@higtclass/core";
import { useId } from "react";
import { useT } from "../i18n/index.ts";
import { inputClass } from "./ui.tsx";

// One input per column type. Values are kept as the text the user typed and
// parsed by the core on save, so "5к" or "вчера" work everywhere.

export function FieldInput({
  column,
  value,
  onChange,
  autoFocus,
  onEnter,
  compact,
}: {
  column: Column;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  onEnter?: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const listId = useId();
  const cls = compact ? `${inputClass} !rounded-lg !border-ink !py-1.5` : inputClass;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      onEnter();
    }
  };

  switch (column.type) {
    case "checkbox":
      return (
        <button
          type="button"
          role="switch"
          aria-checked={value === "1"}
          autoFocus={autoFocus}
          onClick={() => onChange(value === "1" ? "" : "1")}
          className={`relative h-7 w-12 rounded-full transition ${value === "1" ? "bg-accent" : "bg-line"}`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${value === "1" ? "left-6" : "left-1"}`}
          />
        </button>
      );
    case "date":
      return (
        <input
          type="date"
          className={cls}
          value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
        />
      );
    case "select":
      return (
        <>
          <input
            className={cls}
            list={listId}
            value={value}
            placeholder={t("select.placeholder")}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus={autoFocus}
          />
          <datalist id={listId}>
            {(column.options ?? []).map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          {!compact && (column.options?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {column.options!.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => onChange(o)}
                  className={`rounded-full border-2 px-3 py-1 text-sm font-semibold transition ${
                    value.toLowerCase() === o.toLowerCase()
                      ? "border-ink bg-ink text-paper"
                      : "border-line text-ink hover:border-ink"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
        </>
      );
    case "number":
    case "money":
      return (
        <input
          className={`${cls} tabular`}
          inputMode="decimal"
          value={value}
          placeholder={column.type === "money" ? "0" : ""}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
        />
      );
    default:
      return (
        <input
          className={cls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
        />
      );
  }
}
