import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Rows } from "../../test/fakeSupabase";

/**
 * Phase C6 — unit tests (mocked services) for the chat/voice carpool layer: reference
 * resolution among the caller's OWN rows, clarification rules, provider outage, stale offers,
 * and the execute step for every carpool intent (success, RBAC refusal, not found, ...).
 */

const m = vi.hoisted(() => ({
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
const store = vi.hoisted(() => ({ cardData: null as null | Record<string, Record<string, unknown>[]> }));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: async () => "pt-BR" }));
vi.mock("@/app/carpool/actions", () => ({ searchCompatibleCarpool: (...a: unknown[]) => m.search(...a) }));
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
vi.mock("@/lib/carpool/offerCardRows", () => ({
  // 0063: card rows are read with the service-role client in production; here they come from the same fixtures.
  loadOfferCardRows: async (_org: string, ids: string[]) =>
    ((store.cardData?.carpool_offers ?? []) as { id: string; seats_available: number; trip_request?: { departure_at?: string } }[])
      .filter((o) => ids.includes(o.id))
      .map((o) => ({ id: o.id, seats_available: o.seats_available, hostDepartureAt: o.trip_request?.departure_at ?? null })),
}));
vi.mock("@/lib/carpool/resolveLocationText", () => ({ resolveLocationText: (...a: unknown[]) => m.resolve(...a) }));

import { dictionaries } from "@/lib/i18n/dictionaries";
import {
  VEHICLE_OPTION_ID,
  carpoolFirstForReservation,
  executeCarpoolIntent,
  prepareCarpoolIntent,
  prepareFromOption,
  stripServerResolvedSlots,
  type ChatCarpoolCtx,
} from "./carpoolChat";

const HOST = "00000000-0000-4000-8000-0000000000a1";
const OTHER_HOST = "00000000-0000-4000-8000-0000000000a2";
const RIDER = "00000000-0000-4000-8000-0000000000b1";
const OTHER_RIDER = "00000000-0000-4000-8000-0000000000b2";
const TRIP_A = "00000000-0000-4000-8000-0000000000c1";
const TRIP_B = "00000000-0000-4000-8000-0000000000c2";
const TRIP_FOREIGN = "00000000-0000-4000-8000-0000000000c3";
const RES_A = "00000000-0000-4000-8000-0000000000d1";
const RES_B = "00000000-0000-4000-8000-0000000000d2";
const RES_FOREIGN = "00000000-0000-4000-8000-0000000000d3";
const OFFER_A = "00000000-0000-4000-8000-0000000000e1";
const OFFER_FOREIGN = "00000000-0000-4000-8000-0000000000e2";
const REQ_ANA = "00000000-0000-4000-8000-0000000000f1";
const REQ_ANA2 = "00000000-0000-4000-8000-0000000000f2";
const REQ_FOREIGN = "00000000-0000-4000-8000-0000000000f3";
const REQ_OWN_RIDER = "00000000-0000-4000-8000-0000000000f4";
const REQ_OTHER_RIDER = "00000000-0000-4000-8000-0000000000f5";

const FUTURE_A = new Date(Date.now() + 26 * 3600_000).toISOString();
const FUTURE_B = new Date(Date.now() + 50 * 3600_000).toISOString();
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

type DomainRows = Record<"reservations" | "carpool_offers" | "carpool_ride_requests", Record<string, unknown>[]>;
function rows(): DomainRows {
  return {
    reservations: [
      { id: RES_A, status: "confirmed", trip_request: { id: TRIP_A, requester_id: HOST, destination: "Campinas", departure_at: FUTURE_A } },
      { id: RES_FOREIGN, status: "confirmed", trip_request: { id: TRIP_FOREIGN, requester_id: OTHER_HOST, destination: "Santos", departure_at: FUTURE_A } },
    ],
    carpool_offers: [
      { id: OFFER_A, trip_request_id: TRIP_A, host_id: HOST, status: "active", seats_offered: 2, seats_available: 2, created_at: "2026-10-01", trip_request: { destination: "Campinas", departure_at: FUTURE_A } },
      { id: OFFER_FOREIGN, trip_request_id: TRIP_FOREIGN, host_id: OTHER_HOST, status: "active", seats_offered: 3, seats_available: 3, created_at: "2026-10-01", trip_request: { destination: "Santos", departure_at: FUTURE_A } },
    ],
    carpool_ride_requests: [
      { id: REQ_ANA, carpool_offer_id: OFFER_A, rider_id: RIDER, status: "PENDING", requested_seats: 1, requested_departure_at: FUTURE_A, rider: { full_name: "Ana Silva" }, created_at: "1" },
      { id: REQ_FOREIGN, carpool_offer_id: OFFER_FOREIGN, rider_id: OTHER_RIDER, status: "PENDING", requested_seats: 1, requested_departure_at: FUTURE_A, rider: { full_name: "Ana Souza" }, created_at: "2" },
      { id: REQ_OWN_RIDER, carpool_offer_id: OFFER_FOREIGN, rider_id: HOST, status: "PENDING", requested_seats: 1, requested_departure_at: FUTURE_A, rider: { full_name: "Host Himself" }, created_at: "3" },
      { id: REQ_OTHER_RIDER, carpool_offer_id: OFFER_A, rider_id: OTHER_RIDER, status: "ACCEPTED", requested_seats: 1, requested_departure_at: FUTURE_A, rider: { full_name: "Zed" }, created_at: "4" },
    ],
  };
}

