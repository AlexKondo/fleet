import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = {
  user: { id: "u1" } as { id: string } | null,
  profile: { organization_id: "org1" } as { organization_id: string } | null,
  policy: { ok: true, policy: { carpoolEnabled: true } } as unknown,
  geocode: vi.fn(),
  route: vi.fn(),
  image: vi.fn(),
  rpc: vi.fn(),
  locale: "pt-BR",
  providerOptions: [] as unknown[],
};
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: state.profile }) }) }) }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: (...a: unknown[]) => state.rpc(...a) }) }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: async () => state.locale }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/carpool/loadPolicy", () => ({ loadLatestPolicy: async () => state.policy }));
vi.mock("@/lib/geospatial/corporateMobilityPoints", () => ({ listCorporateMobilityPoints: async () => ({ status: "ok", data: [] }) }));
vi.mock("@/lib/geospatial/googlePlacesProvider", () => ({
  createGooglePlacesProvider: (_org: string, options?: unknown) => (state.providerOptions.push(options), { geocode: (a: string) => state.geocode(a), searchPlaces: async () => ({ status: "unavailable", reason: "x" }) }),
}));
vi.mock("@/lib/geospatial/googleRoutingProvider", () => ({ computeRouteWithPolyline: (...a: unknown[]) => state.route(...a) }));
vi.mock("@/lib/geospatial/routeMap", () => ({ fetchRouteMapImage: (...a: unknown[]) => state.image(...a) }));

import { getTripRouteMap } from "./routeMapActions";

const KEY = "AIzaSyFAKEKEYFORACTIONTESTS0123456789abc";
const okPlace = (lat: number) => ({
  status: "ok",
  location: { coordinates: { lat, lng: -46 }, formattedAddress: `Rua Teste ${lat}, São Paulo - SP`, placeTypes: ["street_address"], partialMatch: false, providerPlaceRef: "p" },
});

beforeEach(() => {
  state.rpc = vi.fn(async () => ({ data: true, error: null }));
  state.locale = "pt-BR";
  state.providerOptions = [];
  state.user = { id: "u" + Math.random() };
  state.profile = { organization_id: "org1" };
  state.policy = { ok: true, policy: { carpoolEnabled: true } };
  state.geocode = vi.fn(async (a: string) => okPlace(a.includes("B") ? -15 : -23));
  state.route = vi.fn(async () => ({ status: "ok", distanceKm: 102.44, durationMin: 99.6, encodedPolyline: "abc" }));
  state.image = vi.fn(async () => ({ status: "ok", dataUrl: "data:image/png;base64,AAAA" }));
});

let n = 0;
const uniq = (t: string) => `${t} ${++n} ${Math.random()}`;

describe("getTripRouteMap", () => {
  it("happy path returns the data URL, labels and API-derived numbers only", async () => {
    const r = await getTripRouteMap({ originText: uniq("Rua A"), destinationText: uniq("Rua B") });
    expect(r).toMatchObject({ status: "ok", imageDataUrl: "data:image/png;base64,AAAA", distanceKm: 102.4, durationMin: 100, approximate: false });
    expect(state.geocode).toHaveBeenCalledTimes(2);
    expect(state.route).toHaveBeenCalledTimes(1);
    expect(state.image).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ originText: "", destinationText: "x" }],
    [{ originText: "x", destinationText: "   " }],
    [null as unknown as { originText: string; destinationText: string }],
  ])("invalid input %j -> invalid_input and no provider call", async (input) => {
    expect(await getTripRouteMap(input)).toEqual({ status: "unavailable", reason: "invalid_input" });
    expect(state.geocode).not.toHaveBeenCalled();
  });
  it("clamps very long text before geocoding", async () => {
    await getTripRouteMap({ originText: "A".repeat(5000), destinationText: "B".repeat(5000) });
    for (const call of state.geocode.mock.calls) expect(String(call[0]).length).toBeLessThanOrEqual(200);
  });
  it("no session -> not_authenticated, no provider call", async () => {
    state.user = null;
    expect(await getTripRouteMap({ originText: "a", destinationText: "b" })).toEqual({ status: "unavailable", reason: "not_authenticated" });
    expect(state.geocode).not.toHaveBeenCalled();
  });
  it("does NOT depend on the carpool policy (a user of an org gets the map even with carpool off / policy unreadable)", async () => {
    state.policy = { ok: true, policy: { carpoolEnabled: false } };
    expect((await getTripRouteMap({ originText: uniq("a"), destinationText: uniq("b") })).status).toBe("ok");
    state.policy = { ok: false };
    expect((await getTripRouteMap({ originText: uniq("a"), destinationText: uniq("b") })).status).toBe("ok");
  });
  it("geocoder outage -> geocode_unavailable; not found -> place_not_found", async () => {
    state.geocode = vi.fn(async () => ({ status: "unavailable", reason: "daily_quota_exceeded" }));
    expect(await getTripRouteMap({ originText: "a", destinationText: "b" })).toEqual({ status: "unavailable", reason: "geocode_unavailable" });
    state.geocode = vi.fn(async () => ({ status: "unavailable", reason: "geocode_status_ZERO_RESULTS" }));
    expect(await getTripRouteMap({ originText: "a", destinationText: "b" })).toEqual({ status: "unavailable", reason: "place_not_found" });
  });
  it("city-level place is drawn as an approximate route", async () => {
    state.geocode = vi.fn(async (a: string) => ({
      status: "ok",
      location: {
        coordinates: { lat: a === "Iracemápolis" ? -22.58 : -23.5, lng: -47.5 },
        formattedAddress: a === "Iracemápolis" ? "Iracemápolis, SP, Brasil" : "Rua B 2, São Paulo",
        placeTypes: a === "Iracemápolis" ? ["locality", "political"] : ["street_address"],
        partialMatch: false,
      },
    }));
    const r = await getTripRouteMap({ originText: "Iracemápolis", destinationText: "Rua B 2" });
    expect(r).toMatchObject({ status: "ok", approximate: true, originLabel: "Iracemápolis, SP, Brasil" });
  });
  it("route / image failures -> fixed codes, never provider text or the key", async () => {
    state.route = vi.fn(async () => ({ status: "unavailable", reason: `routes_http_403 ${KEY}` }));
    const a = await getTripRouteMap({ originText: "a", destinationText: "b" });
    expect(a).toEqual({ status: "unavailable", reason: "route_unavailable" });
    state.route = vi.fn(async () => ({ status: "ok", distanceKm: 5, durationMin: 8, encodedPolyline: "abc" }));
    state.image = vi.fn(async () => ({ status: "unavailable", reason: `static_http_403 ${KEY}` }));
    const b = await getTripRouteMap({ originText: "a", destinationText: "b" });
    expect(b).toEqual({ status: "unavailable", reason: "map_unavailable" });
    expect(JSON.stringify([a, b])).not.toContain(KEY);
  });
  it("an unexpected throw is swallowed into map_unavailable", async () => {
    state.geocode = vi.fn(async () => {
      throw new Error(KEY);
    });
    const r = await getTripRouteMap({ originText: "a", destinationText: "b" });
    expect(r).toEqual({ status: "unavailable", reason: "map_unavailable" });
  });
  it("throttles a burst from one user", async () => {
    state.user = { id: "burst" };
    let last: unknown;
    for (let i = 0; i < 25; i++) last = await getTripRouteMap({ originText: "a", destinationText: "b" });
    expect(last).toEqual({ status: "unavailable", reason: "rate_limited" });
  });
});

