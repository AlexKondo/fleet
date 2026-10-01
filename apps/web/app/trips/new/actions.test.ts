import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase C5: planTrip / planTripAction / confirmTrip gating around the new carpool engine.
 *  - when the org policy has carpool enabled, the OLD city-string matcher must get NO candidates
 *    (a pack NO-GO) - and when carpool is disabled by policy NO carpool is offered at all (decision L3: the
 *    old matcher gets no candidates for any org since 0063, and the legacy join path is refused by RLS);
 *  - confirmTrip publishes seats only after a valid reservation, validates them against the
 *    chosen vehicle's capacity, and a publishing failure never undoes the reservation.
 */

const h = vi.hoisted(() => ({
  policyRow: null as null | Record<string, unknown>,
  policyError: false,
  planMobility: vi.fn(),
  rpc: vi.fn(),
  enable: vi.fn(),
  search: vi.fn(),
  geocode: vi.fn(),
  tables: {} as Record<string, unknown>,
  busy: [] as { vehicle_id: string; start_at: string; end_at: string; status: string }[],
  redirects: [] as string[],
}));

class RedirectSignal extends Error {
  constructor(public url: string) {
    super("NEXT_REDIRECT");
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirects.push(url);
    throw new RedirectSignal(url);
  },
}));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => ({ id: "user-1", email: "u@x" }) }));
vi.mock("@/lib/formatDateTime", () => ({ formatDateTime: () => "t" }));
vi.mock("@/lib/getAppUrl", () => ({ getAppUrl: () => "http://x" }));
vi.mock("@/lib/email/recipients", () => ({ getFleetManagerEmails: async () => [] }));
vi.mock("@/lib/email/renderEmail", () => ({ renderEmail: () => ({ html: "", text: "" }) }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/domain/orgConfig", () => ({
  loadOrgConfig: async () => ({ trafficRestrictionEnabled: true, carpool: {}, readiness: {}, bookingMode: "ai_recommended" }),
}));
vi.mock("@/lib/domain/mappers", () => ({
  VEHICLE_CATEGORY_DOMAIN_COLUMNS: "x",
  VEHICLE_DOMAIN_COLUMNS: "id, plate",
  toDomainVehicle: (row: { id: string; plate: string }) => ({ id: row.id, plate: row.plate }),
  toDomainCategory: (row: { name: string; passenger_capacity: number }) => ({
    name: row.name,
    passengerCapacity: row.passenger_capacity,
  }),
}));
vi.mock("@fleet/domain", async (orig) => {
  const actual = await orig<typeof import("@fleet/domain")>();
  return { ...actual, planMobility: (...a: unknown[]) => h.planMobility(...a) };
});
vi.mock("@/app/carpool/actions", () => ({ searchCompatibleCarpool: (...a: unknown[]) => h.search(...a) }));
vi.mock("@/app/carpool/requestActions", () => ({ enableCarpoolOffer: (...a: unknown[]) => h.enable(...a) }));
vi.mock("@/lib/geospatial/googlePlacesProvider", () => ({
  createGooglePlacesProvider: () => ({
    geocode: (...a: unknown[]) => h.geocode(...a),
    searchPlaces: async () => ({ status: "ok", results: [] }),
  }),
}));
vi.mock("@/lib/geospatial/corporateMobilityPoints", () => ({
  listCorporateMobilityPoints: async () => ({ status: "ok", data: [] }),
}));

// A chainable, thenable fake of the supabase-js query builder.
function builder(table: string) {
  const result = (single = false) => {
    if (single && h.tables[table + ":single"] !== undefined) return { data: h.tables[table + ":single"], error: null };
    if (table === "carpool_policy_settings") {
      return h.policyError ? { data: null, error: { message: "boom" } } : { data: h.policyRow, error: null };
    }
    return { data: h.tables[table] ?? null, error: null };
  };
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result());
      if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve(result(true));
      return () => proxy;
    },
  });
  return proxy;
}
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => builder(table),
    // 0063: the busy-window read is a definer RPC; everything else goes to the shared rpc mock.
    rpc: (name: string, ...rest: unknown[]) =>
      name === "get_vehicle_busy_windows" ? Promise.resolve({ data: h.busy, error: null }) : h.rpc(name, ...rest),
  }),
}));
vi.mock("@/lib/carpool/offerCardRows", () => ({ loadOfferCardRows: async () => [] }));

import { confirmTrip, planTrip, planTripAction } from "./actions";

const input = {
  departureAt: "2026-10-20T12:00:00.000Z",
  expectedReturnAt: "2026-10-20T18:00:00.000Z",
  origin: "Fábrica GWM",
  destination: "Av. Paulista 1000",
  distanceKm: 100,
  passengerCount: 2,
  requiresCargo: false,
  justification: "j",
  allowCarpool: true,
};

const policy = (over: Record<string, unknown> = {}) => ({
  policy_version: 3,
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
  ...over,
});

const vehiclePlan = {
  type: "vehicle",
  reasons: [],
  vehicle: { recommendedVehicleId: "v1", reasons: [], rankedEligible: [{ vehicleId: "v1", reasons: [] }] },
};

