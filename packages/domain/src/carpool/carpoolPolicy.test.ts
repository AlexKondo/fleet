import { describe, expect, it } from "vitest";
import {
  evaluatePolicyPredicates,
  defaultCarpoolPolicyConfig,
  type PolicyPredicateInput,
} from "./carpoolPolicy";

function input(overrides: Partial<PolicyPredicateInput> = {}): PolicyPredicateInput {
  return {
    policy: defaultCarpoolPolicyConfig,
    requestedDepartureAt: "2026-09-10T08:00:00Z",
    offerDepartureAt: "2026-09-10T08:05:00Z",
    requestedSeats: 1,
    seatsAvailable: 2,
    ...overrides,
  };
}

describe("defaultCarpoolPolicyConfig", () => {
  it("matches the pack's exact TEST/UAT defaults", () => {
    expect(defaultCarpoolPolicyConfig).toMatchObject({
      departureWindowMinutes: 15,
      maxAdditionalDistanceKm: 5,
      maxAdditionalTimeMinutes: 10,
      hostOptInRequired: true,
      hostApprovalRequired: true,
    });
  });
});

describe("evaluatePolicyPredicates", () => {
  it("passes when within the departure window and seats are sufficient", () => {
    const result = evaluatePolicyPredicates(input());
    expect(result.scheduleAndSeatsOK).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("fails when carpool is disabled at the policy level", () => {
    const result = evaluatePolicyPredicates(
      input({ policy: { ...defaultCarpoolPolicyConfig, carpoolEnabled: false } }),
    );
    expect(result.scheduleAndSeatsOK).toBe(false);
    expect(result.reasons).toContain("CARPOOL_DISABLED");
  });

  it("fails when departure is outside the configured window", () => {
    const result = evaluatePolicyPredicates(
      input({ requestedDepartureAt: "2026-09-10T08:00:00Z", offerDepartureAt: "2026-09-10T08:30:00Z" }),
    );
    expect(result.scheduleAndSeatsOK).toBe(false);
    expect(result.reasons).toContain("OUTSIDE_DEPARTURE_WINDOW");
    expect(result.departureDiffMinutes).toBe(30);
  });

  it("passes at exactly the boundary of the departure window", () => {
    const result = evaluatePolicyPredicates(
      input({ requestedDepartureAt: "2026-09-10T08:00:00Z", offerDepartureAt: "2026-09-10T08:15:00Z" }),
    );
    expect(result.scheduleAndSeatsOK).toBe(true);
  });

  it("fails when requested seats exceed what's available", () => {
    const result = evaluatePolicyPredicates(input({ requestedSeats: 3, seatsAvailable: 2 }));
    expect(result.scheduleAndSeatsOK).toBe(false);
    expect(result.reasons).toContain("INSUFFICIENT_SEATS_AVAILABLE");
  });

  it("fails when seats available is below the policy minimum", () => {
    const result = evaluatePolicyPredicates(
      input({
        policy: { ...defaultCarpoolPolicyConfig, minimumSeatAvailability: 2 },
        requestedSeats: 1,
        seatsAvailable: 1,
      }),
    );
    expect(result.scheduleAndSeatsOK).toBe(false);
    expect(result.reasons).toContain("BELOW_MINIMUM_SEAT_AVAILABILITY");
  });

  it("can fail multiple predicates at once", () => {
    const result = evaluatePolicyPredicates(
      input({
        policy: { ...defaultCarpoolPolicyConfig, carpoolEnabled: false },
        requestedDepartureAt: "2026-09-10T08:00:00Z",
        offerDepartureAt: "2026-09-10T10:00:00Z",
        requestedSeats: 5,
        seatsAvailable: 1,
      }),
    );
    expect(result.reasons).toEqual(
      expect.arrayContaining(["CARPOOL_DISABLED", "OUTSIDE_DEPARTURE_WINDOW", "INSUFFICIENT_SEATS_AVAILABLE"]),
    );
  });
});
