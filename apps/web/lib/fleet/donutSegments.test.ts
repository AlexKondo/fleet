import { describe, expect, it } from "vitest";
import { donutSegments } from "./donutSegments";

describe("donutSegments", () => {
  it("the print: 7 vehicles split in 4 parts cover the ring, each one separated by the gap", () => {
    const segments = donutSegments(
      [
        { key: "BEV", value: 2 },
        { key: "PHEV", value: 2 },
        { key: "ICE", value: 2 },
        { key: "HEV", value: 1 },
      ],
      70,
      2,
    );
    expect(segments.map((s) => s.key)).toEqual(["BEV", "PHEV", "ICE", "HEV"]);
    expect(segments.map((s) => s.dash)).toEqual([18, 18, 18, 8]);
    expect(segments.map((s) => s.offset)).toEqual([0, 20, 40, 60]);
    expect(segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
  });
  it("a part with no vehicles is left out", () => {
    const segments = donutSegments([{ key: "BEV", value: 3 }, { key: "HEV", value: 0 }, { key: "ICE", value: 1 }], 100, 2);
    expect(segments.map((s) => s.key)).toEqual(["BEV", "ICE"]);
  });
  it("one part alone closes the ring, with no gap", () => {
    expect(donutSegments([{ key: "BEV", value: 5 }], 100, 2)).toEqual([{ key: "BEV", value: 5, share: 1, dash: 100, offset: 0 }]);
  });
  it("a tiny part stays visible", () => {
    const [, tiny] = donutSegments([{ key: "BEV", value: 999 }, { key: "HEV", value: 1 }], 100, 2);
    expect(tiny!.dash).toBe(1);
  });
  it("no vehicles, no segments", () => {
    expect(donutSegments([], 100, 2)).toEqual([]);
    expect(donutSegments([{ key: "BEV", value: 0 }], 100, 2)).toEqual([]);
  });
});