const dict = dictionaries["pt-BR"];
const gating = { newEngine: true, carpoolFirst: true, hostStep: true, hostApprovalRequired: true };

function ctxFor(userId: string, data: Rows = rows(), g = gating): ChatCarpoolCtx {
  store.cardData = data;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: fakeSupabase(data) as any,
    userId,
    organizationId: "org-1",
    locale: "pt-BR",
    dict,
    gating: g,
  };
}

const resolved = (text: string) => ({
  status: "resolved",
  place: { label: `${text} [ok]`, coordinates: { lat: -23.5, lng: -46.6 }, source: "geocoding_provider" },
});

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.resolve.mockImplementation(async (text: string) => {
    if (text === "São Paulo") return { status: "needs_precision", reason: "city_level" };
    if (text === "OUTAGE") return { status: "unavailable", reason: "provider_down" };
    return resolved(text);
  });
  m.enable.mockResolvedValue({ status: "success", offerId: OFFER_A });
  m.update.mockResolvedValue({ status: "success" });
  m.disable.mockResolvedValue({ status: "success" });
  m.accept.mockResolvedValue({ status: "success" });
  m.reject.mockResolvedValue({ status: "success" });
  m.cancel.mockResolvedValue({ status: "success" });
  m.requestRide.mockResolvedValue({ status: "success", requestId: "req-new" });
  m.status.mockResolvedValue({ status: "PENDING" });
});

describe("stripServerResolvedSlots", () => {
  it("drops every identifier the LLM might have invented", () => {
    expect(
      stripServerResolvedSlots({ seats: "2", offerId: "x", requestId: "y", tripRequestId: "z", reservationId: "w", clientRequestId: "c", riderName: "Ana" }),
    ).toEqual({ seats: "2", riderName: "Ana" });
  });
});

describe("OFFER_CARPOOL (prepare)", () => {
  it("asks ONE question when the seat count is missing", async () => {
    const r = await prepareCarpoolIntent(ctxFor(HOST), "OFFER_CARPOOL", {});
    expect(r).toEqual({ kind: "reply", message: dict.chat.carpool.askSeats });
  });

  it("resolves the caller's own single upcoming trip and states what will happen", async () => {
    const r = await prepareCarpoolIntent(ctxFor(HOST), "OFFER_CARPOOL", { seats: "2" });
    expect(r.kind).toBe("confirm");
    if (r.kind !== "confirm") return;
    expect(r.slots).toEqual({ seats: "2", tripRequestId: TRIP_A });
    expect(r.summary).toContain("2 vagas");
    expect(r.summary).toContain("Campinas");
  });

  it("states it will UPDATE when an active offer already exists, ENABLE otherwise", async () => {
    const withOffer = await prepareCarpoolIntent(ctxFor(HOST), "OFFER_CARPOOL", { seats: "1" });
    expect(withOffer.kind === "confirm" && withOffer.summary).toContain("Vou alterar");
    const data = rows();
    data.carpool_offers = [];
    const without = await prepareCarpoolIntent(ctxFor(HOST, data), "OFFER_CARPOOL", { seats: "1" });
    expect(without.kind === "confirm" && without.summary).toContain("Vou disponibilizar 1 vaga");
  });

  it("ignores an id the LLM supplied: another host's trip id is never used", async () => {
    const r = await prepareCarpoolIntent(ctxFor(HOST), "OFFER_CARPOOL", { seats: "2", tripRequestId: TRIP_FOREIGN });
    expect(r.kind === "confirm" && r.slots.tripRequestId).toBe(TRIP_A);
  });

  it("not found: the caller has no upcoming trip (another user's trip is invisible)", async () => {
    const r = await prepareCarpoolIntent(ctxFor("00000000-0000-4000-8000-0000000000ff"), "OFFER_CARPOOL", { seats: "2" });
    expect(r).toEqual({ kind: "reply", message: dict.chat.carpool.noHostTrip });
  });

  it("ambiguous: two trips and no hint -> asks which one; the day hint resolves it", async () => {
    const data = rows();
    data.reservations.push({ id: RES_B, status: "confirmed", trip_request: { id: TRIP_B, requester_id: HOST, destination: "Santos", departure_at: FUTURE_B } });
    const ambiguous = await prepareCarpoolIntent(ctxFor(HOST, data), "OFFER_CARPOOL", { seats: "2" });
    expect(ambiguous.kind).toBe("reply");
    expect(ambiguous.kind === "reply" && ambiguous.message).toContain("Campinas");
    expect(ambiguous.kind === "reply" && ambiguous.message).toContain("Santos");
    const byDay = await prepareCarpoolIntent(ctxFor(HOST, data), "OFFER_CARPOOL", { seats: "2", tripDate: dayOf(FUTURE_B) });
    expect(byDay.kind === "confirm" && byDay.slots.tripRequestId).toBe(TRIP_B);
  });

  it("refuses when the org policy has carpool disabled", async () => {
    const r = await prepareCarpoolIntent(ctxFor(HOST, rows(), { ...gating, newEngine: false }), "OFFER_CARPOOL", { seats: "2" });
    expect(r).toEqual({ kind: "reply", message: dict.carpool.errors.disabledByPolicy });
  });
});

