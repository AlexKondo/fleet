import { describe, expect, it } from "vitest";
import { isValidLatLng, isValidReturnAfterDeparture, isValidSeatCount } from "./inputValidation";

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

describe("isValidReturnAfterDeparture", () => {
  const dep = "2026-10-01T12:00:00.000Z";
  it("accepts a return strictly after the departure", () => {
    expect(isValidReturnAfterDeparture(dep, "2026-10-01T12:01:00.000Z")).toBe(true);
    expect(isValidReturnAfterDeparture(dep, "2026-10-02T00:00:00.000Z")).toBe(true);
  });
  it.each([
    ["same instant", dep],
    ["before departure", "2026-10-01T11:59:00.000Z"],
    ["invalid date", "not-a-date"],
    ["empty", ""],
    ["non-string", 5],
    ["undefined", undefined],
  ])("rejects %s", (_n, ret) => {
    expect(isValidReturnAfterDeparture(dep, ret)).toBe(false);
  });
  it("rejects an invalid departure", () => {
    expect(isValidReturnAfterDeparture("nope", "2026-10-01T12:01:00.000Z")).toBe(false);
  });
});
