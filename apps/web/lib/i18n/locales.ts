export const LOCALES = ["pt-BR", "en-US", "es", "zh-CN"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "pt-BR";

export const LOCALE_LABELS: Record<Locale, string> = {
  "pt-BR": "Português",
  "en-US": "English",
  es: "Español",
  "zh-CN": "简体中文",
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