describe("DISABLE_CARPOOL (prepare)", () => {
  it("resolves only the caller's own active offer", async () => {
    const r = await prepareCarpoolIntent(ctxFor(HOST), "DISABLE_CARPOOL", { offerId: OFFER_FOREIGN });
    expect(r.kind === "confirm" && r.slots).toEqual({ offerId: OFFER_A });
  });

  it("not found when the caller hosts no active offer (someone else's offer is invisible)", async () => {
    const r = await prepareCarpoolIntent(ctxFor(RIDER), "DISABLE_CARPOOL", { offerId: OFFER_A });
    expect(r).toEqual({ kind: "reply", message: dict.chat.carpool.noActiveOffer });
  });
});

describe("ACCEPT / REJECT (prepare): a person referenced in speech", () => {
  it("'Ana' resolves among the HOST'S OWN pending requests only (never the other host's Ana Souza)", async () => {
    const r = await prepareCarpoolIntent(ctxFor(HOST), "ACCEPT_CARPOOL_REQUEST", { riderName: "Ana" });
    expect(r.kind).toBe("confirm");
    if (r.kind !== "confirm") return;
    expect(r.slots.requestId).toBe(REQ_ANA);
    expect(r.summary).toContain("Ana Silva");
    expect(JSON.stringify(r)).not.toContain("Souza");
  });

  it("is accent/case-insensitive", async () => {
    const data = rows();
    data.carpool_ride_requests[0] = { ...data.carpool_ride_requests[0]!, rider: { full_name: "Ánã Silva" } };
    const r = await prepareCarpoolIntent(ctxFor(HOST, data), "ACCEPT_CARPOOL_REQUEST", { riderName: "ANA" });
    expect(r.kind).toBe("confirm");
  });

  it("zero matches -> says so, reveals nothing about other people's requests", async () => {
    const r = await prepareCarpoolIntent(ctxFor(HOST), "ACCEPT_CARPOOL_REQUEST", { riderName: "Souza" });
    expect(r).toEqual({ kind: "reply", message: dict.chat.carpool.noPendingForName.replace("{name}", "Souza") });
  });

  it("ambiguous (two Anas) -> asks, lists only the caller's own, never guesses", async () => {
    const data = rows();
    data.carpool_ride_requests.push({ id: REQ_ANA2, carpool_offer_id: OFFER_A, rider_id: OTHER_RIDER, status: "PENDING", requested_seats: 1, requested_departure_at: FUTURE_A, rider: { full_name: "Ana Lima" }, created_at: "9" });
    const r = await prepareCarpoolIntent(ctxFor(HOST, data), "ACCEPT_CARPOOL_REQUEST", { riderName: "Ana" });
    expect(r.kind).toBe("reply");
    const text = r.kind === "reply" ? r.message : "";
    expect(text).toContain("Ana Silva");
    expect(text).toContain("Ana Lima");
    expect(text).not.toContain("Souza");
    // a fuller name disambiguates
    const exact = await prepareCarpoolIntent(ctxFor(HOST, data), "ACCEPT_CARPOOL_REQUEST", { riderName: "Ana Lima" });
    expect(exact.kind === "confirm" && exact.slots.requestId).toBe(REQ_ANA2);
  });

  it("no name and exactly one pending request -> that one; a rider with no offers has nothing to accept", async () => {
    const one = await prepareCarpoolIntent(ctxFor(HOST), "ACCEPT_CARPOOL_REQUEST", {});
    expect(one.kind === "confirm" && one.slots.requestId).toBe(REQ_ANA);
    const asRider = await prepareCarpoolIntent(ctxFor(RIDER), "ACCEPT_CARPOOL_REQUEST", { riderName: "Ana" });
    expect(asRider.kind).toBe("reply");
  });

  it("REJECT carries an optional reason (capped), ACCEPT does not", async () => {
    const rej = await prepareCarpoolIntent(ctxFor(HOST), "REJECT_CARPOOL_REQUEST", { riderName: "Ana", reason: "x".repeat(900) });
    expect(rej.kind === "confirm" && rej.slots.reason?.length).toBe(500);
    const acc = await prepareCarpoolIntent(ctxFor(HOST), "ACCEPT_CARPOOL_REQUEST", { riderName: "Ana", reason: "nope" });
    expect(acc.kind === "confirm" && acc.slots.reason).toBeUndefined();
  });
});

