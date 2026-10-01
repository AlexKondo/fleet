import "server-only";
import { providerErrorReason } from "./redact";
import type {
  LatLng,
  RouteComputeOutcome,
  RouteEvaluationResult,
  RouteInsertionInput,
  RouteInsertionOutcome,
  RoutingProvider,
} from "@fleet/domain";
import { withCostGuard } from "./costGuard";

/**
 * Phase C2 — Google Maps Platform Routes API adapter.
 *
 * Verified live against current docs at implementation time (2026-09-30):
 * https://developers.google.com/maps/documentation/routes/compute_route_directions —
 * `POST https://routes.googleapis.com/directions/v2:computeRoutes`, headers
 * `Content-Type: application/json`, `X-Goog-Api-Key`, `X-Goog-FieldMask`
 * (`routes.duration,routes.distanceMeters`), body
 * `{ origin: { location: { latLng: { latitude, longitude } } }, destination: { ... },
 * travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE" }` -> response
 * `{ routes: [{ distanceMeters, duration: "<seconds>s" }] }`.
 *
 * Same never-throws contract as `analyzeDriversLicense.ts` / `googlePlacesProvider.ts`.
 * `evaluateInsertion` computes the route-insertion detour per the pack's §01/§02 formula:
 * additionalDistance = candidateRouteDistance - baselineRouteDistance, additionalTime the
 * same on duration — both are compared against the policy's configured thresholds by
 * Phase C3's `evaluateRouteMatch.ts` (not here; this file only computes the raw numbers).
 * Two Routes API calls per candidate (baseline once per host trip if cached by the caller,
 * plus one candidate-route call) — this function issues exactly the one candidate-route call
 * it needs per invocation and accepts the already-computed baseline as input, so a caller
 * evaluating N candidates against the same host trip only pays for the baseline once.
 */

const COMPUTE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const FIELD_MASK = "routes.duration,routes.distanceMeters";

function readApiKey(): string | undefined {
  return process.env.GOOGLE_MAPS_API_KEY;
}

function toWaypoint(point: LatLng) {
  return { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
}

/** Parses Google's `"NNNNs"` duration string into minutes. Returns undefined on anything
 * that doesn't match the expected shape, so callers can treat it as a malformed response. */
function parseDurationSecondsToMinutes(duration: unknown): number | undefined {
  if (typeof duration !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration);
  if (!match) return undefined;
  return Number(match[1]) / 60;
}

async function rawComputeRoute(
  origin: LatLng,
  destination: LatLng,
  apiKey: string,
  intermediates?: LatLng[],
): Promise<RouteComputeOutcome> {
  try {
    const response = await fetch(COMPUTE_ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        origin: toWaypoint(origin),
        destination: toWaypoint(destination),
        ...(intermediates && intermediates.length > 0
          ? { intermediates: intermediates.map(toWaypoint) }
          : {}),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        units: "METRIC",
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return { status: "unavailable", reason: `routes_http_${response.status}` };
    }

    const json: unknown = await response.json();
    if (typeof json !== "object" || json === null) {
      return { status: "unavailable", reason: "malformed_routes_response" };
    }
    const body = json as { routes?: Array<{ distanceMeters?: number; duration?: string }> };
    if (!Array.isArray(body.routes) || body.routes.length === 0) {
      return { status: "unavailable", reason: "routes_no_route_found" };
    }

    const route = body.routes[0];
    if (!route) {
      return { status: "unavailable", reason: "routes_no_route_found" };
    }
    const durationMin = parseDurationSecondsToMinutes(route.duration);
    if (typeof route.distanceMeters !== "number" || durationMin === undefined) {
      return { status: "unavailable", reason: "routes_missing_fields" };
    }

    return { status: "ok", distanceKm: route.distanceMeters / 1000, durationMin };
  } catch (err) {
    return { status: "unavailable", reason: providerErrorReason("routes", err) };
  }
}

async function computeRoute(
  organizationId: string,
  origin: LatLng,
  destination: LatLng,
  apiKey: string,
  intermediates?: LatLng[],
) {
  return withCostGuard(
    organizationId,
    "routing",
    () => rawComputeRoute(origin, destination, apiKey, intermediates),
    (outcome) => outcome.status === "ok",
  );
}

/**
 * Computes the route-insertion detour for one rider candidate — exactly two Routes API
 * calls, both Cost Guard-metered:
 *   1. Baseline: host origin -> host destination, no waypoints.
 *   2. Detour: host origin -> host destination, with the candidate's pickup then dropoff as
 *      ordered `intermediates` waypoints — i.e. the same trip with the rider's pickup/dropoff
 *      inserted into it, which is exactly what "route insertion" means (pack §01/§02).
 * additionalDistanceKm/additionalTimeMin = detour - baseline, clamped to a non-negative
 * floor (a well-formed detour can only add distance/time, never remove it; the clamp is
 * purely defensive against provider floating-point/rounding noise). When the candidate's
 * pickup and dropoff are themselves on the host's baseline route (e.g. the pickup point
 * equals the host's destination — the trivial same-route case), the detour and baseline
 * routes are ~identical and the deltas come out ~0, which is exactly the smoke-test
 * expectation.
 */
export async function evaluateRouteInsertion(
  organizationId: string,
  input: RouteInsertionInput,
): Promise<RouteInsertionOutcome> {
  const apiKey = readApiKey();
  if (!apiKey) {
    return { status: "unavailable", reason: "missing_api_key" };
  }

  const baselineGuarded = await computeRoute(organizationId, input.hostOrigin, input.hostDestination, apiKey);
  if (baselineGuarded.status === "blocked") {
    return { status: "unavailable", reason: baselineGuarded.reason };
  }
  const baseline = baselineGuarded.result;
  if (baseline.status !== "ok") {
    return { status: "unavailable", reason: baseline.reason };
  }

  const detourGuarded = await computeRoute(organizationId, input.hostOrigin, input.hostDestination, apiKey, [
    input.candidatePickup,
    input.candidateDropoff,
  ]);
  if (detourGuarded.status === "blocked") {
    return { status: "unavailable", reason: detourGuarded.reason };
  }
  const detour = detourGuarded.result;
  if (detour.status !== "ok") {
    return { status: "unavailable", reason: detour.reason };
  }

  const result: RouteEvaluationResult = {
    baselineDistanceKm: baseline.distanceKm,
    baselineDurationMin: baseline.durationMin,
    candidateRouteDistanceKm: detour.distanceKm,
    candidateRouteDurationMin: detour.durationMin,
    additionalDistanceKm: Math.max(0, detour.distanceKm - baseline.distanceKm),
    additionalTimeMin: Math.max(0, detour.durationMin - baseline.durationMin),
  };

  return { status: "ok", result };
}

/** Concrete `RoutingProvider` implementation bound to one organization (Cost Guard is
 * org-scoped, so this is constructed per-request/per-search rather than as a singleton). */
export function createGoogleRoutingProvider(organizationId: string): RoutingProvider {
  return {
    computeRoute: async (origin: LatLng, destination: LatLng) => {
      const apiKey = readApiKey();
      if (!apiKey) {
        return { status: "unavailable", reason: "missing_api_key" };
      }
      const guarded = await computeRoute(organizationId, origin, destination, apiKey);
      if (guarded.status === "blocked") {
        return { status: "unavailable", reason: guarded.reason };
      }
      return guarded.result;
    },
    evaluateInsertion: (input: RouteInsertionInput) => evaluateRouteInsertion(organizationId, input),
  };
}
