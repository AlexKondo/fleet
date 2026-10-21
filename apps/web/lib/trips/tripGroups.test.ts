import { describe, expect, it } from "vitest";
import { expiredBadge, groupTrips, hasOperationalActivity, type TripActivityState } from "./tripGroups";

/** FIX-VENCIDAS R1: grouping of /trips rows (pure function extracted from TripsWorkspace). */
const NOW = Date.parse("2026-10-21T12:00:00Z");
const none: TripActivityState = {
  pickup_traveler: false, pickup_security: false, return_traveler: false, return_security: false,
  departed: false, arrived: false, legacy_pickup: false, keys_delivered: false, keys_received: false,
};
type Row = { id: string; status: string; start_at: string; end_at: string; vehicle: { status: string } | null; cancellation_reason?: string | null };
const row = (id: string, status: string, start: string, end: string, vehicleStatus = "reserved", reason: string | null = null): Row => ({
  id, status, start_at: start, end_at: end, vehicle: { status: vehicleStatus }, cancellation_reason: reason,
});

// The reported case: confirmed 13/10 14:04–22:04 (SSO5A16), never picked up, seen on 21/10.
const reported = row("reported", "confirmed", "2026-10-13T17:04:00Z", "2026-10-14T01:04:00Z");
const future = row("future", "confirmed", "2026-10-22T12:00:00Z", "2026-10-22T18:00:00Z");
const pendingFuture = row("pendingFuture", "pending_approval", "2026-10-23T12:00:00Z", "2026-10-23T18:00:00Z");
const pendingPast = row("pendingPast", "pending_approval", "2026-10-10T12:00:00Z", "2026-10-10T18:00:00Z", "available");
const overdueInUse = row("overdue", "confirmed", "2026-10-19T12:00:00Z", "2026-10-20T12:00:00Z", "in_use");
const pastWithPickup = row("pastWithPickup", "confirmed", "2026-10-18T12:00:00Z", "2026-10-18T18:00:00Z", "awaiting_pickup");
const pastUnknown = row("pastUnknown", "confirmed", "2026-10-17T12:00:00Z", "2026-10-17T18:00:00Z");
const done = row("done", "completed", "2026-10-01T12:00:00Z", "2026-10-01T18:00:00Z", "available");
const cancelled = row("cancelled", "cancelled", "2026-10-02T12:00:00Z", "2026-10-02T18:00:00Z", "available", "mudança de agenda");
const released = row("released", "cancelled", "2026-10-03T12:00:00Z", "2026-10-03T18:00:00Z", "available", "no_show_auto");

const activity: Record<string, boolean | null> = {
  reported: false, future: false, overdue: true, pastWithPickup: true, pastUnknown: null,
};
const activityOf = (r: Row) => (r.status === "confirmed" && r.id in activity ? activity[r.id]! : false);

describe("FIX-VENCIDAS R1 /trips grouping", () => {
  const all = [reported, future, pendingFuture, pendingPast, overdueInUse, pastWithPickup, pastUnknown, done, cancelled, released];
  const g = groupTrips(all, NOW, activityOf);
  const ids = (rows: Row[]) => rows.map((r) => r.id);

  it("an expired confirmed reservation never picked up is NOT upcoming; it goes to History (cancelled tab)", () => {
    expect(ids(g.upcomingList)).not.toContain("reported");
    expect(ids(g.cancelledList)).toContain("reported");
    expect(ids(g.historyList)).toContain("reported");
    expect(expiredBadge(reported, NOW, false)).toBe("notPickedUp");
  });

  it("future reservations stay upcoming in start order; an expired pending request goes to History", () => {
    expect(ids(g.upcomingList)).toEqual(["pastUnknown", "pastWithPickup", "future", "pendingFuture"]);
    expect(expiredBadge(pendingPast, NOW, false)).toBe("expiredUnapproved");
    expect(ids(g.cancelledList)).toContain("pendingPast");
  });

  it("reservations with any activity, in progress, or with unknown activity keep the previous handling", () => {
    expect(ids(g.activeList)).toEqual(["overdue"]);
    expect(expiredBadge(overdueInUse, NOW, true)).toBeNull();
    expect(expiredBadge(pastWithPickup, NOW, true)).toBeNull();
    expect(expiredBadge(pastUnknown, NOW, null)).toBeNull();
  });

  it("the boundary is end_at itself (same as record_pickup: now >= end_at ends the window)", () => {
    const r = row("b", "confirmed", "2026-10-21T08:00:00Z", "2026-10-21T12:00:00Z");
    expect(expiredBadge(r, NOW - 1, false)).toBeNull();
    expect(expiredBadge(r, NOW, false)).toBe("notPickedUp");
  });

  it("rows already cancelled by the automatic release carry the badge; ordinary cancellations do not", () => {
    expect(expiredBadge(released, NOW, false)).toBe("notPickedUp");
    expect(expiredBadge({ ...released, cancellation_reason: "expired_unapproved" }, NOW, false)).toBe("expiredUnapproved");
    expect(expiredBadge(cancelled, NOW, false)).toBeNull();
    expect(ids(g.doneList)).toEqual(["done"]);
    expect(g.historyList.map((r) => r.id)).toEqual(["reported", "pendingPast", "released", "cancelled", "done"]);
  });

  it("hasOperationalActivity: any pickup/gate/key flag counts; a missing state is unknown", () => {
    expect(hasOperationalActivity(none)).toBe(false);
    expect(hasOperationalActivity(undefined)).toBeNull();
    for (const k of Object.keys(none) as (keyof TripActivityState)[]) {
      expect(hasOperationalActivity({ ...none, [k]: true })).toBe(true);
    }
  });
});