describe("CANCEL_CARPOOL_REQUEST (prepare)", () => {
  it("resolves the caller's own live request only", async () => {
    const r = await prepareCarpoolIntent(ctxFor(RIDER), "CANCEL_CARPOOL_REQUEST", { requestId: REQ_FOREIGN });
    expect(r.kind === "confirm" && r.slots).toEqual({ requestId: REQ_ANA });
  });

  it("an ACCEPTED request says the seat will be released", async () => {
    const r = await prepareCarpoolIntent(ctxFor(OTHER_RIDER), "CANCEL_CARPOOL_REQUEST", {});
    // OTHER_RIDER has one PENDING (foreign offer) and one ACCEPTED -> ambiguous
    expect(r.kind).toBe("reply");
    const data = rows();
    data.carpool_ride_requests = data.carpool_ride_requests.filter((x) => x.id !== REQ_FOREIGN);
    const single = await prepareCarpoolIntent(ctxFor(OTHER_RIDER, data), "CANCEL_CARPOOL_REQUEST", {});
    expect(single.kind === "confirm" && single.summary).toContain("A vaga será liberada");
  });

  it("not found when the caller has no live request", async () => {
    const r = await prepareCarpoolIntent(ctxFor("00000000-0000-4000-8000-0000000000ff"), "CANCEL_CARPOOL_REQUEST", {});
    expect(r).toEqual({ kind: "reply", message: dict.chat.carpool.noCancellableRequest });
  });
});

