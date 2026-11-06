import { describe, expect, it, vi } from "vitest";
import { verifySignature } from "@/lib/approvals/whatsappApproval";
import { buildHostMessage, notifyHostOfCarpool } from "./notifyHost";

const ENV = { approvalUrl: "https://n8n.example.invalid/webhook/fleet-approval-request", secret: "s3cret" };
const NOTICE = { ok: true, phone_e164: "+5511982593096", status: "ACCEPTED", rider_name: "Maria Silva", seats: 1, pickup_label: "Av. Paulista, 1000", destination: "EZ Tower", departure_at: "2026-10-29T12:00:00Z", plate: "CCD0710", vehicle_name: "Ora 05 BEV" };
const deps = (data: unknown, fetchFn?: typeof fetch) => ({ rpc: async () => ({ data, error: null }), env: ENV, fetch: fetchFn, now: () => 1_800_000_000_000 });

describe("message to the host", () => {
  it("accepted: 'Fulano vai de carona com você', with the details of the reservation", () => {
    const t = buildHostMessage(NOTICE);
    expect(t).toContain("*Maria Silva vai de carona com você!*");
    expect(t).toContain("Destino: EZ Tower");
    expect(t).toContain("Veículo: Ora 05 BEV (CCD0710)");
    expect(t).toContain("Embarque do passageiro: Av. Paulista, 1000");
    expect(t).not.toContain("Você aceita levar?");
  });
  it("waiting for the host: says who wants the ride, the reservation details and asks if he accepts", () => {
    const t = buildHostMessage({ ...NOTICE, status: "PENDING", seats: 2 });
    expect(t).toContain("*Maria Silva quer ir de carona com você.* (2 lugares)");
    expect(t).toContain("*Sua reserva:*");
    expect(t).toMatch(/Saída: .* às 09:00/);
    expect(t).toContain("Você aceita levar?");
  });
  it("a detour above the policy limit is told before asking", () => {
    const text = buildHostMessage({ ...NOTICE, status: "PENDING", detour_km: "8.2", detour_min: "15", limit_km: "5", limit_min: "10" });
    expect(text).toContain("⚠️ Desvio de 8.2 km e 15 min, acima do limite da política (5 km e 10 min).");
    expect(text.indexOf("⚠️")).toBeLessThan(text.indexOf("Você aceita levar?"));
  });
  it("within the limit, or already accepted, there is no warning", () => {
    expect(buildHostMessage({ ...NOTICE, status: "PENDING", detour_km: 5, detour_min: 10, limit_km: 5, limit_min: 10 })).not.toContain("⚠️");
    expect(buildHostMessage({ ...NOTICE, status: "ACCEPTED", detour_km: 8, detour_min: 15, limit_km: 5, limit_min: 10 })).not.toContain("⚠️");
  });
  it("with the rider hidden by the policy the message says a colleague", () => {
    expect(buildHostMessage({ ...NOTICE, status: "PENDING", rider_name: null })).toContain("*Um colega quer ir de carona com você.*");
  });
  it("a name typed by the user cannot add WhatsApp formatting", () => {
    expect(buildHostMessage({ ...NOTICE, rider_name: "*Hack* _x_" })).toContain("*Hack x vai de carona com você!*");
  });
  it("cancelled by the rider: says who left, that the seat is free, what the rider wrote and the reservation", () => {
    const t = buildHostMessage({ ...NOTICE, status: "CANCELLED", seats: 2 }, { note: "não irei mais" });
    expect(t).toContain("❌ *Maria Silva cancelou a carona com você.* (2 lugares)");
    expect(t).toContain("A vaga foi liberada.");
    expect(t).toContain("Mensagem do carona: não irei mais");
    expect(t).toContain("*Sua reserva:*");
    expect(t).toContain("Destino: EZ Tower");
    expect(t).toContain("Veículo: Ora 05 BEV (CCD0710)");
    // no question, no pick-up place of somebody who is no longer coming
    expect(t).not.toContain("Você aceita levar?");
    expect(t).not.toContain("Embarque do passageiro");
  });
  it("cancelled without a text from the rider: no 'Mensagem do carona' line; the text cannot add formatting", () => {
    expect(buildHostMessage({ ...NOTICE, status: "CANCELLED" })).not.toContain("Mensagem do carona");
    expect(buildHostMessage({ ...NOTICE, status: "CANCELLED" }, { note: "   " })).not.toContain("Mensagem do carona");
    expect(buildHostMessage({ ...NOTICE, status: "CANCELLED" }, { note: "*urgente* _ok_" })).toContain("Mensagem do carona: urgente ok");
  });
});

describe("notifyHostOfCarpool", () => {
  it("posts a signed notice to the n8n notice endpoint", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await notifyHostOfCarpool("req-1", deps(NOTICE, f as unknown as typeof fetch))).toEqual({ status: "sent" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://n8n.example.invalid/webhook/fleet-notify");
    const h = init.headers as Record<string, string>;
    expect(verifySignature({ rawBody: String(init.body), secret: "s3cret", timestamp: h["x-fleet-timestamp"]!, signature: h["x-fleet-signature"]!, nowSeconds: 1_800_000_000 })).toBe(true);
    expect(JSON.parse(String(init.body))).toMatchObject({ type: "carpool_notice", to: "+5511982593096", request_id: "req-1" });
  });
  it("a pending request carries the Aceitar / Recusar buttons with the single-use token; an accepted one has none", async () => {
    const tok = "a".repeat(64);
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    await notifyHostOfCarpool("req-1", deps({ ...NOTICE, status: "PENDING", token: tok }, f as unknown as typeof fetch));
    const sent = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.buttons).toEqual([{ id: `cp:yes:${tok}`, title: "Aceitar" }, { id: `cp:no:${tok}`, title: "Recusar" }]);
    f.mockClear();
    await notifyHostOfCarpool("req-1", deps({ ...NOTICE, status: "ACCEPTED", token: null }, f as unknown as typeof fetch));
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).buttons).toBeUndefined();
  });
  it("a cancelled seat goes as a plain text notice (no buttons) with the rider's words", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await notifyHostOfCarpool("req-1", deps({ ...NOTICE, status: "CANCELLED", token: null }, f as unknown as typeof fetch), { note: "não irei mais" })).toEqual({ status: "sent" });
    const sent = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent).toMatchObject({ type: "carpool_notice", to: "+5511982593096", request_id: "req-1", title: "Carona cancelada" });
    expect(sent.buttons).toBeUndefined();
    expect(sent.text).toContain("cancelou a carona com você");
    expect(sent.text).toContain("Mensagem do carona: não irei mais");
  });
  it("sends nothing without a registered number, and never throws", async () => {
    const f = vi.fn();
    expect(await notifyHostOfCarpool("req-1", deps({ ok: false, reason: "no_phone" }, f as unknown as typeof fetch))).toEqual({ status: "skipped", reason: "no_phone" });
    expect(f).not.toHaveBeenCalled();
    expect(await notifyHostOfCarpool("req-1", deps(NOTICE, (async () => { throw new Error("down"); }) as unknown as typeof fetch))).toMatchObject({ status: "failed" });
  });
});
