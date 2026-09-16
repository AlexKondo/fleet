"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { readSessionBackup, clearSessionBackup } from "@/lib/supabase/sessionBackup";
import type { Dictionary } from "../../lib/i18n/dictionaries";

/**
 * Silently retries a browser-local session backup before showing the login form — see
 * sessionBackup.ts for why this exists (vercel/next.js#78831: a slow-enough Server Action
 * can make middleware wrongly see no user and clear an actually-valid session). A real,
 * deliberate sign-out revokes the refresh token server-side (dashboard/actions.ts's
 * signOut), so setSession() below naturally fails and falls through to the normal login
 * form in that case — this only fires for the spurious bounce.
 */
export function LoginRecovery({ dict, children }: { dict: Dictionary; children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const backup = readSessionBackup();
    if (!backup) {
      setChecking(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    supabase.auth
      .setSession({ access_token: backup.access_token, refresh_token: backup.refresh_token })
      .then(({ data, error }) => {
        if (data.session && !error) {
          // Full navigation, not router.push — middleware needs to see the cookie
          // setSession() just wrote via document.cookie on a fresh request.
          window.location.href = "/dashboard";
          return;
        }
        clearSessionBackup();
        setChecking(false);
      })
      .catch(() => {
        clearSessionBackup();
        setChecking(false);
      });
  }, []);

  if (checking) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <p className="text-xs uppercase tracking-widest text-fog-600">{dict.auth.verifyingSession}</p>
      </main>
    );
  }

  return <>{children}</>;
}
