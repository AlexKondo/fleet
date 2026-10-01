import { describe, expect, it, vi } from "vitest";
import type { GeocodingOutcome, GeocodingProvider } from "@fleet/domain";
import { resolveLocationText, type MobilityPointForResolution } from "./resolveLocationText";

const points: MobilityPointForResolution[] = [
  {
    id: "cmp-1",
    name: "Fábrica GWM",
    aliases: ["Planta"],
    addressLabel: "Av. Exemplo 100, Iracemápolis",
    latitude: -22.58,
    longitude: -47.52,
    isActive: true,
  },
];

function geocoderReturning(outcome: GeocodingOutcome) {
  const geocode = vi.fn(async () => outcome);
  return { provider: { geocode } as GeocodingProvider, geocode };
}
const ok = (types: string[], extra: object = {}): GeocodingOutcome => ({
  status: "ok",
  location: {
    coordinates: { lat: -23.5, lng: -46.6 },
    formattedAddress: "Rua X, 10 - São Paulo",
    providerPlaceRef: "place-1",
    source: "geocoding_provider",
    placeTypes: types,
    ...extra,
  },
});

describe("resolveLocationText", () => {
  it("Corporate Mobility Point wins and never calls the geocoder (no cost)", async () => {
    const { provider, geocode } = geocoderReturning(ok(["street_address"]));
    const out = await resolveLocationText("fabrica gwm", { points, geocoder: provider });
    expect(out).toMatchObject({ status: "resolved", place: { source: "corporate_mobility_point", corporateMobilityPointId: "cmp-1" } });
    expect(geocode).not.toHaveBeenCalled();
  });

  it("a precise geocoder result is resolved with its canonical label (shown back to the rider)", async () => {
    const { provider } = geocoderReturning(ok(["street_address"]));
    const out = await resolveLocationText("Rua X 10 São Paulo", { points, geocoder: provider });
    expect(out).toMatchObject({
      status: "resolved",
      place: { label: "Rua X, 10 - São Paulo", source: "geocoding_provider", providerPlaceRef: "place-1" },
    });
  });

  it("pack 07: a city-only destination ('São Paulo') asks for precision and is NOT used", async () => {
    const { provider } = geocoderReturning(ok(["locality", "political"]));
    expect(await resolveLocationText("São Paulo", { points, geocoder: provider })).toEqual({
      status: "needs_precision",
      reason: "city_level",
    });
  });

  it("pack 07: an unresolvable address (ZERO_RESULTS) is not guessed", async () => {
    const { provider } = geocoderReturning({ status: "unavailable", reason: "geocode_status_ZERO_RESULTS" });
    expect(await resolveLocationText("asdkjh qwe", { points, geocoder: provider })).toEqual({
      status: "needs_precision",
      reason: "not_found",
    });
  });

  it("a result with no type information is treated as insufficient, never as precise", async () => {
    const { provider } = geocoderReturning(ok([]));
    expect(await resolveLocationText("somewhere", { points, geocoder: provider })).toEqual({
      status: "needs_precision",
      reason: "not_found",
    });
  });

  it("blank input asks for a place without any provider call", async () => {
    const { provider, geocode } = geocoderReturning(ok(["street_address"]));
    expect(await resolveLocationText("   ", { points, geocoder: provider })).toEqual({ status: "needs_precision", reason: "empty" });
    expect(geocode).not.toHaveBeenCalled();
  });

  it("an outage (quota / circuit open / HTTP error / missing key) is 'unavailable', not a rider error", async () => {
    for (const reason of ["circuit_open", "geocode_http_500", "missing_api_key", "geocode_status_OVER_QUERY_LIMIT"]) {
      const { provider } = geocoderReturning({ status: "unavailable", reason });
      expect(await resolveLocationText("Rua X 10", { points, geocoder: provider })).toEqual({ status: "unavailable", reason });
    }
  });

  it("over-long text is truncated before it reaches the provider", async () => {
    const { provider, geocode } = geocoderReturning(ok(["street_address"]));
    await resolveLocationText("a".repeat(500), { points, geocoder: provider });
    expect((geocode.mock.calls[0] as unknown as [string])[0]).toHaveLength(200);
  });
});

