import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signBody } from "@/lib/approvals/whatsappApproval";

const h = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: vi.fn() }) }));
vi.mock("@/lib/whatsapp/chatBridge", () => ({ handleInboundWhatsApp: (...a: unknown[]) => h.handle(...a) }));
vi.mock("@/lib/whatsapp/transcribe", () => ({ transcribeAudio: vi.fn() }));
vi.mock("@/lib/auth/mintUserClient", () => ({ mintUserClient: vi.fn() }));
vi.mock("@/app/chat/queries", () => ({ loadLatestChatState: vi.fn() }));
vi.mock("@/app/chat/actions", () => ({ sendChatMessage: vi.fn() }));

import { POST } from "./route";

const SECRET = "chat-route-secret";
const call = (body: unknown, opts: { secret?: string; ts?: string; sign?: boolean; raw?: string } = {}) => {
  const raw = opts.raw ?? JSON.stringify(body);
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json", "x-fleet-timestamp": ts };
  if (opts.sign !== false) headers["x-fleet-signature"] = signBody(raw, opts.secret ?? SECRET, ts);
  return POST(new NextRequest("http://localhost/api/whatsapp/chat", { method: "POST", headers, body: raw }));
};

beforeEach(() => {
  process.env.N8N_APPROVAL_SECRET = SECRET;
  h.handle.mockReset().mockResolvedValue({ replies: [{ type: "text", text: "Olá" }] });
});

describe("POST /api/whatsapp/chat", () => {
  it("fails closed without the secret and without a valid signature; the assistant is never reached", async () => {
    delete process.env.N8N_APPROVAL_SECRET;
    expect((await call({ from: "5511", kind: "text" })).status).toBe(503);
    process.env.N8N_APPROVAL_SECRET = SECRET;
    const body = { from: "5511987654321", kind: "text", text: "fleet oi" };
    expect((await call(body, { sign: false })).status).toBe(401);
    expect((await call(body, { secret: "wrong" })).status).toBe(401);
    expect((await call(body, { ts: String(Math.floor(Date.now() / 1000) - 3600) })).status).toBe(401);
    expect(h.handle).not.toHaveBeenCalled();
  });
  it("a signed message is handed to the bridge with sanitized fields and its replies are returned", async () => {
    const res = await call({ from: "5511987654321", message_id: "wamid.1", kind: "text", text: "fleet quero um carro", extra: "ignored" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ replies: [{ type: "text", text: "Olá" }] });
    expect(h.handle.mock.calls[0]![0]).toEqual({ from: "5511987654321", messageId: "wamid.1", kind: "text", text: "fleet quero um carro", buttonId: undefined, audioBase64: undefined, mimeType: undefined });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("a voice note reaches the bridge as audio with its bytes and mime type", async () => {
    await call({ from: "5511987654321", message_id: "wamid.2", kind: "audio", audio_base64: "QUJD", mime_type: "audio/ogg; codecs=opus" });
    expect(h.handle.mock.calls[0]![0]).toMatchObject({ kind: "audio", audioBase64: "QUJD", mimeType: "audio/ogg; codecs=opus" });
  });
  it("an unknown kind or a missing sender is answered with no replies and never reaches the bridge", async () => {
    for (const body of [{ from: "5511", kind: "video" }, { kind: "text", text: "x" }, { from: "", kind: "text" }]) {
      const res = await call(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ replies: [] });
    }
    expect(h.handle).not.toHaveBeenCalled();
    expect((await call(null, { raw: "{broken" })).status).toBe(400);
  });
  it("a bridge failure answers 502 without leaking the reason", async () => {
    h.handle.mockRejectedValue(new Error("secret detail"));
    const res = await call({ from: "5511987654321", kind: "text", text: "fleet oi" });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
