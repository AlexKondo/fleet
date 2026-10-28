import "server-only";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { resolveLocationText, searchPlaceCandidates } from "@/lib/carpool/resolveLocationText";
import { createGooglePlacesProvider } from "@/lib/geospatial/googlePlacesProvider";
import { createGoogleRoutingProvider } from "@/lib/geospatial/googleRoutingProvider";
import { listCorporateMobilityPoints } from "@/lib/geospatial/corporateMobilityPoints";
import { verifyReservationPlaces, type PlaceVerification } from "./verifyPlaces";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

/** The real map services (corporate points first, then the geocoder; the route for the distance). Any failure means "could not verify". */
export async function verifyPlacesForChat(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  slots: Record<string, string>,
  dict: Dictionary,
  opts: { allowChoice?: boolean } = {},
): Promise<PlaceVerification> {
  try {
    const geocoder = createGooglePlacesProvider(organizationId);
    const pointsResult = await listCorporateMobilityPoints(supabase, organizationId);
    const points = pointsResult.status === "ok" ? pointsResult.data : [];
    const routing = createGoogleRoutingProvider(organizationId);
    return await verifyReservationPlaces(
      slots,
      {
        resolve: (text) => resolveLocationText(text, { points, geocoder, places: geocoder }),
        route: (from, to) => routing.computeRoute(from, to),
        candidates: (text) => searchPlaceCandidates(text, geocoder),
      },
      dict,
      opts,
    );
  } catch {
    return { status: "unverified" };
  }
}
