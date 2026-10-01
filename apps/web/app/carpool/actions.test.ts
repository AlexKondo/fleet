import { beforeEach, describe, expect, it, vi } from "vitest";

type TableResult = { data: unknown; error: unknown };
const state = {
  tables: {} as Record<string, TableResult>,
  geocode: vi.fn(),
  evaluateInsertion: vi.fn(),
};

function builder(result: TableResult) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = () => b;
  b.single = async () => result;
  b.maybeSingle = async () => result;
  b.then = (resolve: (v: TableResult) => unknown) => Promise.resolve(result).then(resolve);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => builder(state.tables[table] ?? { data: null, error: null }),
  }),
}));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/geospatial/googlePlacesProvider", () => ({
  createGooglePlacesProvider: () => ({ geocode: state.geocode, searchPlaces: vi.fn() }),
}));
vi.mock("@/lib/geospatial/googleRoutingProvider", () => ({
  createGoogleRoutingProvider: () => ({ computeRoute: vi.fn(), evaluateInsertion: state.evaluateInsertion }),
}));

import { searchCompatibleCarpool } from "./actions";

const SP = { lat: -23.55, lng: -46.63 };
const draft = {
  requestedDepartureAt: "2026-10-01T12:00:00.000Z",
  requestedSeats: 1,
  requiresCargo: false,
  pickup: SP,
  dropoff: SP,
};

const policyRow = {
  carpool_enabled: true,
  carpool_first_enabled: true,
  host_opt_in_required: true,
  host_approval_required: true,
  departure_window_minutes: 15,
  return_window_minutes: 15,
  max_additional_distance_km: 5,
  max_additional_time_minutes: 10,
  max_candidates_for_precise_routing: 5,
  request_expiry_minutes: 30,
  allow_intermediate_pickup: true,
  allow_intermediate_dropoff: true,
  minimum_seat_availability: 1,
};

const offerRow = {
  id: "offer-1",
  trip_request_id: "trip-1",
  status: "active",
  seats_available: 2,
  trip_request: {
    departure_at: "2026-10-01T12:00:00.000Z",
    origin: "A",
    destination: "B",
  },
};

beforeEach(() => {
  state.geocode.mockReset();
  state.evaluateInsertion.mockReset();
  state.tables = {
    profiles: { data: { organization_id: "org-1" }, error: null },
    carpool_policy_settings: { data: policyRow, error: null },
    carpool_offers: { data: [offerRow], error: null },
    reservations: {
      data: [
        {
          trip_request_id: "trip-1",
          end_at: "2999-01-01T00:00:00.000Z",
          status: "confirmed",
          vehicle: { category: { supports_cargo: false } },
        },
      ],
      error: null,
    },
  };
});

describe("searchCompatibleCarpool input validation (C3 carry-over a/b)", () => {
  it.each([0, -1, 0.5, Number.NaN, 2.5])("rejects requestedSeats=%s before any DB/provider work", async (seats) => {
    const result = await searchCompatibleCarpool({ ...draft, requestedSeats: seats });
    expect(result).toEqual({ status: "error", error: "invalid_seats" });
    expect(state.geocode).not.toHaveBeenCalled();
    expect(state.evaluateInsertion).not.toHaveBeenCalled();
  });

  it.each([
    [{ lat: 999, lng: 0 }],
    [{ lat: 0, lng: -181 }],
    [{ lat: Number.NaN, lng: 0 }],
    [{ lat: "1", lng: 2 }],
    [null],
  ])("rejects pickup %j", async (pickup) => {
    const result = await searchCompatibleCarpool({ ...draft, pickup: pickup as never });
    expect(result).toEqual({ status: "error", error: "invalid_coordinates" });
    expect(state.geocode).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range dropoff", async () => {
    const result = await searchCompatibleCarpool({ ...draft, dropoff: { lat: 91, lng: 0 } });
    expect(result).toEqual({ status: "error", error: "invalid_coordinates" });
  });

  it("rejects an unparseable departure time", async () => {
    const result = await searchCompatibleCarpool({ ...draft, requestedDepartureAt: "garbage" });
    expect(result).toEqual({ status: "error", error: "invalid_departure" });
  });
});

