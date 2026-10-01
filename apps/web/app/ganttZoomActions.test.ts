import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
const eq = vi.fn();
let currentUser: { id: string } | null = { id: "user-1" };

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => currentUser }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        update(table, patch);
        return { eq: (col: string, value: unknown) => { eq(col, value); return Promise.resolve({ error: null }); } };
      },
    }),
  }),
}));

import { setGanttZoomPreference } from "./ganttZoomActions";

describe("setGanttZoomPreference (L1)", () => {
  beforeEach(() => { update.mockClear(); eq.mockClear(); currentUser = { id: "user-1" }; });

  it("persists a valid zoom for the authenticated caller's OWN id through the admin client", async () => {
    await setGanttZoomPreference("quarter");
    expect(update).toHaveBeenCalledWith("profiles", { gantt_zoom_preference: "quarter" });
    expect(eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("rejects values outside the allowed set (no write at all)", async () => {
    for (const bad of ["day", "", "week'; drop table profiles;--", null, 7, { a: 1 }] as unknown[]) {
      await setGanttZoomPreference(bad as never);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing without a session", async () => {
    currentUser = null;
    await setGanttZoomPreference("week");
    expect(update).not.toHaveBeenCalled();
  });

  it("the function has no user-id parameter: a user cannot target someone else's row", async () => {
    expect(setGanttZoomPreference.length).toBe(1);
    await setGanttZoomPreference("month");
    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq.mock.calls[0]).toEqual(["id", "user-1"]);
  });
});
