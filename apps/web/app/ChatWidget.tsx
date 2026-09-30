"use client";

import { useState } from "react";
import { ChatPanel } from "./ChatPanel";
import type { ChatState } from "./chat/actions";
import type { Dictionary } from "../lib/i18n/dictionaries";
import type { Locale } from "../lib/i18n/locales";

/**
 * Global floating chat entry point, mounted once in AppShell.tsx (alongside
 * InactivityLogout/SessionBackupSync, not inside the header) so it isn't duplicated
 * between the desktop header and MobileNav the way NotificationBell is — a single FAB
 * fixed to the viewport corner works identically at every breakpoint.
 */
export function ChatWidget({
  dict,
  locale,
  initialState,
}: {
  dict: Dictionary;
  locale: Locale;
  /** The caller's most recent conversation, fetched server-side (AppShell.tsx) — without
   * this, reloading the page (a fresh React tree, unlike just closing/reopening the panel)
   * always started a brand new conversation even if the previous one was mid-exchange. */
  initialState: ChatState;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // Once the panel has been opened at least once, it stays mounted (just hidden) instead
  // of unmounting on close — ChatPanel's useActionState conversation lives in that
  // component's own React state, so an unmount/remount (the previous behavior) silently
  // threw away the whole conversation the moment someone closed the panel to do something
  // else and came back.
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);

  function toggle() {
    setIsOpen((v) => !v);
    setHasOpenedOnce(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
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

      {hasOpenedOnce ? (
        <ChatPanel
          dict={dict}
          locale={locale}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          initialState={initialState}
        />
      ) : null}
    </>
  );
}
