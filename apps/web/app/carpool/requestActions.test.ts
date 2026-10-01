import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  user: { id: "user-1" } as { id: string } | null,
  search: vi.fn(),
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: state.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: state.adminRpc }),
}));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => state.user }));
vi.mock("./actions", () => ({ searchCompatibleCarpool: (...a: unknown[]) => state.search(...a) }));

import {
  acceptCarpoolRequest,
  cancelCarpoolRequest,
  disableCarpoolOffer,
  enableCarpoolOffer,
  rejectCarpoolRequest,
  requestCarpoolRide,
  revalidateCarpoolMatches,
  updateCarpoolOffer,
} from "./requestActions";

const OFFER = "0ce8b495-d58d-47ff-8387-5ea8d71d7036";
const REQ = "11111111-d58d-47ff-8387-5ea8d71d7036";
const KEY = "22222222-d58d-47ff-8387-5ea8d71d7036";
const draft = {
  requestedDepartureAt: "2026-10-01T12:00:00.000Z",
  requestedSeats: 1,
  requiresCargo: false,
  pickup: { lat: -23.55, lng: -46.63 },
  dropoff: { lat: -23.56, lng: -46.64 },
};

beforeEach(() => {
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: null, error: null });
  state.adminRpc.mockReset();
  state.adminRpc.mockResolvedValue({ data: null, error: null });
  state.search.mockReset();
  state.user = { id: "user-1" };
});

