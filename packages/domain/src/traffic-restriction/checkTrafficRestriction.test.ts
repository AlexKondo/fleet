import { describe, expect, it } from "vitest";
import type { Vehicle } from "../entities/vehicle";
import type { TripRequest } from "../entities/trip";
import { checkTrafficRestriction, defaultTrafficRestrictionConfig } from "./checkTrafficRestriction";

function vehicle(overrides: Partial<Pick<Vehicle, "plate" | "energyType">> = {}) {
  return {
    plate: "ABC1D21",
    energyType: "ICE" as const,
    ...overrides,
  };
}

function trip(overrides: Partial<Pick<TripRequest, "destination" | "departureAt">> = {}) {
  return {
    // Monday 2026-09-07, 08:00 in São Paulo local time (UTC-3) = 11:00Z.
    departureAt: "2026-09-07T11:00:00Z",
    destination: "São Paulo",
    ...overrides,
  };
}

describe("checkTrafficRestriction (fleet-car-saas.txt §15 — São Paulo rodízio)", () => {
  it("restricts an ICE vehicle whose plate matches Monday's digits during the morning window", () => {
    const result = checkTrafficRestriction(
      vehicle({ plate: "ABC1D21", energyType: "ICE" }),
      trip(),
      defaultTrafficRestrictionConfig,
    );

    expect(result.restricted).toBe(true);
    expect(result.reasons).toContain("rodizio_sp_active");
  });

  it("exempts battery electric vehicles from the rodízio even with a matching digit/window", () => {
    const result = checkTrafficRestriction(
      vehicle({ plate: "ABC1D21", energyType: "BEV" }),
      trip(),
      defaultTrafficRestrictionConfig,
    );

    expect(result.restricted).toBe(false);
    expect(result.reasons).toContain("bev_exempt");
  });

  it("does not restrict a matching plate/weekday departing outside the restricted hour windows", () => {
    const result = checkTrafficRestriction(
      vehicle({ plate: "ABC1D21", energyType: "ICE" }),
      trip({ departureAt: "2026-09-07T14:00:00Z" }), // 11:00 local — between the two windows
      defaultTrafficRestrictionConfig,
    );

    expect(result.restricted).toBe(false);
    expect(result.reasons).toContain("outside_restricted_hours");
  });

  it("does not restrict a trip whose destination is not São Paulo", () => {
    const result = checkTrafficRestriction(
      vehicle({ plate: "ABC1D21", energyType: "ICE" }),
      trip({ destination: "Rio de Janeiro" }),
      defaultTrafficRestrictionConfig,
    );

    expect(result.restricted).toBe(false);
    expect(result.reasons).toContain("not_applicable_destination");
  });

  it("does not restrict a plate whose last digit is not in that weekday's restricted set", () => {
    const result = checkTrafficRestriction(
      // Monday restricts digits 1-2; digit 3 belongs to Tuesday.
      vehicle({ plate: "ABC1D23", energyType: "ICE" }),
      trip(),
      defaultTrafficRestrictionConfig,
    );

    expect(result.restricted).toBe(false);
    expect(result.reasons).toContain("plate_digit_not_restricted_today");
  });
});
