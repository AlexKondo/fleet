import { describe, expect, it } from "vitest";
import { summarizeTripRiders } from "./tripRiders";

const OFFER_A = { id: "offer-a", trip_request_id: "trip-a", seats_offered: 3 };

describe("carpool state of a trip, for the vehicle bar", () => {
  it("a trip without offer or participants is absent", () => {
    expect(summarizeTripRiders([], [], []).size).toBe(0);
  });

  it("an offer nobody asked for: seats, none taken, none waiting", () => {
    expect(summarizeTripRiders([OFFER_A], [], []).get("trip-a")).toEqual({ seats: 3, taken: 0, waiting: 0 });
  });

  it("Maria accepted and Pedro still waits: taken 1, waiting 1", () => {
    const riders = summarizeTripRiders(
      [OFFER_A],
      [{ trip_request_id: "trip-a", passenger_count: 1, status: "accepted" }],
      [{ carpool_offer_id: "offer-a" }],
    );
    expect(riders.get("trip-a")).toEqual({ seats: 3, taken: 1, waiting: 1 });
  });

  it("seats of accepted riders add up", () => {
    const riders = summarizeTripRiders(
      [OFFER_A],
      [
        { trip_request_id: "trip-a", passenger_count: 1, status: "accepted" },
        { trip_request_id: "trip-a", passenger_count: 2, status: "accepted" },
      ],
      [],
    );
    expect(riders.get("trip-a")).toMatchObject({ taken: 3, waiting: 0 });
  });

  it("the older host acceptance (participant in 'pending') also waits, even without an offer", () => {
    const riders = summarizeTripRiders([], [{ trip_request_id: "trip-b", passenger_count: 1, status: "pending" }], []);
    expect(riders.get("trip-b")).toEqual({ taken: 0, waiting: 1 });
  });

  it("a request of an offer that is not in the list is ignored (offer no longer active)", () => {
    expect(summarizeTripRiders([OFFER_A], [], [{ carpool_offer_id: "offer-gone" }]).get("trip-a")?.waiting).toBe(0);
  });

  it("two trips do not mix", () => {
    const riders = summarizeTripRiders(
      [OFFER_A, { id: "offer-b", trip_request_id: "trip-b", seats_offered: 1 }],
      [{ trip_request_id: "trip-b", passenger_count: 1, status: "accepted" }],
      [{ carpool_offer_id: "offer-a" }, { carpool_offer_id: "offer-a" }],
    );
    expect(riders.get("trip-a")).toEqual({ seats: 3, taken: 0, waiting: 2 });
    expect(riders.get("trip-b")).toEqual({ seats: 1, taken: 1, waiting: 0 });
  });
});
