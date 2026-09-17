"use client";

import { useEffect } from "react";
import { writeSessionBackup, clearSessionBackup } from "@/lib/supabase/sessionBackup";

/**
 * Mounted in AppShell (every authenticated page) so a valid session's tokens are always
 * mirrored in localStorage for LoginRecovery.tsx to use — see sessionBackup.ts for why.
 *
 * The Supabase client is pulled in with a dynamic `import()` rather than a top-level one
 * on purpose. This component renders on every authenticated screen, so a static import
 * put `@supabase/ssr` + `@supabase/supabase-js` (~70 kB) into the First Load JS of every
 * route in the app — blocking bytes on the critical path for a background task that only
 * mirrors tokens into localStorage and never affects what the user sees. Loading it as an
 * async chunk after hydration is strictly better here: nothing on screen depends on it.
 */
export function SessionBackupSync() {
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    import("@/lib/supabase/client").then(({ createSupabaseBrowserClient }) => {
      if (cancelled) return;
      const supabase = createSupabaseBrowserClient();

      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) writeSessionBackup(session);
      });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        if (session) {
          writeSessionBackup(session);
        } else if (event === "SIGNED_OUT") {
          clearSessionBackup();
        }
      });

      // The effect may already have been torn down while the chunk was in flight.
      if (cancelled) subscription.unsubscribe();
      else unsubscribe = () => subscription.unsubscribe();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return null;
}
