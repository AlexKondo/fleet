import type { NextRequest } from "next/server";
import { suggestPlaces } from "@/app/carpool/placeAutocompleteActions";
import { isText, jsonNoStore, readJsonObject, rejectCrossOrigin } from "@/lib/geo/routeGuard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/geo/autocomplete  { input, sessionToken? }  ->  PlaceAutocompleteResult (JSON, no-store).
 * A route handler instead of a server action: typing never queues behind the plan submit and the browser can really abort a
 * stale request. Same core as before (suggestPlaces: session actor, 3..120 chars, per-user cap 400/day taken before the
 * provider call, org Cost Guard kind place_autocomplete, mobility points first). Same-origin only; 401 without a session.
 */
export async function POST(request: NextRequest) {
  const cross = rejectCrossOrigin(request);
  if (cross) return cross;
  const body = await readJsonObject(request, ["input", "sessionToken"]);
  if (!body || !isText(body.input, 300) || (body.sessionToken !== undefined && !isText(body.sessionToken, 64))) {
    return jsonNoStore({ error: "invalid_input" }, 400);
  }
  const result = await suggestPlaces({ input: body.input, sessionToken: body.sessionToken as string | undefined });
  if (result.status === "unavailable" && result.reason === "not_authenticated") return jsonNoStore({ error: "not_authenticated" }, 401);
  return jsonNoStore(result);
}
