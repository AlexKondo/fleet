"use client";

import { useRouter } from "next/navigation";
import type { Dictionary } from "../lib/i18n/dictionaries";

/** `router.back()` rather than a fixed href — this page can be reached from more than one
 * place (the user menu, a redirect after upload, etc.), and a hardcoded destination would
 * be wrong for at least one of them. */
export function BackButton({ dict, className = "" }: { dict: Dictionary; className?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className={`mb-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:text-paper-50 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {dict.common.back}
    </button>
  );
}
