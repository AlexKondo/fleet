import { describe, expect, it } from "vitest";
import type { ReservationWindow } from "../entities/reservation";
import { DoubleBookingError, hasSchedulingConflict, reserveVehicle } from "./availability";

const existing: ReservationWindow = {
  startAt: "2026-09-10T08:00:00Z",
  endAt: "2026-09-10T18:00:00Z",
};

describe("hasSchedulingConflict", () => {
  it("detects a fully overlapping window", () => {
    const candidate: ReservationWindow = {
      startAt: "2026-09-10T10:00:00Z",
      endAt: "2026-09-10T12:00:00Z",
    };
    expect(hasSchedulingConflict([existing], candidate)).toBe(true);
  });

  it("detects a partially overlapping window", () => {
    const candidate: ReservationWindow = {
      startAt: "2026-09-10T17:00:00Z",
      endAt: "2026-09-10T20:00:00Z",
    };
    expect(hasSchedulingConflict([existing], candidate)).toBe(true);
  });

  it("allows an adjacent reservation that starts exactly when the other ends", () => {
    const candidate: ReservationWindow = {
      startAt: "2026-09-10T18:00:00Z",
      endAt: "2026-09-10T20:00:00Z",
    };
    expect(hasSchedulingConflict([existing], candidate)).toBe(false);
  });

  it("allows a fully separate window", () => {
    const candidate: ReservationWindow = {
      startAt: "2026-09-11T08:00:00Z",
      endAt: "2026-09-11T18:00:00Z",
    };
    expect(hasSchedulingConflict([existing], candidate)).toBe(false);
  });

  it("returns false when there are no existing reservations", () => {
    expect(hasSchedulingConflict([], existing)).toBe(false);
  });
});

describe("reserveVehicle", () => {
  it("throws DoubleBookingError for an overlapping request", () => {
    const candidate: ReservationWindow = {
      startAt: "2026-09-10T09:00:00Z",
      endAt: "2026-09-10T11:00:00Z",
    };
    expect(() => reserveVehicle([existing], candidate)).toThrow(DoubleBookingError);
  });

  it("does not throw for a non-overlapping request", () => {
    const candidate: ReservationWindow = {
      startAt: "2026-09-12T08:00:00Z",
      endAt: "2026-09-12T18:00:00Z",
    };
    expect(() => reserveVehicle([existing], candidate)).not.toThrow();
  });
});
