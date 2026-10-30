import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "../../test/fakeSupabase";
import { findOwnOverlappingReservations, windowsOverlap } from "./ownOverlap";

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/email/recipients", () => ({ getFleetManagerEmails: async () => [] }));
vi.mock("@/lib/email/renderEmail", () => ({ renderEmail: () => ({ html: "", text: "" }) }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/getAppUrl", () => ({ getAppUrl: () => "http://localhost" }));

import { cleanCancelReason } from "./notifyManagersCancellation";

const T = (h: number) => `2026-11-02T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("windowsOverlap", () => {
  it("detects a partial overlap, containment and identical windows", () => {
    expect(windowsOverlap(T(8), T(12), T(10), T(14))).toBe(true);
    expect(windowsOverlap(T(8), T(18), T(10), T(12))).toBe(true);
    expect(windowsOverlap(T(8), T(12), T(8), T(12))).toBe(true);
  });
  it("lets back-to-back trips and separate days through", () => {
    expect(windowsOverlap(T(8), T(12), T(12), T(14))).toBe(false);
    expect(windowsOverlap(T(14), T(16), T(8), T(12))).toBe(false);
  });
});

describe("findOwnOverlappingReservations", () => {
  const row = (id: string, start: number, end: number, status = "confirmed") => ({
    id,
    status,
    start_at: T(start),
    end_at: T(end),
    vehicle: { plate: "ABC1D23", name: "Carro 1" },
    trip_request: { requester_id: "u1", origin: "Fábrica", destination: "Campinas" },
  });

  it("returns only the reservations that really overlap, earliest first, with the vehicle", async () => {
    const db = fakeSupabase({ reservations: [row("late", 13, 15), row("hit", 9, 11), row("before", 1, 8)] });
    const out = await findOwnOverlappingReservations(db as never, "u1", T(8), T(14));
    expect(out.map((o) => o.reservationId)).toEqual(["hit", "late"]);
    expect(out[0]).toMatchObject({ vehiclePlate: "ABC1D23", vehicleName: "Carro 1", destination: "Campinas", status: "confirmed" });
  });

  it("can ignore the reservation being edited", async () => {
    const db = fakeSupabase({ reservations: [row("self", 9, 11)] });
    expect(await findOwnOverlappingReservations(db as never, "u1", T(8), T(14), "self")).toEqual([]);
  });
});

describe("cleanCancelReason", () => {
  it("trims, collapses whitespace and clamps", () => {
    expect(cleanCancelReason("  mudou   o plano \n")).toBe("mudou o plano");
    expect(cleanCancelReason("x".repeat(500))?.length).toBe(300);
  });
  it("refuses an empty or too short reason", () => {
    expect(cleanCancelReason("")).toBeNull();
    expect(cleanCancelReason("  a ")).toBeNull();
    expect(cleanCancelReason(undefined)).toBeNull();
    expect(cleanCancelReason(42)).toBeNull();
  });
});
