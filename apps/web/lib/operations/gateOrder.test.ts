import { describe, expect, it } from "vitest";
import { nearestEventFirst, shortPersonName } from "./gateOrder";

const HOUR = 3_600_000;
const now = Date.UTC(2026, 10, 5, 12);
const at = (id: string, hours: number) => ({ id, eventMs: now + hours * HOUR });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("nearestEventFirst", () => {
  it("puts the event closest to now on top, upcoming or just past", () => {
    const rows = [at("tomorrow", 22), at("yesterday", -26), at("in-an-hour", 1), at("just-passed", -2)];
    expect(ids(nearestEventFirst(rows, now))).toEqual(["in-an-hour", "just-passed", "tomorrow", "yesterday"]);
  });
  it("on a tie, the earlier event comes first", () => {
    expect(ids(nearestEventFirst([at("after", 3), at("before", -3)], now))).toEqual(["before", "after"]);
  });
  it("does not change the list it receives", () => {
    const rows = [at("far", 9), at("near", 1)];
    nearestEventFirst(rows, now);
    expect(ids(rows)).toEqual(["far", "near"]);
  });
});

describe("shortPersonName", () => {
  it("keeps the first and the last name", () => {
    expect(shortPersonName("ALEXANDRE MASSAHIRO KONDO")).toBe("ALEXANDRE KONDO");
    expect(shortPersonName("  Ana   Souza ")).toBe("Ana Souza");
  });
  it("copes with one name or none", () => {
    expect(shortPersonName("Ana")).toBe("Ana");
    expect(shortPersonName("")).toBeNull();
    expect(shortPersonName(null)).toBeNull();
  });
});
