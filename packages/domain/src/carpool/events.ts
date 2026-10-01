/**
 * Phase C4 — Carpool domain events (typed discriminated union + pure builder).
 *
 * Mirrors the `carpool_events.event_type` check constraint in
 * supabase/migrations/0057_carpool_events_and_request_snapshots.sql. The lifecycle RPCs
 * (0059) emit these via `carpool_emit_event`; the notification SUBSCRIBER
 * (`carpool_events_notify`, 0058) reacts to them — notifications are never produced inline
 * by matching or RPC business logic. `notificationTargetsFor` documents (and is tested
 * against) the recipient mapping the SQL subscriber implements.
 *
 * `RideExpired` is an addition beyond the eight events named in the plan: the pack requires
 * a rider notification on expiry, and expiry is a distinct lifecycle outcome that must not be
 * conflated with `RideRejected`/`RideInvalidated`.
 */

export type CarpoolEventType =
  | "CarpoolOfferEnabled"
  | "RideRequested"
  | "RideAccepted"
  | "RideRejected"
  | "RideCancelled"
  | "RideInvalidated"
  | "RideExpired"
  | "HostTripChanged"
  | "HostTripCancelled";

export const CARPOOL_EVENT_TYPES: readonly CarpoolEventType[] = [
  "CarpoolOfferEnabled",
  "RideRequested",
  "RideAccepted",
  "RideRejected",
  "RideCancelled",
  "RideInvalidated",
  "RideExpired",
  "HostTripChanged",
  "HostTripCancelled",
] as const;

export type RideInvalidationReason =
  | "HOST_TRIP_CANCELLED"
  | "HOST_SCHEDULE_CHANGED"
  | "HOST_ROUTE_CHANGED"
  | "OFFER_DISABLED";

interface CarpoolEventBase {
  /** ISO 8601 */
  occurredAt: string;
  organizationId: string;
  /** null for system-driven events (e.g. the expiry cron). */
  actorId: string | null;
  carpoolOfferId: string;
  tripRequestId: string;
}

export interface CarpoolOfferEnabledEvent extends CarpoolEventBase {
  type: "CarpoolOfferEnabled";
  seatsOffered: number;
  policyVersion: number;
}

export interface RideRequestedEvent extends CarpoolEventBase {
  type: "RideRequested";
  carpoolRideRequestId: string;
  riderId: string;
  requestedSeats: number;
  policyVersion: number;
}

export interface RideAcceptedEvent extends CarpoolEventBase {
  type: "RideAccepted";
  carpoolRideRequestId: string;
  requestedSeats: number;
  seatsAvailableAfter: number;
  auto: boolean;
}

export interface RideRejectedEvent extends CarpoolEventBase {
  type: "RideRejected";
  carpoolRideRequestId: string;
  reason?: string;
}

export interface RideCancelledEvent extends CarpoolEventBase {
  type: "RideCancelled";
  carpoolRideRequestId: string;
  previousStatus: "PENDING" | "ACCEPTED";
  seatsReleased: number;
}

export interface RideInvalidatedEvent extends CarpoolEventBase {
  type: "RideInvalidated";
  carpoolRideRequestId: string;
  reason: RideInvalidationReason;
  previousStatus: "PENDING" | "ACCEPTED";
  seatsReleased: number;
}

export interface RideExpiredEvent extends CarpoolEventBase {
  type: "RideExpired";
  carpoolRideRequestId: string;
}

export interface HostTripChangedEvent extends CarpoolEventBase {
  type: "HostTripChanged";
  changedFields: ("departure_at" | "origin" | "destination")[];
  invalidatedRequests: number;
  /** Riders whose request survived revalidation. */
  survivingRiderIds: string[];
}

export interface HostTripCancelledEvent extends CarpoolEventBase {
  type: "HostTripCancelled";
  invalidatedRequests: number;
}

export type CarpoolEvent =
  | CarpoolOfferEnabledEvent
  | RideRequestedEvent
  | RideAcceptedEvent
  | RideRejectedEvent
  | RideCancelledEvent
  | RideInvalidatedEvent
  | RideExpiredEvent
  | HostTripChangedEvent
  | HostTripCancelledEvent;

/** Distributes `Omit` over the union so each variant keeps its own fields. */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export type CarpoolEventInput = DistributiveOmit<CarpoolEvent, "occurredAt"> & {
  /** ISO 8601; defaults to now. Injectable so callers/tests stay deterministic. */
  occurredAt?: string;
};

/** Pure event builder: stamps `occurredAt` and returns a fully typed event. No I/O. */
export function buildCarpoolEvent<T extends CarpoolEventInput>(
  input: T,
  now: () => Date = () => new Date(),
): Extract<CarpoolEvent, { type: T["type"] }> {
  return { ...input, occurredAt: input.occurredAt ?? now().toISOString() } as unknown as Extract<
    CarpoolEvent,
    { type: T["type"] }
  >;
}

export type NotificationRecipient = "host" | "rider" | "surviving_riders";

export interface NotificationTargets {
  /** Recipients the subscriber may notify for this event. The subscriber additionally never
   * notifies the actor who caused the event (except the rider on auto-accept). */
  recipients: NotificationRecipient[];
}

/**
 * The event -> recipient mapping implemented by `carpool_events_notify` (0058). Pack 05:
 * host: new ride request; rider: accepted/rejected/expired; both: material host trip change;
 * rider: match invalidated; both: cancellation affecting a shared trip.
 */
export function notificationTargetsFor(type: CarpoolEventType): NotificationTargets {
  switch (type) {
    case "CarpoolOfferEnabled":
      return { recipients: [] };
    case "RideRequested":
      return { recipients: ["host"] };
    case "RideAccepted":
      return { recipients: ["rider", "host"] }; // host only on auto-accept
    case "RideRejected":
    case "RideExpired":
    case "RideInvalidated":
      return { recipients: ["rider"] };
    case "RideCancelled":
      return { recipients: ["host", "rider"] };
    case "HostTripChanged":
      return { recipients: ["surviving_riders", "host"] };
    case "HostTripCancelled":
      return { recipients: ["host"] };
  }
}
