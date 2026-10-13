"use server";

/**
 * Embedded route map (Google Static Maps) for the signed-in user's OWN route. The actor always comes from the
 * session (never a client id); the org carpool/geo policy gates it (an unreadable policy fails closed); both
 * places go through the existing resolver (Corporate Mobility Points, then the Cost Guard-metered geocoder);
 * the route and the image are Cost Guard-metered Google calls; the PNG comes back as a data URL, so there is no
 * public proxy endpoint and the API key never leaves the server. Every failure is a fixed reason code.
 *
 * Privacy: this action only maps the two texts the caller typed / owns. No screen passes a HOST's route to a rider.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getLocale } from "@/lib/i18n/getLocale";
import type { Locale } from "@/lib/i18n/locales";
import { RouteMapCache, routeMapCacheKey } from "@/lib/geospatial/routeMapCache";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadLatestPolicy } from "@/lib/carpool/loadPolicy";
import { resolveLocationText } from "@/lib/carpool/resolveLocationText";
import { createGooglePlacesProvider } from "@/lib/geospatial/googlePlacesProvider";
import { listCorporateMobilityPoints } from "@/lib/geospatial/corporateMobilityPoints";
import { computeRouteWithPolyline } from "@/lib/geospatial/googleRoutingProvider";
import { fetchRouteMapImage, type RouteMapReason } from "@/lib/geospatial/routeMap";
import { clampText, MAX_LOCATION_TEXT } from "@/lib/trips/textLimits";
import type { GeocodingOutcome, LatLng } from "@fleet/domain";

export type RouteMapResult =
  | {
      status: "ok";
      imageDataUrl: string;
      distanceKm: number;
      durationMin: number;
      originLabel: string;
      destinationLabel: string;
      /** True when a place was only resolved to an area (city/neighbourhood): the line runs between area centres. */
      approximate: boolean;
    }
  | { status: "unavailable"; reason: RouteMapReason };

/** Per-user DB-backed daily cap on map views (consume_route_map_view, migration 0072). */
const USER_DAILY_VIEW_CAP = 100;

const STATIC_LANGUAGE: Record<Locale, string> = { "pt-BR": "pt-BR", "en-US": "en", es: "es", "zh-CN": "zh-CN" };

// Per-instance cache of OK results (see routeMapCache.ts). Failures are never cached.
const resultCache = new RouteMapCache<Extract<RouteMapResult, { status: "ok" }>>();

// Best-effort per-instance throttle (the Cost Guard daily quota is the real, DB-backed ceiling).
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const recent = new Map<string, number[]>();
function throttled(userId: string): boolean {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) {
    recent.set(userId, hits);
    return true;
  }
  hits.push(now);
  recent.set(userId, hits);
  if (recent.size > 2000) recent.clear();
  return false;
}

const COARSE_OK = new Set(["city_level", "neighborhood_level", "state_level", "postal_code"]);

export async function getTripRouteMap(raw: { originText: string; destinationText: string }): Promise<RouteMapResult> {
  try {
    const originText = clampText(raw?.originText, MAX_LOCATION_TEXT).trim();
    const destinationText = clampText(raw?.destinationText, MAX_LOCATION_TEXT).trim();
    if (!originText || !destinationText) return { status: "unavailable", reason: "invalid_input" };

    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    if (!user) return { status: "unavailable", reason: "not_authenticated" };
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    if (!profile) return { status: "unavailable", reason: "not_authenticated" };

    const policy = await loadLatestPolicy(supabase, profile.organization_id);
    if (!policy.ok || !policy.policy.carpoolEnabled) return { status: "unavailable", reason: "disabled" };
    if (throttled(user.id)) return { status: "unavailable", reason: "rate_limited" };

    // Per-user DB daily cap BEFORE any provider call (a cache hit below still consumes a view). Fail closed.
    const { data: allowed, error: capError } = await createSupabaseAdminClient().rpc("consume_route_map_view", {
      p_user_id: user.id,
      p_daily_cap: USER_DAILY_VIEW_CAP,
    });
    if (capError || allowed !== true) return { status: "unavailable", reason: "rate_limited" };

    const orgId = profile.organization_id;
    const language = STATIC_LANGUAGE[await getLocale()];
    const cacheKey = routeMapCacheKey(orgId, originText, destinationText, language);
    const cached = resultCache.get(cacheKey);
    if (cached) return cached;

    // The map resolves places with its OWN geocode kind and never uses Places Text Search: it cannot touch the
    // geocode / place_search / routing quotas that carpool matching depends on.
    const base = createGooglePlacesProvider(orgId, { geocodeKind: "map_geocode" });
    // Records each geocoder answer so a place that resolves only to an AREA (city / neighbourhood: the default
    // origin of the trip form is a city) can still be drawn, flagged as approximate - without a second geocode call.
    const lastGeocode = new Map<string, GeocodingOutcome>();
    const geocoder = {
      geocode: async (address: string) => {
        const outcome = await base.geocode(address);
        lastGeocode.set(address.trim().slice(0, MAX_LOCATION_TEXT), outcome);
        return outcome;
      },
      searchPlaces: (q: string) => base.searchPlaces(q),
    };
    const pointsResult = await listCorporateMobilityPoints(supabase, orgId);
    const points = pointsResult.status === "ok" ? pointsResult.data : [];

    let approximate = false;
    const resolveOne = async (text: string): Promise<{ label: string; coordinates: LatLng } | RouteMapReason> => {
      const out = await resolveLocationText(text, { points, geocoder });
      if (out.status === "resolved") return { label: out.place.label, coordinates: out.place.coordinates };
      if (out.status === "unavailable") return "geocode_unavailable";
      if (COARSE_OK.has(out.reason)) {
        const g = lastGeocode.get(text);
        if (g && g.status === "ok") {
          approximate = true;
          return { label: g.location.formattedAddress ?? text, coordinates: g.location.coordinates };
        }
      }
      return "place_not_found";
    };

    const [o, d] = await Promise.all([resolveOne(originText), resolveOne(destinationText)]);
    if (typeof o === "string") return { status: "unavailable", reason: o };
    if (typeof d === "string") return { status: "unavailable", reason: d };

    const route = await computeRouteWithPolyline(orgId, o.coordinates, d.coordinates);
    if (route.status !== "ok") return { status: "unavailable", reason: "route_unavailable" };

    const image = await fetchRouteMapImage(orgId, {
      encodedPolyline: route.encodedPolyline,
      origin: o.coordinates,
      destination: d.coordinates,
      language,
    });
    if (image.status !== "ok") return { status: "unavailable", reason: "map_unavailable" };

    const okResult = {
      status: "ok" as const,
      imageDataUrl: image.dataUrl,
      distanceKm: Math.round(route.distanceKm * 10) / 10,
      durationMin: Math.max(1, Math.round(route.durationMin)),
      originLabel: o.label,
      destinationLabel: d.label,
      approximate,
    };
    resultCache.set(cacheKey, okResult);
    return okResult;
  } catch {
    return { status: "unavailable", reason: "map_unavailable" };
  }
}
