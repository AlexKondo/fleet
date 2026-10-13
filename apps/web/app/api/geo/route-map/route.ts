import type { NextRequest } from "next/server";
import { getTripRouteMap } from "@/app/carpool/routeMapActions";
import { isText, jsonNoStore, readJsonObject, rejectCrossOrigin } from "@/lib/geo/routeGuard";
import { MAX_LOCATION_TEXT } from "@/lib/trips/textLimits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/geo/route-map  { originText, destinationText }  ->  RouteMapResult (JSON, no-store).
 * A route handler instead of a server action so the map never queues behind (or blocks) the plan submit. Same core as before
 * (getTripRouteMap: session actor, per-user daily cap, Cost Guard, caches). Same-origin only; 401 without a session (middleware).
 */
export async function POST(request: NextRequest) {
  const cross = rejectCrossOrigin(request);
  if (cross) return cross;
  const body = await readJsonObject(request, ["originText", "destinationText"]);
  if (!body || !isText(body.originText, MAX_LOCATION_TEXT) || !isText(body.destinationText, MAX_LOCATION_TEXT)) {
    return jsonNoStore({ error: "invalid_input" }, 400);
  }
  // Test hook (never set in a deployment): slows the map call so the live tests can prove the plan submit is not delayed by it.
  const delay = Number(process.env.GEO_MAP_TEST_DELAY_MS ?? 0);
  if (Number.isFinite(delay) && delay > 0 && delay <= 15000) await new Promise((r) => setTimeout(r, delay));

  const result = await getTripRouteMap({ originText: body.originText, destinationText: body.destinationText });
  if (result.status === "unavailable" && result.reason === "not_authenticated") return jsonNoStore({ error: "not_authenticated" }, 401);
  return jsonNoStore(result);
}
