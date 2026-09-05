"use client";

import { useEffect, useRef } from "react";
import { signOut } from "./dashboard/actions";

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
// How often to check elapsed time against the last-activity timestamp. Coarser than the
// timeout itself on purpose — the actual sign-out lags the real 10-minute mark by at most
// this long, which is an acceptable trade for not running a check every second.
const CHECK_INTERVAL_MS = 15_000;
// Shared across every tab of this app (localStorage, not per-tab state) so being active
// in one tab keeps every other open tab's session alive too — otherwise a tab left open
// in the background would sign itself out from under someone still working in another.
const STORAGE_KEY = "fleet:lastActivityAt";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

/**
 * Signs the user out after TIMEOUT_MS with no mouse/keyboard/scroll/touch activity in any
 * tab of this app. Mounted once in AppShell, which only ever renders for an already
 * -authenticated user (every page using it redirects to /login first if there's no
 * session), so this never needs its own auth check.
 */
export function InactivityLogout() {
  const lastWriteRef = useRef(0);

  useEffect(() => {
    const markActivity = () => {
      const now = Date.now();
      // Throttled — no need to touch localStorage on every single mousemove/scroll tick.
      if (now - lastWriteRef.current > 1000) {
        lastWriteRef.current = now;
        localStorage.setItem(STORAGE_KEY, String(now));
      }
    };
    markActivity();

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, markActivity, { passive: true });
    }

    const interval = setInterval(() => {
      const lastActivity = Number(localStorage.getItem(STORAGE_KEY) ?? Date.now());
      if (Date.now() - lastActivity >= TIMEOUT_MS) {
        signOut();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, markActivity);
      }
      clearInterval(interval);
    };
  }, []);

  return null;
}
