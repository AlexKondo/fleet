import { describe, expect, it, vi } from "vitest";
import { buildRiderMessage, notifyRiderOfDecision } from "./notifyRider";

const ENV = { approvalUrl: "https://n8n.example.invalid/webhook/fleet-approval-request", secret: "s3cret" };
const BASE = { ok: true, phone_e164: "+5511982593096", host_name: "João Souza", destination: "EZ Tower", departure_at: "2026-10-29T12:00:00Z", plate: "CCD0710", vehicle_name: "Ora 05 BEV" };
const deps = (data: unknown, f?: typeof fetch) => ({ rpc: async () => ({ data, error: null }), env: ENV, fetch: f, now: () => 1_800_000_000_000 });

describe("message to the rider", () => {
  it("accepted: the host will take them, with the trip details", () => {
    const t = buildRiderMessage({ ...BASE, status: "ACCEPTED" })!;
    expect(t).toContain("*João Souza aceitou levar você de carona!*");
    expect(t).toContain("Destino: EZ Tower");
    expect(t).toContain("Veículo: Ora 05 BEV (CCD0710)");
  });
  it("refused: says so and carries the host's justification", () => {
    const t = buildRiderMessage({ ...BASE, status: "REJECTED" }, "Vou sair mais cedo e o carro já estará cheio")!;
    expect(t).toContain("*João Souza não poderá levar você de carona.*");
    expect(t).toContain("Motivo: Vou sair mais cedo e o carro já estará cheio");
  });
  it("a justification cannot add formatting; a request still pending says nothing", () => {
    expect(buildRiderMessage({ ...BASE, status: "REJECTED" }, "*urgente* _ok_")).toContain("Motivo: urgente ok");
    expect(buildRiderMessage({ ...BASE, status: "PENDING" })).toBeNull();
  });
});

describe("notifyRiderOfDecision", () => {
  it("posts the signed message to n8n", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await notifyRiderOfDecision("req-1", "Sem lugar", deps({ ...BASE, status: "REJECTED" }, f as unknown as typeof fetch))).toEqual({ status: "sent" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://n8n.example.invalid/webhook/fleet-notify");
    expect(JSON.parse(String(init.body))).toMatchObject({ type: "carpool_decision", to: "+5511982593096" });
    expect(String(init.body)).toContain("Motivo: Sem lugar");
  });
  it("sends nothing while pending or without a number, and never throws", async () => {
    const f = vi.fn();
    expect(await notifyRiderOfDecision("r", null, deps({ ...BASE, status: "PENDING" }, f as unknown as typeof fetch))).toEqual({ status: "skipped", reason: "not_decided" });
    expect(await notifyRiderOfDecision("r", null, deps({ ok: false, reason: "no_phone" }, f as unknown as typeof fetch))).toEqual({ status: "skipped", reason: "no_phone" });
    expect(f).not.toHaveBeenCalled();
    expect(await notifyRiderOfDecision("r", null, deps({ ...BASE, status: "ACCEPTED" }, (async () => { throw new Error("down"); }) as unknown as typeof fetch))).toMatchObject({ status: "failed" });
  });
});
