import { cache } from "react";
import { headers } from "next/headers";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { VERIFIED_USER_EMAIL_HEADER, VERIFIED_USER_ID_HEADER } from "./headers";

export interface CurrentUser {
  id: string;
  email: string | null;
}

/**
 * The signed-in user for the current request, without a second auth round trip.
 *
 * Middleware (lib/supabase/middleware.ts) already called `supabase.auth.getUser()` — a
 * full network round trip to Supabase's auth API — for every protected route, and
 * forwards the verified id/email as request headers it strips from any inbound request
 * first. Reading them here is pure header parsing: zero network. Every page.tsx that
 * previously started with its own `await supabase.auth.getUser()` was paying for that
 * same round trip a second time, serialized in front of every query it then ran.
 *
 * Falls back to a real `getUser()` when the headers are absent — middleware failing open
 * on a missing env var (see middleware.ts), or any render path middleware didn't match —
 * so the auth check is never silently skipped. Note the headers only ever carry an
 * *identity*: authorization still comes from the profiles row + RLS, exactly as before.
 */
export const getCurrentUser = cache(
  async (supabase: TypedSupabaseClient): Promise<CurrentUser | null> => {
    const headerList = await headers();
    const id = headerList.get(VERIFIED_USER_ID_HEADER);
    if (id) {
      return { id, email: headerList.get(VERIFIED_USER_EMAIL_HEADER) };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? { id: user.id, email: user.email ?? null } : null;
  },
);
