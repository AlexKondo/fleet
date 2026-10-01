import { describe, expect, it } from "vitest";
import {
  prefilterCandidate,
  prefilterCandidates,
  haversineDistanceKm,
  type PrefilterCandidateOffer,
} from "./prefilterCandidates";

function baseCandidate(overrides: Partial<PrefilterCandidateOffer> = {}): PrefilterCandidateOffer {
  return {
    offerId: "offer-1",
    offerStatus: "active",
    hostTripActive: true,
    seatsAvailable: 2,
    requestedSeats: 1,
    riderRequiresCargo: false,
    vehicleSupportsCargo: false,
    hostDepartureAt: "2026-10-01T12:00:00.000Z",
    riderRequestedDepartureAt: "2026-10-01T12:00:00.000Z",
    departureWindowMinutes: 15,
    ...overrides,
  };
}

describe("prefilterCandidate", () => {
  it("passes a baseline compatible candidate", () => {
    const result = prefilterCandidate(baseCandidate());
    expect(result).toEqual({ offerId: "offer-1", passed: true, reasons: [] });
  });

  it("rejects an offer that is not active (draft)", () => {
    const result = prefilterCandidate(baseCandidate({ offerStatus: "draft" }));
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("offer_not_active");
  });

  it("rejects an offer that is not active (disabled)", () => {
    const result = prefilterCandidate(baseCandidate({ offerStatus: "disabled" }));
    expect(result.reasons).toContain("offer_not_active");
  });

  it("rejects when the host trip is no longer active", () => {
    const result = prefilterCandidate(baseCandidate({ hostTripActive: false }));
    expect(result.reasons).toContain("host_trip_inactive");
  });

  it("does NOT consult the legacy allow_carpool flag: a trip reserved with allow_carpool=false but with an active offer is kept (the offer row is the consent)", () => {
    // `hostAllowCarpool` is the OLD field name (it used to mirror trip_requests.allow_carpool). A
    // loader that still supplies it must have no effect on the new-engine prefilter.
    const legacy: PrefilterCandidateOffer & { hostAllowCarpool: boolean } = { ...baseCandidate(), hostAllowCarpool: false };
    const result = prefilterCandidate(legacy);
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("still rejects every other guard even when the legacy flag is absent", () => {
    expect(prefilterCandidate(baseCandidate({ offerStatus: "disabled" })).passed).toBe(false);
    expect(prefilterCandidate(baseCandidate({ hostTripActive: false })).passed).toBe(false);
    expect(prefilterCandidate(baseCandidate({ seatsAvailable: 0 })).passed).toBe(false);
  });

  it("rejects when seats available are fewer than requested (capacity_exhausted guard reused from findCarpoolMatches)", () => {
    const result = prefilterCandidate(baseCandidate({ seatsAvailable: 0, requestedSeats: 1 }));
    expect(result.reasons).toContain("capacity_exhausted");
  });

  it("accepts when seats available exactly match requested seats", () => {
    const result = prefilterCandidate(baseCandidate({ seatsAvailable: 1, requestedSeats: 1 }));
    expect(result.reasons).not.toContain("capacity_exhausted");
  });

  it("rejects when the rider requires cargo and the vehicle does not support it (cargo_unsupported guard reused from findCarpoolMatches)", () => {
    const result = prefilterCandidate(
      baseCandidate({ riderRequiresCargo: true, vehicleSupportsCargo: false }),
    );
    expect(result.reasons).toContain("cargo_unsupported");
  });

  it("accepts when the rider requires cargo and the vehicle supports it", () => {
    const result = prefilterCandidate(
      baseCandidate({ riderRequiresCargo: true, vehicleSupportsCargo: true }),
    );
    expect(result.reasons).not.toContain("cargo_unsupported");
  });

  describe("departure window boundary", () => {
    it("passes just below the window", () => {
      const result = prefilterCandidate(
        baseCandidate({
          departureWindowMinutes: 15,
          hostDepartureAt: "2026-10-01T12:00:00.000Z",
          riderRequestedDepartureAt: "2026-10-01T12:14:00.000Z",
        }),
      );
      expect(result.reasons).not.toContain("departure_window_exceeded");
    });

    it("passes exactly at the window boundary", () => {
      const result = prefilterCandidate(
        baseCandidate({
          departureWindowMinutes: 15,
          hostDepartureAt: "2026-10-01T12:00:00.000Z",
          riderRequestedDepartureAt: "2026-10-01T12:15:00.000Z",
        }),
      );
      expect(result.reasons).not.toContain("departure_window_exceeded");
    });

    it("rejects just above the window", () => {
      const result = prefilterCandidate(
        baseCandidate({
          departureWindowMinutes: 15,
          hostDepartureAt: "2026-10-01T12:00:00.000Z",
          riderRequestedDepartureAt: "2026-10-01T12:16:00.000Z",
        }),
      );
      expect(result.reasons).toContain("departure_window_exceeded");
    });
  });

  describe("coarse geographic bounds (new, no equivalent in findCarpoolMatches)", () => {
    const saoPaulo = { lat: -23.55052, lng: -46.633308 };
    const nearby = { lat: -23.5629, lng: -46.6544 }; // a few km away
    const farAway = { lat: -22.9068, lng: -43.1729 }; // Rio de Janeiro, hundreds of km away

    it("is skipped entirely when coordinates are not available (current phase: host trips have no stored lat/lng)", () => {
      const result = prefilterCandidate(baseCandidate({ coarseBoundsKm: 20 }));
      expect(result.reasons).not.toContain("coarse_bounds_exceeded");
    });

    it("passes when destinations are within the coarse bound", () => {
      const result = prefilterCandidate(
        baseCandidate({ coarseBoundsKm: 20, hostDestination: saoPaulo, riderDropoff: nearby }),
      );
      expect(result.reasons).not.toContain("coarse_bounds_exceeded");
    });

    it("rejects when destinations are far outside the coarse bound", () => {
      const result = prefilterCandidate(
        baseCandidate({ coarseBoundsKm: 20, hostDestination: saoPaulo, riderDropoff: farAway }),
      );
      expect(result.reasons).toContain("coarse_bounds_exceeded");
    });

    it("haversineDistanceKm returns 0 for identical points", () => {
      expect(haversineDistanceKm(saoPaulo, saoPaulo)).toBeCloseTo(0, 5);
    });
  });

  it("prefilterCandidates preserves order and maps each candidate independently", () => {
    const results = prefilterCandidates([
      baseCandidate({ offerId: "a" }),
      baseCandidate({ offerId: "b", offerStatus: "disabled" }),
      baseCandidate({ offerId: "c" }),
    ]);
    expect(results.map((r) => r.offerId)).toEqual(["a", "b", "c"]);
    expect(results[1]!.passed).toBe(false);
  });

  describe("fails closed on invalid input", () => {
    const cases: Array<[string, Partial<PrefilterCandidateOffer>]> = [
      ["invalid rider departure date", { riderRequestedDepartureAt: "garbage" }],
      ["invalid host departure date", { hostDepartureAt: "garbage" }],
      ["NaN seatsAvailable", { seatsAvailable: Number.NaN }],
      ["NaN requestedSeats", { requestedSeats: Number.NaN }],
      ["zero requestedSeats (C3 carry-over a)", { requestedSeats: 0 }],
      ["negative requestedSeats (C3 carry-over a)", { requestedSeats: -1 }],
      ["fractional requestedSeats (C3 carry-over a)", { requestedSeats: 0.5 }],
      ["NaN departure window", { departureWindowMinutes: Number.NaN }],
      ["Infinity departure window is still finite-checked", { departureWindowMinutes: Infinity }],
      ["NaN coarse bound", { coarseBoundsKm: Number.NaN }],
    ];
    for (const [name, overrides] of cases) {
      it(`rejects ${name}`, () => {
        const result = prefilterCandidate(baseCandidate(overrides));
        expect(result.passed).toBe(false);
        expect(result.reasons).toEqual(["invalid_input"]);
      });
    }
  });
});
