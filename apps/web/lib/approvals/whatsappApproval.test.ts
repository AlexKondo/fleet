import { describe, expect, it, vi } from "vitest";
import {
  buildApprovalMessage, cleanUserText, formatWhen, parseButtonId, replyForStatus, signBody, verifySignature, type ApprovalPayload,
} from "./whatsappApproval";
import { approvalChannelConfigured, dispatchApprovalRequest } from "./dispatchApproval";

const TOKEN = "a".repeat(64);
const payload: ApprovalPayload = {
  requester_name: "Maria Solicitante", vehicle_name: "Haval H6", plate: "ABC1D23",
  departure_at: "2026-10-29T11:00:00Z", return_at: "2026-10-29T21:00:00Z",
  origin: "Fábrica GWM", destination: "Cliente Campinas", purpose: "Visita ao cliente", passengers: 2,
};

describe("approval message", () => {
  it("shows what the manager needs: requester, vehicle, departure, return, origin, destination, purpose, passengers (Brasília time)", () => {
    const m = buildApprovalMessage(payload, TOKEN, "2026-10-29T11:00:00Z");
    expect(m.body).toContain("*Pedido de uso de veículo*");
    expect(m.body).toContain("Solicitante: Maria Solicitante");
    expect(m.body).toContain("Veículo: Haval H6 (ABC1D23)");
    expect(m.body).toContain("Saída: qui, 29/10/2026 às 08:00");
    expect(m.body).toContain("Retorno: qui, 29/10/2026 às 18:00");
    expect(m.body).toContain("Origem: Fábrica GWM");
    expect(m.body).toContain("Destino: Cliente Campinas");
    expect(m.body).toContain("Objetivo: Visita ao cliente");
    expect(m.body).toContain("Passageiros: 2");
    expect(m.body).toContain("vale até qui, 29/10/2026 às 08:00");
    expect(m.body.length).toBeLessThan(1024);
  });
  it("two buttons whose ids carry the single-use token", () => {
    const m = buildApprovalMessage(payload, TOKEN, "2026-10-29T11:00:00Z");
    expect(m.buttons).toEqual([{ id: `approve:${TOKEN}`, title: "Aprovar" }, { id: `reject:${TOKEN}`, title: "Recusar" }]);
    expect(m.buttons.every((b) => b.title.length <= 20)).toBe(true);
    expect(m.body).not.toContain(TOKEN);
  });
  it("text typed by the requester cannot add formatting, new lines or exceed the limit", () => {
    expect(cleanUserText("*Aprovar* tudo\n\n_já_ ~agora~ `x`")).toBe("Aprovar tudo já agora x");
    expect(cleanUserText("x".repeat(500), 50)).toHaveLength(50);
    const m = buildApprovalMessage({ ...payload, purpose: "linha1\nSaída: falsa\n".repeat(60), origin: "o".repeat(900) }, TOKEN, "2026-10-29T11:00:00Z");
    expect(m.body.split("\n").filter((l) => l.startsWith("Saída:"))).toHaveLength(1);
    expect(m.body.length).toBeLessThan(1024);
  });
  it("shows the plate once when the vehicle name already contains it", () => {
    const m = buildApprovalMessage({ ...payload, vehicle_name: "T2 criado ABC1D23" }, TOKEN, "2026-10-29T11:00:00Z");
    expect(m.body).toContain("Veículo: T2 criado ABC1D23\nSaída:");
  });
  it("an invalid date never breaks the message", () => {
    expect(formatWhen("não é data")).toBe("—");
  });
});

describe("button ids and answer texts", () => {
  it("parses approve/reject ids and refuses anything else", () => {
    expect(parseButtonId(`approve:${TOKEN}`)).toEqual({ decision: "approve", token: TOKEN });
    expect(parseButtonId(`reject:${TOKEN}`)).toEqual({ decision: "reject", token: TOKEN });
    for (const bad of ["approve:", "approve:short", `delete:${TOKEN}`, `approve:${TOKEN}; drop`, "", null, undefined, 42]) expect(parseButtonId(bad)).toBeNull();
  });
  it("every status has a plain answer and none leaks an internal reason", () => {
    for (const s of ["approved", "rejected", "already_decided", "superseded", "expired", "vehicle_unavailable", "phone_mismatch", "not_authorized", "invalid", "anything"]) {
      expect(replyForStatus(s).length).toBeGreaterThan(10);
    }
    expect(replyForStatus("phone_mismatch")).toBe(replyForStatus("not_authorized"));
    expect(replyForStatus("approved")).toContain("liberado");
  });
});

