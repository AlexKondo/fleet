import "server-only";
import { withCostGuard } from "./costGuard";
import { providerErrorReason } from "./redact";
import type { CorporateMobilityPoint } from "./corporateMobilityPoints";

/**
 * Address autocomplete: Google Places API (New) "Autocomplete" (POST places.googleapis.com/v1/places:autocomplete,
 * key in the X-Goog-Api-Key header, never in a URL). Cost Guard kind `place_autocomplete` (own org quota + breaker, so
 * it can never consume the carpool geocode / routing / place_search quotas). Only the text the user typed goes to
 * Google; the result is mapped to a small fixed DTO (no provider text is ever echoed, no key, no raw body).
 *
 * Also holds the pure helpers (input clamp, session token check, point matching, merge order) so they are unit-testable.
 */

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";

export const MIN_AUTOCOMPLETE_CHARS = 3;
export const MAX_AUTOCOMPLETE_CHARS = 120;
export const MAX_SUGGESTIONS = 6;
/** Corporate Mobility Points shown first (no Google cost); the rest of the 6 slots are Google predictions. */
export const MAX_POINT_SUGGESTIONS = 3;
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 4000;

export interface PlaceSuggestion {
  /** Google placeId, or the Corporate Mobility Point id. */
  id: string;
  /** Full text that fills the input when the option is selected. */
  text: string;
  main: string;
  secondary: string;
  kind: "point" | "place";
}

export type AutocompleteLanguage = "pt-BR" | "en" | "es" | "zh-CN";

export type AutocompleteProviderOutcome =
  | { status: "ok"; suggestions: PlaceSuggestion[] }
  | { status: "unavailable"; reason: string };

/** Trims and clamps; returns null when the text is too short to be worth a call. */
export function clampAutocompleteInput(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_AUTOCOMPLETE_CHARS);
  return text.length >= MIN_AUTOCOMPLETE_CHARS ? text : null;
}

const SESSION_TOKEN = /^[0-9a-fA-F-]{16,64}$/;
export function cleanSessionToken(raw: unknown): string | undefined {
  return typeof raw === "string" && SESSION_TOKEN.test(raw) ? raw : undefined;
}

const fold = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** The org's active Corporate Mobility Points whose name / alias / address contains the typed text (accent-insensitive). */
export function matchPointSuggestions(
  input: string,
  points: readonly CorporateMobilityPoint[],
  limit: number = MAX_POINT_SUGGESTIONS,
): PlaceSuggestion[] {
  const needle = fold(input);
  if (needle.length < MIN_AUTOCOMPLETE_CHARS) return [];
  const out: PlaceSuggestion[] = [];
  for (const p of points) {
    if (!p.isActive) continue;
    const hay = [p.name, p.addressLabel, ...p.aliases].map(fold);
    if (!hay.some((h) => h.includes(needle))) continue;
    out.push({ id: p.id, text: p.name, main: p.name, secondary: p.addressLabel, kind: "point" });
    if (out.length >= limit) break;
  }
  return out;
}

/** Points first, then Google; capped at MAX_SUGGESTIONS; de-duplicated by text. */
export function mergeSuggestions(points: PlaceSuggestion[], google: PlaceSuggestion[]): PlaceSuggestion[] {
  const seen = new Set<string>();
  const out: PlaceSuggestion[] = [];
  for (const s of [...points.slice(0, MAX_POINT_SUGGESTIONS), ...google]) {
    const key = fold(s.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Parses the provider body defensively into at most `limit` suggestions. Exported for tests. */
export function parseAutocompleteBody(json: unknown, limit: number): PlaceSuggestion[] | null {
  if (typeof json !== "object" || json === null) return null;
  const body = json as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: unknown;
        text?: { text?: unknown };
        structuredFormat?: { mainText?: { text?: unknown }; secondaryText?: { text?: unknown } };
      };
    }>;
  };
  // Google omits `suggestions` entirely when nothing matches: that is a valid empty answer.
  if (body.suggestions === undefined) return [];
  if (!Array.isArray(body.suggestions)) return null;
  const out: PlaceSuggestion[] = [];
  for (const s of body.suggestions) {
    const p = s?.placePrediction;
    const text = p?.text?.text;
    const placeId = p?.placeId;
    if (typeof text !== "string" || !text.trim() || typeof placeId !== "string" || !placeId) continue;
    const main = p?.structuredFormat?.mainText?.text;
    const secondary = p?.structuredFormat?.secondaryText?.text;
    out.push({
      id: placeId.slice(0, 200),
      text: text.slice(0, 200),
      main: (typeof main === "string" && main ? main : text).slice(0, 200),
      secondary: typeof secondary === "string" ? secondary.slice(0, 200) : "",
      kind: "place",
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function rawAutocomplete(
  input: string,
  language: AutocompleteLanguage,
  sessionToken: string | undefined,
  apiKey: string,
  limit: number,
): Promise<AutocompleteProviderOutcome> {
  try {
    const response = await fetch(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
      body: JSON.stringify({
        input,
        languageCode: language,
        regionCode: "br",
        ...(sessionToken ? { sessionToken } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { status: "unavailable", reason: `autocomplete_http_${response.status}` };
    const text = await readCapped(response);
    if (text === null) return { status: "unavailable", reason: "autocomplete_response_too_large" };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { status: "unavailable", reason: "autocomplete_malformed_response" };
    }
    const suggestions = parseAutocompleteBody(json, limit);
    if (!suggestions) return { status: "unavailable", reason: "autocomplete_malformed_response" };
    return { status: "ok", suggestions };
  } catch (err) {
    return { status: "unavailable", reason: providerErrorReason("places", err) };
  }
}

/** One Google Places Autocomplete (New) call for the org, behind Cost Guard (`place_autocomplete`). Never throws. */
export async function autocompleteAddress(
  organizationId: string,
  input: string,
  language: AutocompleteLanguage,
  sessionToken: string | undefined,
  limit: number = MAX_SUGGESTIONS,
): Promise<AutocompleteProviderOutcome> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { status: "unavailable", reason: "missing_api_key" };
  const guarded = await withCostGuard(
    organizationId,
    "place_autocomplete",
    () => rawAutocomplete(input, language, sessionToken, apiKey, limit),
    (outcome) => outcome.status === "ok",
  );
  if (guarded.status === "blocked") return { status: "unavailable", reason: guarded.reason };
  return guarded.result;
}