beforeEach(() => {
  h.policyRow = policy();
  h.policyError = false;
  h.redirects.length = 0;
  h.planMobility.mockReset().mockReturnValue(vehiclePlan);
  h.rpc.mockReset().mockResolvedValue({ data: "res-1", error: null });
  h.enable.mockReset().mockResolvedValue({ status: "success", offerId: "o1" });
  h.search.mockReset().mockResolvedValue({ status: "matches", matches: [] });
  h.geocode.mockReset();
  h.busy = [];
  h.tables = {
    profiles: { organization_id: "org-1" },
    vehicles: [{ id: "v1", plate: "ABC1D23", name: "Car", category: { name: "SUV", passenger_capacity: 5, energy_type: "ICE" } }],
    // one ACTIVE reservation = one candidate for the OLD city-string matcher
    reservations: [
      {
        id: "r9",
        vehicle_id: "v9",
        end_at: "2099-01-01T00:00:00Z",
        trip_request: {
          id: "t9", departure_at: "2026-10-20T12:00:00Z", expected_return_at: "2026-10-20T18:00:00Z", origin: "Fábrica GWM",
          destination: "São Paulo", distance_km: 100, passenger_count: 1, requires_cargo: false, justification: "j",
          requester_id: "other", organization_id: "org-1", allow_carpool: true,
        },
        vehicle: { plate: "ZZZ9Z99", category: { passenger_capacity: 5, supports_cargo: true } },
      },
    ],
    trip_participants: [],
  };
});

const carpoolCandidatesPassed = () => (h.planMobility.mock.calls[0]![0] as { carpoolCandidates: unknown[] }).carpoolCandidates;

describe("planTrip gating of the OLD text-matching carpool path", () => {
  it("carpool enabled by policy => planMobility receives NO old-engine carpool candidates", async () => {
    await planTrip(input);
    expect(carpoolCandidatesPassed()).toEqual([]);
  });

  it("0063: policy carpool_enabled=false => NO old candidates either (other travelers' trips are not readable; no carpool offered)", async () => {
    h.policyRow = policy({ carpool_enabled: false });
    await planTrip(input);
    expect(carpoolCandidatesPassed()).toEqual([]);
  });

  it("0063: a vehicle with an active reservation (busy window) is never offered; windows carry no personal data", async () => {
    h.busy = [{ vehicle_id: "v1", start_at: "2026-10-20T12:00:00Z", end_at: "2099-01-01T00:00:00Z", status: "confirmed" }];
    await planTrip(input);
    const candidates = (h.planMobility.mock.calls[0]![0] as { vehicleCandidates: unknown[] }).vehicleCandidates;
    expect(candidates).toEqual([]);
  });

  it("0063: planning never reads the reservations / trip_requests / trip_participants tables of other users", async () => {
    const seen: string[] = [];
    h.tables = new Proxy(h.tables, { get: (t, p) => { seen.push(String(p)); return (t as Record<string, unknown>)[p as string]; } });
    await planTrip(input);
    expect(seen.filter((t) => ["reservations", "trip_requests", "trip_participants"].includes(t.replace(":single", "")))).toEqual([]);
  });

  it("no policy row (default policy, carpool on) => new engine owns carpool, old matcher suppressed", async () => {
    h.policyRow = null;
    await planTrip(input);
    expect(carpoolCandidatesPassed()).toEqual([]);
  });

  it("policy query failure fails CLOSED on the old matcher (never a city-string offer)", async () => {
    h.policyError = true;
    const result = await planTrip(input);
    expect(carpoolCandidatesPassed()).toEqual([]);
    expect(result.carpoolGating).toMatchObject({ newEngine: true, hostStep: false });
  });

  it("exposes the gating and the seats the host may offer (capacity 5 - declared 2 = 3)", async () => {
    const result = await planTrip(input);
    expect(result.carpoolGating).toMatchObject({ newEngine: true, carpoolFirst: true, hostStep: true });
    expect(result.vehicle?.maxOfferableSeats).toBe(3);
  });
});

