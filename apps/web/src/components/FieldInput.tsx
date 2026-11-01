import { cellText, formatDateNumeric, parseDate, rowLabel, type Column, type Table } from "@sumira/core";
import { useId, useMemo, useRef, useState } from "react";
import { readPhoto } from "../assistant.ts";
import { useT } from "../i18n/index.ts";
import { dateExample, useToday } from "../lib.ts";
import { useStore } from "../store.ts";
import { inputClass, optionColor, useDismiss } from "./ui.tsx";

// One input per column type. Values are kept as the text the user typed and
// parsed by the core on save, so "5к", "вчера" or "03.10" work everywhere.

export function FieldInput({
  column,
  value,
  onChange,
  autoFocus,
  onEnter,
  onEscape,
  compact,
  options,
}: {
  column: Column;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  onEnter?: () => void;
  onEscape?: () => void;
  compact?: boolean;
  /** Choices to offer instead of all of the column's (e.g. only income categories). */
  options?: string[];
}) {
  const t = useT();
  const listId = useId();
  const cls = compact ? `${inputClass} !rounded-lg !border-ink !py-1.5` : inputClass;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      onEnter();
    } else if (e.key === "Escape" && onEscape) {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
    }
  };

  switch (column.type) {
    case "link":
      return <LinkPicker column={column} value={value} onChange={onChange} autoFocus={autoFocus} onEnter={onEnter} onEscape={onEscape} compact={compact} />;
    case "checkbox":
      return (
        <button
          type="button"
          role="switch"
          aria-checked={value === "1"}
          aria-label={column.name}
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          onClick={() => onChange(value === "1" ? "" : "1")}
          className={`relative h-7 w-12 rounded-full transition ${value === "1" ? "bg-accent" : "bg-line"}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${value === "1" ? "left-6" : "left-1"}`} />
        </button>
      );
    case "photo":
      return <PhotoInput value={value} onChange={onChange} compact={compact} label={column.name} />;
    case "date":
      return <DateInput value={value} onChange={onChange} autoFocus={autoFocus} onKeyDown={onKeyDown} cls={cls} label={column.name} />;
    case "select": {
      const list = options ?? column.options ?? [];
      return (
        <>
          <input
            className={cls}
            list={listId}
            value={value}
            placeholder={t("select.placeholder")}
            aria-label={column.name}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus={autoFocus}
          />
          <datalist id={listId}>
            {list.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          {!compact && list.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {list.map((o) => {
                const on = value.toLowerCase() === o.toLowerCase();
                const color = optionColor(column, o);
                return (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange(o)}
                    className={`inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-semibold transition ${
                      on ? "border-ink bg-ink text-paper" : "border-line text-ink hover:border-ink"
                    }`}
                  >
                    {color && <i className="h-2 w-2 shrink-0" style={{ background: color }} />}
                    {o}
                  </button>
                );
              })}
            </div>
          )}
        </>
      );
    }
    case "number":
    case "money":
      return (
        <input
          className={`${cls} tabular`}
          inputMode="decimal"
          value={value}
          aria-label={column.name}
          placeholder={column.type === "money" ? "0" : ""}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
        />
      );
    default:
      return (
        <input className={cls} value={value} aria-label={column.name} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} autoFocus={autoFocus} />
      );
  }
}

/** A receipt photo: taken or picked, shrunk on the device, kept with the entry. */
function PhotoInput({ value, onChange, compact, label }: { value: string; onChange: (v: string) => void; compact?: boolean; label: string }) {
  const t = useT();
  const file = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {value && (
        <a href={value} target="_blank" rel="noreferrer" title={label}>
          <img src={value} alt={label} className={`${compact ? "h-8 w-8" : "h-24 w-24"} rounded-lg border-2 border-line object-cover`} />
        </a>
      )}
      <button type="button" onClick={() => file.current?.click()} className="rounded-xl border-2 border-ink px-3 py-1.5 text-sm font-bold hover:bg-soft">
        📷 {value ? t("photo.replace") : t("photo.add")}
      </button>
      {value && (
        <button type="button" onClick={() => onChange("")} className="text-sm font-semibold text-ink-2 hover:text-late">
          {t("photo.remove")}
        </button>
      )}
      {failed && <span className="text-sm font-semibold text-late">{t("photo.failed")}</span>}
      <input
        ref={file}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const photo = await readPhoto(f, 1200);
            setFailed(false);
            onChange(photo.previewUrl);
          } catch {
            setFailed(true);
          }
        }}
      />
    </div>
  );
}

