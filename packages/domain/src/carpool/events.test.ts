import { describe, expect, it } from "vitest";
import {
  CARPOOL_EVENT_TYPES,
  buildCarpoolEvent,
  notificationTargetsFor,
  type CarpoolEvent,
} from "./events";

const base = {
  organizationId: "org-1",
  actorId: "user-1",
  carpoolOfferId: "offer-1",
  tripRequestId: "trip-1",
};

describe("buildCarpoolEvent", () => {
  it("stamps occurredAt from the injected clock", () => {
    const event = buildCarpoolEvent(
      { ...base, type: "CarpoolOfferEnabled", seatsOffered: 3, policyVersion: 1 },
      () => new Date("2026-10-01T10:00:00.000Z"),
    );
    expect(event.occurredAt).toBe("2026-10-01T10:00:00.000Z");
    expect(event.type).toBe("CarpoolOfferEnabled");
    expect(event.seatsOffered).toBe(3);
  });

  it("keeps an explicit occurredAt", () => {
    const event = buildCarpoolEvent({
      ...base,
      type: "RideExpired",
      carpoolRideRequestId: "req-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(event.occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("allows a null actor for system events", () => {
    const event = buildCarpoolEvent({ ...base, actorId: null, type: "RideExpired", carpoolRideRequestId: "r" });
    expect(event.actorId).toBeNull();
  });

  it("builds every variant with its own fields (discriminated union narrows)", () => {
    const events: CarpoolEvent[] = [
      buildCarpoolEvent({ ...base, type: "CarpoolOfferEnabled", seatsOffered: 2, policyVersion: 1 }),
      buildCarpoolEvent({ ...base, type: "RideRequested", carpoolRideRequestId: "r", riderId: "u2", requestedSeats: 1, policyVersion: 1 }),
      buildCarpoolEvent({ ...base, type: "RideAccepted", carpoolRideRequestId: "r", requestedSeats: 1, seatsAvailableAfter: 1, auto: false }),
      buildCarpoolEvent({ ...base, type: "RideRejected", carpoolRideRequestId: "r", reason: "full" }),
      buildCarpoolEvent({ ...base, type: "RideCancelled", carpoolRideRequestId: "r", previousStatus: "ACCEPTED", seatsReleased: 1 }),
      buildCarpoolEvent({ ...base, type: "RideInvalidated", carpoolRideRequestId: "r", reason: "HOST_ROUTE_CHANGED", previousStatus: "ACCEPTED", seatsReleased: 1 }),
      buildCarpoolEvent({ ...base, type: "RideExpired", carpoolRideRequestId: "r" }),
      buildCarpoolEvent({ ...base, type: "HostTripChanged", changedFields: ["destination"], invalidatedRequests: 1, survivingRiderIds: [] }),
      buildCarpoolEvent({ ...base, type: "HostTripCancelled", invalidatedRequests: 2 }),
    ];
    expect(events.map((e) => e.type)).toEqual([...CARPOOL_EVENT_TYPES]);
    for (const e of events) {
      switch (e.type) {
        case "RideInvalidated":
          expect(e.reason).toBe("HOST_ROUTE_CHANGED");
          break;
        case "HostTripChanged":
          expect(e.changedFields).toEqual(["destination"]);
          break;
        default:
          expect(e.carpoolOfferId).toBe("offer-1");
      }
    }
  });
});

describe("notificationTargetsFor (mirrors carpool_events_notify, 0058)", () => {
  it("matches the pack 05 minimum notification set", () => {
    expect(notificationTargetsFor("RideRequested").recipients).toEqual(["host"]);
    expect(notificationTargetsFor("RideAccepted").recipients).toContain("rider");
    expect(notificationTargetsFor("RideRejected").recipients).toEqual(["rider"]);
    expect(notificationTargetsFor("RideExpired").recipients).toEqual(["rider"]);
    expect(notificationTargetsFor("RideInvalidated").recipients).toEqual(["rider"]);
    expect(notificationTargetsFor("HostTripChanged").recipients).toEqual(["surviving_riders", "host"]);
    expect(notificationTargetsFor("RideCancelled").recipients).toEqual(["host", "rider"]);
  });

  it("offer-enabled produces no notification", () => {
    expect(notificationTargetsFor("CarpoolOfferEnabled").recipients).toEqual([]);
  });

  it("every event type has a mapping", () => {
    for (const type of CARPOOL_EVENT_TYPES) {
      expect(notificationTargetsFor(type)).toBeDefined();
    }
  });
});
