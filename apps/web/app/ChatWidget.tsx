"use client";

import { useEffect, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import type { ChatState } from "./chat/actions";
import type { Dictionary } from "../lib/i18n/dictionaries";
import type { Locale } from "../lib/i18n/locales";

const HINT_SHOW_DELAY_MS = 2500;
const HINT_AUTO_HIDE_MS = 10_000;

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
  const [showHint, setShowHint] = useState(false);

  // Shows on every page load now (per explicit request) — no sessionStorage/dismissal
  // memory anymore, so it's not something a returning-within-the-same-tab user has to
  // wonder whether they already saw and lost.
  useEffect(() => {
    const showTimer = setTimeout(() => setShowHint(true), HINT_SHOW_DELAY_MS);
    return () => clearTimeout(showTimer);
  }, []);

  useEffect(() => {
    if (!showHint) return;
    const hideTimer = setTimeout(() => setShowHint(false), HINT_AUTO_HIDE_MS);
    return () => clearTimeout(hideTimer);
  }, [showHint]);

  function dismissHint() {
    setShowHint(false);
  }

  function toggle() {
    setIsOpen((v) => !v);
    setHasOpenedOnce(true);
    if (showHint) dismissHint();
  }

  return (
    <>
      {showHint && !isOpen ? (
        // Floats above the FAB rather than beside it — a second click target next to the
        // real button would just be a confusing duplicate. The robot is decorative;
        // clicking the bubble (or the robot) opens the chat, same as clicking the FAB.
        // A plain div (not a <button>) wraps everything because it contains a real nested
        // <button> for the dismiss X — a button can't validly contain another button.
        <div
          onClick={toggle}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggle()}
          role="button"
          tabIndex={0}
          aria-label={dict.chat.fabLabel}
          className="fixed bottom-24 right-2 z-40 flex cursor-pointer flex-col items-end gap-1 text-left"
        >
          <span
            role="status"
            className="animate-chat-hint-in relative max-w-[12.5rem] rounded-lg border border-line-800 bg-panel-900 px-3 py-2 text-xs text-paper-50 shadow-lg shadow-black/30"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                dismissHint();
              }}
              aria-label={dict.common.close}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line-800 bg-panel-800 text-fog-400 hover:text-paper-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3 w-3" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            {dict.chat.voiceHint}
            <span
              className="absolute -bottom-1.5 right-8 h-3 w-3 rotate-45 border-b border-r border-line-800 bg-panel-900"
              aria-hidden="true"
            />
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element -- small static illustration, next/image is overkill here */}
          <img
            src="/illustrations/fleet-agent.jpg"
            alt=""
            className="animate-chat-agent-float mr-2 h-14 w-14 rounded-full border-2 border-gwm-accent object-cover shadow-lg shadow-black/30"
          />
        </div>
      ) : null}

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
