import { describe, expect, it } from "vitest";
import { layoutTimeline, riderOf, timelineWindow } from "./timelineLayout";

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

  it("an offer nobody joined is not a carpool: no carpool bar", () => {
    const r = layoutTimeline([{ id: "a", start: "2026-11-04T11:00:00Z", end: "2026-11-04T23:00:00Z", status: "confirmed", label: "x", carpool: { seats: 4, taken: 0 } }], NOW);
    expect(r.booking).toHaveLength(1);
    expect(r.carpool).toHaveLength(0);
  });

  describe("the little person on the bar", () => {
    const base = { id: "a", start: "2026-11-04T11:00:00Z", end: "2026-11-04T23:00:00Z", status: "confirmed", label: "x" };

    it("nobody asked for a carpool: no person", () => {
      expect(layoutTimeline([base], NOW).booking[0]!.rider).toBeUndefined();
      expect(riderOf({ ...base, carpool: { seats: 3, taken: 0 }, carpoolWaiting: 0 })).toBeUndefined();
    });

    it("a request waits for the host: the person is 'waiting', with how many", () => {
      expect(layoutTimeline([{ ...base, carpoolWaiting: 1 }], NOW).booking[0]!.rider).toEqual({ state: "waiting", waiting: 1 });
      expect(riderOf({ ...base, carpoolWaiting: 3 })).toEqual({ state: "waiting", waiting: 3 });
    });

    it("everything was answered and somebody goes along: the person is 'confirmed' (still)", () => {
      expect(riderOf({ ...base, carpool: { seats: 3, taken: 1 }, carpoolWaiting: 0 })).toEqual({ state: "confirmed", waiting: 0 });
      expect(riderOf({ ...base, carpool: { seats: 3, taken: 2 } })).toEqual({ state: "confirmed", waiting: 0 });
    });

    it("one confirmed and another still waiting (Maria accepted, Pedro not answered yet): it blinks, with 1", () => {
      expect(riderOf({ ...base, carpool: { seats: 3, taken: 1 }, carpoolWaiting: 1 })).toEqual({ state: "waiting", waiting: 1 });
    });

    it("a finished reservation shows no person, the same as it shows no carpool bar", () => {
      expect(riderOf({ ...base, status: "completed", carpool: { seats: 3, taken: 1 }, carpoolWaiting: 2 })).toBeUndefined();
    });

    it("the carpool bar stays as it was (only when somebody is going along)", () => {
      const r = layoutTimeline([{ ...base, carpool: { seats: 3, taken: 1 }, carpoolWaiting: 1 }], NOW);
      expect(r.carpool).toHaveLength(1);
      expect(layoutTimeline([{ ...base, carpoolWaiting: 2 }], NOW).carpool).toHaveLength(0);
    });
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
