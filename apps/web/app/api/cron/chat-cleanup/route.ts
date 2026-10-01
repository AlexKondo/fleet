import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const RETENTION_DAYS = 90;

/**
 * Runs daily (vercel.json cron -> this route), same pattern as
 * app/api/cron/license-reminders/route.ts. chat_conversations/chat_messages
 * (0046_chat_conversations.sql) have no built-in expiry — without this they'd grow
 * forever. Deletes conversations whose last activity is older than the retention window;
 * chat_messages cascades on delete (0046's FK), so one delete clears both tables. Only
 * "resolved"/"abandoned" conversations are eligible — a long-idle "active" one (someone
 * left a confirmation pending and never came back) is left alone rather than silently
 * dropping a transaction someone might still return to.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const deleteCutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const abandonCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // A conversation left "active" for a week (a confirmation asked and never answered, a
  // tab closed mid-exchange) isn't coming back — moving it to "abandoned" is what lets it
  // eventually qualify for the delete below, and it stops loadLatestChatState.ts from
  // ever restoring a week-old stale confirmation prompt as if it were current.
  await admin
    .from("chat_conversations")
    .update({ status: "abandoned" })
    .eq("status", "active")
    .lt("updated_at", abandonCutoff);

  const { data, error } = await admin
    .from("chat_conversations")
    .delete()
    .in("status", ["resolved", "abandoned"])
    .lt("updated_at", deleteCutoff)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: data?.length ?? 0 });
}
