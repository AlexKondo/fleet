import { describe, expect, it } from "vitest";
import { isValidLatLng, isValidSeatCount } from "./inputValidation";

describe("isValidSeatCount", () => {
  it("accepts positive integers", () => {
    expect(isValidSeatCount(1)).toBe(true);
    expect(isValidSeatCount(4)).toBe(true);
  });
  it.each([0, -1, 0.5, 1.5, Number.NaN, Infinity, "2", null, undefined])("rejects %s", (v) => {
    expect(isValidSeatCount(v)).toBe(false);
  });
});

describe("isValidLatLng", () => {
  it("accepts in-range finite coordinates incl. boundaries", () => {
    expect(isValidLatLng({ lat: -23.55, lng: -46.63 })).toBe(true);
    expect(isValidLatLng({ lat: 90, lng: 180 })).toBe(true);
    expect(isValidLatLng({ lat: -90, lng: -180 })).toBe(true);
  });
  it.each([
    [{ lat: 91, lng: 0 }],
    [{ lat: 0, lng: 181 }],
    [{ lat: Number.NaN, lng: 0 }],
    [{ lat: 0, lng: Infinity }],
    [{ lat: "1", lng: 2 }],
    [{ lat: 1 }],
    [null],
    [undefined],
    ["x"],
  ])("rejects %j", (v) => {
    expect(isValidLatLng(v)).toBe(false);
  });
});
