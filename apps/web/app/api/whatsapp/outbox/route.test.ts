import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: (...a: unknown[]) => m.rpc(...a) }) }));
vi.mock("@/lib/whatsapp/sendNotice", () => ({ sendWhatsAppNotice: (...a: unknown[]) => m.send(...a) }));

import { POST } from "./route";
import { NextRequest } from "next/server";

const req = (token: string | null = "s3cret") =>
  new NextRequest("https://x.invalid/api/whatsapp/outbox", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("POST /api/whatsapp/outbox", () => {
  beforeEach(() => {
    m.rpc.mockReset();
    m.send.mockReset();
    process.env.WHATSAPP_ALERT_SECRET = "s3cret";
  });

  it("refuses without the secret or with a wrong one, and never touches the database", async () => {
    expect((await POST(req(null))).status).toBe(401);
    expect((await POST(req("wrong"))).status).toBe(401);
    delete process.env.WHATSAPP_ALERT_SECRET;
    expect((await POST(req())).status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("moves the expired takeovers on, sends what is queued and marks each result", async () => {
    const rows = [
      { id: "a", phone_e164: "+5511900000001", text: "oi", title: "Assumir a reserva", buttons: [{ id: "tk:yes:x", title: "Aceitar" }] },
      { id: "b", phone_e164: "+5511900000002", text: "tchau", title: null, buttons: null },
    ];
    m.rpc.mockImplementation(async (name: string) => {
      if (name === "fm_takeover_expire_due") return { data: 2, error: null };
      if (name === "fm_wa_outbox_claim") return { data: rows, error: null };
      return { data: null, error: null };
    });
    m.send.mockResolvedValueOnce({ status: "sent" }).mockResolvedValueOnce({ status: "failed", error: "http_502" });
    const body = await (await POST(req())).json();
    expect(body).toEqual({ expired: 2, claimed: 2, sent: 1, failed: 1 });
    expect(m.send).toHaveBeenNthCalledWith(1, { to: "+5511900000001", text: "oi", title: "Assumir a reserva", buttons: [{ id: "tk:yes:x", title: "Aceitar" }] });
    const marks = m.rpc.mock.calls.filter((c) => c[0] === "fm_wa_outbox_mark").map((c) => c[1]);
    expect(marks).toEqual([{ p_id: "a", p_ok: true, p_error: null }, { p_id: "b", p_ok: false, p_error: "http_502" }]);
  });
  it("an empty outbox is fine", async () => {
    m.rpc.mockResolvedValue({ data: [], error: null });
    expect(await (await POST(req())).json()).toEqual({ expired: 0, claimed: 0, sent: 0, failed: 0 });
  });
});
