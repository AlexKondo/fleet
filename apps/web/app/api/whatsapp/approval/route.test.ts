import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signBody } from "@/lib/approvals/whatsappApproval";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: (...a: unknown[]) => h.rpc(...a) }) }));

import { POST } from "./route";

const SECRET = "route-test-secret";
const TOKEN = "b".repeat(64);
const call = (body: unknown, opts: { secret?: string; ts?: string; sign?: boolean; raw?: string } = {}) => {
  const raw = opts.raw ?? JSON.stringify(body);
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json", "x-fleet-timestamp": ts };
  if (opts.sign !== false) headers["x-fleet-signature"] = signBody(raw, opts.secret ?? SECRET, ts);
  return POST(new NextRequest("http://localhost/api/whatsapp/approval", { method: "POST", headers, body: raw }));
};

beforeEach(() => {
  process.env.N8N_APPROVAL_SECRET = SECRET;
  h.rpc.mockReset().mockResolvedValue({ data: { status: "approved", reservation_id: "res-1" }, error: null });
});

describe("POST /api/whatsapp/approval", () => {
  it("fails closed (503) when the secret is not configured", async () => {
    delete process.env.N8N_APPROVAL_SECRET;
    expect((await call({ button_id: `approve:${TOKEN}`, from: "5511987654321" })).status).toBe(503);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("401 without a valid signature; the database is never reached", async () => {
    const body = { button_id: `approve:${TOKEN}`, from: "5511987654321" };
    expect((await call(body, { sign: false })).status).toBe(401);
    expect((await call(body, { secret: "wrong" })).status).toBe(401);
    expect((await call(body, { ts: String(Math.floor(Date.now() / 1000) - 3600) })).status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("a signed approve tap reaches the database function with the token, the decision, the sender and the message id", async () => {
    const res = await call({ button_id: `approve:${TOKEN}`, from: "5511987654321", message_id: "wamid.1" });
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("fm_approval_decide", { p_token: TOKEN, p_decision: "approve", p_from_phone: "5511987654321", p_message_id: "wamid.1" });
    const json = await res.json();
    expect(json).toMatchObject({ status: "approved", reservation_id: "res-1" });
    expect(json.reply_text).toContain("liberado");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("a reject tap, and every business outcome, comes back as 200 with a plain text for the manager", async () => {
    await call({ button_id: `reject:${TOKEN}`, from: "5511987654321" });
    expect(h.rpc).toHaveBeenCalledWith("fm_approval_decide", expect.objectContaining({ p_decision: "reject", p_message_id: null }));
    for (const status of ["expired", "already_decided", "phone_mismatch", "vehicle_unavailable"]) {
      h.rpc.mockResolvedValue({ data: { status, reservation_id: "res-1" }, error: null });
      const res = await call({ button_id: `approve:${TOKEN}`, from: "5511987654321" });
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe(status);
    }
  });
  it("a malformed button id or missing sender never reaches the database", async () => {
    for (const body of [{ button_id: "approve:short", from: "1" }, { button_id: `approve:${TOKEN}` }, { from: "1" }, { button_id: `drop:${TOKEN}`, from: "1" }]) {
      const res = await call(body);
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe("invalid");
    }
    expect(h.rpc).not.toHaveBeenCalled();
    expect((await call(null, { raw: "{not json" })).status).toBe(400);
  });
  it("a database failure answers 502 without leaking the reason", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "secret detail" } });
    const res = await call({ button_id: `approve:${TOKEN}`, from: "5511987654321" });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
