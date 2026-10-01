import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Phase C2 — Cost Guard.
 *
 * Every real Google Maps Platform call in this codebase (googlePlacesProvider.ts,
 * googleRoutingProvider.ts) MUST go through `withCostGuard` — there is no unguarded direct
 * `fetch` to any Google endpoint anywhere else in this repo. Two independent protections,
 * both DB-backed (never in-memory): Vercel serverless functions are stateless and
 * multi-instance, so an in-memory counter or breaker would silently under-count/reset per
 * instance and give a false sense of protection.
 *
 * 1. Quota counter — one row per (organization, provider_call_kind, UTC day) in
 *    `geo_provider_quota_counters` (0054_corporate_mobility_points_and_geo_quota.sql),
 *    incremented with a single atomic UPSERT (`on conflict ... call_count = call_count + 1`)
 *    so concurrent calls from different instances never lose an increment. A hard daily cap
 *    per organization per call kind blocks further calls once exceeded (`DAILY_CALL_CAP`).
 *    This is a *guard*, not the actual prefilter-before-call decision logic (which
 *    candidates are cheap enough to warrant a real API call at all) — that's Phase C3's
 *    `prefilterCandidates.ts` job; Cost Guard only enforces the ceiling once a caller has
 *    already decided to make a call.
 *
 * 2. Circuit breaker — tracks `consecutive_failure_count` in the same row. After
 *    `FAILURE_THRESHOLD` consecutive failures the circuit opens (`circuit_state = 'open'`)
 *    and every further call is rejected immediately (no network call at all) until
 *    `COOLDOWN_MS` has elapsed since `circuit_opened_at`, at which point it moves to
 *    `half_open` and allows exactly one trial call through — success closes the circuit
 *    (resets the failure counter), failure re-opens it and resets the cooldown clock. This
 *    protects the app from hammering an already-failing Google API (and burning quota on
 *    calls that are near-certain to fail) during an outage.
 *
 * Every candidate call still degrades to a typed "unavailable" result, never an unhandled
 * throw or exception bubbling to the caller — matches the same never-throws contract as
 * `analyzeDriversLicense.ts`.
 */

export type ProviderCallKind = "geocode" | "place_search" | "routing";

const DAILY_CALL_CAP: Record<ProviderCallKind, number> = {
  geocode: 2000,
  place_search: 500,
  routing: 1000,
};

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

export type CostGuardBlockReason =
  | "daily_quota_exceeded"
  | "circuit_open"
  | "counter_unavailable";

export type CostGuardOutcome<T> =
  | { status: "ok"; result: T }
  | { status: "blocked"; reason: CostGuardBlockReason };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Wraps a single real provider call (`doCall`) with quota + circuit-breaker enforcement for
 * one organization and one call kind. `doCall` should itself never throw (providers already
 * return typed outcomes) — but `success(result)` must be able to tell this function whether
 * the underlying call actually succeeded or failed, since that drives the circuit breaker.
 */
export async function withCostGuard<T>(
  organizationId: string,
  callKind: ProviderCallKind,
  doCall: () => Promise<T>,
  isSuccess: (result: T) => boolean,
): Promise<CostGuardOutcome<T>> {
  const admin = createSupabaseAdminClient();
  const day = todayUtc();

  const { data: existing, error: readError } = await admin
    .from("geo_provider_quota_counters")
    .select("call_count, consecutive_failure_count, circuit_state, circuit_opened_at")
    .eq("organization_id", organizationId)
    .eq("provider_call_kind", callKind)
    .eq("day", day)
    .maybeSingle();

  if (readError) {
    // Fail closed on our own bookkeeping being unavailable — never silently skip Cost
    // Guard and call Google unmetered/unprotected.
    return { status: "blocked", reason: "counter_unavailable" };
  }

  if (existing) {
    if (existing.call_count >= DAILY_CALL_CAP[callKind]) {
      return { status: "blocked", reason: "daily_quota_exceeded" };
    }

    if (existing.circuit_state === "open") {
      const openedAt = existing.circuit_opened_at ? new Date(existing.circuit_opened_at).getTime() : 0;
      const cooledDown = Date.now() - openedAt >= COOLDOWN_MS;
      if (!cooledDown) {
        return { status: "blocked", reason: "circuit_open" };
      }
      // Cooldown elapsed — move to half-open and let exactly this one trial call through
      // below, without incrementing consecutive_failure_count again here.
      await admin
        .from("geo_provider_quota_counters")
        .update({ circuit_state: "half_open" })
        .eq("organization_id", organizationId)
        .eq("provider_call_kind", callKind)
        .eq("day", day);
    }
  }

  // Increment the call counter atomically before making the call — this counts attempts,
  // not just successes, which is the conservative (cost-accurate) choice: a failed call to
  // Google still consumes quota against most billing models.
  await admin.rpc("increment_geo_provider_quota_counter", {
    p_organization_id: organizationId,
    p_provider_call_kind: callKind,
    p_day: day,
  });

  const result = await doCall();
  const succeeded = isSuccess(result);

  if (succeeded) {
    await admin
      .from("geo_provider_quota_counters")
      .update({ consecutive_failure_count: 0, circuit_state: "closed", circuit_opened_at: null })
      .eq("organization_id", organizationId)
      .eq("provider_call_kind", callKind)
      .eq("day", day);
  } else {
    const nextFailureCount = (existing?.consecutive_failure_count ?? 0) + 1;
    const shouldOpen = nextFailureCount >= FAILURE_THRESHOLD;
    await admin
      .from("geo_provider_quota_counters")
      .update({
        consecutive_failure_count: nextFailureCount,
        circuit_state: shouldOpen ? "open" : existing?.circuit_state === "half_open" ? "open" : "closed",
        circuit_opened_at: shouldOpen || existing?.circuit_state === "half_open" ? new Date().toISOString() : null,
      })
      .eq("organization_id", organizationId)
      .eq("provider_call_kind", callKind)
      .eq("day", day);
  }

  return { status: "ok", result };
}
