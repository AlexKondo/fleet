import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = {
  user: { id: "u1" } as { id: string } | null,
  profile: { organization_id: "org1" } as { organization_id: string } | null,
  policy: { ok: true, policy: { carpoolEnabled: true } } as unknown,
  points: [] as unknown[],
  rpc: vi.fn(),
  google: vi.fn(),
  locale: "pt-BR",
};
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: state.profile }) }) }) }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: (...a: unknown[]) => state.rpc(...a) }) }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: async () => state.locale }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/carpool/loadPolicy", () => ({ loadLatestPolicy: async () => state.policy }));
vi.mock("@/lib/geospatial/corporateMobilityPoints", () => ({ listCorporateMobilityPoints: async () => ({ status: "ok", data: state.points }) }));
vi.mock("@/lib/geospatial/costGuard", () => ({ withCostGuard: async (_o: string, _k: string, f: () => Promise<unknown>) => ({ status: "ok", result: await f() }) }));
vi.mock("@/lib/geospatial/placeAutocomplete", async () => {
  const actual = await vi.importActual<typeof import("@/lib/geospatial/placeAutocomplete")>("@/lib/geospatial/placeAutocomplete");
  return { ...actual, autocompleteAddress: (...a: unknown[]) => state.google(...a) };
});

import { suggestPlaces } from "./placeAutocompleteActions";

const googleOk = (n: number) => ({
  status: "ok",
  suggestions: Array.from({ length: n }, (_, i) => ({ id: `g${i}`, text: `Rua G${i}`, main: `Rua G${i}`, secondary: "", kind: "place" })),
});
let uid = 0;

beforeEach(() => {
  state.user = { id: `u${++uid}` };
  state.profile = { organization_id: "org1" };
  state.policy = { ok: true, policy: { carpoolEnabled: true } };
  state.points = [];
  state.locale = "pt-BR";
  state.rpc = vi.fn(async () => ({ data: true, error: null }));
  state.google = vi.fn(async () => googleOk(6));
});

describe("suggestPlaces", () => {
  it("clamps: too short -> invalid_input, no quota, no provider", async () => {
    expect(await suggestPlaces({ input: "ab" })).toEqual({ status: "unavailable", reason: "invalid_input" });
    expect(await suggestPlaces(null as unknown as { input: string })).toEqual({ status: "unavailable", reason: "invalid_input" });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.google).not.toHaveBeenCalled();
  });
  it("long input is clamped to 120 before the provider", async () => {
    await suggestPlaces({ input: "A".repeat(900) });
    expect(String(state.google.mock.calls[0]![1])).toHaveLength(120);
  });
  it("no session -> not_authenticated, nothing consumed", async () => {
    state.user = null;
    expect(await suggestPlaces({ input: "abcd" })).toEqual({ status: "unavailable", reason: "not_authenticated" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("does NOT depend on the carpool policy (autocomplete works with carpool off / policy unreadable)", async () => {
    state.policy = { ok: true, policy: { carpoolEnabled: false } };
    expect((await suggestPlaces({ input: "abcd" })).status).toBe("ok");
    state.policy = { ok: false };
    expect((await suggestPlaces({ input: "abcd" })).status).toBe("ok");
  });
  it("a user without an org profile -> not_authenticated, nothing consumed", async () => {
    state.profile = null;
    expect(await suggestPlaces({ input: "abcd" })).toEqual({ status: "unavailable", reason: "not_authenticated" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("consumes the per-user cap (400, place_autocomplete) BEFORE the provider call", async () => {
    const order: string[] = [];
    state.rpc = vi.fn(async () => (order.push("rpc"), { data: true, error: null }));
    state.google = vi.fn(async () => (order.push("google"), googleOk(2)));
    await suggestPlaces({ input: "Avenida Paulista" });
    expect(order).toEqual(["rpc", "google"]);
    expect(state.rpc).toHaveBeenCalledWith("consume_user_geo_quota", { p_user_id: state.user!.id, p_kind: "place_autocomplete", p_daily_cap: 400 });
  });
  it("cap reached or cap RPC error -> rate_limited and NO provider call", async () => {
    state.rpc = vi.fn(async () => ({ data: false, error: null }));
    expect(await suggestPlaces({ input: "abcd" })).toEqual({ status: "unavailable", reason: "rate_limited" });
    state.rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    expect(await suggestPlaces({ input: "abcd" })).toEqual({ status: "unavailable", reason: "rate_limited" });
    expect(state.google).not.toHaveBeenCalled();
  });
  it("mobility points come first and are labelled as points; total capped at 6", async () => {
    state.points = [
      { id: "p1", organizationId: "org1", name: "Matriz Paulista", aliases: [], addressLabel: "Av. Paulista, 1", latitude: 1, longitude: 1, isActive: true, category: null, providerPlaceRef: null },
    ];
    state.google = vi.fn(async (_o, _i, _l, _t, limit: number) => googleOk(limit + 3));
    const r = await suggestPlaces({ input: "paulista" });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.suggestions[0]).toMatchObject({ kind: "point", text: "Matriz Paulista" });
    expect(r.suggestions.length).toBeLessThanOrEqual(6);
    expect(state.google.mock.calls[0]![4]).toBe(5);
  });
  it("provider outage: only points (if any) else unavailable; never provider text", async () => {
    state.google = vi.fn(async () => ({ status: "unavailable", reason: "autocomplete_http_403 AIzaSecret" }));
    const none = await suggestPlaces({ input: "abcd" });
    expect(none).toEqual({ status: "unavailable", reason: "unavailable" });
    expect(JSON.stringify(none)).not.toContain("AIza");
    state.points = [{ id: "p1", organizationId: "org1", name: "Abcd Matriz", aliases: [], addressLabel: "X", latitude: 1, longitude: 1, isActive: true, category: null, providerPlaceRef: null }];
    const some = await suggestPlaces({ input: "abcd" });
    expect(some).toMatchObject({ status: "ok", suggestions: [{ kind: "point" }] });
  });
  it("locale -> languageCode; session token passed through only when UUID-like", async () => {
    state.locale = "en-US";
    await suggestPlaces({ input: "abcd", sessionToken: "123e4567-e89b-12d3-a456-426614174000" });
    expect(state.google.mock.calls[0]![2]).toBe("en");
    expect(state.google.mock.calls[0]![3]).toBe("123e4567-e89b-12d3-a456-426614174000");
    await suggestPlaces({ input: "abcd", sessionToken: "not a token!" });
    expect(state.google.mock.calls[1]![3]).toBeUndefined();
  });
  it("burst throttle (per instance)", async () => {
    let last: unknown;
    for (let i = 0; i < 30; i++) last = await suggestPlaces({ input: "abcd" });
    expect(last).toEqual({ status: "unavailable", reason: "rate_limited" });
  });
});
