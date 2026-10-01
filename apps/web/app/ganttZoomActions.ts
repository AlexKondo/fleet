"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/currentUser";

export type GanttZoomLevel = "week" | "month" | "quarter";

const ALLOWED_ZOOM: readonly string[] = ["week", "month", "quarter"];

/**
 * L1: this preference never persisted. `profiles` has no UPDATE policy for users (writes go through the
 * service role, see settings/users/actions.ts and account/profile/actions.ts), so the previous user-client
 * `update` silently affected 0 rows. The write now goes through the admin client, scoped STRICTLY to the
 * authenticated caller's own id (never an id taken from the request) and the value is validated against the
 * allowed set (a server action is a public endpoint: the client-side type is not a guarantee).
 */
export async function setGanttZoomPreference(zoom: GanttZoomLevel): Promise<void> {
  if (typeof zoom !== "string" || !ALLOWED_ZOOM.includes(zoom)) return;
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return;
  await createSupabaseAdminClient().from("profiles").update({ gantt_zoom_preference: zoom }).eq("id", user.id);
}
