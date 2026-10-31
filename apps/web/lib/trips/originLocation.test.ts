import { describe, expect, it } from "vitest";
import { isWorkLocationOrigin, normalizePlaceText, resolveMobilityPoint, resolveOriginLocation, splitByOrigin } from "./originLocation";

const fabrica = { id: "L1", name: "Fábrica da GWM - ao lado do restaurante" };
const spOffice = { id: "L2", name: "SP Office - 3º subsolo" };
const spPatio = { id: "L3", name: "SP Pátio Norte" };
const locations = [fabrica, spOffice, spPatio];

describe("resolveOriginLocation", () => {
  it("uses the picked location id", () => {
    expect(resolveOriginLocation(locations, { originLocationId: "L2", originText: "qualquer" })).toEqual({ kind: "location", location: spOffice });
  });
  it("an id that is not one of the org's locations is unknown (never trusted)", () => {
    expect(resolveOriginLocation(locations, { originLocationId: "OUTRA-ORG", originText: "SP Office" }).kind).toBe("unknown");
  });
  it("matches the typed text to a location name ignoring accents and case", () => {
    expect(resolveOriginLocation(locations, { originText: "fabrica da gwm - ao lado do restaurante" })).toEqual({ kind: "location", location: fabrica });
    expect(resolveOriginLocation(locations, { originText: "sp office" })).toEqual({ kind: "location", location: spOffice });
  });
  it("a city alone or an ambiguous text is not guessed", () => {
    expect(resolveOriginLocation(locations, { originText: "São Paulo" }).kind).toBe("unknown");
    expect(resolveOriginLocation(locations, { originText: "SP" }).kind).toBe("unknown");
    expect(resolveOriginLocation(locations, { originText: "" }).kind).toBe("unknown");
  });
  it("an org without registered locations has nothing to compare", () => {
    expect(resolveOriginLocation([], { originText: "São Paulo" }).kind).toBe("no_locations");
  });
});

describe("splitByOrigin", () => {
  const cars = [
    { id: 1, loc: "L1" },
    { id: 2, loc: "L1" },
    { id: 3, loc: "L2" },
    { id: 4, loc: null },
    { id: 5, loc: "DESCONHECIDO" },
  ];
  it("keeps only the vehicles at the origin and counts the rest per location", () => {
    const r = splitByOrigin(cars, (c) => c.loc, locations, "L1");
    expect(r.atOrigin.map((c) => c.id)).toEqual([1, 2]);
    expect(r.others).toEqual([{ locationId: "L2", name: spOffice.name, count: 1 }]);
    expect(r.withoutLocation).toBe(2);
  });
  it("origin without vehicles: nothing at origin (São Paulo case)", () => {
    const r = splitByOrigin(cars, (c) => c.loc, locations, "L3");
    expect(r.atOrigin).toEqual([]);
    expect(r.others.map((o) => o.locationId)).toEqual(["L1", "L2"]);
  });
});

describe("normalizePlaceText", () => {
  it("strips accents, punctuation and case", () => {
    expect(normalizePlaceText("SP Office - 3º Subsolo")).toBe("sp office 3 subsolo");
  });
});

describe("isWorkLocationOrigin", () => {
  const work = { name: "São Paulo Office", addressLabel: "EZ TOWERS - Torre A - Av. Dr. Chucri Zaidan" };
  it("recognizes the work location by name or by address, ignoring accents and case", () => {
    expect(isWorkLocationOrigin("sao paulo office", work)).toBe(true);
    expect(isWorkLocationOrigin("EZ Towers - Torre A - Av. Dr. Chucri Zaidan", work)).toBe(true);
  });
  it("does not treat another place, a short text or a missing work location as the work location", () => {
    expect(isWorkLocationOrigin("Iracemápolis", work)).toBe(false);
    expect(isWorkLocationOrigin("ab", work)).toBe(false);
    expect(isWorkLocationOrigin("São Paulo Office", null)).toBe(false);
  });
});

describe("resolveMobilityPoint", () => {
  const points = [
    { id: "p1", name: "Iracemápolis", aliases: ["Planta de Iracemapolis", "Ira"], addressLabel: "Portaria Fábrica da GWM Brasil - Iracemápolis - SP" },
    { id: "p2", name: "São Paulo Office", aliases: ["Torre de Controle"], addressLabel: "EZ TOWERS - Torre A - São Paulo - SP" },
  ];
  it("matches the name, a nickname or the address (accents and case ignored)", () => {
    expect(resolveMobilityPoint(points, "iracemapolis")?.id).toBe("p1");
    expect(resolveMobilityPoint(points, "Torre de controle")?.id).toBe("p2");
    expect(resolveMobilityPoint(points, "Portaria Fábrica da GWM Brasil - Iracemápolis - SP")?.id).toBe("p1");
  });
  it("matches an origin that contains the point name, never a guess between two points", () => {
    expect(resolveMobilityPoint(points, "fábrica de Iracemápolis")?.id).toBe("p1");
    expect(resolveMobilityPoint(points, "Iracemápolis ou São Paulo Office")).toBeNull();
    expect(resolveMobilityPoint(points, "lugar nenhum")).toBeNull();
  });
});
