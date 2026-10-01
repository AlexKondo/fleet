"use server";

/**
 * Phase C3 — Matching Engine orchestration (the only real server action in this directory).
 *
 * `searchCompatibleCarpool` is a NEW, additive, currently-unwired entry point (Phase C5's UI
 * will call it) — it does not modify `apps/web/app/trips/new/actions.ts` or the existing
 * vehicle-allocation flow.
 *
 * The decision core (`runCarpoolSearch`) lives in `apps/web/lib/carpool/runCarpoolSearch.ts`
 * on purpose: every export of a "use server" file is a client-reachable action, and the core
 * takes caller-supplied candidates/policy/provider, so it must not be one.
 *
 * Pipeline: load active offers (service-role client, after authenticating the caller - 0063) -> Stage A prefilter -> deterministic
 * ordering + cap (`max_candidates_for_precise_routing`) -> geocode host addresses for the
 * shortlist only -> RoutingProvider per candidate -> Stage B `evaluateRouteMatch` -> rank ->
 * return ONLY compatible matches. Provider outage / unresolvable addresses exclude candidates
 * (never a reduced-confidence guess); total failure yields `{status:"unavailable"}`.
 *
 * KNOWN LIMITATION: host origin/destination lat/lng are not persisted anywhere in the C1/C2
 * schema, so they are geocoded on demand (shortlist only). A future phase should persist
 * resolved host coordinates at offer-publish time.
 */

import type { GeocodingProvider, LatLng } from "@fleet/domain";
import { isValidLatLng, isValidSeatCount } from "@fleet/domain";
import { loadLatestPolicy } from "@/lib/carpool/loadPolicy";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { createGoogleRoutingProvider } from "@/lib/geospatial/googleRoutingProvider";
import { createGooglePlacesProvider } from "@/lib/geospatial/googlePlacesProvider";
import {
  runCarpoolSearch,
  selectShortlistOfferIds,
  toPrefilterInput,
  type CarpoolOfferCandidateRow,
  type RiderTripDraft,
  type SearchCarpoolResult,
} from "@/lib/carpool/runCarpoolSearch";

async function resolveAddress(geocoder: GeocodingProvider, address: string): Promise<LatLng | undefined> {
  const outcome = await geocoder.geocode(address);
  if (outcome.status !== "ok") return undefined;
  return outcome.location.coordinates;
}

export async function searchCompatibleCarpool(
  riderTripDraft: RiderTripDraft,
): Promise<SearchCarpoolResult> {
  // Client-supplied input is validated before any DB/provider work (C3 audit carry-overs a/b):
  // positive-integer seats, finite in-range coordinates, parseable departure time.
  if (!isValidSeatCount(riderTripDraft?.requestedSeats)) {
    return { status: "error", error: "invalid_seats" };
  }
  if (!isValidLatLng(riderTripDraft.pickup) || !isValidLatLng(riderTripDraft.dropoff)) {
    return { status: "error", error: "invalid_coordinates" };
  }
  if (
    typeof riderTripDraft.requestedDepartureAt !== "string" ||
    !Number.isFinite(new Date(riderTripDraft.requestedDepartureAt).getTime())
  ) {
    return { status: "error", error: "invalid_departure" };
  }

  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return { status: "error", error: "not_authenticated" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return { status: "error", error: "no_profile" };
  }

  const organizationId = profile.organization_id;
  const loaded = await loadLatestPolicy(supabase, organizationId);
  if (!loaded.ok) {
    return { status: "unavailable", reason: "policy_unavailable" };
  }
  const policy = loaded.policy;

  if (!policy.carpoolEnabled) {
    return { status: "matches", matches: [] };
  }

  // Phase C7 (0063): other people's offers and host trips are no longer readable with the caller's
  // own RLS context (a coworker's origin/destination is a journey). They are read with the
  // service-role client NOW - strictly AFTER the session user was authenticated above and scoped to
  // that user's own organization - and the host trip details stay inside this function: only the
  // minimal match data (offer id, detour km/min, coordinates the rider already supplied) is ever
  // returned to the browser.
  const admin = createSupabaseAdminClient();
  const { data: offerRows, error: offersError } = await admin
    .from("carpool_offers")
    .select(
      `id, trip_request_id, status, seats_available,
       trip_request:trip_requests(departure_at, origin, destination)`,
    )
    .eq("organization_id", organizationId)
    .eq("status", "active");
  if (offersError) {
    return { status: "unavailable", reason: "offers_unavailable" };
  }

  const tripRequestIds = (offerRows ?? [])
    .map((row) => row.trip_request_id)
    .filter((id): id is string => Boolean(id));

  const now = new Date().toISOString();
  const { data: reservationRows } =
    tripRequestIds.length > 0
      ? await admin
          .from("reservations")
          .select(
            `trip_request_id, end_at, status,
             vehicle:vehicles(category:vehicle_categories(supports_cargo))`,
          )
          .in("trip_request_id", tripRequestIds)
      : { data: [] };

  const activeTripRequestIds = new Set(
    (reservationRows ?? [])
      .filter((r) => (r.status === "pending_approval" || r.status === "confirmed") && r.end_at > now)
      .map((r) => r.trip_request_id),
  );
  const cargoSupportByTripRequestId = new Map(
    (reservationRows ?? []).map((r) => [r.trip_request_id, Boolean(r.vehicle?.category?.supports_cargo)]),
  );

  const textRows = (offerRows ?? []).filter((row) => row.trip_request);
  const rowToCandidateBase = (row: (typeof textRows)[number]) => ({
    offerId: row.id,
    offerStatus: row.status as CarpoolOfferCandidateRow["offerStatus"],
    hostTripActive: activeTripRequestIds.has(row.trip_request_id),
    seatsAvailable: row.seats_available,
    vehicleSupportsCargo: cargoSupportByTripRequestId.get(row.trip_request_id) ?? false,
    hostDepartureAt: row.trip_request!.departure_at,
  });

  // Stage A (no coordinates needed) + deterministic ordering + cap, BEFORE any geocoding.
  const shortlistIds = new Set(
    selectShortlistOfferIds(
      textRows.map((row) => toPrefilterInput(rowToCandidateBase(row), riderTripDraft, policy)),
      policy.maxCandidatesForPreciseRouting,
    ),
  );
  const shortlistRows = textRows.filter((row) => shortlistIds.has(row.id));

  if (shortlistRows.length === 0) {
    return { status: "matches", matches: [] };
  }

  const geocoder = createGooglePlacesProvider(organizationId);
  const resolved: CarpoolOfferCandidateRow[] = [];
  for (const row of shortlistRows) {
    const origin = await resolveAddress(geocoder, row.trip_request!.origin);
    const destination = await resolveAddress(geocoder, row.trip_request!.destination);
    // Unresolvable address: never guessed, simply excluded.
    if (origin && destination) {
      resolved.push({
        ...rowToCandidateBase(row),
        hostTripRequestId: row.trip_request_id,
        hostOrigin: origin,
        hostDestination: destination,
      });
    }
  }

  if (resolved.length === 0) {
    return { status: "unavailable", reason: "geocoding_unavailable" };
  }

  return runCarpoolSearch(riderTripDraft, resolved, policy, createGoogleRoutingProvider(organizationId));
}
