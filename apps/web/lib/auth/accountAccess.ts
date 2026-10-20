import type { TypedSupabaseClient } from "@fleet/supabase-client";

/** Apply 0076 before deploying this guard. Missing RPCs, network errors and
 * invalid responses never reactivate a member or bypass access revocation. */
export async function accountEnabled(db: TypedSupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("fm_account_enabled");
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}
