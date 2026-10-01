import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/carpool/loadPolicy", () => ({ loadLatestPolicy: vi.fn() }));
import { placesForHost, type HostPlaceRow } from "./loadHostCarpool";

const row = (over: Partial<HostPlaceRow> = {}): HostPlaceRow => ({
  request_id: "r", rider_id: "u", status: "PENDING", pickup_label: "Rua Augusta, Consolação", dropoff_label: "Av. Paulista, Bela Vista", is_exact: false, ...over,
});

describe("placesForHost (0064)", () => {
  it("PENDING: coarse labels, flagged not exact", () => {
    expect(placesForHost("PENDING", row())).toEqual({ pickupLabel: "Rua Augusta, Consolação", dropoffLabel: "Av. Paulista, Bela Vista", placesExact: false });
  });
  it("ACCEPTED: full labels, exact", () => {
    expect(placesForHost("ACCEPTED", row({ status: "ACCEPTED", is_exact: true, pickup_label: "Rua Augusta, 1500 - Consolação" })).placesExact).toBe(true);
  });
  it("PENDING never claims exact even if a row says so", () => {
    expect(placesForHost("PENDING", row({ is_exact: true })).placesExact).toBe(false);
  });
  it.each(["REJECTED", "CANCELLED", "EXPIRED", "INVALIDATED"])("%s: nothing shown", (s) => {
    expect(placesForHost(s, row({ status: s }))).toEqual({ pickupLabel: null, dropoffLabel: null, placesExact: false });
  });
  it("no place row: nothing shown", () => {
    expect(placesForHost("PENDING", undefined).pickupLabel).toBeNull();
  });
});
