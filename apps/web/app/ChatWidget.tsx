"use client";

import { useState } from "react";
import { ChatPanel } from "./ChatPanel";
import type { Dictionary } from "../lib/i18n/dictionaries";

/**
 * Global floating chat entry point, mounted once in AppShell.tsx (alongside
 * InactivityLogout/SessionBackupSync, not inside the header) so it isn't duplicated
 * between the desktop header and MobileNav the way NotificationBell is — a single FAB
 * fixed to the viewport corner works identically at every breakpoint.
 */
export function ChatWidget({ dict }: { dict: Dictionary }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={dict.chat.fabLabel}
        title={dict.chat.fabLabel}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-gwm-accent text-ink-950 shadow-lg shadow-black/30 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gwm-accent"
      >
        {isOpen ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M4 12a8 8 0 1 1 3.2 6.4L4 20l1.1-3.3A7.96 7.96 0 0 1 4 12Z" />
          </svg>
        )}
      </button>

      {isOpen ? <ChatPanel dict={dict} onClose={() => setIsOpen(false)} /> : null}
    </>
  );
}
