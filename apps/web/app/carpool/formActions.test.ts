import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  redirects: [] as string[],
  accept: vi.fn(),
  reject: vi.fn(),
  cancel: vi.fn(),
  enable: vi.fn(),
  update: vi.fn(),
  disable: vi.fn(),
}));

class RedirectSignal extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirects.push(url);
    throw new RedirectSignal(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => null }));
vi.mock("./requestActions", () => ({
  acceptCarpoolRequest: (...a: unknown[]) => h.accept(...a),
  rejectCarpoolRequest: (...a: unknown[]) => h.reject(...a),
  cancelCarpoolRequest: (...a: unknown[]) => h.cancel(...a),
  enableCarpoolOffer: (...a: unknown[]) => h.enable(...a),
  updateCarpoolOffer: (...a: unknown[]) => h.update(...a),
  disableCarpoolOffer: (...a: unknown[]) => h.disable(...a),
}));

import {
  getMyCarpoolRequestStatus,
  hostAcceptRequest,
  hostDisableOffer,
  hostEnableOffer,
  hostRejectRequest,
  hostUpdateOffer,
  riderCancelRequest,
} from "./formActions";

const RES = "0ce8b495-d58d-47ff-8387-5ea8d71d7036";
const REQ = "11111111-d58d-47ff-8387-5ea8d71d7036";

async function run(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof RedirectSignal)) throw e;
  }
  return h.redirects[h.redirects.length - 1];
}

beforeEach(() => {
  h.redirects.length = 0;
  for (const m of [h.accept, h.reject, h.cancel, h.enable, h.update, h.disable]) m.mockReset().mockResolvedValue({ status: "success" });
});

describe("form-bound carpool wrappers", () => {
  it("host accept: success returns to the reservation page", async () => {
    expect(await run(() => hostAcceptRequest(RES, REQ))).toBe(`/reservations/${RES}`);
    expect(h.accept).toHaveBeenCalledWith(REQ, RES);
  });

  it("an RPC failure becomes a stable error code in the redirect (no raw text)", async () => {
    h.accept.mockResolvedValue({ status: "error", error: "CARPOOL_NO_SEATS_AVAILABLE" });
    expect(await run(() => hostAcceptRequest(RES, REQ))).toBe(`/reservations/${RES}?carpoolActionError=CARPOOL_NO_SEATS_AVAILABLE`);
  });

  it("a forged reservation id never reaches an RPC or a redirect path", async () => {
    expect(await run(() => hostAcceptRequest("../../admin", REQ))).toBe("/trips");
    expect(h.accept).not.toHaveBeenCalled();
  });

  it("reject forwards the optional reason; blank => undefined", async () => {
    const f = new FormData();
    f.set("reason", "  sem espaço ");
    await run(() => hostRejectRequest(RES, REQ, f));
    expect(h.reject).toHaveBeenCalledWith(REQ, "sem espaço", RES);
    const blank = new FormData();
    blank.set("reason", "   ");
    await run(() => hostRejectRequest(RES, REQ, blank));
    expect(h.reject).toHaveBeenLastCalledWith(REQ, undefined, RES);
  });

  it("enable / update pass the typed seat count; non-integers become NaN (the action refuses them)", async () => {
    const f = new FormData();
    f.set("seats", "2");
    await run(() => hostEnableOffer(RES, "trip", f));
    expect(h.enable).toHaveBeenCalledWith("trip", 2, RES);
    const bad = new FormData();
    bad.set("seats", "1.5");
    await run(() => hostUpdateOffer(RES, "offer", bad));
    expect(Number.isNaN(h.update.mock.calls[0]![1])).toBe(true);
  });

  it("disable offer", async () => {
    await run(() => hostDisableOffer(RES, "offer"));
    expect(h.disable).toHaveBeenCalledWith("offer", RES);
  });

  it("rider cancel returns to /trips, with an error code on failure", async () => {
    expect(await run(() => riderCancelRequest(REQ))).toBe("/trips");
    h.cancel.mockResolvedValue({ status: "error", error: "CARPOOL_NOT_AUTHORIZED" });
    expect(await run(() => riderCancelRequest(REQ))).toBe("/trips?carpoolActionError=CARPOOL_NOT_AUTHORIZED");
  });

  it("getMyCarpoolRequestStatus: unauthenticated or malformed id => null (no DB read)", async () => {
    expect(await getMyCarpoolRequestStatus("nope")).toBeNull();
    expect(await getMyCarpoolRequestStatus(REQ)).toBeNull();
  });
});
