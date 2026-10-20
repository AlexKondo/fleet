import { describe, expect, it } from "vitest";
import { energySegments, normalizeEnergyPercent } from "./energyGaugeModel";

describe("fleet energy telemetry", () => {
  it("does not turn missing or invalid data into a false zero", () => {
    for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(normalizeEnergyPercent(value)).toBeNull();
    }
  });
  it("rejects impossible readings instead of turning them into measured zero or full", () => {
    expect(normalizeEnergyPercent(-12)).toBeNull();
    expect(normalizeEnergyPercent(135)).toBeNull();
    expect(normalizeEnergyPercent(19.6)).toBe(20);
  });
  it("renders a bounded number of filled segments", () => {
    expect(energySegments(0, 5)).toBe(0);
    expect(energySegments(20, 5)).toBe(1);
    expect(energySegments(100, 5)).toBe(5);
    expect(energySegments(250, 5)).toBe(0);
    expect(energySegments(50, 0)).toBe(0);
  });
});