/**
 * A date typed the way people write it — "03.10", "вчора", "gestern" — with a
 * calendar button for picking. Never the browser's own field, whose format
 * follows the browser rather than the person.
 */
function DateInput({
  value,
  onChange,
  autoFocus,
  onKeyDown,
  cls,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  onKeyDown: (e: React.KeyboardEvent) => void;
  cls: string;
  label: string;
}) {
  const t = useT();
  const locale = useStore((s) => s.settings.locale);
  const today = useToday();
  const picker = useRef<HTMLInputElement>(null);
  const parsed = value ? parseDate(value, locale) : null;
  const iso = parsed ?? (value ? null : today);
  return (
    <div className="relative">
      <input
        className={`${cls} pr-11`}
        value={value}
        aria-label={label}
        placeholder={dateExample(locale)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        aria-invalid={value !== "" && !parsed}
      />
      <button
        type="button"
        aria-label={t("date.pick")}
        title={t("date.pick")}
        onClick={() => {
          const el = picker.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
        className="absolute inset-y-0 right-1 my-auto grid h-8 w-9 place-items-center rounded-lg text-ink-2 hover:bg-soft hover:text-ink"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute right-2 bottom-0 h-0 w-0 opacity-0"
        value={iso ?? ""}
        onChange={(e) => e.target.value && onChange(formatDateNumeric(e.target.value, locale))}
      />
    </div>
  );
}

/** Pick a row of the linked table by typing part of its name; shows a couple of its details. */
function LinkPicker({
  column,
  value,
  onChange,
  autoFocus,
  onEnter,
  onEscape,
  compact,
}: {
  column: Column;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  onEnter?: () => void;
  onEscape?: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const ws = useStore((s) => s.ws);
  const settings = useStore((s) => s.settings);
  const target = ws.tables.find((tb) => tb.id === column.linkTableId);
  const selected = target?.rows.find((r) => r.id === value);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, open, () => {
    setOpen(false);
    setQuery(null);
  });

  const items = useMemo(() => {
    if (!target) return [];
    const q = (query ?? "").trim().toLowerCase();
    const details = detailColumns(target);
    return target.rows
      .map((r) => {
        const label = rowLabel(target, r, settings);
        const extra = details.map((c) => cellText(ws, target, c, r.values[c.id], settings)).filter(Boolean);
        return { id: r.id, label, extra: extra.join(" · ") };
      })
      .filter((x) => !q || x.label.toLowerCase().includes(q) || x.extra.toLowerCase().includes(q))
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, 50);
  }, [target, query, ws, settings]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery(null);
  };

  const cls = compact ? `${inputClass} !rounded-lg !border-ink !py-1.5` : inputClass;
  const shown = query ?? (selected && target ? rowLabel(target, selected, settings) : "");
  return (
    <div ref={box} className="relative">
      <input
        className={cls}
        value={shown}
        aria-label={column.name}
        placeholder={t("link.search")}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
          if (!e.target.value) onChange("");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && items[active] && query !== null) pick(items[active].id);
            else onEnter?.();
          } else if (e.key === "Escape") {
            if (open) {
              e.stopPropagation();
              setOpen(false);
              setQuery(null);
            } else onEscape?.();
          }
        }}
      />
      {open && (
        <ul role="listbox" className="absolute z-40 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-xl border-2 border-ink bg-paper p-1 shadow-xl">
          {items.length === 0 && <li className="px-3 py-2 text-sm text-ink-2">{t("link.none")}</li>}
          {items.map((x, i) => (
            <li key={x.id} role="option" aria-selected={x.id === value}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(x.id)}
                className={`block w-full rounded-lg px-3 py-1.5 text-left ${i === active ? "bg-soft" : ""} ${x.id === value ? "font-bold" : ""}`}
              >
                <span className="block truncate">{x.label}</span>
                {x.extra && <span className="block truncate text-xs text-ink-2">{x.extra}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Columns that help tell linked rows apart: a code, a price, a city. */
export function detailColumns(table: Table): Column[] {
  const primary = table.columns.find((c) => c.type === "text");
  return table.columns.filter((c) => c !== primary && ["text", "money", "select", "formula", "rollup"].includes(c.type)).slice(0, 2);
}
