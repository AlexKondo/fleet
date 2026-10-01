import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the admin Supabase client before importing costGuard, since withCostGuard talks to
// `geo_provider_quota_counters` through it. Each test controls the mocked table state
// directly rather than hitting a real DB — the live-DB probe for the real table's CHECK
// constraint lives in supabase/tests/, per this repo's existing convention
// (carpool-offer-seat-constraint.mjs).
const state = {
  row: null as null | {
    call_count: number;
    consecutive_failure_count: number;
    circuit_state: string;
    circuit_opened_at: string | null;
  },
  updates: [] as Record<string, unknown>[],
  rpcCalls: [] as unknown[],
};

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.row, error: null }),
            }),
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          eq: () => ({
            eq: async () => {
              state.updates.push(patch);
              state.row = { ...(state.row as NonNullable<typeof state.row>), ...(patch as Record<string, never>) };
              return { data: null, error: null };
            },
          }),
        }),
      }),
    }),
    rpc: async (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      if (name !== "increment_geo_provider_quota_counter") return { data: null, error: null };
      if (state.row) state.row.call_count += 1;
      else state.row = { call_count: 1, consecutive_failure_count: 0, circuit_state: "closed", circuit_opened_at: null };
      return { data: null, error: null };
    },
  }),
}));

import { withCostGuard } from "./costGuard";

describe("withCostGuard", () => {
  beforeEach(() => {
    state.row = null;
    state.updates = [];
    state.rpcCalls = [];
  });

  it("allows a call through and records it as a success", async () => {
    const doCall = vi.fn(async () => ({ status: "ok" as const }));
    const outcome = await withCostGuard("org-1", "geocode", doCall, (r) => r.status === "ok");

    expect(outcome.status).toBe("ok");
    expect(doCall).toHaveBeenCalledTimes(1);
    // the call counter increment + (C7b) the outcome/latency record
    expect(state.rpcCalls.map((c) => (c as { name: string }).name)).toEqual([
      "increment_geo_provider_quota_counter",
      "record_geo_provider_call_outcome",
    ]);
  });

  it("C7b: records the outcome (ok flag + latency) after every call, success or failure", async () => {
    await withCostGuard("org-1", "routing", async () => ({ status: "ok" as "ok" | "unavailable" }), (r) => r.status === "ok");
    await withCostGuard("org-1", "routing", async () => ({ status: "unavailable" as "ok" | "unavailable" }), (r) => r.status === "ok");
    const outcomes = (state.rpcCalls as { name: string; args: { p_ok: boolean; p_latency_ms: number; p_provider_call_kind: string } }[])
      .filter((c) => c.name === "record_geo_provider_call_outcome")
      .map((c) => ({ ok: c.args.p_ok, kind: c.args.p_provider_call_kind, latencyIsNumber: Number.isFinite(c.args.p_latency_ms) && c.args.p_latency_ms >= 0 }));
    expect(outcomes).toEqual([
      { ok: true, kind: "routing", latencyIsNumber: true },
      { ok: false, kind: "routing", latencyIsNumber: true },
    ]);
  });

  it("blocks a call once the daily quota is exceeded, and never invokes doCall", async () => {
    state.row = { call_count: 2000, consecutive_failure_count: 0, circuit_state: "closed", circuit_opened_at: null };
    const doCall = vi.fn(async () => ({ status: "ok" as const }));

    const outcome = await withCostGuard("org-1", "geocode", doCall, (r) => r.status === "ok");

    expect(outcome).toEqual({ status: "blocked", reason: "daily_quota_exceeded" });
    expect(doCall).not.toHaveBeenCalled();
  });

  it("opens the circuit after the failure threshold and blocks the next call without touching doCall", async () => {
    // Simulate 4 prior consecutive failures (threshold is 5) — the 5th failing call here
    // should flip the breaker open.
    state.row = { call_count: 10, consecutive_failure_count: 4, circuit_state: "closed", circuit_opened_at: null };
    const failing = vi.fn(async (): Promise<{ status: "ok" | "unavailable" }> => ({ status: "unavailable" }));

    const first = await withCostGuard("org-1", "routing", failing, (r) => r.status === "ok");
    expect(first.status).toBe("ok"); // the call itself is allowed through; only the *bookkeeping* records failure
    expect(state.row?.circuit_state).toBe("open");

    // Next call should now be blocked outright — doCall must never be reached.
    const doCall2 = vi.fn(async () => ({ status: "ok" as const }));
    const second = await withCostGuard("org-1", "routing", doCall2, (r) => r.status === "ok");
    expect(second).toEqual({ status: "blocked", reason: "circuit_open" });
    expect(doCall2).not.toHaveBeenCalled();
  });

  it("moves an open circuit to half-open after cooldown and allows exactly one trial call", async () => {
    state.row = {
      call_count: 10,
      consecutive_failure_count: 5,
      circuit_state: "open",
      circuit_opened_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(), // 3 min ago, cooldown is 2 min
    };
    const doCall = vi.fn(async () => ({ status: "ok" as const }));

    const outcome = await withCostGuard("org-1", "routing", doCall, (r) => r.status === "ok");

    expect(outcome.status).toBe("ok");
    expect(doCall).toHaveBeenCalledTimes(1);
    // A successful half-open trial should close the circuit again.
    expect(state.row?.circuit_state).toBe("closed");
  });

  it("blocks when the counter table itself is unreadable (fails closed)", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({
      createSupabaseAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) }),
          }),
        }),
        rpc: async () => ({ data: null, error: null }),
      }),
    }));
    // Re-import with the failing mock for this one test.
    vi.resetModules();
    const { withCostGuard: withCostGuardFailing } = await import("./costGuard");
    const doCall = vi.fn(async () => ({ status: "ok" as const }));
    const outcome = await withCostGuardFailing("org-1", "geocode", doCall, (r) => r.status === "ok");
    expect(outcome).toEqual({ status: "blocked", reason: "counter_unavailable" });
    expect(doCall).not.toHaveBeenCalled();
  });
});
