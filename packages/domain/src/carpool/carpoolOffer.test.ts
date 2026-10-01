import { describe, expect, it } from "vitest";
import { enableOffer, updateSeats, disableOffer, type CarpoolOfferState } from "./carpoolOffer";

function state(overrides: Partial<CarpoolOfferState> = {}): CarpoolOfferState {
  return { status: "draft", seatsOffered: 0, seatsAvailable: 0, ...overrides };
}

describe("enableOffer", () => {
  it("publishes a draft offer with full seats available", () => {
    const result = enableOffer(state({ status: "draft" }), { seatsOffered: 3 });
    expect(result).toEqual({ ok: true, state: { status: "active", seatsOffered: 3, seatsAvailable: 3 } });
  });

  it("re-activates a disabled offer", () => {
    const result = enableOffer(state({ status: "disabled", seatsOffered: 2, seatsAvailable: 0 }), {
      seatsOffered: 4,
    });
    expect(result).toEqual({ ok: true, state: { status: "active", seatsOffered: 4, seatsAvailable: 4 } });
  });

  it("rejects enabling an already-active offer", () => {
    const result = enableOffer(state({ status: "active", seatsOffered: 2, seatsAvailable: 1 }), {
      seatsOffered: 2,
    });
    expect(result).toEqual({ ok: false, reason: "ALREADY_ACTIVE" });
  });

  it("rejects enabling a completed offer", () => {
    const result = enableOffer(state({ status: "completed" }), { seatsOffered: 2 });
    expect(result).toEqual({ ok: false, reason: "OFFER_COMPLETED" });
  });

  it("rejects a zero or negative seat count", () => {
    expect(enableOffer(state({ status: "draft" }), { seatsOffered: 0 })).toEqual({
      ok: false,
      reason: "INVALID_SEAT_COUNT",
    });
    expect(enableOffer(state({ status: "draft" }), { seatsOffered: -1 })).toEqual({
      ok: false,
      reason: "INVALID_SEAT_COUNT",
    });
  });

  it("rejects a non-integer seat count", () => {
    const result = enableOffer(state({ status: "draft" }), { seatsOffered: 2.5 });
    expect(result).toEqual({ ok: false, reason: "INVALID_SEAT_COUNT" });
  });
});

describe("updateSeats", () => {
  it("increases seats offered and available by the same delta", () => {
    const result = updateSeats(state({ status: "active", seatsOffered: 2, seatsAvailable: 2 }), {
      seatsOffered: 4,
    });
    expect(result).toEqual({ ok: true, state: { status: "active", seatsOffered: 4, seatsAvailable: 4 } });
  });

  it("preserves already-claimed seats when reducing the total", () => {
    // 4 offered, 2 accepted (2 available) -> reduce total to 3 -> 1 available, not 3.
    const result = updateSeats(state({ status: "active", seatsOffered: 4, seatsAvailable: 2 }), {
      seatsOffered: 3,
    });
    expect(result).toEqual({ ok: true, state: { status: "active", seatsOffered: 3, seatsAvailable: 1 } });
  });

  it("refuses to let seats available go negative (concurrency/atomicity guard)", () => {
    // 4 offered, all 4 claimed (0 available) -> reduce total to 2 would need -2 available.
    const result = updateSeats(state({ status: "active", seatsOffered: 4, seatsAvailable: 0 }), {
      seatsOffered: 2,
    });
    expect(result).toEqual({ ok: false, reason: "CANNOT_REDUCE_BELOW_SEATS_TAKEN" });
  });

  it("rejects updating seats on a non-active offer", () => {
    const result = updateSeats(state({ status: "draft", seatsOffered: 0, seatsAvailable: 0 }), {
      seatsOffered: 3,
    });
    expect(result).toEqual({ ok: false, reason: "ALREADY_DISABLED" });
  });

  it("rejects a zero or negative seat count", () => {
    const result = updateSeats(state({ status: "active", seatsOffered: 2, seatsAvailable: 2 }), {
      seatsOffered: 0,
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_SEAT_COUNT" });
  });
});

describe("disableOffer", () => {
  it("disables an active offer", () => {
    const result = disableOffer(state({ status: "active", seatsOffered: 3, seatsAvailable: 2 }));
    expect(result).toEqual({ ok: true, state: { status: "disabled", seatsOffered: 3, seatsAvailable: 2 } });
  });

  it("disables a draft offer", () => {
    const result = disableOffer(state({ status: "draft" }));
    expect(result).toEqual({ ok: true, state: { status: "disabled", seatsOffered: 0, seatsAvailable: 0 } });
  });

  it("rejects disabling an already-disabled offer", () => {
    const result = disableOffer(state({ status: "disabled" }));
    expect(result).toEqual({ ok: false, reason: "ALREADY_DISABLED" });
  });

  it("rejects disabling a completed offer", () => {
    const result = disableOffer(state({ status: "completed" }));
    expect(result).toEqual({ ok: false, reason: "OFFER_COMPLETED" });
  });
});
