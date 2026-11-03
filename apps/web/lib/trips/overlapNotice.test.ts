import { describe, expect, it } from "vitest";
import { overlappingPeriods } from "./overlapNotice";

const own = [{ plate: "CCD0710", destination: "EZ Tower", startAt: "2026-11-04T11:00:00Z", endAt: "2026-11-04T23:00:00Z" }];

describe("overlappingPeriods", () => {
  it("finds a reservation that overlaps the requested period", () => {
    expect(overlappingPeriods(own, "2026-11-04T14:00:00Z", "2026-11-04T16:00:00Z")).toHaveLength(1);
    expect(overlappingPeriods(own, "2026-11-04T10:00:00Z", "2026-11-04T12:00:00Z")).toHaveLength(1);
  });
  it("back-to-back periods do not overlap", () => {
    expect(overlappingPeriods(own, "2026-11-04T23:00:00Z", "2026-11-05T05:00:00Z")).toHaveLength(0);
    expect(overlappingPeriods(own, "2026-11-04T05:00:00Z", "2026-11-04T11:00:00Z")).toHaveLength(0);
  });
  it("a request without a return counts as one hour; without a valid start it overlaps nothing", () => {
    expect(overlappingPeriods(own, "2026-11-04T22:30:00Z", undefined)).toHaveLength(1);
    expect(overlappingPeriods(own, "2026-11-04T23:30:00Z", undefined)).toHaveLength(0);
    expect(overlappingPeriods(own, undefined, undefined)).toHaveLength(0);
    expect(overlappingPeriods(own, "garbage", undefined)).toHaveLength(0);
  });
});
