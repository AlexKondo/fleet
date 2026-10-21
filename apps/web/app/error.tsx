"use client";

import { dictionaries } from "../lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale } from "../lib/i18n/locales";
import "./carpool/fm-theme.css";

/** This boundary is a route-level client component: Next.js only ever passes it
 * `error`/`reset`, so there's no Server Component parent to receive `dict` from. The
 * locale lives in a plain (non-httpOnly) cookie, so read it from `document.cookie` —
 * same source of truth as the server helper, no extra dependency. */
function useErrorDictionary() {
  const match =
    typeof document !== "undefined"
      ? /(?:^|;\s*)fleet-locale=([^;]*)/.exec(document.cookie)?.[1]
      : undefined;
  const value = match ? decodeURIComponent(match) : undefined;
  return dictionaries[isLocale(value) ? value : DEFAULT_LOCALE];
}

/**
 * Root error boundary. Catches any otherwise-uncaught error thrown while rendering a
 * Server Component — most relevantly here, MissingEnvVarError from a misconfigured
 * deploy target, which would otherwise reach the visitor as Next.js's generic
 * "a server-side exception has occurred" page with no way back. Next.js redacts
 * `error.message` in production builds before it ever reaches this component (by
 * design, so server-side details never leak to the browser), so this can only show a
 * generic message — the specific cause still goes to the server logs via each call
 * site's own `console.error`, `digest` is the pointer between the two.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const dict = useErrorDictionary();

  // FIX-VISUAL: FleetMind look (scoped .fm-theme tokens + fm-card/fm-btn) instead of the legacy dark panel. No shell:
  // this boundary has no server data (role/nav) to render one with. Same texts, same digest, same retry.
  return (
    <div className="fm-theme">
      <main className="flex min-h-dvh w-full items-center justify-center px-6">
        <div className="fm-card w-full max-w-md p-8 text-center">
          <p className="fm-title">FleetMind</p>
          <p className="mt-4 text-sm">{dict.appError.title}</p>
          <p className="fm-subtitle text-sm">{dict.appError.description}</p>
          {error.digest ? (
            <p className="fm-subtitle font-mono text-xs">
              {dict.appError.code} {error.digest}
            </p>
          ) : null}
          <button type="button" onClick={reset} className="fm-btn fm-btn-primary mt-6">
            {dict.appError.retry}
          </button>
        </div>
      </main>
    </div>
  );
}
