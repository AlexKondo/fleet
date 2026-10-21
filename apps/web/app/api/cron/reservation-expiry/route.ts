import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * FIX-VENCIDAS R3/R5: releases reservations whose window ended without any pickup, gate or key
 * activity (no-show / never approved). The sweep is the `fm_release_expired_reservations` RPC
 * (0209_release_expired_reservations.sql): it applies each org's
 * organization_settings.no_show_release_grace_minutes (0207, default 60) after end_at, cancels the
 * reservation (no_show_auto / expired_unapproved), restores the vehicle exactly like
 * cancel_reservation, notifies the requester and writes the audit row. It is granted to service_role
 * ONLY, so it is reachable solely through the admin client here. Same auth/shape as
 * app/api/cron/carpool-expiry/route.ts; also run by the daily dispatcher (app/api/cron/daily).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  // Fail closed: this route is reachable without a session (middleware exempts /api/cron/), so a
  // missing CRON_SECRET must refuse the call rather than leave the sweep open to anyone.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("fm_release_expired_reservations", {});
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? { released: 0 });
}