describe("FIND_CARPOOL (prepare): read-only, same clarification rule as New Trip", () => {
  const slots = { origin: "Av Paulista 1578", destination: "Concessionária X, Av Brasil 100", departureAt: "2026-10-02T08:00:00-03:00" };
  const match = { offerId: OFFER_A, hostTripRequestId: TRIP_A, additionalDistanceKm: 2.14, additionalTimeMin: 4.2, departureDiffMinutes: 5 };

  it("a missing origin is asked (a pickup point is never guessed)", async () => {
    const r = await prepareCarpoolIntent(ctxFor(RIDER), "FIND_CARPOOL", { destination: "X", departureAt: slots.departureAt });
    expect(r).toEqual({ kind: "reply", message: dict.chat.carpool.askOrigin });
    expect(m.search).not.toHaveBeenCalled();
  });

  it("a city-only destination -> asks for a precise place and does NOT search", async () => {
    const r = await prepareCarpoolIntent(ctxFor(RIDER), "FIND_CARPOOL", { ...slots, destination: "São Paulo" });
    expect(r.kind).toBe("reply");
    expect(r.kind === "reply" && r.message).toContain("São Paulo");
    expect(r.kind === "reply" && r.message).toContain("apenas uma cidade");
    expect(m.search).not.toHaveBeenCalled();
  });

  it("provider outage -> clear message, no fake matches", async () => {
    const r = await prepareCarpoolIntent(ctxFor(RIDER), "FIND_CARPOOL", { ...slots, destination: "OUTAGE" });
    expect(r).toEqual({ kind: "reply", message: dict.carpool.newTrip.unavailableBanner });
    m.resolve.mockImplementation(async (t: string) => resolved(t));
    m.search.mockResolvedValue({ status: "unavailable", reason: "routes_down" });
    const r2 = await prepareCarpoolIntent(ctxFor(RIDER), "FIND_CARPOOL", slots);
    expect(r2).toEqual({ kind: "reply", message: dict.carpool.newTrip.unavailableBanner });
  });

  it("no compatible offer -> says so (never lists incompatible ones)", async () => {
    m.search.mockResolvedValue({ status: "matches", matches: [] });
    const r = await prepareCarpoolIntent(ctxFor(RIDER), "FIND_CARPOOL", slots);
    expect(r.kind === "reply" && r.message).toContain(dict.chat.carpool.findNone);
  });

  it("compatible offers -> numbered options with ONLY departure time, detour and seats", async () => {
    m.search.mockResolvedValue({ status: "matches", matches: [match] });
    const data = rows();
    const r = await prepareCarpoolIntent(ctxFor(RIDER, data), "FIND_CARPOOL", slots);
    expect(r.kind).toBe("options");
    if (r.kind !== "options") return;
    expect(r.options).toHaveLength(1);
    expect(r.options[0]!.id).toBe(OFFER_A);
    expect(r.options[0]!.label).toMatch(/Saída \d{2}:\d{2} · desvio \+2.1 km \/ \+4 min · 2 vagas/);
    // privacy: nothing about the host trip beyond time/detour/seats
    const everything = JSON.stringify(r);
    expect(everything).not.toContain("Campinas");
    expect(everything).not.toContain(HOST);
    // the search was fed with SERVER-resolved coordinates + the rider's time
    const draft = m.search.mock.calls[0]![0];
    expect(draft.pickup).toEqual({ lat: -23.5, lng: -46.6 });
    expect(draft.requestedSeats).toBe(1);
    expect(r.slots.destination).toBe(slots.destination);
  });

  it("carpool disabled by policy -> refusal, no search", async () => {
    const r = await prepareCarpoolIntent(ctxFor(RIDER, rows(), { ...gating, newEngine: false }), "FIND_CARPOOL", slots);
    expect(r).toEqual({ kind: "reply", message: dict.carpool.errors.disabledByPolicy });
    expect(m.search).not.toHaveBeenCalled();
  });
});

describe("REQUEST_CARPOOL (prepare / option selection)", () => {
  const search = { origin: "Av Paulista 1578", destination: "Concessionária X", departureAt: "2026-10-02T08:00:00-03:00", passengerCount: "1" };
  const match = { offerId: OFFER_A, hostTripRequestId: TRIP_A, additionalDistanceKm: 2.14, additionalTimeMin: 4.2, departureDiffMinutes: 5 };
  const prev = { intent: "FIND_CARPOOL" as const, slots: search, options: [{ id: OFFER_A, label: "x" }] };

  it("without a recent search -> asks for one", async () => {
    const r = await prepareCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", {});
    expect(r).toEqual({ kind: "reply", message: dict.chat.carpool.noRecentSearch });
  });

  it("'solicitar essa carona' with ONE shown option -> confirmation card with the real detour", async () => {
    m.search.mockResolvedValue({ status: "matches", matches: [match] });
    const r = await prepareCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", { offerId: "forged" }, prev);
    expect(r.kind).toBe("confirm");
    if (r.kind !== "confirm") return;
    expect(r.slots.offerId).toBe(OFFER_A);
    expect(r.slots.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.summary).toMatch(/Vou solicitar 1 vaga na carona com saída às \d{2}:\d{2}, desvio estimado de 2.1 km \(cerca de 4 min\)\./);
    expect(r.summary).toContain("O motorista precisa aprovar");
  });

  it("several options and no number -> asks which; a number picks it", async () => {
    const many = { ...prev, options: [{ id: OFFER_A, label: "a" }, { id: OFFER_FOREIGN, label: "b" }] };
    const ask = await prepareCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", {}, many);
    expect(ask).toEqual({ kind: "reply", message: dict.chat.carpool.pickOption });
    m.search.mockResolvedValue({ status: "matches", matches: [match] });
    const picked = await prepareCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", { optionNumber: "1" }, many);
    expect(picked.kind).toBe("confirm");
  });

  it("STALE option: the offer is no longer among the compatible results -> refused, no card", async () => {
    m.search.mockResolvedValue({ status: "matches", matches: [] });
    const r = await prepareFromOption(ctxFor(RIDER), prev, OFFER_A);
    expect(r).toEqual({ kind: "reply", message: dict.carpool.errors.notCompatible });
  });

  it("an offer id that was never listed/compatible can't be smuggled in (re-validated by a fresh search)", async () => {
    m.search.mockResolvedValue({ status: "matches", matches: [match] });
    const r = await prepareFromOption(ctxFor(RIDER), prev, OFFER_FOREIGN);
    expect(r).toEqual({ kind: "reply", message: dict.carpool.errors.notCompatible });
  });

  it("garbage id -> refused without a search", async () => {
    const r = await prepareFromOption(ctxFor(RIDER), prev, "not-a-uuid");
    expect(r.kind).toBe("reply");
    expect(m.search).not.toHaveBeenCalled();
  });

  it("provider outage while re-validating -> clear message", async () => {
    m.search.mockResolvedValue({ status: "unavailable", reason: "routes_down" });
    const r = await prepareFromOption(ctxFor(RIDER), prev, OFFER_A);
    expect(r).toEqual({ kind: "reply", message: dict.carpool.newTrip.unavailableBanner });
  });

  it("'use a vehicle' is only meaningful for a chat reservation", async () => {
    expect(await prepareFromOption(ctxFor(RIDER), { ...prev, intent: "CREATE_RESERVATION" }, VEHICLE_OPTION_ID)).toEqual({ kind: "vehicle" });
    expect((await prepareFromOption(ctxFor(RIDER), prev, VEHICLE_OPTION_ID)).kind).toBe("reply");
  });
});

