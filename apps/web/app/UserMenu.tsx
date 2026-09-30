"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "../lib/i18n/dictionaries";

/** Initials for the round avatar button — "Jaime Quadros" -> "JQ". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Round avatar button (initials) replacing the plain name/role text link — clicking it
 * opens a small menu to change password, edit personal data, or upload the driver's
 * license, instead of those living as separate unlinked destinations.
 */
export function UserMenu({
  userName,
  roleLabel,
  avatarUrl,
  dict,
}: {
  userName: string;
  roleLabel: string;
  avatarUrl?: string | null;
  dict: Dictionary;
}) {
  const t = dict.chrome.userMenu;
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

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={t.label}
        title={userName}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-line-800 bg-panel-800 text-xs font-semibold text-paper-50 hover:border-gwm-accent hover:text-gwm-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gwm-accent"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-uploaded avatar, arbitrary origin
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initials(userName)
        )}
      </button>

      {isOpen ? (
        <div
          role="menu"
          aria-label={t.label}
          className="absolute right-0 top-[calc(100%+8px)] z-50 flex w-56 flex-col rounded-md border border-line-800 bg-panel-900 py-1.5 shadow-lg shadow-black/40"
        >
          <div className="border-b border-line-800 px-3 pb-2">
            <p className="truncate text-sm text-paper-50">{userName}</p>
            <p className="text-xs uppercase tracking-widest text-fog-600">{roleLabel}</p>
          </div>
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setIsOpen(false)}
            className="px-3 py-2 text-sm text-fog-400 hover:bg-panel-800 hover:text-paper-50"
          >
            {t.changePassword}
          </Link>
          <Link
            href="/account/profile"
            role="menuitem"
            onClick={() => setIsOpen(false)}
            className="px-3 py-2 text-sm text-fog-400 hover:bg-panel-800 hover:text-paper-50"
          >
            {t.personalData}
          </Link>
          <Link
            href="/account/license"
            role="menuitem"
            onClick={() => setIsOpen(false)}
            className="px-3 py-2 text-sm text-fog-400 hover:bg-panel-800 hover:text-paper-50"
          >
            {t.license}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
