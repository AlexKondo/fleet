import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the pre-existing bug fixed in Phase C4 (plan C0 item #10): the
 * CREATE_RESERVATION carpool branch passed `target.reservationId` (a RESERVATION id) as
 * `p_existing_trip_request_id`. It must pass the host's trip_request id, exactly like the
 * web form's confirmTrip does.
 */

const state = {
  rpc: vi.fn(),
  plan: {} as Record<string, unknown>,
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: state.rpc }),
}));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => ({ id: "user-1" }) }));
vi.mock("@/app/trips/new/actions", () => ({ planTrip: async () => state.plan }));
vi.mock("@/app/reservations/[id]/actions", () => ({ postReservationMessage: vi.fn() }));
vi.mock("@/lib/email/recipients", () => ({ getFleetManagerEmails: vi.fn() }));
vi.mock("@/lib/email/renderEmail", () => ({ renderEmail: vi.fn() }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/formatDateTime", () => ({ formatDateTime: vi.fn() }));
vi.mock("@/lib/i18n/locales", () => ({ DEFAULT_LOCALE: "pt-BR" }));
vi.mock("@/lib/getAppUrl", () => ({ getAppUrl: () => "http://localhost" }));
vi.mock("./queries", () => ({ findActiveReservations: vi.fn(), resolveReservationId: vi.fn() }));

import { dispatchIntent } from "./dispatch";

const slots = {
  departureAt: "2026-10-01T12:00:00-03:00",
  expectedReturnAt: "2026-10-01T18:00:00-03:00",
  origin: "Sede",
  destination: "Centro",
  distanceKm: "10",
  passengerCount: "1",
  requiresCargo: "false",
  allowCarpool: "true",
};

describe("dispatchIntent CREATE_RESERVATION (carpool branch)", () => {
  beforeEach(() => {
    state.rpc.mockReset();
    state.rpc.mockResolvedValue({ error: null });
  });

  it("passes the host's trip_request id, NOT the reservation id", async () => {
    state.plan = {
      type: "carpool",
      reasons: [],
      carpoolOptions: [
        {
          reservationId: "RESERVATION-ID",
          tripRequestId: "HOST-TRIP-REQUEST-ID",
          vehiclePlate: "ABC1D23",
          departureAt: "",
          expectedReturnAt: "",
        },
      ],
    };

    const result = await dispatchIntent("CREATE_RESERVATION", slots);

    expect(result.success).toBe(true);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = state.rpc.mock.calls[0]!;
    expect(fn).toBe("create_carpool_participation");
    expect(args.p_existing_trip_request_id).toBe("HOST-TRIP-REQUEST-ID");
    expect(args.p_existing_trip_request_id).not.toBe("RESERVATION-ID");
  });

  it("refuses (and never calls the RPC) when the trip_request id could not be resolved", async () => {
    state.plan = {
      type: "carpool",
      reasons: [],
      carpoolOptions: [
        { reservationId: "RESERVATION-ID", tripRequestId: "", vehiclePlate: "ABC1D23", departureAt: "", expectedReturnAt: "" },
      ],
    };

    const result = await dispatchIntent("CREATE_RESERVATION", slots);

    expect(result).toEqual({ success: false, message: "carpool_trip_unresolved" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
