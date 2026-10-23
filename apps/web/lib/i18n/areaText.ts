import { getLocale } from "./getLocale";
import type { Locale } from "./locales";

/**
 * Texts of ONE screen/area, written next to each other in the 4 languages (`lib/i18n/areas/<area>.ts`). Used by the screens
 * that were written with literal Portuguese; the shared dictionaries (`dictionaries/*.ts`) stay for the older screens.
 * The record type forces every language to define every key; `areas.test.ts` also checks placeholders and empty values.
 */
export type AreaTexts<K extends string> = Record<Locale, Record<K, string>>;

/** pt-BR is the fallback for any language a build does not know. */
export function areaText<K extends string>(texts: AreaTexts<K>, locale: Locale): Record<K, string> {
  return texts[locale] ?? texts["pt-BR"];
}

/** Server components: the texts in the language of the `fleet-locale` cookie. */
export async function getAreaText<K extends string>(texts: AreaTexts<K>): Promise<Record<K, string>> {
  return areaText(texts, await getLocale());
}

/** `{name}` placeholders: fmt("Faltam {km} km", { km: 10 }). */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