describe("searchCompatibleCarpool (wrapper)", () => {
  it("fails closed when the policy query errors: unavailable, never the permissive default, no provider calls", async () => {
    state.tables.carpool_policy_settings = { data: null, error: { message: "db down" } };

    const result = await searchCompatibleCarpool(draft);

    expect(result).toEqual({ status: "unavailable", reason: "policy_unavailable" });
    expect(state.geocode).not.toHaveBeenCalled();
    expect(state.evaluateInsertion).not.toHaveBeenCalled();
  });

  it("returns no matches without any provider call when the org's policy disables carpool", async () => {
    state.tables.carpool_policy_settings = {
      data: { ...policyRow, carpool_enabled: false },
      error: null,
    };
    const result = await searchCompatibleCarpool(draft);
    expect(result).toEqual({ status: "matches", matches: [] });
    expect(state.geocode).not.toHaveBeenCalled();
  });

  it("uses the permissive default only when the query succeeded and no policy row exists", async () => {
    state.tables.carpool_policy_settings = { data: null, error: null };
    state.geocode.mockResolvedValue({
      status: "ok",
      location: { coordinates: SP, source: "geocoding_provider" },
    });
    state.evaluateInsertion.mockResolvedValue({
      status: "ok",
      result: {
        baselineDistanceKm: 10,
        baselineDurationMin: 10,
        candidateRouteDistanceKm: 11,
        candidateRouteDurationMin: 11,
        additionalDistanceKm: 1,
        additionalTimeMin: 1,
      },
    });
    const result = await searchCompatibleCarpool(draft);
    expect(result.status).toBe("matches");
    if (result.status === "matches") expect(result.matches).toHaveLength(1);
  });

  it("returns unavailable (geocoding_unavailable) when every shortlisted host address fails to geocode, and never calls the routing provider", async () => {
    state.geocode.mockResolvedValue({ status: "unavailable", reason: "geocode_http_503" });

    const result = await searchCompatibleCarpool(draft);

    expect(result).toEqual({ status: "unavailable", reason: "geocoding_unavailable" });
    expect(state.evaluateInsertion).not.toHaveBeenCalled();
  });

  it("returns unavailable (offers_unavailable) when the offers query errors", async () => {
    state.tables.carpool_offers = { data: null, error: { message: "db down" } };
    const result = await searchCompatibleCarpool(draft);
    expect(result).toEqual({ status: "unavailable", reason: "offers_unavailable" });
  });

  it("never geocodes candidates that fail Stage A", async () => {
    state.tables.carpool_offers = {
      data: [{ ...offerRow, seats_available: 0 }],
      error: null,
    };
    const result = await searchCompatibleCarpool(draft);
    expect(result).toEqual({ status: "matches", matches: [] });
    expect(state.geocode).not.toHaveBeenCalled();
  });
});

describe("regression: host answered No at reservation, later enabled an offer (allow_carpool=false)", () => {
  it("the rider's search still finds the active offer (the offer row is the consent, not the legacy flag)", async () => {
    // Even if a loader/row still carried the legacy flag as false, it must not hide the offer.
    state.tables.carpool_offers = {
      data: [{ ...offerRow, trip_request: { ...offerRow.trip_request, allow_carpool: false } }],
      error: null,
    };
    state.geocode.mockResolvedValue({ status: "ok", location: { coordinates: SP, source: "geocoding_provider" } });
    state.evaluateInsertion.mockResolvedValue({
      status: "ok",
      result: {
        baselineDistanceKm: 10, baselineDurationMin: 10, candidateRouteDistanceKm: 11,
        candidateRouteDurationMin: 11, additionalDistanceKm: 1, additionalTimeMin: 1,
      },
    });
    const result = await searchCompatibleCarpool(draft);
    expect(result.status).toBe("matches");
    if (result.status === "matches") expect(result.matches.map((m) => m.offerId)).toEqual(["offer-1"]);
  });
});
