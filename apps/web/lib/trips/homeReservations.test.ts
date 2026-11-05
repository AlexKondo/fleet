import { describe, expect, it } from "vitest";
import { openReservationsNearestFirst } from "./homeReservations";

const now = Date.parse("2026-11-05T12:00:00Z");
const row = (id: string, start: string, end: string, status = "confirmed") => ({ id, status, start_at: start, end_at: end });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("openReservationsNearestFirst", () => {
  it("the closest departure comes first, a trip running now before the ones to come", () => {
    const rows = [
      row("friday", "2026-11-07T11:00:00Z", "2026-11-07T20:00:00Z"),
      row("tomorrow", "2026-11-06T11:00:00Z", "2026-11-06T20:00:00Z", "pending_approval"),
      row("running", "2026-11-05T10:00:00Z", "2026-11-05T20:00:00Z"),
    ];
    expect(ids(openReservationsNearestFirst(rows, () => false, now))).toEqual(["running", "tomorrow", "friday"]);
  });
  it("what ended, was completed or was cancelled is not on the list", () => {
    const rows = [
      row("ended", "2026-11-04T11:00:00Z", "2026-11-04T20:00:00Z"),
      row("completed", "2026-11-06T11:00:00Z", "2026-11-06T20:00:00Z", "completed"),
      row("cancelled", "2026-11-06T11:00:00Z", "2026-11-06T20:00:00Z", "cancelled"),
    ];
    expect(openReservationsNearestFirst(rows, () => false, now)).toEqual([]);
  });
  it("a vehicle that left and did not come back leads the list, even after its window ended", () => {
    const rows = [row("next", "2026-11-05T13:00:00Z", "2026-11-05T20:00:00Z"), row("overdue", "2026-11-03T11:00:00Z", "2026-11-03T20:00:00Z")];
    expect(ids(openReservationsNearestFirst(rows, (r) => r.id === "overdue", now))).toEqual(["overdue", "next"]);
  });
  it("does not change the list it receives", () => {
    const rows = [row("b", "2026-11-07T11:00:00Z", "2026-11-07T20:00:00Z"), row("a", "2026-11-06T11:00:00Z", "2026-11-06T20:00:00Z")];
    openReservationsNearestFirst(rows, () => false, now);
    expect(ids(rows)).toEqual(["b", "a"]);
  });
});
