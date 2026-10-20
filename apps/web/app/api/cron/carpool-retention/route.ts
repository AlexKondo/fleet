import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/** Preservation checkpoint: historical coordinate erasure is paused until an
 * explicit approved retention policy replaces the inherited threshold. */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // No coordinate/history erasure without a specifically approved retention policy.
  return NextResponse.json({ purged: 0, preserved: true, reason: "retention_policy_required" });
}
