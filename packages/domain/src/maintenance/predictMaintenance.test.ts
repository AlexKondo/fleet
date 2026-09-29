import { describe, expect, it } from "vitest";
import {
  defaultMaintenancePredictionConfig,
  predictNextService,
  type OdometerReading,
} from "./predictMaintenance";

describe("predictNextService (§12 Predictive Maintenance)", () => {
  it("estimates the service date from the spec's own example (110 km/day)", () => {
    const history: OdometerReading[] = [
      { odometerKm: 17_800, recordedAt: "2026-08-23T08:00:00.000Z" },
      { odometerKm: 18_900, recordedAt: "2026-09-02T08:00:00.000Z" },
    ];

    const result = predictNextService(
      18_900,
      20_000,
      history,
      "2026-09-02T08:00:00.000Z",
      defaultMaintenancePredictionConfig,
    );

    expect(result.averageKmPerDay).toBe(110);
    expect(result.daysUntilService).toBe(10);
    expect(result.remainingKm).toBe(1_100);
    expect(result.estimatedServiceDate).toBe("2026-09-12T08:00:00.000Z");
    // 1100km remaining is just outside the default 1000km window.
    expect(result.dueSoon).toBe(false);
    expect(result.reasons).toContain("estimate_based_on_recent_usage");
  });

  it("flags due soon once remainingKm falls within the configured km window", () => {
    const history: OdometerReading[] = [
      { odometerKm: 17_800, recordedAt: "2026-08-23T08:00:00.000Z" },
      { odometerKm: 19_500, recordedAt: "2026-09-02T08:00:00.000Z" },
    ];

    const result = predictNextService(
      19_500,
      20_000,
      history,
      "2026-09-02T08:00:00.000Z",
      defaultMaintenancePredictionConfig,
    );

    expect(result.remainingKm).toBe(500);
    expect(result.dueSoon).toBe(true);
    expect(result.reasons).toContain("maintenance_due_soon");
  });

  it("returns nothing-to-predict when no service is scheduled", () => {
    const history: OdometerReading[] = [
      { odometerKm: 17_800, recordedAt: "2026-08-23T08:00:00.000Z" },
      { odometerKm: 18_900, recordedAt: "2026-09-02T08:00:00.000Z" },
    ];

    const result = predictNextService(
      18_900,
      null,
      history,
      "2026-09-02T08:00:00.000Z",
      defaultMaintenancePredictionConfig,
    );

    expect(result.estimatedServiceDate).toBeNull();
    expect(result.averageKmPerDay).toBeNull();
    expect(result.daysUntilService).toBeNull();
    expect(result.remainingKm).toBeNull();
    expect(result.dueSoon).toBe(false);
    expect(result.reasons).toContain("no_service_scheduled");
  });

  it("still flags dueSoon by remainingKm even with fewer than 2 distinct-timestamp readings", () => {
    const history: OdometerReading[] = [{ odometerKm: 19_500, recordedAt: "2026-09-02T08:00:00.000Z" }];

    const result = predictNextService(
      19_500,
      20_000,
      history,
      "2026-09-02T08:00:00.000Z",
      defaultMaintenancePredictionConfig,
    );

    expect(result.averageKmPerDay).toBeNull();
    expect(result.estimatedServiceDate).toBeNull();
    expect(result.daysUntilService).toBeNull();
    expect(result.remainingKm).toBe(500);
    // 500km remaining <= the default 1000km window, regardless of usage history.
    expect(result.dueSoon).toBe(true);
    expect(result.reasons).toContain("insufficient_history");
    expect(result.reasons).toContain("maintenance_due_soon");
  });

  it("does not flag dueSoon from insufficient history when remainingKm is outside the window", () => {
    const history: OdometerReading[] = [{ odometerKm: 18_900, recordedAt: "2026-09-02T08:00:00.000Z" }];

    const result = predictNextService(
      18_900,
      20_000,
      history,
      "2026-09-02T08:00:00.000Z",
      defaultMaintenancePredictionConfig,
    );

    expect(result.averageKmPerDay).toBeNull();
    expect(result.remainingKm).toBe(1_100);
    expect(result.dueSoon).toBe(false);
    expect(result.reasons).toContain("insufficient_history");
  });

  it("treats readings that all share the same timestamp as insufficient history", () => {
    const history: OdometerReading[] = [
      { odometerKm: 18_800, recordedAt: "2026-09-02T08:00:00.000Z" },
      { odometerKm: 18_900, recordedAt: "2026-09-02T08:00:00.000Z" },
    ];

    const result = predictNextService(
      18_900,
      20_000,
      history,
      "2026-09-02T08:00:00.000Z",
      defaultMaintenancePredictionConfig,
    );

    expect(result.averageKmPerDay).toBeNull();
    expect(result.reasons).toContain("insufficient_history");
  });

  it("flags a vehicle already at or past its next service odometer as overdue, regardless of history", () => {
    const result = predictNextService(
      20_100,
      20_000,
      [],
      "2026-09-02T08:00:00.000Z",
      defaultMaintenancePredictionConfig,
    );

    expect(result.dueSoon).toBe(true);
    expect(result.reasons).toContain("already_overdue");
    expect(result.daysUntilService).toBe(0);
    expect(result.remainingKm).toBe(-100);
  });

  it("averages total km driven over total days spanned across a multi-reading history with a varying rate", () => {
    // odometer goes 17,000 -> 17,300 (5 days, 60km/day) -> 18,900 (10 more days, 160km/day)
    // averaging approach: total km driven / total days spanned across earliest-to-latest readings
    // = (18,900 - 17,000) / 15 days = 126.66... km/day
    const history: OdometerReading[] = [
      { odometerKm: 17_000, recordedAt: "2026-08-18T08:00:00.000Z" },
      { odometerKm: 17_300, recordedAt: "2026-08-23T08:00:00.000Z" },
      { odometerKm: 18_900, recordedAt: "2026-09-02T08:00:00.000Z" },
    ];

    const result = predictNextService(
      18_900,
      20_000,
      history,
      "2026-09-02T08:00:00.000Z",
      defaultMaintenancePredictionConfig,
    );

    expect(result.averageKmPerDay).toBeCloseTo(1900 / 15, 5);
    expect(result.reasons).toContain("estimate_based_on_recent_usage");
  });

  it("does not flag dueSoon when remainingKm falls outside the configured km window", () => {
    const history: OdometerReading[] = [
      { odometerKm: 10_000, recordedAt: "2026-08-02T08:00:00.000Z" },
      { odometerKm: 10_300, recordedAt: "2026-09-02T08:00:00.000Z" },
    ];

    const result = predictNextService(
      10_300,
      20_000,
      history,
      "2026-09-02T08:00:00.000Z",
      defaultMaintenancePredictionConfig,
    );

    // remainingKm = 9700, far outside the default 1000km window.
    expect(result.remainingKm).toBe(9_700);
    expect(result.dueSoon).toBe(false);
    expect(result.reasons).not.toContain("already_overdue");
  });

  it("reports no usable rate when the odometer shows no movement across distinct timestamps", () => {
    const history: OdometerReading[] = [
      { odometerKm: 18_900, recordedAt: "2026-08-23T08:00:00.000Z" },
      { odometerKm: 18_900, recordedAt: "2026-09-02T08:00:00.000Z" },
    ];

    const result = predictNextService(
      18_900,
      20_000,
      history,
      "2026-09-02T08:00:00.000Z",
      defaultMaintenancePredictionConfig,
    );

    expect(result.averageKmPerDay).toBe(0);
    expect(result.estimatedServiceDate).toBeNull();
    expect(result.daysUntilService).toBeNull();
    // remainingKm = 1100, outside the default 1000km window.
    expect(result.dueSoon).toBe(false);
    expect(result.reasons).toContain("no_recent_usage");
  });
});
