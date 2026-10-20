import "server-only";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
export async function assistantPolicy(db: TypedSupabaseClient) {
  try {
    const { data, error } = await db.rpc("fm_ai_policy_read");
    // Compatibility with an installation preceding migration 0075 only. A network
    // or permission error must never bypass an explicitly disabled policy.
    if (error)
      return {
        enabled: error.code === "PGRST202",
        available: error.code === "PGRST202",
        legacy: error.code === "PGRST202",
      };
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data.enabled !== "boolean"
    )
      return { enabled: false, available: false, legacy: false };
    return { enabled: data.enabled, available: true, legacy: false };
  } catch {
    return { enabled: false, available: false, legacy: false };
  }
}
