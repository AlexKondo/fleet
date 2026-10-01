import { describe, expect, it } from "vitest";
import {
  classifyLocationPrecision,
  matchMobilityPoint,
  maxOfferableSeats,
  normalizeLocationText,
  validOfferSeats,
} from "./locationResolution";

describe("classifyLocationPrecision", () => {
  it("city-only result (locality) is city_level - 'São Paulo' alone is not enough", () => {
    expect(classifyLocationPrecision({ types: ["locality", "political"] })).toBe("city_level");
  });
  it("state / neighborhood / postal-code-only results are area-level", () => {
    expect(classifyLocationPrecision({ types: ["administrative_area_level_1", "political"] })).toBe("city_level");
    expect(classifyLocationPrecision({ types: ["sublocality", "political"] })).toBe("city_level");
    expect(classifyLocationPrecision({ types: ["neighborhood", "political"] })).toBe("city_level");
    expect(classifyLocationPrecision({ types: ["postal_code"] })).toBe("city_level");
  });
  it("street address, establishment and station are precise", () => {
    expect(classifyLocationPrecision({ types: ["street_address"] })).toBe("precise");
    expect(classifyLocationPrecision({ types: ["establishment", "point_of_interest"] })).toBe("precise");
    expect(classifyLocationPrecision({ types: ["premise"] })).toBe("precise");
    expect(classifyLocationPrecision({ types: ["transit_station", "point_of_interest"] })).toBe("precise");
  });
  it("a precise type wins over an accompanying political type", () => {
    expect(classifyLocationPrecision({ types: ["political", "establishment"] })).toBe("precise");
  });
  it("a bare route is precise only on a full match; a partial match is not trusted", () => {
    expect(classifyLocationPrecision({ types: ["route"] })).toBe("precise");
    expect(classifyLocationPrecision({ types: ["route"], partialMatch: true })).toBe("unknown");
  });
  it("missing / unrecognised types => unknown (never guessed precise)", () => {
    expect(classifyLocationPrecision({})).toBe("unknown");
    expect(classifyLocationPrecision({ types: [] })).toBe("unknown");
    expect(classifyLocationPrecision({ types: ["something_new"] })).toBe("unknown");
  });
});

describe("matchMobilityPoint", () => {
  const points = [
    { id: "p1", name: "Fábrica GWM", aliases: ["Planta Iracemápolis", "GWM"], addressLabel: "Av. Exemplo 100, Iracemápolis", isActive: true },
    { id: "p2", name: "Concessionária Centro", aliases: [], addressLabel: "Rua Teste 5, São Paulo", isActive: false },
  ];
  it("matches name, alias or address label, ignoring case and diacritics", () => {
    expect(matchMobilityPoint("fabrica gwm", points)?.id).toBe("p1");
    expect(matchMobilityPoint("  PLANTA   iracemapolis ", points)?.id).toBe("p1");
    expect(matchMobilityPoint("Av. Exemplo 100, Iracemápolis", points)?.id).toBe("p1");
  });
  it("is exact, never a substring/fuzzy guess", () => {
    expect(matchMobilityPoint("Fábrica", points)).toBeUndefined();
    expect(matchMobilityPoint("Iracemápolis", points)).toBeUndefined();
  });
  it("inactive points never match; blank input never matches", () => {
    expect(matchMobilityPoint("Concessionária Centro", points)).toBeUndefined();
    expect(matchMobilityPoint("   ", points)).toBeUndefined();
  });
  it("normalizeLocationText strips accents and collapses whitespace", () => {
    expect(normalizeLocationText("  São   PAULO ")).toBe("sao paulo");
  });
});

describe("maxOfferableSeats / validOfferSeats (mirror of carpool_vehicle_free_seats)", () => {
  it("capacity minus declared occupants", () => {
    expect(maxOfferableSeats(5, 1)).toBe(4);
    expect(maxOfferableSeats(5, 2)).toBe(3);
    expect(maxOfferableSeats(7, 7)).toBe(0);
  });
  it("never negative; unknown capacity => 0 (do not offer)", () => {
    expect(maxOfferableSeats(4, 9)).toBe(0);
    expect(maxOfferableSeats(null, 1)).toBe(0);
    expect(maxOfferableSeats(undefined, 1)).toBe(0);
    expect(maxOfferableSeats(Number.NaN, 1)).toBe(0);
  });
  it("valid seats are positive integers within the maximum", () => {
    expect(validOfferSeats(2, 4)).toBe(2);
    expect(validOfferSeats(4, 4)).toBe(4);
    expect(validOfferSeats(5, 4)).toBeNull();
    expect(validOfferSeats(0, 4)).toBeNull();
    expect(validOfferSeats(-1, 4)).toBeNull();
    expect(validOfferSeats(1.5, 4)).toBeNull();
    expect(validOfferSeats("2", 4)).toBeNull();
    expect(validOfferSeats(1, 0)).toBeNull();
  });
});

describe("firstSegmentKey", () => {
  it("splits on commas and ' - ' (Google formats 'Campinas - State of São Paulo, Brazil')", async () => {
    const { firstSegmentKey } = await import("./locationResolution");
    expect(firstSegmentKey("Campinas - State of São Paulo, Brazil")).toBe("campinas");
    expect(firstSegmentKey("São Paulo, SP")).toBe("sao paulo");
  });
});
