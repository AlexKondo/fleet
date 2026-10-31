import { describe, expect, it } from "vitest";
import { RESERVATION_WORDS, workUnitHasNoVehicles } from "./workUnitFleet";

type Loc = { id: string; name: string; mobility_point_id?: string | null };
type Pt = { id: string; name: string; aliases?: string[]; address_label?: string };

function fake(locations: Loc[], points: Pt[], count: number | null, error: unknown = null) {
  return {
    from: (table: string) => {
      const rows = table === "vehicle_locations" ? locations : table === "corporate_mobility_points" ? points : null;
      if (rows) { const c: any = { select: () => c, eq: async () => ({ data: rows }) }; return c; }
      const chain: any = { select: () => chain, is: () => chain, in: async () => ({ count, error }) };
      return chain;
    },
  } as never;
}

const points: Pt[] = [{ id: "p1", name: "Iracemápolis", aliases: ["Planta de Iracemapolis", "Ira"] }, { id: "p2", name: "São Paulo Office" }];
const locs: Loc[] = [
  { id: "l1", name: "Portaria P1", mobility_point_id: "p1" },
  { id: "l2", name: "Carregador GA Shop", mobility_point_id: "p1" },
  { id: "l3", name: "Sem unidade" },
];

describe("workUnitHasNoVehicles", () => {
  it("is false when a sub-location of the unit holds vehicles", async () => {
    expect(await workUnitHasNoVehicles(fake(locs, points, 3), "Iracemápolis")).toBe(false);
    expect(await workUnitHasNoVehicles(fake(locs, points, 3), "planta de iracemapolis")).toBe(false);
  });
  it("is true when the unit's sub-locations are empty", async () => {
    expect(await workUnitHasNoVehicles(fake(locs, points, 0), "Iracemápolis")).toBe(true);
  });
  it("is true when the unit has no sub-location and matches no vehicle location", async () => {
    expect(await workUnitHasNoVehicles(fake(locs, points, 9), "São Paulo Office")).toBe(true);
  });
  it("falls back to a vehicle location with the same name", async () => {
    expect(await workUnitHasNoVehicles(fake(locs, points, 2), "Portaria P1")).toBe(false);
    expect(await workUnitHasNoVehicles(fake(locs, points, 0), "Portaria P1")).toBe(true);
  });
  it("is false when the org has no vehicle locations, the name is empty or the read fails", async () => {
    expect(await workUnitHasNoVehicles(fake([], points, 0), "Iracemápolis")).toBe(false);
    expect(await workUnitHasNoVehicles(fake(locs, points, 0), "")).toBe(false);
    expect(await workUnitHasNoVehicles(fake(locs, points, null, { message: "x" }), "Iracemápolis")).toBe(false);
  });
});

describe("RESERVATION_WORDS", () => {
  it("matches a vehicle request but not an unrelated question", () => {
    expect(RESERVATION_WORDS.test("preciso de um carro amanhã")).toBe(true);
    expect(RESERVATION_WORDS.test("quais são as regras de manutenção?")).toBe(false);
  });
});
