import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Expires stale PENDING carpool ride requests (vercel.json cron -> this route), same
 * auth/shape as app/api/cron/chat-cleanup/route.ts. The sweep itself is the
 * `expire_stale_carpool_requests` RPC (0059_carpool_lifecycle_rpcs.sql): it applies each
 * org's latest `carpool_policy_settings.request_expiry_minutes`, also expires requests whose
 * host trip already departed, marks them EXPIRED, writes the audit row and emits a RideExpired
 * event — the notification subscriber then notifies the rider. That RPC is granted to
 * service_role ONLY (revoked from anon/authenticated), so it is reachable solely through the
 * admin client here.
 *
 * Correctness does not depend on how often this runs: accept_carpool_ride_request independently
 * refuses a request older than the expiry window (CARPOOL_REQUEST_EXPIRED), so a stale request
 * can never be accepted between sweeps — the sweep only makes the status/notification catch up.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  // Fail closed: this route is reachable without a session (middleware exempts /api/cron/), so a
  // missing CRON_SECRET must refuse the call rather than leave the sweep open to anyone.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("expire_stale_carpool_requests");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ expired: data ?? 0 });
}
