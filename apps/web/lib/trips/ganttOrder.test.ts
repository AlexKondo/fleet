import { describe, expect, it } from "vitest";
import { byNextReservation } from "./ganttOrder";

const now = Date.parse("2026-11-05T12:00:00Z");
const res = (start: string, end: string, status = "confirmed") => ({ status, start, end });
const rows = (r: Record<string, ReturnType<typeof res>[]>) => Object.entries(r).map(([id, list]) => ({ id, list }));
const order = (r: Record<string, ReturnType<typeof res>[]>) => byNextReservation(rows(r), (x) => x.list, now).map((x) => x.id);

describe("byNextReservation", () => {
  it("the print: the vehicle with the reservation ahead goes on top of the ones with cancelled reservations only", () => {
    expect(
      order({
        haval: [res("2026-11-06T11:00:00Z", "2026-11-06T20:00:00Z", "cancelled")],
        ora03: [res("2026-11-06T11:00:00Z", "2026-11-06T20:00:00Z")],
        ora05: [res("2026-11-04T11:00:00Z", "2026-11-04T23:00:00Z", "cancelled")],
      }),
    ).toEqual(["ora03", "haval", "ora05"]);
  });
  it("the closest open reservation first; one running now leads", () => {
    expect(
      order({
        later: [res("2026-11-09T11:00:00Z", "2026-11-09T20:00:00Z")],
        soon: [res("2026-11-06T11:00:00Z", "2026-11-06T20:00:00Z", "pending_approval")],
        running: [res("2026-11-05T10:00:00Z", "2026-11-05T20:00:00Z")],
      }),
    ).toEqual(["running", "soon", "later"]);
  });
  it("a vehicle counts by its next reservation, not by an old one", () => {
    expect(
      order({
        a: [res("2026-11-20T11:00:00Z", "2026-11-20T20:00:00Z")],
        b: [res("2026-10-01T11:00:00Z", "2026-10-01T20:00:00Z", "completed"), res("2026-11-07T11:00:00Z", "2026-11-07T20:00:00Z")],
      }),
    ).toEqual(["b", "a"]);
  });
  it("with nothing ahead, the most recently used first", () => {
    expect(
      order({
        old: [res("2026-10-01T11:00:00Z", "2026-10-01T20:00:00Z", "completed")],
        recent: [res("2026-11-01T11:00:00Z", "2026-11-01T20:00:00Z", "completed")],
      }),
    ).toEqual(["recent", "old"]);
  });
});
