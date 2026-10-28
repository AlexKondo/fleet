import { describe, expect, it, vi } from "vitest";
import {
  buildApprovalMessage, cleanUserText, formatWhen, parseButtonId, replyForStatus, signBody, verifySignature, type ApprovalPayload,
} from "./whatsappApproval";
import { approvalChannelConfigured, dispatchApprovalRequest, emailConfigured, whatsappConfigured } from "./dispatchApproval";
import { approvalPageUrl, buildApprovalEmail, escapeHtml } from "./approvalEmail";

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

describe("approval e-mail", () => {
  const BASE = "https://fleet.example.invalid/";
  it("carries every detail the manager needs and a link to the CONFIRMATION page (never a decision link)", () => {
    const m = buildApprovalEmail(payload, TOKEN, "2026-10-29T11:00:00Z", BASE);
    const body = m.bodyLines.join("\n");
    expect(m.subject).toBe("Aprovação de reserva: Maria Solicitante para Cliente Campinas");
    for (const part of ["Maria Solicitante", "Haval H6 (ABC1D23)", "qui, 29/10/2026 às 08:00", "qui, 29/10/2026 às 18:00", "Fábrica GWM", "Cliente Campinas", "Visita ao cliente", "Passageiros:</strong> 2"]) {
      expect(body).toContain(part);
    }
    expect(m.ctaUrl).toBe(`https://fleet.example.invalid/aprovar/${TOKEN}`);
    expect(m.ctaUrl).not.toMatch(/approve|reject|decision/i);
    expect(body).not.toContain(TOKEN);
  });
  it("escapes everything the requester typed", () => {
    const m = buildApprovalEmail({ ...payload, requester_name: "<b>Eu</b>", purpose: "<script>alert(1)</script> & mais", destination: "\"><img src=x>" }, TOKEN, "2026-10-29T11:00:00Z", BASE);
    const html = m.bodyLines.join("\n");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.bodyLines.join("\n")).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; mais");
    expect(escapeHtml(`a&b<c>"d'e`)).toBe("a&amp;b&lt;c&gt;&quot;d&#39;e");
    expect(approvalPageUrl("https://x.y///", "t")).toBe("https://x.y/aprovar/t");
  });
});

