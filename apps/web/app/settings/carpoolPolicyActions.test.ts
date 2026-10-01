import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "fleet_manager" as string | null,
  user: { id: "u1" } as { id: string } | null,
  latest: { policy_version: 3 } as { policy_version: number } | null,
  insert: vi.fn(),
  inserted: null as Record<string, unknown> | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      if (table === "profiles") {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => q;
        q.single = async () => ({ data: h.role ? { organization_id: "org-1", role: h.role } : null });
        return q;
      }
      // carpool_policy_settings
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.order = () => q;
      q.limit = () => q;
      q.maybeSingle = async () => ({ data: h.latest, error: null });
      q.insert = (row: Record<string, unknown>) => {
        h.inserted = row;
        return h.insert(row);
      };
      return q;
    },
  }),
}));

import { publishCarpoolPolicy } from "./carpoolPolicyActions";

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const base: Record<string, string> = {
    carpoolEnabled: "on", carpoolFirstEnabled: "on", hostApprovalRequired: "on",
    departureWindowMinutes: "20", returnWindowMinutes: "15", maxAdditionalDistanceKm: "6",
    maxAdditionalTimeMinutes: "11", maxCandidatesForPreciseRouting: "5", requestExpiryMinutes: "30",
    minimumSeatAvailability: "1",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) f.set(k, v);
  // a hostile client may also send these; they must never be trusted
  f.set("organization_id", "other-org");
  f.set("policy_version", "999");
  return f;
}

beforeEach(() => {
  h.role = "fleet_manager";
  h.user = { id: "u1" };
  h.latest = { policy_version: 3 };
  h.inserted = null;
  h.insert.mockReset().mockResolvedValue({ error: null });
});

describe("publishCarpoolPolicy", () => {
  it("publishes an INSERT with version = latest + 1 for the caller's OWN organization (client ids ignored)", async () => {
    const r = await publishCarpoolPolicy({ status: "idle" }, form());
    expect(r).toEqual({ status: "success", version: 4 });
    expect(h.inserted).toMatchObject({
      organization_id: "org-1",
      policy_version: 4,
      departure_window_minutes: 20,
      max_additional_distance_km: 6,
      carpool_enabled: true,
      host_opt_in_required: false, // unchecked
    });
  });

  it("first ever version is 1", async () => {
    h.latest = null;
    expect(await publishCarpoolPolicy({ status: "idle" }, form())).toEqual({ status: "success", version: 1 });
  });

  it("employees are refused (no insert attempted)", async () => {
    h.role = "employee";
    expect(await publishCarpoolPolicy({ status: "idle" }, form())).toEqual({ status: "error", error: "not_authorized" });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("administrators are allowed", async () => {
    h.role = "administrator";
    expect((await publishCarpoolPolicy({ status: "idle" }, form())).status).toBe("success");
  });

  it("unauthenticated is refused", async () => {
    h.user = null;
    expect(await publishCarpoolPolicy({ status: "idle" }, form())).toEqual({ status: "error", error: "not_authorized" });
  });

  it("invalid values (negative / zero / NaN / out of range) are refused server-side before any insert", async () => {
    const bad: Record<string, string>[] = [{ maxAdditionalDistanceKm: "-1" }, { departureWindowMinutes: "0" }, { maxAdditionalTimeMinutes: "NaN" }, { maxCandidatesForPreciseRouting: "999" }];
    for (const over of bad) {
      const r = await publishCarpoolPolicy({ status: "idle" }, form(over));
      expect(r).toMatchObject({ status: "error", error: "invalid_values" });
    }
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("a concurrent publish (unique violation) is reported as a conflict, not swallowed", async () => {
    h.insert.mockResolvedValue({ error: { code: "23505", message: "dup" } });
    expect(await publishCarpoolPolicy({ status: "idle" }, form())).toEqual({ status: "error", error: "version_conflict" });
  });

  it("an RLS/DB failure is a generic save error", async () => {
    h.insert.mockResolvedValue({ error: { code: "42501", message: "rls" } });
    expect(await publishCarpoolPolicy({ status: "idle" }, form())).toEqual({ status: "error", error: "save_failed" });
  });
});
