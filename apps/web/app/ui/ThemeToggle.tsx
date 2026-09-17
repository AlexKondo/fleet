"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "../../lib/i18n/dictionaries";

function SunIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
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
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

/** Reads/writes the `data-theme` attribute set on <html> (see layout.tsx's blocking
 * init script). Mounted client-only; starts undefined to avoid a hydration mismatch,
 * then syncs from the DOM once mounted. */
export function ThemeToggle({ dict, className = "" }: { dict: Dictionary; className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    updateThemeColorMeta(next);
    // Cookie is the source of truth (readable server-side by layout.tsx, so the very
    // next navigation — including straight after login — renders in the right theme
    // without a client-side flash-fix). localStorage is kept as a same-tab fallback only.
    try {
      document.cookie = `fleet-theme=${next}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // ignore (cookies blocked)
    }
    try {
      localStorage.setItem("fleet-theme", next);
    } catch {
      // ignore (private mode / storage blocked)
    }
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dict.chrome.theme}
      title={dict.chrome.theme}
      className={`flex h-8 w-8 items-center justify-center rounded-sm border border-line-800 text-fog-400 hover:border-gwm-accent hover:text-gwm-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gwm-accent ${className}`}
    >
      {theme === null ? null : isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}

/** Keeps the mobile browser chrome (status bar / address bar) color in sync with the
 * manually-toggled theme — the static `viewport.themeColor` in layout.tsx only covers
 * the initial paint. */
function updateThemeColorMeta(theme: "light" | "dark") {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#000000" : "#ffffff");
}
