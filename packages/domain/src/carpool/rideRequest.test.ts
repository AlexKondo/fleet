import { describe, expect, it } from "vitest";
import {
  accept,
  reject,
  cancel,
  expire,
  invalidate,
  type CarpoolRideRequestState,
  type CarpoolRideRequestStatus,
} from "./rideRequest";

function state(status: CarpoolRideRequestStatus): CarpoolRideRequestState {
  return { status };
}

describe("accept", () => {
  it("accepts a pending request", () => {
    expect(accept(state("PENDING"))).toEqual({ ok: true, state: { status: "ACCEPTED" } });
  });

  it("refuses to accept an already-rejected request", () => {
    expect(accept(state("REJECTED"))).toEqual({ ok: false, reason: "NOT_PENDING" });
  });

  it("refuses to accept an already-accepted request", () => {
    expect(accept(state("ACCEPTED"))).toEqual({ ok: false, reason: "NOT_PENDING" });
  });

  it("refuses to accept an expired request", () => {
    expect(accept(state("EXPIRED"))).toEqual({ ok: false, reason: "NOT_PENDING" });
  });
});

describe("reject", () => {
  it("rejects a pending request (durable status, not a delete)", () => {
    expect(reject(state("PENDING"))).toEqual({ ok: true, state: { status: "REJECTED" } });
  });

  it("refuses to reject an already-accepted request", () => {
    expect(reject(state("ACCEPTED"))).toEqual({ ok: false, reason: "NOT_PENDING" });
  });

  it("refuses to reject an already-rejected request", () => {
    expect(reject(state("REJECTED"))).toEqual({ ok: false, reason: "NOT_PENDING" });
  });
});

describe("cancel", () => {
  it("cancels a pending request", () => {
    expect(cancel(state("PENDING"))).toEqual({ ok: true, state: { status: "CANCELLED" } });
  });

  it("cancels an accepted request (rider changes their mind)", () => {
    expect(cancel(state("ACCEPTED"))).toEqual({ ok: true, state: { status: "CANCELLED" } });
  });

  it("refuses to cancel an already-rejected request", () => {
    expect(cancel(state("REJECTED"))).toEqual({ ok: false, reason: "NOT_PENDING" });
  });

  it("refuses to cancel an already-cancelled request", () => {
    expect(cancel(state("CANCELLED"))).toEqual({ ok: false, reason: "NOT_PENDING" });
  });
});

describe("expire", () => {
  it("expires a pending request", () => {
    expect(expire(state("PENDING"))).toEqual({ ok: true, state: { status: "EXPIRED" } });
  });

  it("refuses to expire an already-accepted request", () => {
    expect(expire(state("ACCEPTED"))).toEqual({ ok: false, reason: "NOT_PENDING" });
  });
});

describe("invalidate", () => {
  it("invalidates an accepted request", () => {
    expect(invalidate(state("ACCEPTED"))).toEqual({ ok: true, state: { status: "INVALIDATED" } });
  });

  it("refuses to invalidate a pending request", () => {
    expect(invalidate(state("PENDING"))).toEqual({ ok: false, reason: "NOT_ACCEPTED" });
  });

  it("refuses to invalidate an already-rejected request", () => {
    expect(invalidate(state("REJECTED"))).toEqual({ ok: false, reason: "NOT_ACCEPTED" });
  });
});
