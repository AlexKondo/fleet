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
  it("a name typed by the user cannot add WhatsApp formatting", () => {
    expect(buildHostMessage({ ...NOTICE, rider_name: "*Hack* _x_" })).toContain("*Hack x vai de carona com você!*");
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
  it("sends nothing without a registered number, and never throws", async () => {
    const f = vi.fn();
    expect(await notifyHostOfCarpool("req-1", deps({ ok: false, reason: "no_phone" }, f as unknown as typeof fetch))).toEqual({ status: "skipped", reason: "no_phone" });
    expect(f).not.toHaveBeenCalled();
    expect(await notifyHostOfCarpool("req-1", deps(NOTICE, (async () => { throw new Error("down"); }) as unknown as typeof fetch))).toMatchObject({ status: "failed" });
  });
});
