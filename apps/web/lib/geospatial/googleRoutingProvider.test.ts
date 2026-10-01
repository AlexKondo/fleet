import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./costGuard", () => ({
  withCostGuard: async (_org: string, _kind: string, doCall: () => Promise<unknown>) => ({
    status: "ok",
    result: await doCall(),
  }),
}));

import { evaluateRouteInsertion, createGoogleRoutingProvider } from "./googleRoutingProvider";

const ORIGINAL_ENV = process.env.GOOGLE_MAPS_API_KEY;
const SAO_PAULO = { lat: -23.5505, lng: -46.6333 };
const CAMPINAS = { lat: -22.9099, lng: -47.0626 };

describe("googleRoutingProvider", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = ORIGINAL_ENV;
    vi.unstubAllGlobals();
  });

  it("computeRoute parses distanceMeters/duration into km/min", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distanceMeters: 92575, duration: "4747s" }] }),
    });
    const provider = createGoogleRoutingProvider("org-1");
    const outcome = await provider.computeRoute(SAO_PAULO, CAMPINAS);
    expect(outcome).toEqual({ status: "ok", distanceKm: 92.575, durationMin: 4747 / 60 });
  });

  it("returns unavailable, never throws, on a malformed response (missing routes)", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });
    const provider = createGoogleRoutingProvider("org-1");
    const outcome = await provider.computeRoute(SAO_PAULO, CAMPINAS);
    expect(outcome).toEqual({ status: "unavailable", reason: "routes_no_route_found" });
  });

  it("returns unavailable on an unparseable duration string", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distanceMeters: 100, duration: "not-a-duration" }] }),
    });
    const provider = createGoogleRoutingProvider("org-1");
    const outcome = await provider.computeRoute(SAO_PAULO, CAMPINAS);
    expect(outcome).toEqual({ status: "unavailable", reason: "routes_missing_fields" });
  });

  it("returns unavailable on 4xx (quota exceeded)", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 429, text: async () => "" });
    const provider = createGoogleRoutingProvider("org-1");
    const outcome = await provider.computeRoute(SAO_PAULO, CAMPINAS);
    expect(outcome).toEqual({ status: "unavailable", reason: "routes_http_429" });
  });

  it("returns unavailable on 5xx", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500, text: async () => "" });
    const provider = createGoogleRoutingProvider("org-1");
    const outcome = await provider.computeRoute(SAO_PAULO, CAMPINAS);
    expect(outcome).toEqual({ status: "unavailable", reason: "routes_http_500" });
  });

  it("returns unavailable, never throws, when fetch rejects (timeout)", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("timeout"));
    const provider = createGoogleRoutingProvider("org-1");
    const outcome = await provider.computeRoute(SAO_PAULO, CAMPINAS);
    expect(outcome).toEqual({ status: "unavailable", reason: "timeout" });
  });

  it("evaluateRouteInsertion: candidate pickup/dropoff equal to host destination yields ~0 additional distance/time", async () => {
    // Both the baseline call and the detour-with-intermediates call resolve to the same
    // distance/duration here, simulating the trivial "candidate is on the exact same route"
    // case: additionalDistanceKm/additionalTimeMin must come out to 0.
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distanceMeters: 92575, duration: "4747s" }] }),
    });

    const outcome = await evaluateRouteInsertion("org-1", {
      hostOrigin: SAO_PAULO,
      hostDestination: CAMPINAS,
      candidatePickup: CAMPINAS,
      candidateDropoff: CAMPINAS,
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.additionalDistanceKm).toBe(0);
      expect(outcome.result.additionalTimeMin).toBe(0);
    }
    expect(fetch).toHaveBeenCalledTimes(2); // exactly one baseline + one detour call
  });

  it("evaluateRouteInsertion propagates unavailable if the baseline call fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 500, text: async () => "" });
    const outcome = await evaluateRouteInsertion("org-1", {
      hostOrigin: SAO_PAULO,
      hostDestination: CAMPINAS,
      candidatePickup: SAO_PAULO,
      candidateDropoff: CAMPINAS,
    });
    expect(outcome.status).toBe("unavailable");
  });
});
