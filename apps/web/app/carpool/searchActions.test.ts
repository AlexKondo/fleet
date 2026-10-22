import { beforeEach, describe, expect, it, vi } from "vitest";

// S3-02: the rider's search must FAIL CLOSED when the corporate mobility points cannot be read (like the host
// side), never treat the failure as "no points" and send the typed text to the external geocoder.
const s = vi.hoisted(() => ({
  points: { status: "ok", data: [] } as { status: "ok"; data: unknown[] } | { status: "error"; message: string },
  geocode: vi.fn(),
  searchPlaces: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) b[m] = () => b;
      b.single = async () => ({ data: { organization_id: "org-a" }, error: null });
      return b;
    },
  }),
}));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => ({ id: "rider-1" }) }));
vi.mock("@/lib/carpool/loadPolicy", () => ({ loadLatestPolicy: async () => ({ ok: true, policy: { carpoolEnabled: true }, policyVersion: 1 }) }));
vi.mock("@/lib/carpool/buscarCarona", async (orig) => ({ ...(await orig<object>()), deriveBuscarGate: () => "enabled" }));
vi.mock("@/lib/geospatial/corporateMobilityPoints", () => ({ listCorporateMobilityPoints: async () => s.points }));
vi.mock("@/lib/geospatial/googlePlacesProvider", () => ({
  createGooglePlacesProvider: () => ({ geocode: s.geocode, searchPlaces: s.searchPlaces }),
}));
vi.mock("@/lib/carpool/offerCardRows", () => ({ loadOfferCardRows: async () => [] }));
vi.mock("./actions", () => ({ searchCompatibleCarpool: s.search }));

import { searchBuscarCarona } from "./searchActions";

const input = () => ({
  originText: "Matriz Faria Lima",
  destinationText: "Centro Técnico Campinas",
  departureAt: new Date(Date.now() + 86_400_000).toISOString(),
  passengerCount: 1,
});

beforeEach(() => {
  s.geocode.mockReset();
  s.searchPlaces.mockReset();
  s.search.mockReset();
});

describe("searchBuscarCarona with unreadable corporate points (S3-02)", () => {
  it("stops with points_unavailable and never calls the geocoder or the engine", async () => {
    s.points = { status: "error", message: "permission denied for table corporate_mobility_points" };
    const result = await searchBuscarCarona(input());
    expect(result).toEqual({ status: "unavailable", reason: "points_unavailable" });
    expect(s.geocode).not.toHaveBeenCalled();
    expect(s.searchPlaces).not.toHaveBeenCalled();
    expect(s.search).not.toHaveBeenCalled();
  });

  it("does not expose the technical database message", async () => {
    s.points = { status: "error", message: "permission denied for table corporate_mobility_points" };
    expect(JSON.stringify(await searchBuscarCarona(input()))).not.toContain("permission denied");
  });

  it("a readable (even empty) list still proceeds past the points step", async () => {
    s.points = { status: "ok", data: [] };
    s.geocode.mockResolvedValue({ status: "unavailable", reason: "geocoding_unavailable" });
    s.searchPlaces.mockResolvedValue({ status: "unavailable", reason: "geocoding_unavailable" });
    const result = await searchBuscarCarona(input());
    expect(result).not.toEqual({ status: "unavailable", reason: "points_unavailable" });
  });
});
