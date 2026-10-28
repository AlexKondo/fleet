import { describe, expect, it, vi } from "vitest";
import { verifySignature } from "@/lib/approvals/whatsappApproval";
import { buildHostMessage, notifyHostOfCarpool } from "./notifyHost";

const ENV = { approvalUrl: "https://n8n.example.invalid/webhook/fleet-approval-request", secret: "s3cret" };
const NOTICE = { ok: true, phone_e164: "+5511982593096", status: "ACCEPTED", rider_name: "Maria Silva", seats: 1, pickup_label: "Av. Paulista, 1000", destination: "EZ Tower", departure_at: "2026-10-29T12:00:00Z", plate: "CCD0710", vehicle_name: "Ora 05 BEV" };
const deps = (data: unknown, fetchFn?: typeof fetch) => ({ rpc: async () => ({ data, error: null }), env: ENV, fetch: fetchFn, now: () => 1_800_000_000_000 });

describe("message to the host", () => {
  it("accepted: 'Fulano vai de carona com você', with when, where and the vehicle", () => {
    const t = buildHostMessage(NOTICE);
    expect(t).toContain("*Maria Silva vai de carona com você!*");
    expect(t).toContain("Destino: EZ Tower");
    expect(t).toContain("Embarque: Av. Paulista, 1000");
    expect(t).toContain("Veículo: Ora 05 BEV (CCD0710)");
    expect(t).not.toContain("Abra o FleetMind");
  });
  it("still waiting for the host's answer: says it is a request and where to answer it", () => {
    const t = buildHostMessage({ ...NOTICE, status: "PENDING", seats: 2 });
    expect(t).toContain("*Maria Silva pediu carona com você.* (2 lugares)");
    expect(t).toContain("Minhas Caronas");
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
  it("sends nothing without a registered number, and never throws", async () => {
    const f = vi.fn();
    expect(await notifyHostOfCarpool("req-1", deps({ ok: false, reason: "no_phone" }, f as unknown as typeof fetch))).toEqual({ status: "skipped", reason: "no_phone" });
    expect(f).not.toHaveBeenCalled();
    expect(await notifyHostOfCarpool("req-1", deps(NOTICE, (async () => { throw new Error("down"); }) as unknown as typeof fetch))).toMatchObject({ status: "failed" });
  });
});
