import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), user: { id: "admin-1" } as { id: string } | null, revalidate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: (...a: unknown[]) => h.rpc(...a) }) }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => h.user }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));

import { saveApprovalChannel } from "./actions";

const USER = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const idle = { status: "idle" as const };

beforeEach(() => {
  h.user = { id: "admin-1" };
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  h.revalidate.mockReset();
});

describe("saveApprovalChannel", () => {
  it("writes the manager and the number (with consent) and refreshes the page", async () => {
    const r = await saveApprovalChannel(idle, form({ userId: USER, managerId: MANAGER, phone: "(11) 98765-4321", consent: "on", hadManager: "", hadPhone: "0" }));
    expect(r).toEqual({ status: "success" });
    expect(h.rpc).toHaveBeenCalledWith("fm_set_user_manager", { p_user_id: USER, p_manager_id: MANAGER });
    expect(h.rpc).toHaveBeenCalledWith("fm_set_whatsapp_contact", { p_user_id: USER, p_phone: "(11) 98765-4321", p_consent: true });
    expect(h.revalidate).toHaveBeenCalledWith("/settings/approvals");
  });
  it("writes only what changed (every write is audited)", async () => {
    await saveApprovalChannel(idle, form({ userId: USER, managerId: MANAGER, phone: "", hadManager: MANAGER, hadPhone: "0" }));
    expect(h.rpc).not.toHaveBeenCalled();
    await saveApprovalChannel(idle, form({ userId: USER, managerId: "", phone: "", hadManager: MANAGER, hadPhone: "1" }));
    expect(h.rpc).toHaveBeenCalledWith("fm_set_user_manager", { p_user_id: USER, p_manager_id: null });
    expect(h.rpc).toHaveBeenCalledWith("fm_set_whatsapp_contact", { p_user_id: USER, p_phone: null, p_consent: false });
  });
  it("turns a database refusal into a translated key, never the raw text", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "CONSENT_REQUIRED" } });
    expect(await saveApprovalChannel(idle, form({ userId: USER, managerId: "", phone: "11987654321", hadManager: "", hadPhone: "0" }))).toEqual({ status: "error", errorKey: "errConsent" });
    h.rpc.mockResolvedValue({ data: null, error: { message: "NOT_AUTHORIZED" } });
    expect((await saveApprovalChannel(idle, form({ userId: USER, managerId: MANAGER, phone: "", hadManager: "", hadPhone: "0" }))).errorKey).toBe("errNotAuthorized");
    h.rpc.mockResolvedValue({ data: null, error: { message: "INVALID_PHONE" } });
    expect((await saveApprovalChannel(idle, form({ userId: USER, managerId: "", phone: "12", consent: "on", hadManager: "", hadPhone: "0" }))).errorKey).toBe("errInvalidPhone");
  });
  it("refuses a visitor without session and malformed ids before touching the database", async () => {
    h.user = null;
    expect((await saveApprovalChannel(idle, form({ userId: USER }))).errorKey).toBe("errNotAuthorized");
    h.user = { id: "admin-1" };
    expect((await saveApprovalChannel(idle, form({ userId: "not-a-uuid", managerId: "" }))).errorKey).toBe("errNotFound");
    expect((await saveApprovalChannel(idle, form({ userId: USER, managerId: "x'; drop" }))).errorKey).toBe("errNotFound");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
