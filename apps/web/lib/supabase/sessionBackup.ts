"use client";

/**
 * Browser-local backup of the current session's tokens, used to recover from a known
 * Next.js/Vercel bug (vercel/next.js#78831) where a Server Action that runs long enough
 * intermittently makes middleware see no user for that request and clear the real,
 * cookie-based session — bouncing an actually-authenticated user to /login and losing
 * whatever they were doing. See SessionBackupSync.tsx (keeps this in sync) and
 * LoginRecovery.tsx (uses it to silently restore the real session on /login).
 */

const STORAGE_KEY = "fleet.session-backup.v1";

interface SessionBackup {
  access_token: string;
  refresh_token: string;
}

export function writeSessionBackup(session: SessionBackup): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }),
    );
  } catch {
    // localStorage unavailable (private browsing, disabled storage) — recovery just won't
    // be available; the user falls back to a normal re-login.
  }
}

export function readSessionBackup(): SessionBackup | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionBackup>;
    if (typeof parsed.access_token === "string" && typeof parsed.refresh_token === "string") {
      return { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearSessionBackup(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
