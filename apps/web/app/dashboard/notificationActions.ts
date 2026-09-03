"use server";

import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server actions for NotificationBell.tsx. Kept separate from actions.ts (which is
 * owned by another workstream this round) — same RPC/mutation conventions, just scoped
 * to the notifications table added in supabase/migrations/0008_notifications.sql.
 *
 * Both actions are plain UPDATEs gated entirely by RLS ("members mark own notifications
 * as read" — organization_id = current_organization_id() and user_id = auth.uid()), so
 * there is nothing to double-check here beyond surfacing a Supabase error as a thrown
 * Error, same as runFleetAction in actions.ts.
 */
async function runNotificationUpdate(
  fn: (supabase: TypedSupabaseClient) => PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await fn(supabase);
  if (error) throw new Error(error.message);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  return runNotificationUpdate((supabase) =>
    supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId)
      .is("read_at", null),
  );
}

export async function markAllNotificationsRead(): Promise<void> {
  return runNotificationUpdate((supabase) =>
    supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null),
  );
}
