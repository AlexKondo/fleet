import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database, TypedSupabaseClient } from "@fleet/supabase-client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/**
 * A Supabase client that is signed in AS the given member, built server-side without their password: the admin API creates a one-time
 * sign-in token for their e-mail (nothing is sent), it is exchanged for a short-lived access token, and the returned client carries only
 * that token (no refresh, nothing stored). Used by the WhatsApp channel after the sender's phone number identified the member; every query
 * then runs under THEIR row-level security. Fails closed: any problem returns null and the message is not processed.
 */
export async function mintUserClient(email: string, expectedUserId: string): Promise<TypedSupabaseClient | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) return null;

    const { url, anonKey } = getSupabasePublicEnv();
    const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
    const exchanger = createClient<Database>(url, anonKey, { auth });
    const { data: session, error: otpError } = await exchanger.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    const accessToken = session?.session?.access_token;
    // the token must belong to the person the phone identified (never act as somebody else)
    if (otpError || !accessToken || session?.user?.id !== expectedUserId) return null;

    return createClient<Database>(url, anonKey, { auth, global: { headers: { Authorization: `Bearer ${accessToken}` } } }) as unknown as TypedSupabaseClient;
  } catch {
    return null;
  }
}