describe("dispatching the approval request", () => {
  const env = { n8nUrl: "https://n8n.example.invalid/webhook/x", n8nSecret: "shh", emailFrom: "no-reply@example.invalid" };
  const expires = "2026-10-29T11:00:00Z";
  const wa = { channel: "whatsapp", request_id: "req-wa", token: TOKEN, phone_e164: "+5511987654321", email: null, expires_at: expires };
  const mail = { channel: "email", request_id: "req-mail", token: "c".repeat(64), phone_e164: null, email: "gestor@example.invalid", expires_at: expires };
  const ok = (requests: unknown[]) => ({ ok: true, payload, requests });
  const mk = (prep: unknown, over: { fetch?: typeof fetch; env?: typeof env | Record<string, string>; sendOk?: boolean } = {}) => {
    const rpc = vi.fn(async (name: string) => (name === "fm_approval_prepare" ? { data: prep, error: null } : { data: null, error: null }));
    const sendEmail = vi.fn(async () => (over.sendOk === false ? { success: false, error: "smtp_down" } : { success: true }));
    const renderEmail = vi.fn((p: { heading: string; bodyLines: string[]; ctaLabel?: string; ctaUrl?: string }) => ({ html: `<h1>${p.heading}</h1>${p.ctaUrl}`, text: p.ctaUrl ?? "" }));
    return { rpc, sendEmail, renderEmail, deps: { rpc, env: over.env ?? env, fetch: over.fetch, sendEmail, renderEmail, appUrl: "https://fleet.example.invalid", now: () => 1790000000_000 } };
  };
  it("does nothing while no channel is configured", async () => {
    const { rpc, deps } = mk(ok([wa]), { env: {} });
    expect(await dispatchApprovalRequest("res-1", deps)).toEqual({ status: "disabled" });
    // only the manager's bell notification is created; no request is prepared and nothing is sent
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("fm_approval_notify_manager", { p_reservation_id: "res-1" });
    expect(whatsappConfigured({ n8nUrl: "u", n8nSecret: "" })).toBe(false);
    expect(whatsappConfigured({ n8nUrl: "u", n8nSecret: "s" })).toBe(true);
    expect(emailConfigured({ emailFrom: "a@b" })).toBe(true);
    expect(emailConfigured({ emailFrom: "a@b", emailSwitch: "off" })).toBe(false);
    expect(emailConfigured({})).toBe(false);
    expect(approvalChannelConfigured({ emailFrom: "a@b" })).toBe(true);
    expect(approvalChannelConfigured({})).toBe(false);
  });
  it("asks the database only for the channels that are configured", async () => {
    const both = mk(ok([]));
    await dispatchApprovalRequest("res-1", both.deps);
    expect(both.rpc).toHaveBeenCalledWith("fm_approval_prepare", { p_reservation_id: "res-1", p_rotate: false, p_channels: ["whatsapp", "email"] });
    const onlyMail = mk(ok([]), { env: { emailFrom: "a@b" } });
    await dispatchApprovalRequest("res-1", onlyMail.deps);
    expect(onlyMail.rpc).toHaveBeenCalledWith("fm_approval_prepare", expect.objectContaining({ p_channels: ["email"] }));
    const noMail = mk(ok([]), { env: { ...env, emailSwitch: "off" } });
    await dispatchApprovalRequest("res-1", noMail.deps);
    expect(noMail.rpc).toHaveBeenCalledWith("fm_approval_prepare", expect.objectContaining({ p_channels: ["whatsapp"] }));
  });
  it("sends the signed WhatsApp JSON to n8n and the e-mail with the confirmation link, recording each delivery", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    const { rpc, sendEmail, deps } = mk(ok([wa, mail]), { fetch: fetchMock as unknown as typeof fetch });
    const r = await dispatchApprovalRequest("res-1", deps);
    expect(r).toEqual({ status: "done", results: [{ channel: "whatsapp", status: "sent", requestId: "req-wa" }, { channel: "email", status: "sent", requestId: "req-mail" }] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(env.n8nUrl);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-fleet-timestamp"]).toBe("1790000000");
    expect(verifySignature({ rawBody: String(init.body), secret: env.n8nSecret, timestamp: headers["x-fleet-timestamp"]!, signature: headers["x-fleet-signature"]!, nowSeconds: 1790000000 })).toBe(true);
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ type: "approval_request", request_id: "req-wa", reservation_id: "res-1", to: "+5511987654321" });
    expect(sent.message.buttons).toHaveLength(2);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "gestor@example.invalid", subject: expect.stringContaining("Maria Solicitante") }));
    expect(String((sendEmail.mock.calls[0] as unknown[])[0] && (sendEmail.mock.calls[0] as { html: string }[])[0]!.html)).toContain(`/aprovar/${mail.token}`);
    expect(rpc).toHaveBeenCalledWith("fm_approval_mark_delivery", { p_request_id: "req-wa", p_ok: true, p_error: null });
    expect(rpc).toHaveBeenCalledWith("fm_approval_mark_delivery", { p_request_id: "req-mail", p_ok: true, p_error: null });
  });
  it("a failing channel is recorded and never stops the other one nor throws", async () => {
    const down = mk(ok([wa, mail]), { fetch: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch });
    const r = await dispatchApprovalRequest("res-1", down.deps);
    expect(r).toEqual({ status: "done", results: [{ channel: "whatsapp", status: "failed", requestId: "req-wa", error: "http_500" }, { channel: "email", status: "sent", requestId: "req-mail" }] });
    expect(down.rpc).toHaveBeenCalledWith("fm_approval_mark_delivery", { p_request_id: "req-wa", p_ok: false, p_error: "http_500" });
    const boom = mk(ok([wa]), { fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch });
    expect(((await dispatchApprovalRequest("res-1", boom.deps)) as { results: { status: string }[] }).results[0]!.status).toBe("failed");
    const smtp = mk(ok([mail]), { sendOk: false, env: { emailFrom: "a@b" } });
    expect(await dispatchApprovalRequest("res-1", smtp.deps)).toEqual({ status: "done", results: [{ channel: "email", status: "failed", requestId: "req-mail", error: "smtp_down" }] });
    expect(smtp.rpc).toHaveBeenCalledWith("fm_approval_mark_delivery", { p_request_id: "req-mail", p_ok: false, p_error: "smtp_down" });
  });
  it("skips quietly when there is no manager, nothing to send, or the database refuses", async () => {
    for (const reason of ["no_manager", "no_contact", "not_pending", "already_pending"]) {
      const { deps } = mk({ ok: false, reason });
      expect(await dispatchApprovalRequest("res-1", deps)).toEqual({ status: "skipped", reason });
    }
    const err = mk(null);
    err.rpc.mockResolvedValue({ data: null, error: { message: "boom" } } as never);
    expect(await dispatchApprovalRequest("res-1", err.deps)).toEqual({ status: "skipped", reason: "prepare_error" });
  });
});
