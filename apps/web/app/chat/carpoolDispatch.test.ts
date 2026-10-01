import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Rows } from "../../test/fakeSupabase";

/**
 * Phase C6 — dispatchIntent: one case per new carpool intent, each reaching EXACTLY the same
 * server services as the web UI (mocked here), plus the host "offer seats" step of a chat
 * CREATE_RESERVATION (parity with confirmTrip).
 */

const m = vi.hoisted(() => ({
  user: { id: "" },
  db: null as unknown,
  plan: {} as Record<string, unknown>,
  search: vi.fn(),
  resolve: vi.fn(),
  enable: vi.fn(),
  update: vi.fn(),
  disable: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  cancel: vi.fn(),
  requestRide: vi.fn(),
  status: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => m.db }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => (m.user.id ? { id: m.user.id } : null) }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: async () => "pt-BR" }));
vi.mock("@/app/trips/new/actions", () => ({ planTrip: async () => m.plan }));
vi.mock("@/app/reservations/[id]/actions", () => ({ postReservationMessage: vi.fn() }));
vi.mock("@/lib/email/recipients", () => ({ getFleetManagerEmails: async () => [] }));
vi.mock("@/lib/email/renderEmail", () => ({ renderEmail: vi.fn() }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/getAppUrl", () => ({ getAppUrl: () => "http://localhost" }));
vi.mock("./queries", () => ({ findActiveReservations: vi.fn(async () => []), resolveReservationId: vi.fn() }));
vi.mock("@/app/carpool/actions", () => ({ searchCompatibleCarpool: (...a: unknown[]) => m.search(...a), searchCompatibleCarpoolForChat: (...a: unknown[]) => m.search(...a) }));
vi.mock("@/app/carpool/requestActions", () => ({
  enableCarpoolOffer: (...a: unknown[]) => m.enable(...a),
  updateCarpoolOffer: (...a: unknown[]) => m.update(...a),
  disableCarpoolOffer: (...a: unknown[]) => m.disable(...a),
  acceptCarpoolRequest: (...a: unknown[]) => m.accept(...a),
  rejectCarpoolRequest: (...a: unknown[]) => m.reject(...a),
  cancelCarpoolRequest: (...a: unknown[]) => m.cancel(...a),
  requestCarpoolRide: (...a: unknown[]) => m.requestRide(...a),
}));
vi.mock("@/app/carpool/formActions", () => ({ getMyCarpoolRequestStatus: (...a: unknown[]) => m.status(...a) }));
vi.mock("@/lib/geospatial/googlePlacesProvider", () => ({ createGooglePlacesProvider: () => ({}) }));
vi.mock("@/lib/geospatial/corporateMobilityPoints", () => ({
  listCorporateMobilityPoints: async () => ({ status: "ok", data: [] }),
}));
vi.mock("@/lib/carpool/resolveLocationText", () => ({ resolveLocationText: (...a: unknown[]) => m.resolve(...a) }));

import { dispatchIntent } from "./dispatch";

const HOST = "00000000-0000-4000-8000-0000000000a1";
const RIDER = "00000000-0000-4000-8000-0000000000b1";
const TRIP = "00000000-0000-4000-8000-0000000000c1";
const RES = "00000000-0000-4000-8000-0000000000d1";
const OFFER = "00000000-0000-4000-8000-0000000000e1";
const REQ = "00000000-0000-4000-8000-0000000000f1";
const FUTURE = new Date(Date.now() + 26 * 3600_000).toISOString();

function baseRows(): Rows {
  return {
    profiles: [{ id: HOST, organization_id: "org-1" }, { id: RIDER, organization_id: "org-1" }],
    reservations: [{ id: RES, trip_request_id: TRIP, status: "confirmed", trip_request: { id: TRIP, requester_id: HOST, destination: "Campinas", departure_at: FUTURE } }],
    carpool_offers: [{ id: OFFER, trip_request_id: TRIP, host_id: HOST, status: "active", seats_offered: 2, seats_available: 2, created_at: "1", trip_request: { destination: "Campinas", departure_at: FUTURE } }],
    carpool_ride_requests: [
      { id: REQ, carpool_offer_id: OFFER, rider_id: RIDER, status: "PENDING", requested_seats: 1, requested_departure_at: FUTURE, rider: { full_name: "Ana Silva" }, created_at: "1" },
    ],
  };
}

function useDb(userId: string, rows: Rows = baseRows()) {
  m.user.id = userId;
  const db = fakeSupabase(rows);
  m.db = db;
  return db;
}

beforeEach(() => {
  for (const fn of [m.search, m.resolve, m.enable, m.update, m.disable, m.accept, m.reject, m.cancel, m.requestRide, m.status]) fn.mockReset();
  m.resolve.mockImplementation(async (t: string) => ({
    status: "resolved",
    place: { label: t, coordinates: { lat: -23.5, lng: -46.6 }, source: "geocoding_provider" },
  }));
  m.enable.mockResolvedValue({ status: "success", offerId: OFFER });
  m.update.mockResolvedValue({ status: "success" });
  m.disable.mockResolvedValue({ status: "success" });
  m.accept.mockResolvedValue({ status: "success" });
  m.reject.mockResolvedValue({ status: "success" });
  m.cancel.mockResolvedValue({ status: "success" });
  m.requestRide.mockResolvedValue({ status: "success", requestId: "r1" });
  m.status.mockResolvedValue({ status: "PENDING" });
  m.search.mockResolvedValue({ status: "matches", matches: [] });
});

describe("dispatchIntent: carpool intents reach the same services as the web UI", () => {
  it("is refused when there is no session", async () => {
    useDb("");
    expect(await dispatchIntent("ACCEPT_CARPOOL_REQUEST", { requestId: REQ })).toEqual({ success: false, message: "not_authenticated" });
    expect(m.accept).not.toHaveBeenCalled();
  });

  it("OFFER_CARPOOL -> updateCarpoolOffer/enableCarpoolOffer", async () => {
    useDb(HOST);
    expect((await dispatchIntent("OFFER_CARPOOL", { seats: "2", tripRequestId: TRIP })).success).toBe(true);
    expect(m.update).toHaveBeenCalledWith(OFFER, 2, RES);
  });

  it("DISABLE_CARPOOL -> disableCarpoolOffer", async () => {
    useDb(HOST);
    expect((await dispatchIntent("DISABLE_CARPOOL", { offerId: OFFER })).success).toBe(true);
    expect(m.disable).toHaveBeenCalledWith(OFFER);
  });

  it("FIND_CARPOOL -> read-only search (no mutating service)", async () => {
    useDb(RIDER);
    const r = await dispatchIntent("FIND_CARPOOL", { origin: "A", destination: "B", departureAt: "2026-10-02T08:00:00-03:00" });
    expect(r.success).toBe(true);
    expect(m.search).toHaveBeenCalled();
    for (const fn of [m.enable, m.update, m.disable, m.accept, m.reject, m.cancel, m.requestRide]) expect(fn).not.toHaveBeenCalled();
  });

  it("REQUEST_CARPOOL -> requestCarpoolRide", async () => {
    useDb(RIDER);
    const r = await dispatchIntent("REQUEST_CARPOOL", { offerId: OFFER, origin: "A", destination: "B", departureAt: "2026-10-02T08:00:00-03:00" });
    expect(r.success).toBe(true);
    expect(m.requestRide).toHaveBeenCalledTimes(1);
  });

  it("ACCEPT_CARPOOL_REQUEST (host) -> acceptCarpoolRequest; as the RIDER it is refused", async () => {
    useDb(HOST);
    expect((await dispatchIntent("ACCEPT_CARPOOL_REQUEST", { requestId: REQ })).success).toBe(true);
    expect(m.accept).toHaveBeenCalledWith(REQ);
    m.accept.mockClear();
    useDb(RIDER);
    const refused = await dispatchIntent("ACCEPT_CARPOOL_REQUEST", { requestId: REQ });
    expect(refused).toMatchObject({ success: false, message: "CARPOOL_REQUEST_NOT_FOUND" });
    expect(m.accept).not.toHaveBeenCalled();
  });

  it("REJECT_CARPOOL_REQUEST -> rejectCarpoolRequest", async () => {
    useDb(HOST);
    expect((await dispatchIntent("REJECT_CARPOOL_REQUEST", { requestId: REQ, reason: "lotado" })).success).toBe(true);
    expect(m.reject).toHaveBeenCalledWith(REQ, "lotado");
  });

  it("CANCEL_CARPOOL_REQUEST (rider) -> cancelCarpoolRequest; as the host (not the rider) it is refused", async () => {
    useDb(RIDER);
    expect((await dispatchIntent("CANCEL_CARPOOL_REQUEST", { requestId: REQ })).success).toBe(true);
    expect(m.cancel).toHaveBeenCalledWith(REQ);
    m.cancel.mockClear();
    useDb(HOST);
    expect(await dispatchIntent("CANCEL_CARPOOL_REQUEST", { requestId: REQ })).toMatchObject({ success: false });
    expect(m.cancel).not.toHaveBeenCalled();
  });
});

describe("dispatchIntent CREATE_RESERVATION: host offer step (answer Yes to 'Deseja disponibilizar vagas?')", () => {
  const slots = {
    departureAt: "2026-10-02T12:00:00-03:00",
    expectedReturnAt: "2026-10-02T18:00:00-03:00",
    origin: "Sede",
    destination: "Campinas",
    distanceKm: "90",
    passengerCount: "1",
    requiresCargo: "false",
    allowCarpool: "true",
  };
  const vehiclePlan = {
    type: "vehicle",
    reasons: [],
    bookingMode: "ai_recommended",
    vehicle: { vehicleId: "veh-1", plate: "ABC1D23", vehicleName: "SUV", categoryName: "SUV", reasons: [], alternatives: [], maxOfferableSeats: 4 },
  };

  function dbWithReservation(extra: Rows = {}) {
    const rows: Rows = {
      profiles: [{ id: HOST, organization_id: "org-1" }],
      reservations: [{ id: "res-new", trip_request_id: "trip-new" }],
      ...extra,
    };
    const db = useDb(HOST, rows);
    db.rpc.mockResolvedValue({ data: "res-new", error: null });
    return db;
  }

  beforeEach(() => {
    m.plan = vehiclePlan;
  });

  it("publishes the MAXIMUM safe seats by default through enable_carpool_offer", async () => {
    const db = dbWithReservation();
    const r = await dispatchIntent("CREATE_RESERVATION", slots);
    expect(db.rpc).toHaveBeenCalledWith("create_vehicle_reservation", expect.objectContaining({ p_vehicle_id: "veh-1", p_allow_carpool: true }));
    expect(m.enable).toHaveBeenCalledWith("trip-new", 4, "res-new");
    expect(r.success).toBe(true);
    expect(r.message).toContain("Reserva criada");
    expect(r.message).toContain("Vagas de carona publicadas: 4 vagas");
  });

  it("honours an explicit seat count within the maximum", async () => {
    dbWithReservation();
    await dispatchIntent("CREATE_RESERVATION", { ...slots, offerSeats: "2" });
    expect(m.enable).toHaveBeenCalledWith("trip-new", 2, "res-new");
  });

  it("seats above the maximum are NOT published (same rule as the form) but the reservation stands", async () => {
    dbWithReservation();
    const r = await dispatchIntent("CREATE_RESERVATION", { ...slots, offerSeats: "9" });
    expect(m.enable).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.message).toContain("Não consegui publicar as vagas");
  });

  it("a publishing failure is NON-FATAL (reservation created, notice appended)", async () => {
    dbWithReservation();
    m.enable.mockResolvedValue({ status: "error", error: "CARPOOL_DISABLED_BY_POLICY" });
    const r = await dispatchIntent("CREATE_RESERVATION", slots);
    expect(r.success).toBe(true);
    expect(r.message).toContain("Reserva criada");
    expect(r.message).toContain("Não consegui publicar as vagas");
  });

  it("answering No never publishes", async () => {
    dbWithReservation();
    const r = await dispatchIntent("CREATE_RESERVATION", { ...slots, allowCarpool: "false" });
    expect(m.enable).not.toHaveBeenCalled();
    expect(r.message).toBe("Reserva criada — veículo ABC1D23.");
  });

  it("org with carpool DISABLED by policy: reservation flow unchanged, no carpool offered or published (L3)", async () => {
    dbWithReservation({
      carpool_policy_settings: [{
        policy_version: 1, carpool_enabled: false, carpool_first_enabled: false, host_opt_in_required: true, host_approval_required: true,
        departure_window_minutes: 15, return_window_minutes: 15, max_additional_distance_km: 5, max_additional_time_minutes: 10,
        max_candidates_for_precise_routing: 5, request_expiry_minutes: 30, allow_intermediate_pickup: true, allow_intermediate_dropoff: true,
        minimum_seat_availability: 1, organization_id: "org-1",
      }],
    });
    const r = await dispatchIntent("CREATE_RESERVATION", slots);
    expect(m.enable).not.toHaveBeenCalled();
    expect(r.message).toBe("Reserva criada — veículo ABC1D23.");
  });
});
