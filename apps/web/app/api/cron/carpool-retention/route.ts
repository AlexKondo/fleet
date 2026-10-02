import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Retention (LGPD): removes exact coordinates/addresses from carpool requests older than 180 days
 *  (purge_old_carpool_locations, 0071; service_role only). Same fail-closed auth as the other cron routes. */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("purge_old_carpool_locations", { p_days: 180 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ purged: data ?? 0 });
}
