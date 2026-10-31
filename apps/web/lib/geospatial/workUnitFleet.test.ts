import { describe, expect, it } from "vitest";
import { RESERVATION_WORDS, workUnitHasNoVehicles } from "./workUnitFleet";

function fake(locations: { id: string; name: string }[], count: number | null, error: unknown = null) {
  return {
    from: (table: string) => {
      if (table === "vehicle_locations") return { select: async () => ({ data: locations }) };
      const chain: any = { select: () => chain, is: () => chain, eq: async () => ({ count, error }) };
      return chain;
    },
  } as never;
}

describe("workUnitHasNoVehicles", () => {
  const locs = [{ id: "l1", name: "Iracemápolis" }, { id: "l2", name: "São Paulo Office" }];
  it("is true when the unit is a registered location with no vehicle", async () => {
    expect(await workUnitHasNoVehicles(fake(locs, 0), "Iracemápolis")).toBe(true);
  });
  it("is false when the unit has vehicles", async () => {
    expect(await workUnitHasNoVehicles(fake(locs, 3), "Iracemápolis")).toBe(false);
  });
  it("is false when the unit is not a registered location or the read fails", async () => {
    expect(await workUnitHasNoVehicles(fake(locs, 0), "Lugar nenhum")).toBe(false);
    expect(await workUnitHasNoVehicles(fake(locs, null, { message: "x" }), "Iracemápolis")).toBe(false);
  });
});

describe("RESERVATION_WORDS", () => {
  it("matches a vehicle request but not an unrelated question", () => {
    expect(RESERVATION_WORDS.test("preciso de um carro amanhã")).toBe(true);
    expect(RESERVATION_WORDS.test("quais são as regras de manutenção?")).toBe(false);
  });
});