describe("carpoolFirstForReservation (chat reservation parity)", () => {
  const slots = { origin: "Av Paulista 1578", destination: "Concessionária X", departureAt: "2026-10-02T08:00:00-03:00", expectedReturnAt: "2026-10-02T18:00:00-03:00", passengerCount: "1" };
  const match = { offerId: OFFER_A, hostTripRequestId: TRIP_A, additionalDistanceKm: 1, additionalTimeMin: 2, departureDiffMinutes: 1 };

  it("offers + a trailing 'use a vehicle' option when compatible offers exist", async () => {
    m.search.mockResolvedValue({ status: "matches", matches: [match] });
    const r = await carpoolFirstForReservation(ctxFor(RIDER), slots);
    expect(r.kind).toBe("options");
    if (r.kind !== "options") return;
    expect(r.options.map((o) => o.id)).toEqual([OFFER_A, VEHICLE_OPTION_ID]);
  });

  it("does nothing when carpool-first is off, declined, or there is no origin", async () => {
    expect(await carpoolFirstForReservation(ctxFor(RIDER, rows(), { ...gating, carpoolFirst: false }), slots)).toEqual({ kind: "none" });
    expect(await carpoolFirstForReservation(ctxFor(RIDER), { ...slots, carpoolDeclined: "true" })).toEqual({ kind: "none" });
    expect(await carpoolFirstForReservation(ctxFor(RIDER), { ...slots, origin: "" })).toEqual({ kind: "none" });
    expect(m.search).not.toHaveBeenCalled();
  });

  it("no matches -> normal vehicle flow untouched; outage -> same flow plus a note", async () => {
    m.search.mockResolvedValue({ status: "matches", matches: [] });
    expect(await carpoolFirstForReservation(ctxFor(RIDER), slots)).toEqual({ kind: "none" });
    m.search.mockResolvedValue({ status: "unavailable", reason: "x" });
    expect(await carpoolFirstForReservation(ctxFor(RIDER), slots)).toEqual({ kind: "none", note: dict.carpool.newTrip.unavailableBanner });
  });
});

