import { describe, expect, it } from "vitest";
import { easeInOut, scrollDuration, scrollStop } from "./attentionJump";

describe("easeInOut: slow start, faster middle, slow stop", () => {
  it("starts at the start and ends at the end, and never leaves them", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(-0.5)).toBe(0);
    expect(easeInOut(1.5)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });

  it("moves little at the start and at the end, and fastest in the middle", () => {
    const start = easeInOut(0.1) - easeInOut(0);
    const middle = easeInOut(0.55) - easeInOut(0.45);
    const end = easeInOut(1) - easeInOut(0.9);
    expect(start).toBeLessThan(0.01);
    expect(end).toBeLessThan(0.01);
    expect(middle).toBeGreaterThan(0.14);
  });

  it("always goes forward, and the stop mirrors the start", () => {
    for (let t = 0; t < 1; t += 0.05) {
      expect(easeInOut(t + 0.05)).toBeGreaterThanOrEqual(easeInOut(t));
      expect(easeInOut(t) + easeInOut(1 - t)).toBeCloseTo(1);
    }
  });
});

describe("scrollDuration", () => {
  it("is longer for a longer trip, between 0.6 s and 1.4 s, in either direction", () => {
    expect(scrollDuration(50)).toBe(600);
    expect(scrollDuration(1000)).toBe(950);
    expect(scrollDuration(-1000)).toBe(950);
    expect(scrollDuration(9000)).toBe(1400);
  });
});

describe("scrollStop", () => {
  const base = { scrollY: 0, viewport: 900, topBar: 76, maxScroll: 5000 };

  it("puts the cards in the middle of what the top bar leaves visible", () => {
    const y = scrollStop({ ...base, top: 1500, height: 300 });
    // after the trip the cards sit at top - y, with the same room above and below them under the bar
    const above = 1500 - y - 76;
    const below = 900 - (1500 - y + 300);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
  });

  it("counts what the page has already scrolled", () => {
    expect(scrollStop({ ...base, scrollY: 400, top: 1100, height: 300 })).toBe(scrollStop({ ...base, top: 1500, height: 300 }));
  });

  it("shows the first row just under the bar when the cards do not fit", () => {
    expect(scrollStop({ ...base, top: 1500, height: 2000 })).toBe(1500 - 76 - 16);
  });

  it("never goes past either end of the page", () => {
    expect(scrollStop({ ...base, top: 100, height: 300 })).toBe(0);
    expect(scrollStop({ ...base, maxScroll: 800, top: 1500, height: 300 })).toBe(800);
    expect(scrollStop({ ...base, maxScroll: -10, top: 1500, height: 300 })).toBe(0);
  });
});
