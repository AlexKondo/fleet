import "server-only";

/**
 * Address autocomplete for the trip / carpool address boxes. Served by the route handler POST /api/geo/autocomplete (NOT a
 * server action: Next runs server actions one at a time per tab, so typing would queue behind / block the plan submit). The
 * actor always comes from the session; it needs an authenticated user of an org and does NOT depend on the carpool policy;
 * the typed text is clamped (3..120 chars); the per-USER daily cap
 * (consume_user_geo_quota, 400/day, DB-backed, fail closed) is consumed BEFORE any provider call; the org Cost Guard kind
 * `place_autocomplete` is the second ceiling. The org's matching Corporate Mobility Points come FIRST (read with the user's
 * own RLS client, no Google cost). Every failure is a fixed reason code: the provider text and the API key never reach
 * the browser. The UI treats any non-ok result as "no suggestions" (silent).
 *
 * Privacy: only the text the user typed goes to Google; suggestions never contain another user's data.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getLocale } from "@/lib/i18n/getLocale";
import type { Locale } from "@/lib/i18n/locales";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { listCorporateMobilityPoints } from "@/lib/geospatial/corporateMobilityPoints";
import {
  autocompleteAddress,
  cleanSessionToken,
  clampAutocompleteInput,
  matchPointSuggestions,
  mergeSuggestions,
  MAX_SUGGESTIONS,
  type AutocompleteLanguage,
  type PlaceSuggestion,
} from "@/lib/geospatial/placeAutocomplete";

export type AutocompleteReason = "invalid_input" | "not_authenticated" | "rate_limited" | "unavailable";

export type PlaceAutocompleteResult =
  | { status: "ok"; suggestions: PlaceSuggestion[] }
  | { status: "unavailable"; reason: AutocompleteReason };

/** Per-user DB-backed daily cap on autocomplete calls (consume_user_geo_quota kind 'place_autocomplete', migration 0073). */
const USER_DAILY_AUTOCOMPLETE_CAP = 400;

const LANGUAGE: Record<Locale, AutocompleteLanguage> = { "pt-BR": "pt-BR", "en-US": "en", es: "es", "zh-CN": "zh-CN" };

// Best-effort per-instance burst throttle (the DB cap above is the real ceiling).
const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 25;
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

export async function suggestPlaces(raw: { input: string; sessionToken?: string }): Promise<PlaceAutocompleteResult> {
  try {
    const input = clampAutocompleteInput(raw?.input);
    if (!input) return { status: "unavailable", reason: "invalid_input" };
    const sessionToken = cleanSessionToken(raw?.sessionToken);

    const supabase = await createSupabaseServerClient();
    const user = await getCurrentUser(supabase);
    if (!user) return { status: "unavailable", reason: "not_authenticated" };
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    if (!profile) return { status: "unavailable", reason: "not_authenticated" };

    if (throttled(user.id)) return { status: "unavailable", reason: "rate_limited" };

    // Per-user DB daily cap BEFORE any provider call. Fail closed.
    const { data: allowed, error: capError } = await createSupabaseAdminClient().rpc("consume_user_geo_quota", {
      p_user_id: user.id,
      p_kind: "place_autocomplete",
      p_daily_cap: USER_DAILY_AUTOCOMPLETE_CAP,
    });
    if (capError || allowed !== true) return { status: "unavailable", reason: "rate_limited" };

    const pointsResult = await listCorporateMobilityPoints(supabase, profile.organization_id);
    const pointSuggestions = matchPointSuggestions(input, pointsResult.status === "ok" ? pointsResult.data : []);

    const language = LANGUAGE[await getLocale()] ?? "pt-BR";
    const google = await autocompleteAddress(
      profile.organization_id,
      input,
      language,
      sessionToken,
      MAX_SUGGESTIONS - pointSuggestions.length,
    );
    if (google.status !== "ok") {
      // The provider is down / over quota: the org's own points are still useful and cost nothing.
      return pointSuggestions.length > 0
        ? { status: "ok", suggestions: pointSuggestions }
        : { status: "unavailable", reason: "unavailable" };
    }
    return { status: "ok", suggestions: mergeSuggestions(pointSuggestions, google.suggestions) };
  } catch {
    return { status: "unavailable", reason: "unavailable" };
  }
}
