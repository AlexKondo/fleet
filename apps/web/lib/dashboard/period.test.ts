import { describe, expect, it } from "vitest";
import { dashboardPeriod } from "./period";
describe("command center reporting period", () => {
  it("uses the São Paulo day before midnight UTC", () => {
    expect(dashboardPeriod("today", new Date("2026-10-16T01:30:00Z"))).toEqual({
      period: "today",
      from: "2026-10-15T03:00:00.000Z",
      to: "2026-10-16T03:00:00.000Z",
    });
  });
  it("includes seven calendar days across a month boundary", () => {
    expect(dashboardPeriod("7d", new Date("2026-03-02T15:00:00Z")).from).toBe(
      "2026-02-24T03:00:00.000Z",
    );
  });
  it("uses the first day of the current month and next midnight as exclusive end", () => {
    expect(dashboardPeriod("month", new Date("2026-10-16T15:00:00Z"))).toEqual({
      period: "month",
      from: "2026-10-01T03:00:00.000Z",
      to: "2026-10-17T03:00:00.000Z",
    });
  });
  it("defaults invalid query values to today and supports 30 days", () => {
    const now = new Date("2026-01-15T15:00:00Z");
    expect(dashboardPeriod("unbounded", now).period).toBe("today");
    expect(dashboardPeriod("30d", now).from).toBe("2025-12-17T03:00:00.000Z");
  });
});
