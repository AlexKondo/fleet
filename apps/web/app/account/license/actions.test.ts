import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const st = { user: { id: "u1" } as { id: string } | null, rpc: vi.fn(), update: vi.fn(), audit: { data: [] as unknown[] | null, error: null as unknown } };
const auditChain: Record<string, unknown> = {};
for (const m of ["select", "eq", "order"]) auditChain[m] = () => auditChain;
auditChain.limit = async () => st.audit;
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: (...a: unknown[]) => st.rpc(...a),
    from: (table: string) => (table === "audit_log" ? auditChain : { update: (...a: unknown[]) => (st.update(...a), { eq: async () => ({ error: null }) }) }),
  }),
}));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => st.user }));
vi.mock("@/lib/i18n/getLocale", () => ({
  getDictionary: async () => ({ errors: { common: { not_authenticated: "NA" } }, account: { license: { saveFailed: "SAVE_FAILED", analysisFailed: "AF", noPhoto: "NP", notAnImage: "NI", photoTooLarge: "PT" } } }),
}));
vi.mock("@/lib/domain/analyzeDriversLicense", () => ({ analyzeDriversLicense: vi.fn() }));

import { signLicenseToken } from "@/lib/auth/licenseToken";
import { submitLicensePhoto } from "./actions";

const read = { fullName: "FULANO", number: "999", category: "B", expirationDate: "2031-05-20", lastReset: "" };
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests-0123456789";
  st.user = { id: "u1" };
  st.rpc = vi.fn(async () => ({ error: null }));
  st.update = vi.fn();
  st.audit = { data: [], error: null };
});

describe("CNH confirm phase (signed AI result)", () => {
  it("valid token: persists ONLY through apply_ai_license_read with the signed values (client fields ignored), no direct profiles update", async () => {
    const token = signLicenseToken({ uid: "u1", ...read })!;
    const res = await submitLicensePhoto({ status: "idle" }, form({ phase: "confirm", token, fullName: "HACKER", number: "000", category: "E", expirationDate: "2099-01-01" }));
    expect(res.status).toBe("success");
    expect(st.rpc).toHaveBeenCalledWith("apply_ai_license_read", {
      p_user_id: "u1",
      p_full_name: "FULANO",
      p_number: "999",
      p_category: "B",
      p_expiration: "2031-05-20",
      p_authorized: true,
    });
    expect(st.update).not.toHaveBeenCalled();
  });
  it("an expired CNH is saved but not authorized (existing isStillValid logic)", async () => {
    const token = signLicenseToken({ uid: "u1", ...read, expirationDate: "2020-01-01" })!;
    const res = await submitLicensePhoto({ status: "idle" }, form({ phase: "confirm", token }));
    expect(res.status).toBe("success_expired");
    expect(st.rpc.mock.calls[0]![1]).toMatchObject({ p_authorized: false });
  });
  it.each([
    ["no token (the old hidden-input style)", { fullName: "A", number: "1", category: "B", expirationDate: "2031-01-01" }],
    ["garbage token", { token: "abc.def" }],
    ["tampered payload", { token: "" }],
  ])("%s -> generic save-failed error, nothing written", async (_n, extra) => {
    let fields: Record<string, string> = { phase: "confirm", ...extra };
    if (_n === "tampered payload") {
      const t = signLicenseToken({ uid: "u1", ...read })!;
      const [b, s] = t.split(".") as [string, string];
      const p = JSON.parse(Buffer.from(b, "base64url").toString());
      p.expirationDate = "2099-12-31";
      fields = { phase: "confirm", token: `${Buffer.from(JSON.stringify(p)).toString("base64url")}.${s}` };
    }
    const res = await submitLicensePhoto({ status: "idle" }, form(fields));
    expect(res).toEqual({ status: "error", error: "SAVE_FAILED" });
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("a token issued BEFORE an administrator reset of this member is refused (a newer reset exists)", async () => {
    const token = signLicenseToken({ uid: "u1", ...read })!; // issued when there was no reset (lastReset "")
    st.audit = { data: [{ created_at: "2026-10-13 17:12:42.031452+00" }], error: null };
    expect(await submitLicensePhoto({ status: "idle" }, form({ phase: "confirm", token }))).toEqual({ status: "error", error: "SAVE_FAILED" });
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("a token issued AFTER the latest reset (it carries that reset's created_at) is accepted", async () => {
    const stamp = "2026-10-13 17:12:42.031452+00";
    const token = signLicenseToken({ uid: "u1", ...read, lastReset: stamp })!;
    st.audit = { data: [{ created_at: stamp }], error: null };
    expect((await submitLicensePhoto({ status: "idle" }, form({ phase: "confirm", token }))).status).toBe("success");
  });
  it("a token issued before an OLD reset is refused once a NEWER reset happens", async () => {
    const token = signLicenseToken({ uid: "u1", ...read, lastReset: "2026-10-01 10:00:00+00" })!;
    st.audit = { data: [{ created_at: "2026-10-13 17:12:42+00" }], error: null };
    expect(await submitLicensePhoto({ status: "idle" }, form({ phase: "confirm", token }))).toEqual({ status: "error", error: "SAVE_FAILED" });
  });
  it("the audit query is scoped to this user and to driver_license_reset entries", async () => {
    const token = signLicenseToken({ uid: "u1", ...read })!;
    const calls: unknown[][] = [];
    auditChain.eq = (...a: unknown[]) => (calls.push(["eq", ...a]), auditChain);
    await submitLicensePhoto({ status: "idle" }, form({ phase: "confirm", token }));
    auditChain.eq = () => auditChain;
    expect(calls).toContainEqual(["eq", "entity_id", "u1"]);
    expect(calls).toContainEqual(["eq", "action", "driver_license_reset"]);
  });
  it("an unreadable audit log fails CLOSED (nothing written)", async () => {
    const token = signLicenseToken({ uid: "u1", ...read })!;
    st.audit = { data: null, error: { message: "down" } };
    expect(await submitLicensePhoto({ status: "idle" }, form({ phase: "confirm", token }))).toEqual({ status: "error", error: "SAVE_FAILED" });
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("another user's token is refused", async () => {
    const token = signLicenseToken({ uid: "someone-else", ...read })!;
    expect(await submitLicensePhoto({ status: "idle" }, form({ phase: "confirm", token }))).toEqual({ status: "error", error: "SAVE_FAILED" });
    expect(st.rpc).not.toHaveBeenCalled();
  });
  it("an RPC failure (e.g. DB error) -> the same generic error", async () => {
    st.rpc = vi.fn(async () => ({ error: { message: "boom" } }));
    const token = signLicenseToken({ uid: "u1", ...read })!;
    expect(await submitLicensePhoto({ status: "idle" }, form({ phase: "confirm", token }))).toEqual({ status: "error", error: "SAVE_FAILED" });
  });
});
