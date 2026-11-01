import type { Locale } from "@sumira/core";
import { useStore } from "../store.ts";
import { de } from "./de.ts";
import { en, type MessageKey, type Messages } from "./en.ts";
import { es } from "./es.ts";
import { ru } from "./ru.ts";
import { uk } from "./uk.ts";

const DICTIONARIES: Record<Locale, Messages> = { ru, uk, en, de, es };

export const LANGUAGE_NAMES: Record<Locale, string> = {
  ru: "Русский",
  uk: "Українська",
  en: "English",
  de: "Deutsch",
  es: "Español",
};

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const dict = DICTIONARIES[locale];
  return (key, vars) => {
    let s: string = dict[key] ?? en[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export function useT(): Translate {
  const locale = useStore((s) => s.settings.locale);
  return translator(locale);
}

export type { MessageKey };