describe("executeCarpoolIntent", () => {
  it("OFFER: success (enable) calls the SAME service the My Trip form uses, with the resolved trip/reservation", async () => {
    const r = await executeCarpoolIntent(ctxFor(HOST), "OFFER_CARPOOL", { seats: "2", tripRequestId: TRIP_A });
    // an active offer exists in the fixture -> update path
    expect(m.update).toHaveBeenCalledWith(OFFER_A, 2, RES_A);
    expect(m.enable).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.message).toContain("2 vagas");
    const data = rows();
    data.carpool_offers = [];
    await executeCarpoolIntent(ctxFor(HOST, data), "OFFER_CARPOOL", { seats: "3", tripRequestId: TRIP_A });
    expect(m.enable).toHaveBeenCalledWith(TRIP_A, 3, RES_A);
  });

  it("OFFER: RBAC — another host's trip id is refused before any service call", async () => {
    const r = await executeCarpoolIntent(ctxFor(HOST), "OFFER_CARPOOL", { seats: "2", tripRequestId: TRIP_FOREIGN });
    expect(r).toMatchObject({ success: false, message: "CARPOOL_TRIP_NOT_FOUND" });
    expect(m.enable).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("OFFER: a service/RPC error is mapped to a friendly localized reason (never raw text)", async () => {
    m.update.mockResolvedValue({ status: "error", error: "CARPOOL_SEATS_EXCEED_CAPACITY" });
    const r = await executeCarpoolIntent(ctxFor(HOST), "OFFER_CARPOOL", { seats: "9", tripRequestId: TRIP_A });
    expect(r.success).toBe(false);
    expect(r.reasons).toEqual([dict.carpool.errors.exceedsCapacity]);
  });

  it("OFFER: invalid seat count never reaches the service", async () => {
    const r = await executeCarpoolIntent(ctxFor(HOST), "OFFER_CARPOOL", { seats: "0", tripRequestId: TRIP_A });
    expect(r.success).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("DISABLE: success on the caller's own offer; a foreign offer is 'not found' and never disabled", async () => {
    const ok = await executeCarpoolIntent(ctxFor(HOST), "DISABLE_CARPOOL", { offerId: OFFER_A });
    expect(ok.success).toBe(true);
    expect(m.disable).toHaveBeenCalledWith(OFFER_A);
    m.disable.mockClear();
    const refused = await executeCarpoolIntent(ctxFor(HOST), "DISABLE_CARPOOL", { offerId: OFFER_FOREIGN });
    expect(refused).toMatchObject({ success: false, message: "CARPOOL_OFFER_NOT_FOUND" });
    const nonHost = await executeCarpoolIntent(ctxFor(RIDER), "DISABLE_CARPOOL", { offerId: OFFER_A });
    expect(nonHost).toMatchObject({ success: false, message: "CARPOOL_OFFER_NOT_FOUND" });
    expect(m.disable).not.toHaveBeenCalled();
  });

  it("ACCEPT: success on the host's own pending request; refused for a request on someone else's offer", async () => {
    const ok = await executeCarpoolIntent(ctxFor(HOST), "ACCEPT_CARPOOL_REQUEST", { requestId: REQ_ANA, riderName: "Ana Silva" });
    expect(ok.success).toBe(true);
    expect(m.accept).toHaveBeenCalledWith(REQ_ANA);
    expect(ok.message).toContain("Ana Silva");
    m.accept.mockClear();
    const foreign = await executeCarpoolIntent(ctxFor(HOST), "ACCEPT_CARPOOL_REQUEST", { requestId: REQ_FOREIGN });
    expect(foreign).toMatchObject({ success: false, message: "CARPOOL_REQUEST_NOT_FOUND" });
    expect(m.accept).not.toHaveBeenCalled();
  });

  it("ACCEPT: a RIDER (hosting nothing) can never accept — refused before the RPC", async () => {
    const r = await executeCarpoolIntent(ctxFor(RIDER), "ACCEPT_CARPOOL_REQUEST", { requestId: REQ_ANA });
    expect(r).toMatchObject({ success: false, message: "CARPOOL_REQUEST_NOT_FOUND" });
    expect(m.accept).not.toHaveBeenCalled();
  });

  it("ACCEPT: when the RPC itself refuses (e.g. no seats) the localized reason is surfaced", async () => {
    m.accept.mockResolvedValue({ status: "error", error: "CARPOOL_NO_SEATS_AVAILABLE" });
    const r = await executeCarpoolIntent(ctxFor(HOST), "ACCEPT_CARPOOL_REQUEST", { requestId: REQ_ANA });
    expect(r.reasons).toEqual([dict.carpool.errors.noSeats]);
  });

  it("REJECT: forwards the reason; non-uuid / foreign ids are refused", async () => {
    await executeCarpoolIntent(ctxFor(HOST), "REJECT_CARPOOL_REQUEST", { requestId: REQ_ANA, reason: "sem espaço" });
    expect(m.reject).toHaveBeenCalledWith(REQ_ANA, "sem espaço");
    m.reject.mockClear();
    expect(await executeCarpoolIntent(ctxFor(HOST), "REJECT_CARPOOL_REQUEST", { requestId: "nope" })).toMatchObject({ success: false });
    expect(await executeCarpoolIntent(ctxFor(HOST), "REJECT_CARPOOL_REQUEST", { requestId: REQ_FOREIGN })).toMatchObject({ success: false });
    expect(m.reject).not.toHaveBeenCalled();
  });

  it("CANCEL: only the caller's own live request", async () => {
    const ok = await executeCarpoolIntent(ctxFor(RIDER), "CANCEL_CARPOOL_REQUEST", { requestId: REQ_ANA });
    expect(ok.success).toBe(true);
    expect(m.cancel).toHaveBeenCalledWith(REQ_ANA);
    m.cancel.mockClear();
    const other = await executeCarpoolIntent(ctxFor(OTHER_RIDER), "CANCEL_CARPOOL_REQUEST", { requestId: REQ_ANA });
    expect(other).toMatchObject({ success: false, message: "CARPOOL_REQUEST_NOT_FOUND" });
    expect(m.cancel).not.toHaveBeenCalled();
  });

  describe("REQUEST", () => {
    const slots = {
      offerId: OFFER_A,
      clientRequestId: "00000000-0000-4000-8000-0000000000aa",
      origin: "Av Paulista 1578",
      destination: "Concessionária X",
      departureAt: "2026-10-02T08:00:00-03:00",
      passengerCount: "1",
    };

    it("success: re-resolves places server-side, calls requestCarpoolRide (which re-runs the search); PENDING message", async () => {
      const r = await executeCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", slots);
      expect(r).toEqual({ success: true, message: dict.carpool.newTrip.outcomePending });
      const arg = m.requestRide.mock.calls[0]![0];
      expect(arg.offerId).toBe(OFFER_A);
      expect(arg.clientRequestId).toBe(slots.clientRequestId);
      expect(arg.draft).toMatchObject({ requestedSeats: 1, pickup: { lat: -23.5, lng: -46.6 }, dropoff: { lat: -23.5, lng: -46.6 } });
      expect(arg.draft.requestedDepartureAt).toBe("2026-10-02T11:00:00.000Z");
    });

    it("an auto-accepted outcome is reported as confirmed", async () => {
      m.status.mockResolvedValue({ status: "ACCEPTED" });
      const r = await executeCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", slots);
      expect(r.message).toBe(dict.carpool.newTrip.outcomeAccepted);
    });

    it("STALE/invalid offer at confirm time -> refused with the 'not compatible' reason", async () => {
      m.requestRide.mockResolvedValue({ status: "error", error: "offer_not_compatible" });
      const r = await executeCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", slots);
      expect(r).toMatchObject({ success: false, message: "offer_not_compatible", reasons: [dict.carpool.errors.notCompatible] });
    });

    it("provider outage at confirm -> clear message, no request", async () => {
      m.requestRide.mockResolvedValue({ status: "error", error: "carpool_unavailable" });
      const out = await executeCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", slots);
      expect(out.reasons).toEqual([dict.carpool.errors.unavailable]);
      m.requestRide.mockClear();
      m.resolve.mockResolvedValue({ status: "unavailable", reason: "x" });
      const noCall = await executeCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", slots);
      expect(noCall).toMatchObject({ success: false, message: "carpool_unavailable" });
      expect(m.requestRide).not.toHaveBeenCalled();
    });

    it("a place that is no longer precise is not guessed; a non-uuid offer never reaches the service", async () => {
      m.resolve.mockResolvedValue({ status: "needs_precision", reason: "city_level" });
      expect(await executeCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", slots)).toMatchObject({ success: false });
      expect(await executeCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", { ...slots, offerId: "x" })).toMatchObject({ success: false });
      expect(m.requestRide).not.toHaveBeenCalled();
    });

    it("RBAC: the host asking for a seat on their own offer is refused by the service (error surfaced)", async () => {
      m.requestRide.mockResolvedValue({ status: "error", error: "CARPOOL_CANNOT_REQUEST_OWN_OFFER" });
      const r = await executeCarpoolIntent(ctxFor(HOST), "REQUEST_CARPOOL", slots);
      expect(r.success).toBe(false);
      expect(r.reasons).toEqual([dict.carpool.errors.notCompatible]);
    });

    it("no explicit clientRequestId -> a fresh uuid is generated, never an empty key", async () => {
      await executeCarpoolIntent(ctxFor(RIDER), "REQUEST_CARPOOL", { ...slots, clientRequestId: "" });
      expect(m.requestRide.mock.calls[0]![0].clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it("FIND (direct dispatch) is read-only text and never calls a mutating service", async () => {
    m.search.mockResolvedValue({ status: "matches", matches: [{ offerId: OFFER_A, hostTripRequestId: TRIP_A, additionalDistanceKm: 1, additionalTimeMin: 2, departureDiffMinutes: 1 }] });
    const r = await executeCarpoolIntent(ctxFor(RIDER), "FIND_CARPOOL", { origin: "A", destination: "B", departureAt: "2026-10-02T08:00:00-03:00" });
    expect(r.success).toBe(true);
    expect(r.message).toMatch(/1\. Saída/);
    for (const fn of [m.enable, m.update, m.disable, m.accept, m.reject, m.cancel, m.requestRide]) expect(fn).not.toHaveBeenCalled();
  });

  it("a non-carpool intent is not handled here", async () => {
    expect(await executeCarpoolIntent(ctxFor(HOST), "CREATE_RESERVATION", {})).toEqual({ success: false, message: "not_supported_via_chat" });
  });
});
