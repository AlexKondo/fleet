"use server";

/**
 * SCR-USR-003 (/carpool): server action behind the "Buscar Carona" screen. The actor is ALWAYS derived from the
 * session (never a client-supplied id), the org policy gates the screen (carpool must be enabled; an unreadable
 * policy fails closed) and the search reuses runCarpoolFirst exactly as New Trip does: text places are resolved
 * server-side, the geospatial engine returns only compatible offers and the cards carry nothing but the host's
 * departure time, seats and the detour (no host name/address/coordinates).
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadLatestPolicy } from "@/lib/carpool/loadPolicy";
import { buildOfferCards, runCarpoolFirst, type CarpoolFirstState } from "@/lib/carpool/carpoolFirst";
import { resolveLocationText } from "@/lib/carpool/resolveLocationText";
import { loadOfferCardRows } from "@/lib/carpool/offerCardRows";
import { deriveBuscarGate, parseBuscarInput } from "@/lib/carpool/buscarCarona";
import { createGooglePlacesProvider } from "@/lib/geospatial/googlePlacesProvider";
import { listCorporateMobilityPoints } from "@/lib/geospatial/corporateMobilityPoints";
import { searchCompatibleCarpool } from "./actions";

export type BuscarCaronaResult =
  | CarpoolFirstState
  | { status: "blocked" }
  | { status: "forbidden" }
  | { status: "invalid" };

export async function searchBuscarCarona(raw: {
  originText: string;
  destinationText: string;
  departureAt: string;
  returnAt?: string;
  passengerCount: number;
}): Promise<BuscarCaronaResult> {
  const parsed = parseBuscarInput(raw);
  if (!parsed.ok) return { status: "invalid" };

  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { status: "forbidden" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) return { status: "forbidden" };

  const gate = deriveBuscarGate(await loadLatestPolicy(supabase, profile.organization_id));
  if (gate === "disabled") return { status: "blocked" };
  if (gate === "unknown") return { status: "unavailable", reason: "policy_unavailable" };

  const geocoder = createGooglePlacesProvider(profile.organization_id);
  const pointsResult = await listCorporateMobilityPoints(supabase, profile.organization_id);
  // S3-02: fail closed (like the host side in actions.ts). An unreadable list of corporate points must never
  // be treated as "no points": the typed place would then go to the external geocoder instead of resolving to
  // the company's canonical point.
  if (pointsResult.status !== "ok") return { status: "unavailable", reason: "points_unavailable" };
  const points = pointsResult.data;

  return runCarpoolFirst(
    {
      originText: parsed.input.originText,
      destinationText: parsed.input.destinationText,
      departureAt: parsed.input.departureAt,
      returnAt: parsed.input.returnAt,
      passengerCount: parsed.input.passengerCount,
      requiresCargo: false,
    },
    {
      resolve: (text) => resolveLocationText(text, { points, geocoder, places: geocoder }),
      search: (draft) => searchCompatibleCarpool(draft),
      loadOfferCards: async (matches) =>
        buildOfferCards(
          matches,
          await loadOfferCardRows(
            profile.organization_id,
            matches.map((m) => m.offerId),
          ),
        ),
    },
  );
}