describe("HMAC signature shared with n8n", () => {
  const secret = "s3cret-for-tests";
  const body = JSON.stringify({ button_id: `approve:${TOKEN}`, from: "5511987654321" });
  const ts = "1790000000";
  const sig = signBody(body, secret, ts);
  it("accepts a correct signature inside the time window", () => {
    expect(verifySignature({ rawBody: body, secret, timestamp: ts, signature: sig, nowSeconds: 1790000100 })).toBe(true);
  });
  it("refuses a changed body, a wrong secret, a missing header and a stale or future timestamp", () => {
    expect(verifySignature({ rawBody: body + " ", secret, timestamp: ts, signature: sig, nowSeconds: 1790000100 })).toBe(false);
    expect(verifySignature({ rawBody: body, secret: "other", timestamp: ts, signature: sig, nowSeconds: 1790000100 })).toBe(false);
    expect(verifySignature({ rawBody: body, secret, timestamp: null, signature: sig, nowSeconds: 1790000100 })).toBe(false);
    expect(verifySignature({ rawBody: body, secret, timestamp: ts, signature: null, nowSeconds: 1790000100 })).toBe(false);
    expect(verifySignature({ rawBody: body, secret, timestamp: ts, signature: sig, nowSeconds: 1790000100 + 301 })).toBe(false);
    expect(verifySignature({ rawBody: body, secret, timestamp: ts, signature: sig, nowSeconds: 1790000000 - 301 })).toBe(false);
    expect(verifySignature({ rawBody: body, secret: "", timestamp: ts, signature: sig, nowSeconds: 1790000100 })).toBe(false);
    expect(verifySignature({ rawBody: body, secret, timestamp: "abc", signature: sig, nowSeconds: 1790000100 })).toBe(false);
  });
});

describe("dispatching the request to n8n", () => {
  const env = { url: "https://n8n.example.invalid/webhook/x", secret: "shh" };
  const prepared = { ok: true, request_id: "req-1", token: TOKEN, phone_e164: "+5511987654321", expires_at: "2026-10-29T11:00:00Z", payload };
  const mk = (prep: unknown, fetchImpl?: typeof fetch) => {
    const rpc = vi.fn(async (name: string) => (name === "fm_approval_prepare" ? { data: prep, error: null } : { data: null, error: null }));
    return { rpc, deps: { rpc, env, fetch: fetchImpl, now: () => 1790000000_000 } };
  };
  it("does nothing while the channel is not configured", async () => {
    const { rpc } = mk(prepared);
    expect(await dispatchApprovalRequest("res-1", { rpc, env: { url: "", secret: "" } })).toEqual({ status: "disabled" });
    expect(rpc).not.toHaveBeenCalled();
    expect(approvalChannelConfigured({ url: "u", secret: "" })).toBe(false);
    expect(approvalChannelConfigured({ url: "u", secret: "s" })).toBe(true);
  });
  it("sends a signed JSON with the message, the buttons and the destination number, then records the delivery", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    const { rpc, deps } = mk(prepared, fetchMock as unknown as typeof fetch);
    const r = await dispatchApprovalRequest("res-1", deps);
    expect(r).toEqual({ status: "sent", requestId: "req-1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(env.url);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-fleet-timestamp"]).toBe("1790000000");
    expect(verifySignature({ rawBody: String(init.body), secret: env.secret, timestamp: headers["x-fleet-timestamp"]!, signature: headers["x-fleet-signature"]!, nowSeconds: 1790000000 })).toBe(true);
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ type: "approval_request", request_id: "req-1", reservation_id: "res-1", to: "+5511987654321" });
    expect(sent.message.buttons).toHaveLength(2);
    expect(rpc).toHaveBeenCalledWith("fm_approval_mark_delivery", { p_request_id: "req-1", p_ok: true, p_error: null });
  });
  it("a failing n8n is recorded and never throws", async () => {
    const { rpc, deps } = mk(prepared, (async () => new Response("no", { status: 500 })) as unknown as typeof fetch);
    expect(await dispatchApprovalRequest("res-1", deps)).toEqual({ status: "failed", requestId: "req-1", error: "http_500" });
    expect(rpc).toHaveBeenCalledWith("fm_approval_mark_delivery", { p_request_id: "req-1", p_ok: false, p_error: "http_500" });
    const boom = mk(prepared, (async () => { throw new Error("down"); }) as unknown as typeof fetch);
    expect((await dispatchApprovalRequest("res-1", boom.deps)).status).toBe("failed");
  });
  it("skips quietly when there is no manager / number, or the database refuses", async () => {
    for (const reason of ["no_manager", "no_contact", "not_pending", "already_pending"]) {
      const { deps } = mk({ ok: false, reason });
      expect(await dispatchApprovalRequest("res-1", deps)).toEqual({ status: "skipped", reason });
    }
    const err = { rpc: async () => ({ data: null, error: { message: "boom" } }), env };
    expect(await dispatchApprovalRequest("res-1", err)).toEqual({ status: "skipped", reason: "prepare_error" });
  });
});