describe("planTripAction (form-bound): carpool-first", () => {
  const formData = () => {
    const f = new FormData();
    f.set("departureAt", "2026-10-20T12:00");
    f.set("expectedReturnAt", "2026-10-20T18:00");
    f.set("origin", input.origin);
    f.set("destination", input.destination);
    f.set("distanceKm", "100");
    f.set("passengerCount", "2");
    f.set("justification", "j");
    f.set("allowCarpool", "on");
    return f;
  };

  it("city-only destination => needs_precision, the matching search is never run, vehicle plan still returned", async () => {
    h.geocode.mockImplementation(async (text: string) =>
      text === "Av. Paulista 1000"
        ? { status: "ok", location: { coordinates: { lat: -23.5, lng: -46.6 }, formattedAddress: "São Paulo", source: "geocoding_provider", placeTypes: ["locality", "political"] } }
        : { status: "ok", location: { coordinates: { lat: -22.5, lng: -47.5 }, formattedAddress: "Fábrica, Iracemápolis", source: "geocoding_provider", placeTypes: ["establishment"] } },
    );
    const result = await planTripAction(null, formData());
    expect(result.carpoolFirst).toMatchObject({ status: "needs_precision", destination: { ok: false, reason: "city_level" }, origin: { ok: true } });
    expect(h.search).not.toHaveBeenCalled();
    expect(result.type).toBe("vehicle");
  });

  it("both places precise => runs the search with the RESOLVED coordinates", async () => {
    h.geocode.mockImplementation(async (text: string) => ({
      status: "ok",
      location: { coordinates: text.startsWith("Fábrica") ? { lat: -22.5, lng: -47.5 } : { lat: -23.5, lng: -46.6 }, formattedAddress: text, source: "geocoding_provider", placeTypes: ["street_address"] },
    }));
    const result = await planTripAction(null, formData());
    expect(h.search).toHaveBeenCalledWith(
      expect.objectContaining({ requestedSeats: 2, pickup: { lat: -22.5, lng: -47.5 }, dropoff: { lat: -23.5, lng: -46.6 } }),
    );
    expect(result.carpoolFirst?.status).toBe("none");
  });

  it("provider outage => carpoolFirst unavailable (banner), vehicle plan untouched", async () => {
    h.geocode.mockResolvedValue({ status: "unavailable", reason: "circuit_open" });
    const result = await planTripAction(null, formData());
    expect(result.carpoolFirst).toEqual({ status: "unavailable", reason: "circuit_open" });
    expect(result.type).toBe("vehicle");
  });

  it("carpool disabled by policy => no carpool-first block at all, no provider call", async () => {
    h.policyRow = policy({ carpool_enabled: false });
    const result = await planTripAction(null, formData());
    expect(result.carpoolFirst).toBeUndefined();
    expect(h.geocode).not.toHaveBeenCalled();
  });

  it("carpool enabled but carpool-first off => no rider-side search", async () => {
    h.policyRow = policy({ carpool_first_enabled: false });
    const result = await planTripAction(null, formData());
    expect(result.carpoolFirst).toBeUndefined();
    expect(h.geocode).not.toHaveBeenCalled();
  });
});

describe("confirmTrip: host offer step", () => {
  async function confirm(over: Record<string, unknown> = {}) {
    try {
      await confirmTrip({ ...input, choice: "vehicle", targetId: "v1", ...over } as never);
    } catch (e) {
      if (!(e instanceof RedirectSignal)) throw e;
    }
  }
  beforeEach(() => {
    // the post-create lookup of the new reservation's trip_request id
    h.tables["reservations:single"] = { trip_request_id: "trip-new" };
  });

  it("publishes the chosen seats for the JUST-CREATED reservation only, then goes to /trips", async () => {
    await confirm({ offerSeats: 2 });
    expect(h.rpc).toHaveBeenCalledWith("create_vehicle_reservation", expect.objectContaining({ p_allow_carpool: true }));
    expect(h.enable).toHaveBeenCalledWith("trip-new", 2, "res-1");
    expect(h.redirects).toEqual(["/trips"]);
  });

  it("no offerSeats (answered No) => nothing is published", async () => {
    await confirm({});
    expect(h.enable).not.toHaveBeenCalled();
    expect(h.redirects).toEqual(["/trips"]);
  });

  it("seats above the vehicle's free capacity (5 - 2 = 3) are refused BEFORE publishing; the reservation stands and the user is told", async () => {
    await confirm({ offerSeats: 4 });
    expect(h.rpc).toHaveBeenCalledWith("create_vehicle_reservation", expect.anything());
    expect(h.enable).not.toHaveBeenCalled();
    expect(h.redirects).toEqual(["/reservations/res-1?carpoolPublish=CARPOOL_INVALID_SEATS"]);
  });

  it("a publishing failure is NON-FATAL: reservation already created, redirect to My Trip with the error code to retry", async () => {
    h.enable.mockResolvedValue({ status: "error", error: "CARPOOL_SEATS_EXCEED_CAPACITY" });
    await confirm({ offerSeats: 3 });
    expect(h.redirects).toEqual(["/reservations/res-1?carpoolPublish=CARPOOL_SEATS_EXCEED_CAPACITY"]);
  });

  it("when the reservation itself fails, nothing is published", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "23P01", message: "conflict" } });
    const result = await confirmTrip({ ...input, choice: "vehicle", targetId: "v1", offerSeats: 2 } as never);
    expect(result).toEqual({ success: false, error: "RESERVATION_CONFLICT" });
    expect(h.enable).not.toHaveBeenCalled();
  });

  it("policy with carpool disabled ignores offerSeats (nothing is published)", async () => {
    h.policyRow = policy({ carpool_enabled: false });
    await confirm({ offerSeats: 2 });
    expect(h.enable).not.toHaveBeenCalled();
    expect(h.redirects).toEqual(["/trips"]);
  });

  it("garbage seats (0, negative, fractional, NaN) never reach the RPC", async () => {
    for (const offerSeats of [0, -1, 1.5, Number.NaN]) {
      h.redirects.length = 0;
      await confirm({ offerSeats });
    }
    expect(h.enable).not.toHaveBeenCalled();
  });
});
