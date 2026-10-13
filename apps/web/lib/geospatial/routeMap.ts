import "server-only";
import type { LatLng } from "@fleet/domain";
import { withCostGuard } from "./costGuard";
import { providerErrorReason } from "./redact";
import { fitPolyline } from "./polyline";

/**
 * Embedded route map: Google Static Maps image, fetched SERVER-SIDE and handed to the browser as a data URL.
 *
 * - The API key is only ever part of the server-to-Google request URL. It is never returned, logged or put in an
 *   error: every failure is one of fixed reason codes.
 * - No public proxy endpoint exists: the image travels inside the server-action response as a data URL.
 * - Only the fixed host `maps.googleapis.com` is called (no user-controlled URL -> no SSRF).
 * - Cost Guard: the Static Maps call has its own `static_map` kind (migration 0072), separate from carpool's counters.
 */

export const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";
/** Google's documented limit for a Static Maps request URL. */
export const STATIC_MAP_URL_LIMIT = 8192;
export const MAX_IMAGE_BYTES = 1_500_000;
export const ROUTE_COLOR = "0x2369c8ff";

export const STATIC_MAP_LANGUAGES = ["pt-BR", "en", "es", "zh-CN"] as const;

export type RouteMapReason =
  | "rate_limited"
  | "not_authenticated"
  | "disabled"
  | "invalid_input"
  | "place_not_found"
  | "geocode_unavailable"
  | "route_unavailable"
  | "map_unavailable";

/** Builds the Static Maps URL (key included - server use only). Returns null when the polyline cannot be made to fit. */
export function buildStaticMapUrl(args: {
  encodedPolyline: string;
  origin: LatLng;
  destination: LatLng;
  apiKey: string;
  /** Static Maps `language` (pt-BR | en | es | zh-CN). */
  language?: string;
}): string | null {
  const markers =
    `&markers=${encodeURIComponent(`color:0x2369c8|label:A|${args.origin.lat.toFixed(6)},${args.origin.lng.toFixed(6)}`)}` +
    `&markers=${encodeURIComponent(`color:red|label:B|${args.destination.lat.toFixed(6)},${args.destination.lng.toFixed(6)}`)}`;
  const base = `${STATIC_MAP_URL}?size=640x360&scale=2&maptype=roadmap&language=${args.language ?? "pt-BR"}&region=BR&format=png${markers}`;
  const keyPart = `&key=${encodeURIComponent(args.apiKey)}`;
  const pathPrefix = `&path=${encodeURIComponent(`color:${ROUTE_COLOR}|weight:5|enc:`)}`;
  // Budget for the (URL-encoded) polyline itself, with a small safety margin under Google's limit.
  const budget = STATIC_MAP_URL_LIMIT - 64 - base.length - keyPart.length - pathPrefix.length;
  const fitted = fitPolyline(args.encodedPolyline, budget);
  if (!fitted) return null;
  return `${base}${pathPrefix}${encodeURIComponent(fitted)}${keyPart}`;
}

type StaticImageOutcome = { status: "ok"; dataUrl: string } | { status: "unavailable"; reason: string };

async function rawFetchStaticMap(url: string): Promise<StaticImageOutcome> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
    if (!response.ok) return { status: "unavailable", reason: `static_http_${response.status}` };
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (contentType !== "image/png") return { status: "unavailable", reason: "static_bad_content_type" };
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return { status: "unavailable", reason: "static_too_large" };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return { status: "unavailable", reason: "static_too_large" };
    // PNG signature sanity check.
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
      return { status: "unavailable", reason: "static_bad_content_type" };
    }
    return { status: "ok", dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` };
  } catch (err) {
    return { status: "unavailable", reason: providerErrorReason("routes", err).replace("routes_", "static_") };
  }
}

/** Fetches the Static Maps PNG through the Cost Guard. Never throws; the reason is an internal fixed code. */
export async function fetchRouteMapImage(
  organizationId: string,
  args: { encodedPolyline: string; origin: LatLng; destination: LatLng; language?: string },
): Promise<StaticImageOutcome> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { status: "unavailable", reason: "missing_api_key" };
  const url = buildStaticMapUrl({ ...args, apiKey });
  if (!url) return { status: "unavailable", reason: "static_url_too_long" };
  const guarded = await withCostGuard(
    organizationId,
    "static_map",
    () => rawFetchStaticMap(url),
    (outcome) => outcome.status === "ok",
  );
  if (guarded.status === "blocked") return { status: "unavailable", reason: guarded.reason };
  return guarded.result;
}
