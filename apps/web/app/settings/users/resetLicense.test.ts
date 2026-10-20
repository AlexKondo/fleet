import { beforeEach, describe, expect, it, vi } from "vitest";

const st = {
  actor: { id: "adm1" } as { id: string } | null,
  role: "administrator",
  target: { organization_id: "org1", drivers_license_expiration_source: "ai" } as { organization_id: string; drivers_license_expiration_source: string | null } | null,
  rpc: vi.fn(),
};
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => st.actor }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { organization_id: "org1", role: st.role } }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: st.target }) }) }) }),
    rpc: (...a: unknown[]) => st.rpc(...a),
  }),
}));
vi.mock("@/lib/i18n/getLocale", () => ({
  getDictionary: async () => ({
    errors: { users: { userInvalid: "INVALID", userNotFound: "NOTFOUND", licenseResetFailed: "RESET_FAILED", licenseResetSelf: "SELF", licenseResetReasonInvalid: "REASON" } },
  }),
}));
vi.mock("@/lib/email/renderEmail", () => ({ renderEmail: () => ({ html: "", text: "" }) }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/getAppUrl", () => ({ getAppUrl: () => "http://x" }));

import { resetMemberLicense } from "./actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const idle = { status: "idle" } as const;

beforeEach(() => {
  st.actor = { id: "adm1" };
  st.role = "administrator";
  st.target = { organization_id: "org1", drivers_license_expiration_source: "ai" };
  st.rpc = vi.fn(async () => ({ error: null }));
});

describe("resetMemberLicense (administrator-only, audited)", () => {
  it("refuses a SELF reset (translated error), nothing called", async () => {
    expect(await resetMemberLicense(idle, form({ userId: "adm1", reason: "motivo valido" }))).toEqual({ status: "error", error: "SELF" });
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it.each([["", "empty"], ["abcd", "4 chars"], ["   ab   ", "spaces trimmed"], ["x".repeat(201), "201 chars"]])("refuses a bad reason (%s: %s)", async (reason) => {
    expect(await resetMemberLicense(idle, form({ userId: "u2", reason }))).toEqual({ status: "error", error: "REASON" });
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("a fleet_manager (not administrator) cannot reset", async () => {
    st.role = "fleet_manager";
    expect(await resetMemberLicense(idle, form({ userId: "u2", reason: "motivo valido" }))).toEqual({ status: "error", error: "not_authorized" });
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("another organization's member is not found", async () => {
    st.target = { organization_id: "other", drivers_license_expiration_source: "ai" };
    expect((await resetMemberLicense(idle, form({ userId: "u2", reason: "motivo valido" }))).status).toBe("error");
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("a row that is not AI-locked is not reset through this action", async () => {
    st.target = { organization_id: "org1", drivers_license_expiration_source: "manual" };
    expect(await resetMemberLicense(idle, form({ userId: "u2", reason: "motivo valido" }))).toEqual({ status: "error", error: "RESET_FAILED" });
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("valid reset: calls reset_ai_license and writes an audit entry with the reason and NO CNH values", async () => {
    const r = await resetMemberLicense(idle, form({ userId: "u2", reason: "  foto   errada enviada  " }));
    expect(r).toEqual({ status: "success" });
    expect(st.rpc).toHaveBeenCalledWith("reset_ai_license", { p_user_id: "u2" });
    const audit = st.rpc.mock.calls.find((c) => c[0] === "log_audit_event")![1] as { p_actor_id: string; p_entity_id: string; p_action: string; p_after: Record<string, unknown> };
    expect(audit).toMatchObject({ p_actor_id: "adm1", p_entity_id: "u2", p_action: "driver_license_reset" });
    expect(audit.p_after).toEqual({ reset: true, driver_authorized: false, reason: "foto errada enviada" });
  });
});
