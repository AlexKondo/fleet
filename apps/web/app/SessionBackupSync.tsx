"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { writeSessionBackup, clearSessionBackup } from "@/lib/supabase/sessionBackup";

/**
 * Mounted in AppShell (every authenticated page) so a valid session's tokens are always
 * mirrored in localStorage for LoginRecovery.tsx to use — see sessionBackup.ts for why.
 */
export function SessionBackupSync() {
  useEffect(() => {
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

    return () => subscription.unsubscribe();
  }, []);

  return null;
}
