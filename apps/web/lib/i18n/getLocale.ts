import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales";
import { dictionaries, type Dictionary } from "./dictionaries";

export const LOCALE_COOKIE = "fleet-locale";

/** Server-side helper — reads the persisted locale cookie (Server Components can't
 * read localStorage), falling back to the default when unset or invalid. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getDictionary(): Promise<Dictionary> {
  const locale = await getLocale();
  return dictionaries[locale];
}