describe("C5 audit fix: wording per case + POI recovery via ONE Places search", () => {
  const geo = (formatted: string, types: string[]): GeocodingOutcome => ({
    status: "ok",
    location: { coordinates: { lat: -23.5, lng: -46.6 }, formattedAddress: formatted, source: "geocoding_provider", placeTypes: types },
  });
  const run = async (text: string, g: GeocodingOutcome, placesOutcome?: import("@fleet/domain").PlaceSearchOutcome) => {
    const searchPlaces = vi.fn(async () => placesOutcome ?? ({ status: "ok", results: [] } as import("@fleet/domain").PlaceSearchOutcome));
    const out = await resolveLocationText(text, {
      points: [],
      geocoder: { geocode: async () => g },
      places: { searchPlaces },
    });
    return { out, searchPlaces };
  };
  const poi = (types: string[]) => ({
    status: "ok" as const,
    results: [{ displayName: "Hospital Albert Einstein", formattedAddress: "Av. Albert Einstein, 627 - Morumbi", coordinates: { lat: -23.6, lng: -46.7 }, providerPlaceRef: "p1", types }],
  });

  it("street address: accepted, no Places call", async () => {
    const { out, searchPlaces } = await run("Av. Paulista 1000, São Paulo", geo("Av. Paulista, 1000 - SP", ["street_address"]));
    expect(out.status).toBe("resolved");
    expect(searchPlaces).not.toHaveBeenCalled();
  });
  it.each([
    ["Campinas", "Campinas, State of São Paulo, Brazil", ["locality", "political"], "city_level"],
    ["São Paulo, SP", "São Paulo, State of São Paulo, Brazil", ["locality", "political"], "city_level"],
    ["Minas Gerais", "Minas Gerais, Brazil", ["administrative_area_level_1", "political"], "state_level"],
    ["Pinheiros, São Paulo", "Pinheiros, São Paulo - SP, Brazil", ["sublocality", "sublocality_level_1", "political"], "neighborhood_level"],
    ["01310-100", "Bela Vista, São Paulo - SP, 01310-100, Brazil", ["postal_code"], "postal_code"],
  ] as const)("%s asks for precision with the accurate reason and makes NO extra Places call", async (text, formatted, types, reason) => {
    const { out, searchPlaces } = await run(text, geo(formatted, [...types]));
    expect(out).toEqual({ status: "needs_precision", reason });
    expect(searchPlaces).not.toHaveBeenCalled();
  });
  it("POI name ('Hospital Albert Einstein, São Paulo'): geocoder says city -> ONE Places search, precise result accepted", async () => {
    const { out, searchPlaces } = await run("Hospital Albert Einstein, São Paulo", geo("São Paulo, State of São Paulo, Brazil", ["locality", "political"]), poi(["hospital", "point_of_interest", "establishment"]));
    expect(searchPlaces).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: "resolved", place: { coordinates: { lat: -23.6, lng: -46.7 }, providerPlaceRef: "p1" } });
  });
  it("POI search that only returns a city is NOT accepted (still asks)", async () => {
    const { out, searchPlaces } = await run("Algum Lugar Inexistente, São Paulo", geo("São Paulo, State of São Paulo, Brazil", ["locality", "political"]), poi(["locality", "political"]));
    expect(searchPlaces).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ status: "needs_precision", reason: "city_level" });
  });
  it("Places outage never becomes a guess", async () => {
    const { out } = await run("Hospital X, São Paulo", geo("São Paulo, Brazil", ["locality"]), { status: "unavailable", reason: "circuit_open" });
    expect(out).toEqual({ status: "needs_precision", reason: "city_level" });
  });
  it("gibberish (ZERO_RESULTS) -> not_found without a Places call", async () => {
    const { out, searchPlaces } = await run("zzqxk wvbn", { status: "unavailable", reason: "geocode_status_ZERO_RESULTS" });
    expect(out).toEqual({ status: "needs_precision", reason: "not_found" });
    expect(searchPlaces).not.toHaveBeenCalled();
  });
});
