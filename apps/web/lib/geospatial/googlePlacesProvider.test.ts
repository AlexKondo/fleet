import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Cost Guard always allows the call through in these tests — its own behavior is covered by
// costGuard.test.ts. This isolates the provider's own fetch/parsing logic.
vi.mock("./costGuard", () => ({
  withCostGuard: async (_org: string, _kind: string, doCall: () => Promise<unknown>) => ({
    status: "ok",
    result: await doCall(),
  }),
}));

import { geocodeAddress, searchPlaces } from "./googlePlacesProvider";

const ORIGINAL_ENV = process.env.GOOGLE_MAPS_API_KEY;

describe("googlePlacesProvider", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = ORIGINAL_ENV;
    vi.unstubAllGlobals();
  });

  describe("geocodeAddress", () => {
    it("returns unavailable when the API key is missing", async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      const outcome = await geocodeAddress("org-1", "Av. Paulista, 1000");
      expect(outcome).toEqual({ status: "unavailable", reason: "missing_api_key" });
    });

    it("parses a successful OK response into a ResolvedLocation", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "OK",
          results: [
            {
              formatted_address: "Av. Paulista, 1000 - São Paulo, SP",
              place_id: "abc123",
              geometry: { location: { lat: -23.5613, lng: -46.6565 } },
            },
          ],
        }),
      });

      const outcome = await geocodeAddress("org-1", "Av. Paulista, 1000");
      expect(outcome).toEqual({
        status: "ok",
        location: {
          coordinates: { lat: -23.5613, lng: -46.6565 },
          formattedAddress: "Av. Paulista, 1000 - São Paulo, SP",
          providerPlaceRef: "abc123",
          source: "geocoding_provider",
        },
      });
    });

    it("returns unavailable, never throws, on a malformed response body", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ nonsense: true }),
      });
      const outcome = await geocodeAddress("org-1", "x");
      expect(outcome.status).toBe("unavailable");
    });

    it("returns unavailable on a non-OK Google status (e.g. ZERO_RESULTS)", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ZERO_RESULTS", results: [] }),
      });
      const outcome = await geocodeAddress("org-1", "asdkjaslkdj");
      expect(outcome).toEqual({ status: "unavailable", reason: "geocode_status_ZERO_RESULTS" });
    });

    it("returns unavailable on quota-exceeded (4xx) responses", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 403, text: async () => "quota exceeded" });
      const outcome = await geocodeAddress("org-1", "x");
      expect(outcome).toEqual({ status: "unavailable", reason: "geocode_http_403" });
    });

    it("returns unavailable on a 5xx server error", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500, text: async () => "server error" });
      const outcome = await geocodeAddress("org-1", "x");
      expect(outcome).toEqual({ status: "unavailable", reason: "geocode_http_500" });
    });

    it("returns unavailable, never throws, when fetch itself rejects (e.g. timeout)", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("timeout"));
      const outcome = await geocodeAddress("org-1", "x");
      expect(outcome).toEqual({ status: "unavailable", reason: "timeout" });
    });
  });

  describe("searchPlaces", () => {
    it("parses a successful places:searchText response", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          places: [
            {
              id: "place-1",
              displayName: { text: "Shopping Morumbi" },
              formattedAddress: "Av. Roque Petroni Jr, 1089",
              location: { latitude: -23.6237, longitude: -46.7006 },
            },
          ],
        }),
      });
      const outcome = await searchPlaces("org-1", "shopping morumbi");
      expect(outcome).toEqual({
        status: "ok",
        results: [
          {
            displayName: "Shopping Morumbi",
            formattedAddress: "Av. Roque Petroni Jr, 1089",
            coordinates: { lat: -23.6237, lng: -46.7006 },
            providerPlaceRef: "place-1",
          },
        ],
      });
    });

    it("skips malformed individual place entries rather than failing the whole batch", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ places: [{ id: "only-id" }] }),
      });
      const outcome = await searchPlaces("org-1", "x");
      expect(outcome).toEqual({ status: "ok", results: [] });
    });

    it("returns unavailable on 5xx", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 503, text: async () => "" });
      const outcome = await searchPlaces("org-1", "x");
      expect(outcome).toEqual({ status: "unavailable", reason: "places_http_503" });
    });
  });
});
