import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";


/** Marks stale active conversations as abandoned without deleting messages.
 * Definitive retention/erasure stays paused until a specific approved policy exists. */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
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

  // Preservation is the default. A destructive retention schedule requires an
  // explicit versioned business policy, not an inherited hard-coded threshold.
  return NextResponse.json({ deleted: 0, preserved: true, reason: "retention_policy_required" });
}