describe("getTripRouteMap: per-user cap, cache, kinds, language", () => {
  const input = () => ({ originText: uniq("Rua A"), destinationText: uniq("Rua B") });

  it("consumes the per-user DB cap (100) BEFORE any provider call", async () => {
    const order: string[] = [];
    state.rpc = vi.fn(async () => (order.push("rpc"), { data: true, error: null }));
    state.geocode = vi.fn(async (a: string) => (order.push("geocode"), okPlace(a.includes("B") ? -15 : -23)));
    await getTripRouteMap(input());
    expect(state.rpc).toHaveBeenCalledWith("consume_route_map_view", { p_user_id: expect.any(String), p_daily_cap: 100 });
    expect(order[0]).toBe("rpc");
  });
  it("cap reached (false) or rpc error -> rate_limited and NO provider call", async () => {
    state.rpc = vi.fn(async () => ({ data: false, error: null }));
    expect(await getTripRouteMap(input())).toEqual({ status: "unavailable", reason: "rate_limited" });
    state.rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    expect(await getTripRouteMap(input())).toEqual({ status: "unavailable", reason: "rate_limited" });
    expect(state.geocode).not.toHaveBeenCalled();
    expect(state.route).not.toHaveBeenCalled();
    expect(state.image).not.toHaveBeenCalled();
  });
  it("cache hit: no provider calls but the per-user view is still consumed; failures are not cached", async () => {
    const i = input();
    await getTripRouteMap(i);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    const again = await getTripRouteMap({ originText: "  " + i.originText.toUpperCase() + " ", destinationText: i.destinationText });
    expect(again.status).toBe("ok");
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(state.geocode).toHaveBeenCalledTimes(2);
    expect(state.route).toHaveBeenCalledTimes(1);
    expect(state.image).toHaveBeenCalledTimes(1);
    // failure is retried (not cached)
    const j = input();
    state.route = vi.fn(async () => ({ status: "unavailable", reason: "x" }));
    await getTripRouteMap(j);
    state.route = vi.fn(async () => ({ status: "ok", distanceKm: 1, durationMin: 2, encodedPolyline: "abc" }));
    expect((await getTripRouteMap(j)).status).toBe("ok");
    expect(state.route).toHaveBeenCalledTimes(1);
  });
  it("places are resolved with the map_geocode kind (never carpool's geocode / place_search)", async () => {
    await getTripRouteMap(input());
    expect(state.providerOptions).toEqual([{ geocodeKind: "map_geocode" }]);
  });
  it.each([["pt-BR", "pt-BR"], ["en-US", "en"], ["es", "es"], ["zh-CN", "zh-CN"]])("locale %s -> Static Maps language %s", async (loc, lang) => {
    state.locale = loc;
    await getTripRouteMap(input());
    expect(state.image.mock.calls.at(-1)![1]).toMatchObject({ language: lang });
  });
});
