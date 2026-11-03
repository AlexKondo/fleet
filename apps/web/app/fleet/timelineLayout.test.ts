import { describe, expect, it } from "vitest";
import { layoutTimeline, timelineWindow } from "./timelineLayout";

const NOW = Date.parse("2026-11-03T16:00:00Z"); // 13:00 Brasília

describe("layoutTimeline", () => {
  it("window starts at 00:00 Brasília of yesterday", () => {
    expect(new Date(timelineWindow(NOW).start).toISOString()).toBe("2026-11-02T03:00:00.000Z");
  });

  it("a reservation is one bar; a carpool bar appears only when the trip has an active carpool", () => {
    const r = layoutTimeline(
      [
        { id: "a", start: "2026-11-04T11:00:00Z", end: "2026-11-04T23:00:00Z", status: "confirmed", label: "x" },
        { id: "b", start: "2026-11-06T11:00:00Z", end: "2026-11-06T23:00:00Z", status: "pending_approval", label: "y", carpool: { seats: 4, taken: 1 } },
      ],
      NOW,
    );
    expect(r.booking.map((b) => b.kind)).toEqual(["reserved", "pending"]);
    expect(r.carpool).toHaveLength(1);
    expect(r.carpool[0]).toMatchObject({ id: "b:carpool", label: "1/4" });
    expect(r.carpool[0]!.leftPct).toBe(r.booking[1]!.leftPct);
  });

  it("a confirmed reservation that is under way is 'inUse'; bookings outside the window are dropped", () => {
    const r = layoutTimeline(
      [
        { id: "a", start: "2026-11-03T12:00:00Z", end: "2026-11-03T20:00:00Z", status: "confirmed", label: "x" },
        { id: "old", start: "2026-10-01T12:00:00Z", end: "2026-10-01T20:00:00Z", status: "completed", label: "z" },
      ],
      NOW,
    );
    expect(r.booking.map((b) => [b.id, b.kind])).toEqual([["a", "inUse"]]);
  });
});
