"use client";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";

/** Route-level client boundary: reads the same locale cookie as the server helper. */
function useCommandCenterDictionary() {
  const match =
    typeof document !== "undefined"
      ? /(?:^|;\s*)fleet-locale=([^;]*)/.exec(document.cookie)?.[1]
      : undefined;
  const value = match ? decodeURIComponent(match) : undefined;
  return dictionaries[isLocale(value) ? value : DEFAULT_LOCALE].commandCenter;
}
export default function CommandCenterError({ reset }: { reset: () => void }) {
  const t = useCommandCenterDictionary();
  return (
    <div
      role="alert"
      style={{
        padding: 32,
        color: "#08163d",
        background: "#f3f8fe",
        minHeight: "100vh",
      }}
    >
      <h1>{t.loadError}</h1>
      <p>{t.loadErrorHint}</p>
      <button
        onClick={reset}
        style={{
          marginTop: 16,
          padding: "12px 20px",
          background: "#0068ff",
          color: "white",
          border: 0,
          borderRadius: 6,
        }}
      >
        {t.retry}
      </button>
    </div>
  );
}
