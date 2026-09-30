"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_LABELS, type Locale } from "../../lib/i18n/locales";
import { setLocale } from "../actions/setLocale";
import type { Dictionary } from "../../lib/i18n/dictionaries";

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

/** Icon-button dropdown, matching ThemeToggle's square border-box style and UserMenu's
 * open/close pattern — replaces the previous native <select> that always showed the
 * current language as text (e.g. "PORTUGUÊS"), inconsistent with every other header
 * control being a plain icon. */
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
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function pick(next: Locale) {
    setIsOpen(false);
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={dict.chrome.language}
        title={LOCALE_LABELS[locale]}
        className="flex h-8 w-8 items-center justify-center rounded-sm border border-line-800 text-fog-400 hover:border-gwm-accent hover:text-gwm-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gwm-accent disabled:opacity-50"
      >
        <GlobeIcon className="h-4 w-4" />
      </button>

      {isOpen ? (
        <div
          role="menu"
          aria-label={dict.chrome.language}
          className="absolute right-0 top-[calc(100%+8px)] z-50 flex w-40 flex-col rounded-md border border-line-800 bg-panel-900 py-1.5 shadow-lg shadow-black/40"
        >
          {LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={code === locale}
              onClick={() => pick(code)}
              className={`px-3 py-2 text-left text-sm hover:bg-panel-800 hover:text-paper-50 ${
                code === locale ? "text-gwm-accent" : "text-fog-400"
              }`}
            >
              {LOCALE_LABELS[code]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
