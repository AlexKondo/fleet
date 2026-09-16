"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALES, LOCALE_LABELS, type Locale } from "../../lib/i18n/locales";
import { setLocale } from "../actions/setLocale";
import type { Dictionary } from "../../lib/i18n/dictionaries";

/** Native <select> — accessible, no extra dependency, matches the flat/no-shadow
 * component style of Button/Input. Persists via a server action that sets the
 * `fleet-locale` cookie (readable by the Server Component tree), then refreshes
 * the route so server-rendered strings re-render in the new language. */
export function LanguageToggle({
  locale,
  dict,
  className = "",
}: {
  locale: Locale;
  dict: Dictionary;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={locale}
      disabled={pending}
      aria-label={dict.chrome.language}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(async () => {
          await setLocale(next);
          router.refresh();
        });
      }}
      className={`h-8 rounded-sm border border-line-800 bg-panel-900 px-2 text-xs uppercase tracking-widest text-fog-400 outline-none hover:border-signal-amber hover:text-signal-amber focus-visible:border-signal-amber focus-visible:ring-1 focus-visible:ring-signal-amber ${className}`}
    >
      {LOCALES.map((code) => (
        <option key={code} value={code}>
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  );
}