describe("requestCarpoolRide", () => {
  it("records the SERVER-computed route numbers, never client-supplied ones, and forwards the idempotency key", async () => {
    state.search.mockResolvedValue({
      status: "matches",
      matches: [{ offerId: OFFER, hostTripRequestId: "t", additionalDistanceKm: 1.2, additionalTimeMin: 3.4, departureDiffMinutes: 0, rankingKey: 1, pickup: { lat: -23.55, lng: -46.63 }, dropoff: { lat: -23.56, lng: -46.64 } }],
    });
    state.adminRpc.mockResolvedValue({ data: REQ, error: null });

    const result = await requestCarpoolRide({
      offerId: OFFER,
      clientRequestId: KEY,
      // a forged extra field on the draft must not influence the RPC numbers
      draft: { ...draft, additionalDistanceKm: 0, additionalTimeMin: 0 } as never,
    });

    expect(result).toEqual({ status: "success", requestId: REQ });
    // creation goes ONLY through the service-role client, never the user-session client
    expect(state.rpc).not.toHaveBeenCalled();
    const [fn, args] = state.adminRpc.mock.calls[0]!;
    expect(fn).toBe("create_carpool_ride_request_as_rider");
    expect(args.p_rider_id).toBe("user-1");
    expect(args.p_match_additional_distance_km).toBe(1.2);
    expect(args.p_match_additional_time_min).toBe(3.4);
    expect(args.p_client_request_id).toBe(KEY);
    expect(args.p_seats).toBe(1);
    // coordinates come from the server-evaluated match, not the (forgeable) draft copy
    expect(args.p_pickup.coordinates).toEqual({ lat: -23.55, lng: -46.63 });
  });

  it("C5: stores the rider's confirmed pickup/drop-off labels (whitespace-normalised, capped), never as coordinates", async () => {
    state.search.mockResolvedValue({
      status: "matches",
      matches: [{ offerId: OFFER, hostTripRequestId: "t", additionalDistanceKm: 1, additionalTimeMin: 2, departureDiffMinutes: 0, rankingKey: 1, pickup: draft.pickup, dropoff: draft.dropoff }],
    });
    state.adminRpc.mockResolvedValue({ data: REQ, error: null });
    await requestCarpoolRide({
      offerId: OFFER,
      clientRequestId: KEY,
      draft,
      pickupLabel: "  Av. Paulista,   1578 \n Bela Vista, São Paulo ",
      dropoffLabel: "x".repeat(500),
    });
    const args = state.adminRpc.mock.calls[0]![1];
    // letters must survive the normalisation (a /s+/ typo once turned every "s" into a space)
    expect(args.p_pickup.label).toBe("Av. Paulista, 1578 Bela Vista, São Paulo");
    expect(args.p_dropoff.label).toHaveLength(200);
    expect(args.p_pickup.coordinates).toEqual({ lat: -23.55, lng: -46.63 });
    // a non-string label is ignored rather than stored
    state.adminRpc.mockClear();
    await requestCarpoolRide({ offerId: OFFER, clientRequestId: KEY, draft, pickupLabel: { evil: true } as never });
    expect(state.adminRpc.mock.calls[0]![1].p_pickup).not.toHaveProperty("label");
  });

  it("creates nothing when the offer is not among the compatible matches", async () => {
    state.search.mockResolvedValue({ status: "matches", matches: [] });
    const result = await requestCarpoolRide({ offerId: OFFER, clientRequestId: KEY, draft });
    expect(result).toEqual({ status: "error", error: "offer_not_compatible" });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.adminRpc).not.toHaveBeenCalled();
  });

  it("creates nothing when the provider is unavailable", async () => {
    state.search.mockResolvedValue({ status: "unavailable", reason: "x" });
    const result = await requestCarpoolRide({ offerId: OFFER, clientRequestId: KEY, draft });
    expect(result).toEqual({ status: "error", error: "carpool_unavailable" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("rejects forged / malformed ids before touching anything", async () => {
    expect(await requestCarpoolRide({ offerId: "x'; drop table", clientRequestId: KEY, draft })).toEqual({
      status: "error",
      error: "invalid_input",
    });
    expect(await requestCarpoolRide({ offerId: OFFER, clientRequestId: "nope", draft })).toEqual({
      status: "error",
      error: "invalid_input",
    });
    expect(state.search).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("maps an RPC exception to a stable code (raw message not leaked)", async () => {
    state.search.mockResolvedValue({
      status: "matches",
      matches: [{ offerId: OFFER, hostTripRequestId: "t", additionalDistanceKm: 1, additionalTimeMin: 1, departureDiffMinutes: 0, rankingKey: 1, pickup: { lat: -23.55, lng: -46.63 }, dropoff: { lat: -23.56, lng: -46.64 } }],
    });
    state.adminRpc.mockResolvedValue({ data: null, error: { message: "CARPOOL_NO_SEATS_AVAILABLE" } });
    const result = await requestCarpoolRide({ offerId: OFFER, clientRequestId: KEY, draft });
    expect(result).toEqual({ status: "error", error: "CARPOOL_NO_SEATS_AVAILABLE" });
  });
});

describe("authentication + input validation on every action", () => {
  it("returns not_authenticated without calling any RPC", async () => {
    state.user = null;
    const results = await Promise.all([
      enableCarpoolOffer(OFFER, 2),
      updateCarpoolOffer(OFFER, 2),
      disableCarpoolOffer(OFFER),
      acceptCarpoolRequest(REQ),
      rejectCarpoolRequest(REQ),
      cancelCarpoolRequest(REQ),
      revalidateCarpoolMatches(OFFER),
    ]);
    for (const r of results) expect(r).toEqual({ status: "error", error: "not_authenticated" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("rejects non-positive-integer seats and non-uuid ids", async () => {
    for (const seats of [0, -1, 0.5, Number.NaN]) {
      expect(await enableCarpoolOffer(OFFER, seats)).toEqual({ status: "error", error: "invalid_input" });
      expect(await updateCarpoolOffer(OFFER, seats)).toEqual({ status: "error", error: "invalid_input" });
    }
    expect(await acceptCarpoolRequest("not-a-uuid")).toEqual({ status: "error", error: "invalid_input" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("calls the matching RPC with the session client for a valid request", async () => {
    expect((await acceptCarpoolRequest(REQ)).status).toBe("success");
    expect(state.rpc).toHaveBeenCalledWith("accept_carpool_ride_request", { p_request_id: REQ });
    expect((await rejectCarpoolRequest(REQ, "full")).status).toBe("success");
    expect(state.rpc).toHaveBeenCalledWith("reject_carpool_ride_request", { p_request_id: REQ, p_reason: "full" });
  });
});
